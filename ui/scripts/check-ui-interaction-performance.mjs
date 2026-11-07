import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, library } from './lib/suite-test-fixtures.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const tick = () => new Promise(yes => setImmediate(yes));
const locator = (site, key = 'stable') => ({
  version: 1, renderRoot: 'launcher.main', calls: [{ site, key }], business: [],
});
function element(name, parentElement = null, metrics = {}) {
  const attrs = new Map();
  return {
    name, parentElement, isConnected: true, tagName: 'BUTTON', textContent: name,
    ownerDocument: { getElementById: () => null, defaultView: {
      innerWidth: 1000, innerHeight: 800,
      getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }),
    } },
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute(name, value) { metrics.writes = (metrics.writes ?? 0) + 1; attrs.set(name, value); },
    removeAttribute(name) { metrics.writes = (metrics.writes ?? 0) + 1; attrs.delete(name); },
    getClientRects() {
      metrics.rects = (metrics.rects ?? 0) + 1;
      return [{ width: 20, height: 10, left: 1, right: 21, top: 1, bottom: 11 }];
    },
    contains(other) {
      metrics.contains = (metrics.contains ?? 0) + 1;
      for (let node = other; node; node = node.parentElement) if (node === this) return true;
      return false;
    },
  };
}
const owner = (id, roots = [], position = locator(id), target = 'element.button') => ({
  ownerId: id, parentOwnerId: null, target, site: position.calls.at(-1)?.site ?? null,
  locator: position, stability: 'stable', roots: new Set(roots),
  metadata: { nameKey: null, type: 'element', sourcePath: 'Home.tsx', routeId: 'home' },
  catalogPresentation: false, viewId: null, layerId: 'test.layer',
});
const position = row => ({ kind: 'position', target: row.target, locator: row.locator });
function prepared(targetBindings = []) {
  return { digest: 'fixture', views: new Map(), routes: [], css: '', sourceDefinitions: [],
    viewMetadata: new Map(), targetBindings, styleUsages: [], styleGroups: new Map(), dispose() {} };
}
async function controllerFixture(app, getTargetContext = () => ({})) {
  const b = bundle();
  const controller = app('ui-editor/controller.tsx').createUiEditorController({
    storage: { loadSuiteLibrary: async () => library([]) },
    getBuiltinBundle: async () => structuredClone(b), createScope: () => ({}),
    compile: async () => prepared(), exportFile: async () => {},
    acquireInteractionPublisher: () => ({ publish() {}, release() {} }),
    getTargetContext, safe: true,
  });
  const disconnect = controller.connect();
  for (let i = 0; i < 20; i++) await tick();
  return { controller, disconnect };
}

// Catches eager connection, owner/language/provider refreshes and draft publication.
await test('closed editor skips the full catalog and its layout/context reads', async () => {
  const app = loadApp(), registry = app('customization/ownership.ts'), metrics = {};
  const stop = registry.registerOwner(owner('closed', [element('Closed', null, metrics)]));
  let contexts = 0;
  const { controller, disconnect } = await controllerFixture(app, () => { contexts++; return {}; });
  try {
    controller.refreshTargets();
    app('i18n.ts').default.emit('languageChanged', 'zh-CN');
    await tick();
    assert.equal(controller.getSnapshot().open, false);
    assert.equal(contexts, 0, 'closed editor must not reconstruct catalog context');
    assert.equal(metrics.rects ?? 0, 0, 'closed editor must not read target layouts');
    assert.deepEqual(controller.getSnapshot().targets, []);
  } finally { disconnect(); stop(); }
});

