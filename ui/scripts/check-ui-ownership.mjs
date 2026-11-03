import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { loadApp } from './lib/hook-test-host.mjs';
const app = loadApp(new Map(), { isolateCustomization: false });
const optional = (file) => (existsSync(new URL('../src/' + file, import.meta.url)) ? app(file) : {});
const sites = optional('customization/site-transform.ts');
const selectors = optional('customization/selectors.ts');
const registry = optional('customization/ownership.ts');
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const locator = (site, key = null, business = []) => ({
  version: 1,
  renderRoot: 'launcher.main',
  calls: [{ site, key }],
  business,
});
const owner = (ownerId, loc) => ({
  ownerId,
  parentOwnerId: null,
  target: 'control.field',
  site: loc.calls.at(-1).site,
  locator: loc,
  stability: 'stable',
  roots: new Set(),
  metadata: { nameKey: null, type: 'control', sourcePath: 'field.tsx', routeId: null },
  catalogPresentation: false,
  viewId: null,
  layerId: null,
});

await test('shared AST sites distinguish calls, retain explicit positions, reject duplicate declarations and protect aliases', () => {
  assert.equal(
    typeof sites.instrumentSites,
    'function',
    'shared site instrumentation is implemented',
  );
  const source =
    'export default () => <><Field data-ui-site="first"/><Field data-ui-site="second"/></>';
  const first = sites.instrumentSites(source, 'views/form.tsx', 'tsx');
  const inserted = sites.instrumentSites(
    'const before = <div/>;\n' + source,
    'views/form.tsx',
    'tsx',
  );
  assert.ok([...first.sites.keys()].some((key) => key.includes('first')));
  assert.ok(
    [...first.sites.keys()]
      .filter((key) => key.includes('first') || key.includes('second'))
      .every((key) => inserted.sites.has(key)),
  );
  assert.throws(
    () =>
      sites.instrumentSites(
        '<><i data-ui-site="same"/><b data-ui-site="same"/></>',
        'x.tsx',
        'tsx',
      ),
    /duplicate/i,
  );
  const privateSource =
    'import {LauncherProvider as P} from "./launcher/LauncherProvider"; import * as F from "@paradox/ui"; const X=P; const Y=(F.UiFoundationProvider); export const A=()=> <X><Y><F.Button/></Y></X>';
  const transformed = sites.instrumentSites(privateSource, 'src/host.tsx', 'tsx');
  assert.equal(transformed.sites.size, 1);
  assert.ok(transformed.source.includes('data-ui-site'));
  const html = sites.instrumentSites(
    '<section data-ui-site="first"><input><span title=">">x</span></section>',
    'views/a.html',
    'html',
  );
  assert.equal(html.sites.size, 3);
  assert.ok(![...html.sites.keys()].some((site) => first.sites.has(site)));
});

await test('complete selector SHA index verifies original structures including constructed legacy token collisions', () => {
  assert.equal(typeof selectors.selectorDigest, 'function', 'full selector digest is implemented');
  const one = {
    kind: 'position',
    target: 'control.field',
    locator: locator('field', '7', [{ namespace: 'account', value: 'same' }]),
  };
  const expected = createHash('sha256')
    .update(app('ui-suite/canonical.ts').canonicalSuiteJson(one))
    .digest('hex');
  assert.equal(selectors.selectorDigest(one), expected);
  assert.equal(selectors.normalizeUiKey(7), '7');
  assert.equal(selectors.normalizeUiKey(7n), '7');
  assert.equal(selectors.normalizeUiKey('7'), '7');
  const index = new selectors.SelectorIndex(() => 'collision');
  const two = { ...one, locator: locator('another', '7') };
  index.add(one, 'a');
  index.add(two, 'b');
  assert.deepEqual(index.get(one).values, ['a']);
  assert.equal(index.get(one).collision, true);
  const legacy = app('customization/identity.ts');
  const raw = 'account with spaces';
  assert.equal(legacy.identityToken(raw), legacy.identityToken(legacy.identityToken(raw)));
  assert.notEqual(
    selectors.selectorDigest({
      kind: 'business',
      target: 'account',
      identity: { namespace: 'account', value: raw },
    }),
    selectors.selectorDigest({
      kind: 'business',
      target: 'account',
      identity: { namespace: 'account', value: legacy.identityToken(raw) },
    }),
  );
});

