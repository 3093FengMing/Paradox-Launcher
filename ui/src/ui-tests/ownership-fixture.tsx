/* eslint-disable react-refresh/only-export-components -- Explicit, opt-in browser acceptance fixture. */
import { createElement, Fragment, StrictMode } from 'react';
import type { ReactNode, Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { Field, Input, UiCatalogPresentation, UiIdentity } from '@paradox/ui';
import { UiRuntimeRoot, UiRuntimeView } from '../customization/runtime';
import {
  listOwners,
  getDomOwnership,
  getOwner,
  resolveSelector,
  collectVisibleRects,
  subscribeOwners,
  getTargetMetadata,
  publishUiDefinitions,
  getSuiteStyleRoot,
} from '../customization/ownership';
import type { UiOwnerRecord } from '../customization/ownership';
import { SuiteViewContext } from '../ui-suite/View';
import { customComponent } from '../customization/Customizable';
import { sameSelector } from '../customization/selectors';
import { compileSuiteInScope, compileSuite } from '../ui-suite/compiler';
import {
  createSuiteRuntimeScope,
  SuiteInlineStyleContext,
  suiteInlineStyleResolver,
  attachSuiteStyles,
} from '../ui-suite/prepared';
import type { PreparedSuiteRuntime, UiViewProps } from '../ui-suite/prepared';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSuiteBundle, UiSelector } from '../ui-suite/model';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';