// Catches stale reopening when owner changes have not reached their microtask.
await test('opening and recovery reopening publish current targets synchronously', async () => {
  const app = loadApp(), registry = app('customization/ownership.ts');
  const { controller, disconnect } = await controllerFixture(app);
  let stop = () => {};
  try {
    const first = owner('first', [element('First')]);
    stop = registry.registerOwner(first);
    controller.actions.open();
    assert.ok(controller.getSnapshot().targets.some(row => row.ownerId === 'first'));
    controller.actions.selectTarget(position(first));
    controller.actions.close();
    stop();
    const second = owner('second', [element('Second')]);
    stop = registry.registerOwner(second);
    controller.recovery.openBuiltinEditor();
    const current = controller.getSnapshot();
    assert.equal(current.mode, 'builtin');
    assert.ok(current.targets.some(row => row.ownerId === 'second'));
    assert.equal(current.targets.some(row => row.ownerId === 'first'), false);
    assert.equal(current.currentTarget.status, 'unmounted');
    assert.equal(current.selection.selector.locator.calls[0].site, 'first');
    controller.actions.close();
    controller.actions.patchManifest({ overrides: [{ selector: { kind: 'type', target: 'control.future' }, enabled: false, stylesheet: null, entry: null }] });
    controller.actions.open();
    assert.ok(controller.getSnapshot().targets.some(row => row.selector.target === 'control.future'), 'reopening includes closed draft changes without a runtime mount');
  } finally { disconnect(); stop(); }
});

await test('closed active selection refreshes only its descriptor while unrelated catalog stays deferred', async () => {
  const overrides = new Map(), app = loadApp(overrides), canonical = app('ui-suite/canonical.ts');
  let retainedCatalog = null, catalogSerializations = 0;
  overrides.set(resolve(uiRoot, 'src/ui-suite/canonical.ts'), {
    ...canonical, canonicalSuiteJson(value) {
      if (retainedCatalog && value === retainedCatalog) catalogSerializations++;
      return canonical.canonicalSuiteJson(value);
    },
  });
  const registry = app('customization/ownership.ts'), metrics = {};
  const { controller, disconnect } = await controllerFixture(app);
  const selected = owner('selected', [element('Selected')]);
  const stopSelected = registry.registerOwner(selected);
  let stopOther = () => {}, stopNotifications = () => {};
  try {
    controller.actions.open(); controller.actions.selectTarget(position(selected)); controller.actions.close();
    retainedCatalog = controller.getSnapshot().targets;
    assert.ok(retainedCatalog.length >= 2);
    const statuses = [];
    stopNotifications = controller.subscribe(() => statuses.push(controller.getSnapshot().currentTarget?.status));
    stopOther = registry.registerOwner(owner('unrelated', [element('Unrelated', null, metrics)], locator('unrelated'), 'element.input'));
    await tick(); controller.refreshTargets();
    assert.equal(metrics.rects ?? 0, 0, 'selected target refresh must not enumerate unrelated layouts');
    assert.equal(catalogSerializations, 0, 'closed refresh must not serialize the retained full catalog');
    stopSelected(); await tick();
    assert.equal(controller.getSnapshot().currentTarget.status, 'unmounted');
    assert.equal(controller.getSnapshot().scopeChoices.length, 0);
    assert.ok(statuses.includes('unmounted'), 'selection retirement must still notify consumers');
    assert.equal(controller.getSnapshot().targets, retainedCatalog);
    assert.equal(catalogSerializations, 0, 'selection publication must not serialize its unchanged retained catalog');
  } finally { stopNotifications(); disconnect(); stopSelected(); stopOther(); }
});

