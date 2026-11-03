import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const out = resolve('../.test-data/whole-final-fix-1/browser', process.env.PARADOX_FINAL_EVIDENCE ?? 'manual-run');
await mkdir(out, { recursive: true });
const report = { rows: [] };
const filter = process.env.PARADOX_ACTIVATION_CASES && new RegExp(process.env.PARADOX_ACTIVATION_CASES);
const duplicateSource = `import {UiView} from '@paradox/ui';
export default function Accounts(){
  return <>{[0,1].map(()=>
    <UiView data-ui-site="Preview-duplicate" key="duplicate"
      id="component.inspector-preview"/>
  )}</>;
}`;
const previewSource = `import {Fragment} from 'react';import {Dialog} from '@paradox/ui';
export default function Preview(){return <Fragment key="preview-fragment"><section data-ui-site="Preview-real" data-preview-real>Current root</section><Dialog.Root data-ui-site="Preview-dialog" open modal={false}><Dialog.Portal data-ui-site="Preview-portal"><Dialog.Popup data-ui-site="Preview-popup" aria-label="Preview portal" style={{position:'fixed',top:30,left:10,width:160,height:50,pointerEvents:'auto'}}>Current portal</Dialog.Popup></Dialog.Portal></Dialog.Root></Fragment>}`;
const accountsSource = `import {Fragment} from 'react';import {UiView,UiIdentity} from '@paradox/ui';
export default function Accounts(){return <Fragment data-ui-site="accounts-fragment" key="accounts-fragment"><UiIdentity data-ui-site="accounts-identity" namespace="account" value="account-a">{['one','two'].map((key,index)=><UiView data-ui-site="Preview-view" key={key} id="component.inspector-preview" props={{index}}/>)}</UiIdentity></Fragment>}`;
const svgSource = `import {Fragment} from 'react';export default function SvgProbe({props}){const i=props.index??0;return <Fragment data-ui-site="svg-fragment" key="svg-fragment"><svg data-ui-site="SvgProbe-root" key="svg-root" width="40" height="40" data-svg-probe={i}><defs data-ui-site="SvgProbe-defs"><linearGradient data-ui-site="SvgProbe-gradient" key="gradient" id={'probe-gradient-'+i}><stop data-ui-site="SvgProbe-stop" offset="0" stopColor="red"/></linearGradient><radialGradient data-ui-site="SvgProbe-radial" key="radial" id={'probe-radial-'+i}><stop data-ui-site="SvgProbe-radial-stop" offset="1" stopColor="blue"/></radialGradient><clipPath data-ui-site="SvgProbe-clip" key="clip" id={'probe-clip-'+i}><rect data-ui-site="SvgProbe-clip-rect" width="30" height="30"/></clipPath></defs><rect data-ui-site="SvgProbe-rect" width="40" height="40" fill={'url(#probe-gradient-'+i+')'} clipPath={'url(#probe-clip-'+i+')'}/><circle data-ui-site="SvgProbe-circle" r="10" cx="20" cy="20" fill={'url(#probe-radial-'+i+')'}/></svg><span data-ui-site="SvgProbe-label" key="svg-label" data-svg-label={i}>SVG {i}</span></Fragment>}`;
const settle = (page) => page.waitForTimeout(350);
async function install(page, source = previewSource) {
  return page.evaluate(async ({ source, accountsSource }) => {
    const f = window.suiteFinalFixture, c = f.controller;
    c.actions.createFile('Preview.tsx', 'tsx'); c.actions.patchFile('Preview.tsx', source);
    c.actions.createFile('PreviewAccounts.tsx', 'tsx'); c.actions.patchFile('PreviewAccounts.tsx', accountsSource);
    c.actions.patchManifest({ views: { ...c.getSnapshot().draft.manifest.views, 'page.accounts': 'PreviewAccounts.tsx', 'component.inspector-preview': 'Preview.tsx' }, routes: c.getSnapshot().draft.manifest.routes.map(r => r.id === 'accounts' ? { ...r, entry: 'PreviewAccounts.tsx' } : r) });
    f.actions.navigation.navigate('accounts');
    return c.actions.preview();
  }, { source, accountsSource });
}
async function run(name, fn) {
  if (filter && !filter.test(name)) return;
  const fixture = await createBrowserFixture({ desktopBoundary: true });
  const { page } = fixture;
  page.setDefaultTimeout(15000);
  const row = { name };
  report.rows.push(row);
  try {
    await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
    await page.evaluate(async () => {
      const f = window.suiteFinalFixture; await f.setLanguage('en-US');
      f.actions.settings.patch('memory_mb', 6144); f.actions.accounts.patchClientId('activation-retained-draft');
      await f.controller.actions.copyBuiltin('modern', 'Activation regression');
      f.controller.actions.open();
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      const live = new Set(), created = [], revoked = [];
      URL.createObjectURL = (...args) => { const url = create(...args); live.add(url); created.push(url); return url; };
      URL.revokeObjectURL = url => { live.delete(url); revoked.push(url); return revoke(url); };
      window.activationProbe = { controller: f.controller, actions: f.actions, editorActions: f.controller.actions, live, created, revoked };
    });
    row.detail = await fn(page, fixture);
    await settle(page);
    assert.deepEqual(fixture.observedPageErrors, [], 'all startup and settled activation page errors');
    assert.deepEqual(fixture.observedCspViolations, []);
    if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
      assert.ok(fixture.contentSecurityPolicy);
      assert.deepEqual(fixture.observedSourceModuleRequests, []);
    }
    console.log('PASS ' + name);
  } catch (error) {
    row.failure = String(error); process.exitCode = 1; console.error('FAIL ' + name + ' ' + error);
  } finally {
    row.errors = [...fixture.observedPageErrors]; row.cspViolations = [...fixture.observedCspViolations];
    row.csp = fixture.contentSecurityPolicy; row.sourceRequests = [...fixture.observedSourceModuleRequests];
    row.final = await page.evaluate(() => {
      const f = window.suiteFinalFixture, c = f?.controller, p = window.activationProbe;
      return { suspended: c?.getSnapshot().suspended, diagnostics: c?.getSnapshot().diagnostics, owners: f?.owners().map(o => ({ ownerId: o.ownerId, target: o.target, locator: o.locator, stability: o.stability, roots: [...o.roots].map(r => ({ localName: r.localName, connected: r.isConnected })) })), styles: document.querySelectorAll('style[data-ui-suite]').length, urls: p && { created: p.created, revoked: p.revoked, live: [...p.live] } };
    }).catch(error => ({ failure: String(error) }));
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await fixture.close();
  }
}