await test('registry rejects duplicate precise keys and unkeyed repeats while retaining valid broad matches and lease cleanup', () => {
  assert.equal(typeof registry.registerOwner, 'function', 'one ownership registry is implemented');
  const loc = locator('field', '7', [{ namespace: 'account', value: 'a' }]);
  const a = registry.registerOwner(owner('a', loc));
  const b = registry.registerOwner(owner('b', structuredClone(loc)));
  assert.equal(
    registry.resolveSelector({ kind: 'position', target: 'control.field', locator: loc }).status,
    'ambiguous',
  );
  assert.notEqual(
    registry.resolveSelector({
      kind: 'business',
      target: 'control.field',
      identity: { namespace: 'account', value: 'a' },
    }).status,
    'ambiguous',
  );
  b();
  a();
  const unkeyed = locator('repeat');
  const c = registry.registerOwner(owner('c', unkeyed));
  const d = registry.registerOwner(owner('d', unkeyed));
  assert.equal(
    registry.resolveSelector({ kind: 'position', target: 'control.field', locator: unkeyed })
      .status,
    'unsupported',
  );
  const current = registry.registerOwner(owner('c', locator('new', 'c')));
  c();
  assert.equal(registry.getOwner('c').site, 'new');
  current();
  d();
  assert.equal(registry.listOwners().length, 0);
});

await test('unmounted boundaries and plural source definitions survive without guessing source from IDs', () => {
  assert.equal(
    typeof registry.publishUiDefinitions,
    'function',
    'source definition publication is implemented',
  );
  const selector = { kind: 'type', target: 'control.field' };
  const release = registry.publishUiDefinitions({
    key: 'layer',
    definitions: [
      {
        target: 'control.field',
        site: 'first',
        sourcePath: 'a.tsx',
        nameKey: 'field.name',
        type: 'control',
        routeId: 'home',
        viewId: 'page.home',
      },
      {
        target: 'control.field',
        site: 'second',
        sourcePath: 'b.tsx',
        nameKey: null,
        type: 'control',
        routeId: 'settings',
        viewId: 'page.settings',
      },
    ],
  });
  assert.deepEqual(
    registry
      .getTargetMetadata(selector)
      .map((m) => m.sourcePath)
      .sort(),
    ['a.tsx', 'b.tsx'],
  );
  const root = registry.getSuiteStyleRoot('launcher.main');
  assert.match(root.resolveTarget(selector), /data-ui-selector/);
  assert.equal(registry.resolveSelector(selector).status, 'unmounted');
  assert.equal(
    root.resolveTarget({
      kind: 'position',
      target: 'control.field',
      locator: { ...locator('other'), renderRoot: 'launcher.editor' },
    }),
    null,
  );
  release();
  assert.deepEqual(registry.getTargetMetadata(selector), []);
});

await test('real shared JSX native style consumes the entire activated inline resolver result', () => {
  const { SuiteInlineStyleContext } = app('ui-suite/prepared.ts');
  const { jsx } = app('customization/jsx-runtime.tsx');
  const html = renderToStaticMarkup(
    React.createElement(
      SuiteInlineStyleContext.Provider,
      {
        value: (style) => ({
          ...style,
          animationName: 'renamed',
          '--suite-private-mirror': 'renamed',
        }),
      },
      jsx('div', { style: { animationName: 'pulse' } }),
    ),
  );
  assert.match(html, /animation-name:renamed/);
  assert.match(html, /--suite-private-mirror:renamed/);
});