// Runs the real resolver and Original rendering through public React contexts.
await test('native/type/business surfaces without a matching position binding skip owner snapshots', () => {
  const overrides = new Map(), app = loadApp(overrides, { isolateCustomization: false });
  const registry = app('customization/ownership.ts');
  let reads = 0;
  overrides.set(resolve(uiRoot, 'src/customization/ownership.ts'), {
    ...registry, listOwners() { reads++; return registry.listOwners(); },
  });
  const { SuiteProvider } = app('ui-suite/SuiteProvider.tsx');
  const { UiView } = app('ui-suite/View.tsx');
  const { UiFoundationProvider } = app('ui-foundation/environment.tsx');
  const { LauncherSnapshotContext, LauncherActionsContext } = app('launcher/public/context.ts');
  const { ActiveRouteRegistryContext } = app('launcher/routeRegistry.ts');
  const { UiEditorControllerContext } = app('ui-editor/controller.tsx');
  const target = { kind: 'type', target: 'element.button' };
  function Override({ Original, props }) { return React.createElement(Original, props); }
  const suite = prepared([{ selector: target, Component: Override, styleGroup: 'global' },
    { selector: { kind: 'business', target: 'element.button', identity: { namespace: 'profile', value: 'other' } }, Component: Override, styleGroup: 'global' },
    { selector: { kind: 'position', target: 'element.path', locator: locator('unrelated') }, Component: Override, styleGroup: 'global' }]);
  const layer = { layerId: 'test.layer', prepared: suite };
  const activation = { primary: layer, parent: null, trusted: layer };
  const el = React.createElement;
  reads = 0; // Exclude shared control module initialization; measure this surface render.
  const render = () => renderToStaticMarkup(el(LauncherSnapshotContext.Provider, { value: {} },
    el(LauncherActionsContext.Provider, { value: {} },
      el(ActiveRouteRegistryContext.Provider, { value: { setActiveRouteRegistry() {} } },
        el(UiEditorControllerContext.Provider, { value: { subscribe: () => () => {}, getActivation: () => activation } },
          el(UiFoundationProvider, { value: { theme: 'dark', variables: {}, portalContainer: null, protectedMode: false } },
            el(SuiteProvider, { fallback: suite }, el(UiView, { id: 'element.button', Original: props => el('button', props), props: { children: 'Native' } }))))))));
  assert.match(render(), /<button>Native<\/button>/);
  assert.equal(reads, 0, 'unrelated ownership cannot affect these structural candidates');
  const viewLocator = { version: 1, renderRoot: 'launcher.main', calls: [{ site: 'view:element.button', key: null }], business: [] };
  function PositionOverride() { return el('strong', null, 'Position'); }
  suite.targetBindings.push({ selector: { kind: 'position', target: 'element.button', locator: viewLocator }, Component: PositionOverride, styleGroup: 'global' });
  const stop = registry.registerOwner(owner('matching', [element('Matching')], viewLocator));
  let duplicate = () => {};
  try {
    assert.match(render(), /<strong>Position<\/strong>/);
    assert.ok(reads > 0, 'matching position candidates retain their ownership safety subscription');
    duplicate = registry.registerOwner(owner('duplicate', [element('Duplicate')], viewLocator));
    assert.match(render(), /<button>Native<\/button>/, 'unsafe repeated positions fall through to the broad Original candidate');
  } finally { duplicate(); stop(); }
});

// Catches a mutable-object cache or an unbounded cache while measuring real SHA input work.
await test('equal selectors reuse SHA work, mutable full structures and case stay authoritative, cache evicts', () => {
  const overrides = new Map(), app = loadApp(overrides), canonical = app('ui-suite/canonical.ts');
  let encodes = 0;
  overrides.set(resolve(uiRoot, 'src/ui-suite/canonical.ts'), {
    ...canonical, utf8(value) { encodes++; return canonical.utf8(value); },
  });
  const selectors = app('customization/selectors.ts');
  const one = { kind: 'position', target: 'element.linearGradient', locator: locator('SVG', 'A') };
  const expected = value => createHash('sha256').update(canonical.canonicalSuiteJson(value)).digest('hex');
  for (let i = 0; i < 20; i++) assert.equal(selectors.selectorDigest(structuredClone(one)), expected(one));
  assert.equal(encodes, 1, 'the same complete canonical selector should encode/hash once');
  one.locator.calls[0].key = 'B';
  assert.equal(selectors.selectorDigest(one), expected(one));
  const lower = { ...one, target: 'element.lineargradient' };
  assert.notEqual(selectors.selectorDigest(one), selectors.selectorDigest(lower));
  const collision = new selectors.SelectorIndex(() => 'collision');
  collision.add(one, 'exact'); collision.add(lower, 'lower');
  one.locator.calls[0].key = 'mutated-after-add';
  assert.deepEqual(collision.get({ kind: 'position', target: 'element.linearGradient', locator: locator('SVG', 'B') }), { values: ['exact'], collision: true });
  for (let i = 0; i < 4096; i++) selectors.selectorDigest({ kind: 'type', target: 'stress.' + i });
  const before = encodes; selectors.selectorDigest(lower);
  assert.equal(encodes, before + 1, 'old canonical keys must be evicted from the bounded cache');
});