await run('duplicate_key_actual_controller_recovery_and_draft', async (page) => {
  assert.equal(await install(page), true); await settle(page);
  assert.equal(await page.evaluate(() => window.suiteFinalFixture.owners().filter(o => o.target === 'component.inspector-preview' && o.roots.size === 2).length), 2);
  const result = await page.evaluate(async (source) => {
    const f = window.suiteFinalFixture, c = f.controller, before = c.getSnapshot(), previous = c.getActivation();
    c.actions.patchFile('PreviewAccounts.tsx', source); const preview = await c.actions.preview();
    await new Promise(y => setTimeout(y, 350));
    const repeated = f.owners().find(o => o.target === 'component.inspector-preview');
    c.actions.selectTarget({ kind: 'position', target: repeated.target, locator: repeated.locator });
    const duplicate = { status: c.getSnapshot().currentTarget.status, matchCount: c.getSnapshot().currentTarget.matchCount, owners: f.owners().filter(o => o.target === 'component.inspector-preview').map(o => ({ stability: o.stability, roots: o.roots.size })), allOwners: f.owners().length, suspended: c.getSnapshot().suspended };
    c.recovery.disable(); await new Promise(y => setTimeout(y, 350));
    const disabled = { owners: f.owners().length, retiredAttachment: f.probeStyleAttachment(previous.primary.prepared), activeStyles: [...document.querySelectorAll('style[data-ui-suite]')].map(s => s.dataset.uiSuite), trustedDigest: c.getActivation().trusted.prepared.digest, liveUrls: [...window.activationProbe.live] };
    c.recovery.openBuiltinEditor(); await new Promise(y => setTimeout(y, 100));
    return { preview, duplicate, disabled, sameController: c === window.activationProbe.controller, sameActions: f.actions === window.activationProbe.actions, sameEditorActions: c.actions === window.activationProbe.editorActions, sameSuite: before.selectedSuiteId === c.getSnapshot().selectedSuiteId, source: c.getSnapshot().draft.files['PreviewAccounts.tsx'].text, draft: f.snapshot.settings.draft.memory_mb, clientId: f.snapshot.accounts.clientIdDraft, recoveryVisible: c.isRecoveryVisible(), open: c.getSnapshot().open, mode: c.getSnapshot().mode };
  }, duplicateSource);
  await writeFile(resolve(out, 'duplicate-source.tsx'), duplicateSource);
  assert.equal(result.preview, true); assert.ok(result.duplicate.allOwners > 0);
  assert.equal(result.duplicate.status, 'ambiguous'); assert.equal(result.duplicate.matchCount, 2);
  assert.ok(result.disabled.owners > 0); assert.match(result.disabled.retiredAttachment, /disposed or foreign/);
  assert.ok(result.disabled.activeStyles.every(d => d === result.disabled.trustedDigest));
  assert.deepEqual(result.disabled.liveUrls, []);
  for (const key of ['sameController', 'sameActions', 'sameEditorActions', 'sameSuite', 'open']) assert.equal(result[key], true);
  assert.equal(result.source, duplicateSource); assert.equal(result.draft, 6144); assert.equal(result.clientId, 'activation-retained-draft');
  assert.equal(result.mode, 'builtin');
  await page.getByRole('dialog', { name: 'UI Suite Editor', exact: true }).waitFor();
  return result;
});

