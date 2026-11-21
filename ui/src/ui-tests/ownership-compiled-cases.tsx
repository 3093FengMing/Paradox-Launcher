import { createElement } from 'react';

import { UiRuntimeRoot, UiRuntimeView } from '../customization/runtime';
import {
  listOwners,
  getTargetMetadata,
  publishUiDefinitions,
} from '../customization/ownership';

import { sameSelector } from '../customization/selectors';
import { compileSuiteInScope, compileSuite } from '../ui-suite/compiler';
import {
  createSuiteRuntimeScope,
  SuiteInlineStyleContext,
  suiteInlineStyleResolver,
  attachSuiteStyles,
} from '../ui-suite/prepared';
import type { PreparedSuiteRuntime } from '../ui-suite/prepared';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSelector } from '../ui-suite/model';

import { check, tick, source, bundle, envelope } from './ownership-support';
import type { OwnershipCaseContext } from './ownership-support';
export async function checkCompiledOwnership(context: OwnershipCaseContext) {
  const { checks, mount, resources, render, styleRoot } = context;
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
  const prepared = await compileSuiteInScope(
    await normalizeDraftBundle(data),
    scope,
  );
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
          publication: {
            ...runtime.viewMetadata.get('page.home')!,
            layerId: 'runtime',
          },
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
  const styleDetach = attachSuiteStyles(
    document,
    prepared,
    styleRoot('launcher.main'),
  );
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
  const cssPrepared = await compileSuiteInScope(
    await normalizeDraftBundle(cssData),
    scope,
  );
  resources.push(() => cssPrepared.dispose());
  check(
    cssPrepared.views.get('page.home') === View,
    'CSS-only compile retains Component',
  );
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
        publication: {
          ...prepared.viewMetadata.get('test.copy')!,
          layerId: 'copy',
        },
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
}

export async function checkHtmlSourceMetadata(context: OwnershipCaseContext) {
  const { checks, evidence, mount, resources, render } = context;
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
      publication: {
        ...htmlPrepared.viewMetadata.get('test.html')!,
        layerId: 'html',
      },
      children: createElement(Html, {
        ...envelope,
        props: { 'aria-label': 'HTML input' },
      }),
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
      (row) =>
        row.sourcePath === 'Two.html' && row.site?.includes('html-label'),
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
        row.sourcePath === 'OverrideChild.tsx' &&
        row.site?.endsWith(':override-only-child'),
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
  const spanSources = getTargetMetadata({
    kind: 'type',
    target: 'element.span',
  }).map((row) => row.sourcePath);
  check(
    spanSources.includes('OnlyOverride.tsx') &&
      spanSources.includes('OnlyOverride.html'),
    'plural never-mounted override metadata remains discoverable before either override renders',
  );
  evidence.overrideOnlySources = onlySites.map((row) => ({
    site: row.site,
    sourcePath: row.sourcePath,
    viewId: row.viewId,
    routeId: row.routeId,
  }));
  checks.push('public_compile_html_sites_and_copy_metadata');
}