const check = (value: unknown, message: string) => {
  if (!value) throw Error(message);
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const position = (owner: UiOwnerRecord): UiSelector => ({
  kind: 'position',
  target: owner.target,
  locator: owner.locator,
});
const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const source = (text: string) => ({ encoding: 'utf8' as const, text });
async function bundle(files: UiSuiteBundle['files'], styles: string[] = []) {
  const value = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  value.files = { 'Home.tsx': source('export default ()=>null'), ...files };
  value.manifest.styles = styles;
  return normalizeDraftBundle(value);
}
const envelope = {
  snapshot: {},
  actions: {},
  props: {},
  Original: () => null,
} as unknown as UiViewProps;
const publication = {
  viewId: 'test.ownership',
  sourcePath: 'src/ui-tests/ownership-fixture.tsx',
  routeId: 'home',
  layerId: 'test',
};
function Pair({ second = true }: { second?: boolean }) {
  return (
    <Fragment data-ui-site="pair">
      <span data-ui-site="pair-a">A</span>
      {second && <span data-ui-site="pair-b">B</span>}
    </Fragment>
  );
}
function Portal({ container }: { container: Element }) {
  return createPortal(<span data-ui-site="portal-leaf">Portal</span>, container);
}
function Opaque() {
  return createElement('mark', null, 'opaque');
}
function Bare() {
  return 'bare text';
}
function Fields() {
  return (
    <UiIdentity namespace="account" value="same">
      <Field data-ui-site="field-a" label="First">
        <Input data-ui-site="input-a" />
      </Field>
      <Field data-ui-site="field-b" label="Second">
        <Input data-ui-site="input-b" />
      </Field>
    </UiIdentity>
  );
}
function KeyRows({ items, keys = true }: { items: string[]; keys?: boolean }) {
  return (
    <section data-ui-site="rows">
      {items.map((value) => (
        <button data-ui-site="row" key={keys ? value : undefined}>
          {value}
        </button>
      ))}
    </section>
  );
}
function EquivalentKey({ itemKey }: { itemKey: string | number | bigint }) {
  return (
    <button data-ui-site="equivalent-key" key={itemKey}>
      Same
    </button>
  );
}
function BusinessParent({ account }: { account: string }) {
  return (
    <UiIdentity namespace="account" value={account}>
      <button data-ui-site="same-child-key" key="child">
        {account}
      </button>
    </UiIdentity>
  );
}
function CssTree() {
  return (
    <section data-ui-site="css-tree-root">
      <span className="ownership-child" data-ui-site="css-tree-child">
        Child
      </span>
    </section>
  );
}
function RefInput({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  return (
    <input
      data-ui-site="ref-input"
      ref={inputRef}
      defaultValue="preserved"
      aria-label="Ref input"
    />
  );
}
const OriginalControl = customComponent(
  'control.ownership-original',
  ({ onClick, ...props }: { onClick: () => void; className?: string }) => (
    <button {...props} data-ui-site="original-button" onClick={onClick}>
      Original action
    </button>
  ),
);
const Inner = customComponent(
  'control.ownership-inner',
  ({ children }: { children?: ReactNode }) => (
    <section data-ui-site="inner-original">{children}</section>
  ),
);

export function installOwnershipFixture() {
  window.ownershipFixture = {
    async run() {
      const checks: string[] = [],
        evidence: Record<string, unknown> = {};
      const host = document.createElement('div');
      host.id = 'ownership-acceptance';
      host.style.cssText =
        'position:fixed;inset:10px;background:white;color:black;z-index:2147483600;overflow:auto;padding:16px;';
      document.body.append(host);
      const portalA = document.createElement('div'),
        portalB = document.createElement('div');
      host.append(portalA, portalB);
      const shadow = portalB.attachShadow({ mode: 'open' });
      const shadowContainer = document.createElement('div');
      shadow.append(shadowContainer);
      const foreign = document.createElement('iframe');
      host.append(foreign);
      const foreignBody = foreign.contentDocument!.body;
      const mount = document.createElement('div');
      host.append(mount);
      const root = createRoot(mount);
      let notifications = 0;
      const unsubscribe = subscribeOwners(() => notifications++);
      const render = (children: ReactNode, strict = false) => {
        flushSync(() =>
          root.render(
            createElement(UiRuntimeRoot, {
              id: 'launcher.main',
              children: createElement(UiRuntimeView, {
                publication,
                children: strict ? createElement(StrictMode, null, children) : children,
              }),
            }),
          ),
        );
      };
      const own = () => listOwners().filter((row) => row.viewId === publication.viewId);
      const at = (site: string) => own().filter((row) => row.site?.endsWith(`:${site}`));
      const resources: (() => void)[] = [];
      const styleRoot = (id: 'launcher.main' | 'launcher.editor') => {
        const snapshot = getSuiteStyleRoot(id);
        resources.push(() => snapshot.dispose());
        return snapshot;
      };
      try {
        const fields = <Fields data-ui-site="fields" />;
        render(fields);
        await tick();
        const labels = own().filter((row) => row.target === 'element.label');
        check(labels.length === 2, 'two actual Field labels register');
        check(!equal(labels[0].locator, labels[1].locator), 'same account Field call paths differ');
        check(
          labels.every((row) =>
            row.locator.business.some(
              (identity) => identity.namespace === 'account' && identity.value === 'same',
            ),
          ),
          'business ancestry survives both fields',
        );
        const saved = labels.map((row) => row.locator);
        render(null);
        render(fields);
        await tick();
        check(
          equal(
            saved,
            own()
              .filter((row) => row.target === 'element.label')
              .map((row) => row.locator),
          ),
          'remount retains locator',
        );
        const firstInput = mount.querySelector('input')!;
        check(firstInput.getAttribute('aria-labelledby') !== null, 'Field association retained');
        evidence.fieldLocators = saved;
        checks.push('field_call_paths_business_and_remount');

        const rows = (items: string[], keys = true) => (
          <KeyRows data-ui-site="keyrows" items={items} keys={keys} />
        );
        render(rows(['a', 'b']));
        await tick();
        const initial = at('row'),
          a = initial.find((row) => [...row.roots][0]?.textContent === 'a')!;
        const aElement = [...a.roots][0];
        render(rows(['b', 'a']));
        await tick();
        const reordered = resolveSelector(position(a));
        check(
          reordered.status === 'resolved' && reordered.owners[0].roots.has(aElement),
          'keyed reorder follows same DOM and locator',
        );
        render(rows(['a', 'a']));
        await tick();
        check(
          resolveSelector(position(at('row')[0])).status === 'ambiguous',
          'duplicate key is ambiguous',
        );
        render(null);
        await tick();
        render(rows(['a', 'b'], false));
        await tick();
        check(
          resolveSelector(position(at('row')[0])).status === 'unsupported',
          'unkeyed repeat unsupported',
        );
        const missingPosition = position(at('row')[0]);
        render(rows(['b'], false));
        await tick();
        check(
          resolveSelector(missingPosition).status === 'unsupported',
          'detected unkeyed list remains unsupported after two to one',
        );
        render(rows(['different'], false));
        await tick();
        check(
          resolveSelector(missingPosition).status === 'unsupported' &&
            mount.querySelector('button')?.textContent === 'different',
          'different remaining item cannot acquire a saved unkeyed precise position',
        );
        render(rows([], false));
        await tick();
        render(rows(['new-after-empty'], false));
        await tick();
        check(
          resolveSelector(missingPosition).status === 'unsupported',
          'same list lifecycle retains repetition history through an empty render',
        );
        render(rows(['keyed-again']));
        await tick();
        check(
          resolveSelector(position(at('row')[0])).status === 'resolved',
          'stable key restores legitimate precise support',
        );
        evidence.unkeyedLifecycle = ['two', 'one', 'different', 'empty', 'new', 'keyed'];
        checks.push('keyed_reorder_duplicate_and_missing_keys');

        const keyView = (itemKey: string | number | bigint) => (
          <EquivalentKey data-ui-site="equivalent-call" itemKey={itemKey} />
        );
        render(keyView(7));
        await tick();
        const numeric = at('equivalent-key')[0],
          numericElement = [...numeric.roots][0];
        render(keyView('7'));
        await tick();
        check(
          equal(at('equivalent-key')[0].locator, numeric.locator) &&
            at('equivalent-key')[0].roots.has(numericElement),
          'number/string React keys are equivalent',
        );
        render(keyView(7n));
        await tick();
        check(
          equal(at('equivalent-key')[0].locator, numeric.locator) &&
            at('equivalent-key')[0].roots.has(numericElement),
          'bigint React key is equivalent',
        );
        const businessRows = ['a', 'b'].map((account) => (
          <BusinessParent data-ui-site="business-parent" account={account} key={account} />
        ));
        render(businessRows);
        await tick();
        const businessChildren = at('same-child-key');
        check(
          businessChildren.length === 2 &&
            !equal(businessChildren[0].locator, businessChildren[1].locator) &&
            businessChildren.every((row) => row.locator.business.length === 1),
          'equal child keys retain distinct business parents',
        );
        checks.push('react_key_equivalence_and_business_parent_accumulation');

        const pairView = (second = true) => <Pair data-ui-site="pair-call" second={second} />;
        render(pairView());
        await tick();
        let pair = at('pair-call')[0];
        check(pair.roots.size === 2, 'component Fragment has two roots');
        const before = [...pair.roots];
        render(pairView(false));
        await tick();
        pair = at('pair-call')[0];
        check(
          pair.roots.size === 1 && !pair.roots.has(before[1]),
          'removed Fragment root is released',
        );
        const portalView = (container: Element) => (
          <div data-ui-site="portal-parent">
            <Portal data-ui-site="portal" container={container} />
          </div>
        );
        render(portalView(portalA));
        await tick();
        check(
          at('portal-parent')[0].roots.size === 2,
          'Portal extends logical parent roots beyond DOM subtree',
        );
        const portalId = at('portal')[0].ownerId;
        render(portalView(shadowContainer));
        await tick();
        check(
          getOwner(portalId)?.roots.size === 1 &&
            shadowContainer.textContent === 'Portal' &&
            !portalA.textContent,
          'Portal move removes old root',
        );
        render(portalView(foreignBody));
        await tick();
        check(
          at('portal')[0].roots.size === 1 &&
            collectVisibleRects([at('portal')[0].ownerId]).length > 0,
          'foreign document Portal uses realm-safe roots and rects',
        );
        render(
          <>
            <Opaque data-ui-site="opaque" />
            <Bare data-ui-site="bare" />
          </>,
        );
        await tick();
        check(
          resolveSelector(position(at('opaque')[0])).status === 'unsupported' &&
            resolveSelector(position(at('bare')[0])).status === 'unsupported',
          'opaque/createElement/text stay unsupported',
        );
        checks.push('fragment_portal_foreign_document_and_opaque');

        let setups = 0,
          cleanups = 0,
          nullCalls = 0;
        const callback = (element: HTMLInputElement | null) => {
          if (!element) {
            nullCalls++;
            return;
          }
          setups++;
          return () => {
            cleanups++;
          };
        };
        const refView = (inputRef: Ref<HTMLInputElement>) => (
          <RefInput data-ui-site="refcall" inputRef={inputRef} />
        );
        render(refView(callback), true);
        await tick();
        const input = mount.querySelector('input')!;
        input.focus();
        input.value = 'draft';
        input.setSelectionRange(1, 3);
        render(refView(callback), true);
        await tick();
        check(
          mount.querySelector('input') === input &&
            document.activeElement === input &&
            input.value === 'draft' &&
            input.selectionStart === 1,
          'rerender preserves input focus/selection/value',
        );
        const objectRef = { current: null as HTMLInputElement | null };
        render(refView(objectRef), true);
        await tick();
        check(
          objectRef.current === input && cleanups === setups && nullCalls === 0,
          'React19 returned cleanup and ref swap',
        );
        render(null);
        await tick();
        check(objectRef.current === null, 'object ref cleared');
        check(!getDomOwnership(input), 'removed DOM ownership cleared');
        evidence.refs = { setups, cleanups, nullCalls };
        checks.push('react19_ref_cleanup_swap_focus_and_forms');

        let calls = 0;
        const onClick = () => calls++;
        const replacements = {
              'control.ownership-original': {
                Component: ({ Original, ...props }: Record<string, unknown>) =>
                  createElement(
                    Inner,
                    null,
                    createElement(Original as React.ComponentType<Record<string, unknown>>, props),
                  ),
              },
              'control.ownership-inner': {
                Component: ({ Original, ...props }: Record<string, unknown>) =>
                  createElement(
                    'article',
                    null,
                    createElement(Original as React.ComponentType<Record<string, unknown>>, props),
                  ),
              },
        };
        render(
          createElement(
            SuiteViewContext.Provider,
            { value: ({ id, props, Original }) => {
              const row = replacements[id as keyof typeof replacements];
              return row ? createElement(row.Component, { ...props, Original }) : Original ? createElement(Original, props) : null;
            } },
            <OriginalControl
              data-ui-site="business-control"
              onClick={onClick}
              className="caller"
            />,
          ),
        );
        await tick();
        mount.querySelector('button')!.click();
        check(
          calls === 1 && mount.querySelector('button')!.className === 'caller',
          'nested Original retains callback and caller props',
        );
        checks.push('nested_original_callback_and_props');

        render(
          <section data-ui-site="catalog">
            <input data-ui-site="search" />
            <UiCatalogPresentation>
              <button data-ui-site="catalog-item">Generated row</button>
            </UiCatalogPresentation>
          </section>,
        );
        await tick();
        const item = at('catalog-item')[0];
        check(
          item.catalogPresentation && !at('search')[0].catalogPresentation,
          'catalog presentation only generated item subtree',
        );
        check(
          resolveSelector(position(item)).status === 'resolved' &&
            collectVisibleRects([item.ownerId]).length === 1,
          'catalog row remains pickable/resolvable/rect counted',
        );
        const checkpoint = notifications;
        await tick();
        await tick();
        check(notifications === checkpoint, 'registry notifications settle');
        check(
          !listOwners().some((row) =>
            /launcherprovider|recoveryhost|uifoundationprovider|uiruntimeroot/i.test(row.target),
          ),
          'private roots/providers absent from targets',
        );
        checks.push('catalog_presentation_and_private_boundaries');

        const compiledSource =
          'import {useState} from "react";import {UiIdentity} from "@paradox/ui";export default function View(){const [v,setV]=useState("draft");return <UiIdentity namespace="account" value="runtime"><section data-ui-site="runtime-root"><input data-ui-site="runtime-input" value={v} onChange={e=>setV(e.currentTarget.value)}/><span data-ui-site="runtime-label" style={{animationName:"pulse","--Motion":"pulse"}}>Runtime</span></section></UiIdentity>}';
        const scope = createSuiteRuntimeScope();
        const data = await bundle(
          {
            'Home.tsx': source(compiledSource),
            'Copy.tsx': source(compiledSource),
            'style.css': source(
              '@keyframes pulse{to{opacity:.5}}@property --Motion{syntax:"pulse | <number>";inherits:false;initial-value:1}span{animation-name:var(--Motion)}',
            ),
          },
          ['style.css'],
        );
        data.manifest.views['test.copy'] = 'Copy.tsx';
        const prepared = await compileSuiteInScope(await normalizeDraftBundle(data), scope);
        resources.push(() => prepared.dispose());
        const release = publishUiDefinitions({
          key: 'ownership-prepared',
          definitions: prepared.sourceDefinitions,
        });
        resources.push(release);
        check(
          getTargetMetadata({ kind: 'type', target: 'element.span' }).some(
            (row) => row.sourcePath === 'Copy.tsx',
          ),
          'unmounted copied source metadata retained',
        );
        const View = prepared.views.get('page.home')!,
          Copy = prepared.views.get('test.copy')!;
        const show = (runtime: PreparedSuiteRuntime) => {
          render(
            createElement(
              SuiteInlineStyleContext.Provider,
              { value: suiteInlineStyleResolver(runtime) },
              createElement(UiRuntimeView, {
                publication: { ...runtime.viewMetadata.get('page.home')!, layerId: 'runtime' },
                children: createElement(View, envelope),
              }),
            ),
          );
        };
        show(prepared);
        await tick();
        const originalInput = mount.querySelector('input')!;
        originalInput.focus();
        originalInput.value = 'changed';
        originalInput.dispatchEvent(new Event('input', { bubbles: true }));
        const styleDetach = attachSuiteStyles(document, prepared, styleRoot('launcher.main'));
        resources.push(styleDetach);
        const nativeSpan = mount.querySelector('span')!;
        check(
          nativeSpan.style.animationName.startsWith('suite-'),
          'normal compile uses shared native style resolver',
        );
        check(
          [...nativeSpan.style].some((name) => name.startsWith('--suite-')),
          'entire descriptor mirror record reaches DOM',
        );
        const compiledOwners = listOwners().filter(
          (row) => row.viewId === 'page.home' && row.layerId === 'runtime',
        );
        check(
          compiledOwners.some(
            (row) =>
              row.site?.includes('runtime-input') &&
              row.locator.business.some((identity) => identity.value === 'runtime'),
          ),
          'normal public module JSX instrumented',
        );
        const cssData = structuredClone(data);
        cssData.files['style.css'] = source(
          '@keyframes pulse{to{opacity:.25}}span{color:rgb(10,20,30)}',
        );
        const cssPrepared = await compileSuiteInScope(await normalizeDraftBundle(cssData), scope);
        resources.push(() => cssPrepared.dispose());
        check(cssPrepared.views.get('page.home') === View, 'CSS-only compile retains Component');
        show(cssPrepared);
        await tick();
        check(
          mount.querySelector('input') === originalInput &&
            document.activeElement === originalInput,
          'CSS metadata update does not remount input',
        );
        render(
          createElement(UiRuntimeRoot, {
            id: 'launcher.editor',
            children: createElement(UiRuntimeView, {
              publication: { ...prepared.viewMetadata.get('test.copy')!, layerId: 'copy' },
              children: createElement(Copy, envelope),
            }),
          }),
        );
        await tick();
        check(
          listOwners()
            .filter((row) => row.layerId === 'copy')
            .every((row) => row.metadata.sourcePath === 'Copy.tsx'),
          'identical TSX copies keep actual source metadata',
        );
        check(
          styleRoot('launcher.editor').viewIds.has('test.copy') &&
            !styleRoot('launcher.main').viewIds.has('test.copy'),
          'active view IDs reflect actual root, not naming',
        );
        checks.push('normal_compiler_context_metadata_css_state_and_active_views');

        const htmlData = await bundle({
          'Home.tsx': source('export default ()=>null'),
          'One.html': source(
            '<section data-ui-site="html-root"><input data-ui-site="html-input" data-ui-props><span data-ui-site="html-label">HTML</span></section>',
          ),
          'Two.html': source(
            '<section data-ui-site="html-root"><input data-ui-site="html-input" data-ui-props><span data-ui-site="html-label">HTML</span></section>',
          ),
        });
        htmlData.manifest.views['test.html'] = 'One.html';
        htmlData.manifest.views['test.html-copy'] = 'Two.html';
        const htmlPrepared = (await compileSuite(
          await normalizeDraftBundle(htmlData),
        )) as PreparedSuiteRuntime;
        resources.push(() => htmlPrepared.dispose());
        const Html = htmlPrepared.views.get('test.html')!;
        render(
          createElement(UiRuntimeView, {
            publication: { ...htmlPrepared.viewMetadata.get('test.html')!, layerId: 'html' },
            children: createElement(Html, { ...envelope, props: { 'aria-label': 'HTML input' } }),
          }),
        );
        await tick();
        check(
          mount.querySelector('input')?.getAttribute('aria-label') === 'HTML input',
          'HTML forwarded caller props retained',
        );
        check(
          listOwners().some(
            (row) =>
              row.layerId === 'html' &&
              row.site?.includes('html-input') &&
              row.metadata.sourcePath === 'One.html',
          ),
          'public compile instruments HTML before DOMParser',
        );
        check(
          htmlPrepared.sourceDefinitions.some(
            (row) => row.sourcePath === 'Two.html' && row.site?.includes('html-label'),
          ),
          'unmounted identical HTML source metadata isolated',
        );
        const overrideData = await bundle({
          'Home.tsx': source('export default()=>null'),
          'OnlyOverride.tsx': source(
            'import Child from "./OverrideChild";export default()=> <span data-ui-site="override-only-root"><Child data-ui-site="override-only-call"/></span>',
          ),
          'OverrideChild.tsx': source(
            'export default()=> <button data-ui-site="override-only-child">Child</button>',
          ),
          'OnlyOverride.html': source(
            '<span data-ui-site="override-only-html"><b data-ui-site="override-only-html-child">HTML child</b></span>',
          ),
        });
        const externalSelector: UiSelector = {
          kind: 'position',
          target: 'control.external-override',
          locator: {
            version: 1,
            renderRoot: 'launcher.main',
            calls: [{ site: 'external-site', key: 'external-key' }],
            business: [{ namespace: 'account', value: 'external' }],
          },
        };
        overrideData.manifest.overrides = [
          {
            selector: externalSelector,
            enabled: true,
            entry: 'OnlyOverride.tsx',
            stylesheet: null,
          },
          {
            selector: { kind: 'type', target: 'control.external-html' },
            enabled: true,
            entry: 'OnlyOverride.html',
            stylesheet: null,
          },
        ];
        const overridePrepared = (await compileSuite(
          await normalizeDraftBundle(overrideData),
        )) as PreparedSuiteRuntime;
        resources.push(() => overridePrepared.dispose());
        const onlySites = overridePrepared.sourceDefinitions.filter((row) =>
          row.site?.includes('override-only'),
        );
        check(
          onlySites.length === 5 &&
            onlySites.every((row) => row.viewId === null && row.routeId === null),
          'never-mounted override TSX/HTML and dependency sites retain nullable view/route provenance',
        );
        check(
          onlySites.some(
            (row) =>
              row.sourcePath === 'OverrideChild.tsx' && row.site?.endsWith(':override-only-child'),
          ),
          'override-only dependency keeps actual source path',
        );
        check(
          overridePrepared.sourceDefinitions.some(
            (row) =>
              row.selector &&
              sameSelector(row.selector, externalSelector) &&
              row.sourcePath === 'OnlyOverride.tsx',
          ),
          'exact external override selector retained beside child definitions',
        );
        const releaseOverrideDefinitions = publishUiDefinitions({
          key: 'ownership-override-only',
          definitions: overridePrepared.sourceDefinitions,
        });
        resources.push(releaseOverrideDefinitions);
        const spanSources = getTargetMetadata({ kind: 'type', target: 'element.span' }).map(
          (row) => row.sourcePath,
        );
        check(
          spanSources.includes('OnlyOverride.tsx') && spanSources.includes('OnlyOverride.html'),
          'plural never-mounted override metadata remains discoverable before either override renders',
        );
        evidence.overrideOnlySources = onlySites.map((row) => ({
          site: row.site,
          sourcePath: row.sourcePath,
          viewId: row.viewId,
          routeId: row.routeId,
        }));
        checks.push('public_compile_html_sites_and_copy_metadata');

        render(
          <>
            <CssTree data-ui-site="css-tree-a" />
            <CssTree data-ui-site="css-tree-b" />
          </>,
        );
        await tick();
        const selected = at('css-tree-a')[0],
          other = at('css-tree-b')[0];
        const targetData = await bundle({
          'Home.tsx': source('export default ()=>null'),
          'target.css': source(
            ':scope{border-top:7px solid rgb(1,2,3)}.ownership-child{color:rgb(11,22,33)}',
          ),
        });
        targetData.manifest.overrides = [
          { selector: position(selected), enabled: true, entry: null, stylesheet: 'target.css' },
        ];
        const targetPrepared = await compileSuite(await normalizeDraftBundle(targetData));
        resources.push(() => targetPrepared.dispose());
        const targetDetach = attachSuiteStyles(
          document,
          targetPrepared,
          styleRoot('launcher.main'),
        );
        resources.push(targetDetach);
        await tick();
        const selectedRoot = [...selected.roots][0],
          otherRoot = [...other.roots][0],
          child = selectedRoot.querySelector('span')!;
        check(
          getComputedStyle(selectedRoot).borderTopWidth === '7px' &&
            getComputedStyle(otherRoot).borderTopWidth !== '7px',
          'position CSS matches only complete selected locator',
        );
        check(
          getComputedStyle(child).borderTopWidth !== '7px' &&
            getComputedStyle(child).color === 'rgb(11, 22, 33)',
          'root shorthand remains root-only and descendant containment works',
        );
        check(
          !getDomOwnership(child)!.rootOwnerIds.includes(selected.ownerId),
          'descendants do not consume ancestor root ownership',
        );
        targetDetach();
        check(
          getComputedStyle(selectedRoot).borderTopWidth !== '7px',
          'style detach removes owned target rules',
        );
        checks.push('full_selector_css_root_and_descendant_scope');

        const boundarySelector: UiSelector = { kind: 'type', target: 'control.future-action' };
        const boundary = styleRoot('launcher.main').resolveTarget(boundarySelector)!;
        render(
          <button data-ui-site="css-future" data-ui-target="control.future-action">
            Future target
          </button>,
        );
        await tick();
        check(
          mount.querySelector('button')!.matches(boundary),
          'supported unmounted explicit target boundary matches future actual root',
        );
        check(
          at('css-future')[0].target === 'control.future-action',
          'native owner and source metadata use the explicit target',
        );
        const actual = mount.querySelector('button')!;
        const native = document.createElement('button');
        native.textContent = 'Future target';
        mount.append(native);
        const aRect = actual.getBoundingClientRect(),
          bRect = native.getBoundingClientRect();
        check(
          aRect.width === bRect.width &&
            aRect.height === bRect.height &&
            actual.parentElement === mount,
          'registry adds no DOM/layout wrappers',
        );
        native.remove();
        evidence.layout = {
          registered: [aRect.width, aRect.height],
          ordinary: [bRect.width, bRect.height],
          tag: actual.tagName,
        };
        checks.push('stable_css_boundary_and_no_layout_wrappers');
        evidence.finalOwners = own().map((row) => ({
          target: row.target,
          site: row.site,
          roots: row.roots.size,
        }));
        const summary = document.createElement('section');
        summary.innerHTML = '<h2>Ownership acceptance</h2>';
        const list = document.createElement('ol');
        for (const name of checks) {
          const item = document.createElement('li');
          item.textContent = name;
          list.append(item);
        }
        summary.append(list);
        host.append(summary);
        window.ownershipFixture.captureReady = true;
        await new Promise<void>((resolve) => {
          window.ownershipFixture.resume = resolve;
        });
        return { checks, evidence };
      } catch (error) {
        console.error('OWNERSHIP PRIMARY', String(error));
        throw error;
      } finally {
        flushSync(() => root.unmount());
        unsubscribe();
        for (const release of resources.reverse()) release();
        host.remove();
        await tick();
        check(
          !listOwners().some(
            (row) =>
              row.layerId === 'test' ||
              row.layerId === 'runtime' ||
              row.layerId === 'copy' ||
              row.layerId === 'html',
          ),
          'all fixture owners released: ' +
            JSON.stringify(
              listOwners()
                .filter((row) => row.layerId === 'test')
                .map((row) => ({ id: row.ownerId, target: row.target, site: row.site })),
            ),
        );
      }
    },
  };
}
declare global {
  interface Window {
    ownershipFixture: {
      run(): Promise<{ checks: string[]; evidence: Record<string, unknown> }>;
      captureReady?: boolean;
      resume?: () => void;
    };
  }
}