await run('keyed_svg_case_selectors_original_export_reimport', async (page) => {
  assert.equal(await install(page, svgSource), true); await settle(page);
  const read = () => page.evaluate(() => {
    const f = window.suiteFinalFixture, c = f.controller;
    return { tags: [...document.querySelectorAll('[data-svg-probe] defs > *')].map(e => e.localName), owners: f.owners().filter(o => ['element.linearGradient', 'element.radialGradient', 'element.clipPath', 'component.inspector-preview'].includes(o.target)).map(o => ({ target: o.target, locator: o.locator, stability: o.stability, roots: [...o.roots].map(r => r.localName) })), colors: [...document.querySelectorAll('[data-svg-probe] linearGradient > stop')].map(e => getComputedStyle(e).stopColor), suspended: c.getSnapshot().suspended, diagnostics: c.getSnapshot().diagnostics, current: c.getSnapshot().currentTarget };
  });
  const initial = await read();
  assert.deepEqual(initial.tags, ['linearGradient','radialGradient','clipPath','linearGradient','radialGradient','clipPath']);
  assert.equal(initial.owners.filter(o => o.target === 'component.inspector-preview' && o.roots.length === 2).length, 2);
  assert.equal(initial.owners.filter(o => o.target === 'element.linearGradient' && o.stability === 'stable').length, 2);
  const selector = await page.evaluate(async () => {
    const c = window.suiteFinalFixture.controller, o = window.suiteFinalFixture.owners().find(o => o.target === 'element.linearGradient');
    const selector = { kind: 'position', target: o.target, locator: o.locator };
    c.actions.selectTarget(selector); await c.actions.createSelectionOverride('css');
    c.actions.patchFile(c.getSnapshot().selection.filePath, ':scope > stop { stop-color:rgb(12,34,56) }');
    if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
    return selector;
  });
  await settle(page); const position = await read();
  assert.equal(position.colors.filter(c => c === 'rgb(12, 34, 56)').length, 1);
  assert.equal(position.current.status, 'hidden', 'gradient in defs has no visible layout box'); assert.equal(position.current.matchCount, 1);
  const roots = await page.evaluate(() => [...document.querySelectorAll('[data-svg-probe]')].map(r => r));
  assert.equal(roots.length, 2);
  await page.evaluate(async () => {
    const c = window.suiteFinalFixture.controller; window.activationProbe.svgRoots = [...document.querySelectorAll('[data-svg-probe]')];
    c.actions.selectTarget({ kind: 'type', target: 'element.linearGradient' }); await c.actions.createSelectionOverride('css');
    c.actions.patchFile(c.getSnapshot().selection.filePath, ':scope > stop { stop-color:rgb(78,90,123) }');
    if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
  });
  await settle(page); const type = await read();
  assert.equal(type.colors.filter(c => c === 'rgb(78, 90, 123)').length, 2, 'later type stylesheet applies to both roots');
  assert.equal(await page.evaluate(() => window.activationProbe.svgRoots.every((r,i) => r === document.querySelectorAll('[data-svg-probe]')[i])), true, 'CSS-only SVG roots retained');
  await page.evaluate(async selector => {
    const c = window.suiteFinalFixture.controller; c.actions.selectTarget(selector); await c.actions.createSelectionOverride('tsx');
    c.actions.patchFile(c.getSnapshot().selection.filePath, 'export default function Gradient({props,children,Original}){return <Original {...props}>{children}</Original>}');
    if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
  }, selector);
  await settle(page); const original = await read();
  assert.equal(original.current.status, 'hidden', 'Original retains the gradient in defs'); assert.equal(original.current.matchCount, 1);
  assert.deepEqual(original.current.selector, selector); assert.deepEqual(original.tags, initial.tags);
  const binding = await page.evaluate(() => window.suiteFinalFixture.controller.getSnapshot().draft.manifest.overrides);
  const download = page.waitForEvent('download'); await page.evaluate(() => window.suiteFinalFixture.controller.actions.exportDraft());
  const file = await download, archive = await readFile(await file.path()); await writeFile(resolve(out, 'svg-export.paradox-ui'), archive);
  assert.equal(await page.evaluate(async bytes => { const c = window.suiteFinalFixture.controller; if (!await c.actions.importBundle(new File([Uint8Array.from(bytes)], 'SVG.paradox-ui'))) return false; return c.actions.preview(); }, [...archive]), true);
  await settle(page); const reimport = await read();
  assert.deepEqual(await page.evaluate(() => window.suiteFinalFixture.controller.getSnapshot().draft.manifest.overrides), binding);
  assert.deepEqual(reimport.tags, initial.tags); assert.equal(reimport.suspended, false); assert.deepEqual(reimport.diagnostics, []);
  return { initial, selector, position, type, original, reimport, binding, archiveBytes: archive.length };
});