await test('actual JSX Context accumulates call keys and business ancestry across keyed Fragment without wrappers', () => {
  const { jsx, Fragment } = app('customization/jsx-runtime.tsx');
  const context = app('customization/context.ts');
  const identity = optional('ui-foundation/Identity.tsx');
  const frames = [];
  function Probe() {
    const value = context.UiOwnerContext ? React.useContext(context.UiOwnerContext) : null;
    frames.push(value);
    return React.createElement('input');
  }
  function Row() {
    return jsx(Probe, { 'data-ui-site': 'site:row:child' }, 7n);
  }
  const child = jsx(
    Fragment,
    { 'data-ui-site': 'site:group', children: jsx(Row, { 'data-ui-site': 'site:row' }, 'parent') },
    9,
  );
  const html = renderToStaticMarkup(
    identity.UiIdentity
      ? React.createElement(identity.UiIdentity, { namespace: 'account', value: 'same' }, child)
      : child,
  );
  assert.equal(html, '<input/>');
  assert.deepEqual(
    frames[0]?.locator.calls.map((call) => call.key),
    ['9', 'parent', '7'],
  );
  assert.deepEqual(frames[0]?.locator.business, [{ namespace: 'account', value: 'same' }]);
});
await test('shared Vite transform preserves generic async TypeScript helpers', () => {
  const transformed = sites.instrumentSites(
    'export const run = async <T>(operation:()=>Promise<T>):Promise<T> => { return await operation(); };',
    'src/helper.ts',
    'tsx',
  );
  const ts = require('typescript');
  const result = ts.transpileModule(transformed.source, {
    fileName: 'helper.ts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(
    result.diagnostics?.filter((row) => row.category === ts.DiagnosticCategory.Error),
    [],
  );
});
await test('parent mount lease cleanup removes orphan descendants but replacement publication keeps them', () => {
  const parent = registry.registerOwner(owner('parent', locator('parent')));
  const child = registry.registerOwner({
    ...owner('child', locator('child')),
    parentOwnerId: 'parent',
  });
  const replacement = registry.registerOwner(owner('parent', locator('changed')));
  parent();
  assert.ok(registry.getOwner('child'));
  replacement();
  assert.equal(registry.getOwner('child'), null);
  child();
});
await test('private Context and Recovery aliases stay outside the shared target catalog', () => {
  const result = sites.instrumentSites(
    'import {createContext as context} from "react";import Rescue from "./ui-editor/RecoveryHost";const C=context(null);const P=C.Provider;const Q=P;export default()=> <Rescue><Q><button/></Q></Rescue>',
    'src/host.tsx',
    'tsx',
  );
  assert.equal(result.sites.size, 1);
});
await test('Task10 permanent editor direct and alias imports stay private while visible editor sources remain eligible', () => {
  const result = sites.instrumentSites(
    'import {UiEditorProvider as P} from "./ui-editor/controller";import {NormalEditorHost as H,RecoveryHost as R} from "./ui-editor/host";import Editor from "./ui-editor/Editor";const A=P;const B=H;export default()=> <A><B/><R/><Editor/><button/></A>',
    'src/composition.tsx', 'tsx',
  );
  assert.equal(result.sites.size, 2);
  assert.doesNotMatch(result.source, /data-ui-node="component\.(a|b|r)"/);
  assert.match(result.source, /data-ui-node="component\.editor"/);
});
await test('equivalent publication settles and readonly snapshots cannot mutate registry state', async () => {
  let count = 0;
  const stop = registry.subscribeOwners(() => count++);
  const record = owner('equal', locator('equal', '1'));
  const first = registry.registerOwner(record);
  await Promise.resolve();
  const before = registry.listOwners();
  const after = registry.registerOwner({ ...record });
  await Promise.resolve();
  assert.equal(registry.listOwners(), before);
  assert.equal(count, 1);
  assert.equal(typeof registry.getOwner('equal').roots.add, 'undefined');
  first();
  assert.ok(registry.getOwner('equal'));
  after();
  await Promise.resolve();
  stop();
});
await test('composed caller ref cleanup is idempotent', () => {
  const { useRegisteredRef } = app('customization/runtime.tsx');
  let composed,
    calls = 0;
  function RefProbe() {
    composed = useRegisteredRef(() => () => {
      calls++;
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(RefProbe));
  const release = composed({ nodeType: 0 });
  release();
  release();
  assert.equal(calls, 1);
});
await test('fix1 I1 private aliases retain declaration-scope and immutable destructuring provenance', () => {
  const sources = [
    'import {UiFoundationProvider as P} from "@paradox/ui";const Private=P;function View(P:unknown){return <Private><button/></Private>}',
    'import {createContext} from "react";const {Provider:Private}=createContext(null);export default()=> <Private><button/></Private>',
    'import * as F from "@paradox/ui";const {UiFoundationProvider:Private}=F;const Next=Private;function View(F:unknown){return <Next><button/></Next>}',
  ];
  const results = sources.map((source) => sites.instrumentSites(source, 'src/lexical.tsx', 'tsx'));
  assert.deepEqual(
    results.map((result) => result.sites.size),
    [1, 1, 1],
  );
  for (const result of results) {
    assert.doesNotMatch(result.source, /data-ui-node="component\.(private|next)"/);
  }
  const visible = sites.instrumentSites(
    'import {UiFoundationProvider as P} from "@paradox/ui";function View(){const P=()=> <span/>;const Private=P;return <Private><button/></Private>}',
    'src/shadow.tsx',
    'tsx',
  );
  assert.equal(
    visible.sites.size,
    3,
    'a local visible alias is not mistaken for the outer private import',
  );
});
await test('fix1 I2 unkeyed repetition remains unsupported for its parent lifecycle, keys and distinct business regain support', () => {
  const element = {
    isConnected: true,
    ownerDocument: {
      defaultView: { getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }) },
    },
    getClientRects: () => [{ width: 10, height: 10 }],
    contains: () => false,
  };
  const parent = registry.registerOwner(owner('repeat-parent', locator('parent')));
  const loc = locator('repeat-history');
  const row = (id, position = loc) => ({
    ...owner(id, position),
    parentOwnerId: 'repeat-parent',
    roots: new Set([element]),
  });
  let first = registry.registerOwner(row('first'));
  const second = registry.registerOwner(row('second'));
  const selector = { kind: 'position', target: 'control.field', locator: loc };
  assert.equal(registry.resolveSelector(selector).status, 'unsupported');
  second();
  assert.equal(
    registry.resolveSelector(selector).status,
    'unsupported',
    'two to one keeps repetition provenance',
  );
  first();
  registry.listOwners();
  first = registry.registerOwner(row('different-item'));
  assert.equal(
    registry.resolveSelector(selector).status,
    'unsupported',
    'new item in the same list cannot acquire the old precise selector',
  );
  first();
  const keyedLoc = locator('repeat-history', 'stable');
  const keyed = registry.registerOwner(row('keyed', keyedLoc));
  assert.equal(registry.resolveSelector({ ...selector, locator: keyedLoc }).status, 'resolved');
  keyed();
  const businessLoc = locator('repeat-history', null, [{ namespace: 'account', value: 'unique' }]);
  const business = registry.registerOwner(row('business', businessLoc));
  const otherBusinessLoc = locator('repeat-history', null, [
    { namespace: 'account', value: 'other-unique' },
  ]);
  const otherBusiness = registry.registerOwner(row('other-business', otherBusinessLoc));
  assert.equal(registry.resolveSelector({ ...selector, locator: businessLoc }).status, 'resolved');
  assert.equal(
    registry.resolveSelector({ ...selector, locator: otherBusinessLoc }).status,
    'resolved',
    'distinct business identities independently support unkeyed siblings',
  );
  business();
  otherBusiness();
  parent();
  registry.listOwners();
  const fresh = registry.registerOwner({ ...owner('fresh', loc), roots: new Set([element]) });
  assert.equal(
    registry.resolveSelector(selector).status,
    'resolved',
    'an unrelated fresh parent lifecycle is not poisoned',
  );
  fresh();
});
await test('fix1 I4 pure HTML allocation matches the frozen shared transform without an eager TypeScript import', () => {
  const pure = app('customization/html-sites.ts');
  for (const source of [
    '<section data-ui-site="root"><input><span title=">">Text</span></section>',
    '<!--ignored--><button data-ui-site="persist">A</button>',
    '<textarea>not <b> markup</textarea><i/>',
  ]) {
    const shared = sites.instrumentSites(source, 'F:\\project\\ui\\src\\test.html', 'html');
    const result = pure.instrumentHtmlSites(source, 'F:\\project\\ui\\src\\test.html');
    assert.deepEqual(result, shared);
  }
  assert.throws(
    () => pure.instrumentHtmlSites('<i data-ui-site="same"/><b data-ui-site="same"/>', 'x.html'),
    /duplicate/i,
  );
  assert.match(readFileSync(new URL('../src/customization/html.ts', import.meta.url), 'utf8'), /from '\.\/html-sites'/);
  assert.doesNotMatch(
    readFileSync(new URL('../src/customization/html-sites.ts', import.meta.url), 'utf8'),
    /from ['"]typescript['"]/,
  );
});

await test('Task13 main modal guard preserves business dialogs while editor Dialog owns dismissal', () => {
  const runtime = app('customization/jsx-runtime.tsx');
  const contexts = app('customization/context.ts');
  const { UiRuntimeRoot } = app('customization/runtime.tsx');
  for (const id of ['launcher.main', 'launcher.editor']) {
    let forwarded, called = false;
    function Modal(props) { forwarded = props; return React.createElement('div'); }
    renderToStaticMarkup(React.createElement(contexts.UiInteractionContext.Provider, { value: { editing: true } },
      React.createElement(UiRuntimeRoot, { id }, runtime.jsx(Modal, {
        'data-ui-site': 'Task13-modal', 'data-ui-modal-boundary': true, modal: true,
        onOpenChange: () => { called = true; },
      }))));
    let cancelled = false;
    forwarded.onOpenChange(false, { cancel() { cancelled = true; } });
    assert.equal(cancelled, id === 'launcher.main', 'only the business root preserves its dialog');
    assert.equal(called, id === 'launcher.editor', 'editor reaches its own close callback');
    assert.equal(forwarded.modal, id === 'launcher.editor', 'editor keeps modal focus ownership');
  }
});