await test('roots preserve candidate order, ancestry, disconnected and shadow boundaries without pairwise contains', () => {
  const app = loadApp(), registry = app('customization/ownership.ts'), metrics = {};
  const left = element('left', null, metrics), right = element('right', null, metrics);
  const leftLeaf = element('left-leaf', left, metrics), rightLeaf = element('right-leaf', right, metrics);
  const detached = element('detached', null, metrics); detached.isConnected = false;
  const host = element('host', null, metrics);
  // Element.parentElement stops at ShadowRoot: the host does not Node.contains its shadow children.
  const shadow = element('shadow', null, metrics), shadowLeaf = element('shadow-leaf', shadow, metrics);
  const candidates = [leftLeaf, rightLeaf, left, right, detached, host, shadowLeaf, shadow];
  const stop = registry.registerOwner(owner('roots', candidates));
  try {
    assert.deepEqual([...registry.getOwner('roots').roots].map(root => root.name), ['left', 'right', 'detached', 'host', 'shadow']);
    assert.equal(metrics.contains ?? 0, 0, 'roots must not compare every candidate pair');
    leftLeaf.parentElement = right;
    const release = registry.registerOwner(owner('roots', [leftLeaf, left, right]));
    assert.deepEqual([...registry.getOwner('roots').roots].map(root => root.name), ['left', 'right']);
    release();
  } finally { stop(); }
});

await test('equal dirty ownership batches reuse frozen record comparisons and avoid DOM attribute mutations', () => {
  const overrides = new Map(), app = loadApp(overrides), canonical = app('ui-suite/canonical.ts');
  let ownerSerializations = 0;
  overrides.set(resolve(uiRoot, 'src/ui-suite/canonical.ts'), {
    ...canonical, canonicalSuiteJson(value) {
      if (value && typeof value === 'object' && value.ownerId && value.roots === null) ownerSerializations++;
      return canonical.canonicalSuiteJson(value);
    },
  });
  const registry = app('customization/ownership.ts'), metrics = {};
  const root = element('Dom', null, metrics), row = owner('dom', [root]);
  const stopOwner = registry.registerOwner(row);
  const registration = { ownerIds: ['dom'], rootOwnerIds: [], leafOwnerId: 'dom' };
  const stopDom = registry.registerDom(root, registration);
  let stopEquivalent = () => {};
  try {
    const before = registry.listOwners(), mark = root.getAttribute('data-ui-selector');
    assert.match(mark, /^s[0-9a-f]{64} /);
    metrics.writes = 0; ownerSerializations = 0;
    stopEquivalent = registry.registerDom(root, registration);
    assert.equal(registry.listOwners(), before);
    assert.equal(metrics.writes, 0, 'identical selector/root/layer strings must not be written again');
    assert.equal(ownerSerializations, 0, 'unchanged frozen owner inputs must not be canonicalized again');
    stopDom(); registry.listOwners();
    assert.equal(root.getAttribute('data-ui-selector'), mark, 'one remaining DOM lease retains marks');
    stopEquivalent(); registry.listOwners();
    assert.equal(root.getAttribute('data-ui-selector'), null);
  } finally { stopEquivalent(); stopDom(); stopOwner(); }
});