await run('rapid_replacement_synchronous_disable_and_prepared_guards', async (page) => {
  assert.equal(await install(page), true); await settle(page);
  const result = await page.evaluate(async () => {
    const f = window.suiteFinalFixture, c = f.controller, initial = c.getActivation(), drafts = c.getSnapshot().draft;
    const live = f.probeStyleAttachment(initial.primary.prepared), foreign = f.probeStyleAttachment({ ...initial.primary.prepared });
    window.activationProbe.layoutRetirements = [];
    const duringLayout = drafts.files['Preview.tsx'].text.replace('import {Fragment}', 'import {Fragment,useLayoutEffect}').replace('function Preview(){return', 'function Preview(){useLayoutEffect(()=>{window.activationProbe.layoutRetirements.push(window.suiteFinalFixture.controller.getActivation().primary.prepared.digest);window.suiteFinalFixture.controller.recovery.disable()},[]);return');
    // The committed view triggers retirement before passive style setup.
    c.actions.patchFile('Preview.tsx', duringLayout);
    const immediate = await c.actions.preview(); await new Promise(y => setTimeout(y, 200));
    const retired = f.probeStyleAttachment(initial.primary.prepared), suspended = c.getSnapshot().suspended;
    c.recovery.openBuiltinEditor();
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      c.actions.patchFile('Preview.tsx', drafts.files['Preview.tsx'].text + '\n// replacement ' + i);
      outcomes.push(await c.actions.preview());
    }
    c.recovery.disable(); c.recovery.disable(); await new Promise(y => setTimeout(y, 350));
    const digest = c.getActivation().trusted.prepared.digest;
    return { live, foreign, retired, immediate, layoutRetirements: window.activationProbe.layoutRetirements, suspended, outcomes, owners: f.owners().length, styles: [...document.querySelectorAll('style[data-ui-suite]')].map(s => s.dataset.uiSuite), digest, liveUrls: [...window.activationProbe.live], draft: f.snapshot.settings.draft.memory_mb, sameActions: c.actions === window.activationProbe.editorActions, sameSource: c.getSnapshot().draft.files['Preview.tsx'].text.endsWith('// replacement 3') };
  });
  assert.equal(result.live, 'attached'); assert.match(result.foreign, /disposed or foreign/); assert.match(result.retired, /disposed or foreign/);
  assert.equal(result.layoutRetirements.length, process.env.PARADOX_TEST_NATIVE_CSP === '1' ? 2 : 4, 'two view mounts, with development StrictMode effect replay'); assert.equal(result.suspended, true);
  assert.deepEqual(result.outcomes, [true,true,true,true]); assert.ok(result.owners > 0);
  assert.ok(result.styles.every(s => s === result.digest)); assert.deepEqual(result.liveUrls, []);
  assert.equal(result.draft, 6144); assert.equal(result.sameActions, true); assert.equal(result.sameSource, true);
  return result;
});
