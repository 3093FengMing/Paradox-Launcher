import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserFixture, openEditor as openCurrentEditor } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const artifacts = resolve(fileURLToPath(new URL('../../.test-data/task-13/customization/', import.meta.url)), process.env.PARADOX_FINAL_EVIDENCE ?? 'manual-run');
await mkdir(artifacts, { recursive: true });
const config = structuredClone(initialConfig);
config.settings.offline_username = 'Player';
config.profiles.push({ ...config.profiles[0], instance_key: 'second-instance', name: 'Second world' });
const oldBytes = { 'paradox.ui-customization.v1': '{opaque old bytes\n', 'paradox.ui-customization.v1.recovery.keep': 'legacy backup bytes' };
const fixture = await createBrowserFixture({ config, desktopBoundary: true, oldNamespaceBytes: oldBytes });
const { page } = fixture;
page.setDefaultTimeout(30000);
const report = { checks: [], started_at: new Date().toISOString(), native_csp: fixture.contentSecurityPolicy };
const editorLocator = () => page.getByRole('dialog', { name: 'UI Suite Editor', exact: true });
const raw = () => page.evaluate(() => window.suiteFinalFixture.savedRaw());
const snapshot = () => page.evaluate(() => window.suiteFinalFixture.controller.getSnapshot());
const openEditor = () => openCurrentEditor(page);
async function closeEditor() {
  if (await editorLocator().count()) await editorLocator().locator('header button').click();
  await editorLocator().waitFor({ state: 'hidden' });
}
async function navigate(route) {
  await page.evaluate(route => window.suiteFinalFixture.actions.navigation.navigate(route), route);
  await page.waitForFunction(route => window.suiteFinalFixture.snapshot.navigation.routeId === route, route);
}
async function preserveNativeReload() {
  const saved = await page.evaluate(() => { const d = window.foundationDesktop; return { config: d.config, accounts: d.accounts, suiteLibrary: d.suiteLibrary, suiteRaw: d.suiteRaw ? Array.from(d.suiteRaw) : null, suiteBackups: d.suiteBackups }; });
  await page.addInitScript(saved => { Object.assign(window.foundationDesktop, saved); window.foundationDesktop.suiteRaw = saved.suiteRaw ? new Uint8Array(saved.suiteRaw) : null; }, saved);
}
async function check(name, action) {
  try { await action(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack }); throw error; }
}
async function patch({ files = {}, overrides, styles } = {}) {
  await openEditor();
  await page.evaluate(({ files, overrides, styles }) => {
    const c = window.suiteFinalFixture.controller, a = c.actions;
    for (const [path, text] of Object.entries(files)) {
      if (!c.getSnapshot().draft.files[path]) a.createFile(path, path.split('.').at(-1));
      a.patchFile(path, text);
    }
    const next = {};
    if (overrides) next.overrides = overrides;
    if (styles) next.styles = styles;
    a.patchManifest(next);
  }, { files, overrides, styles });
}
async function preview() {
  const before = await raw();
  await editorLocator().getByRole('button', { name: 'Preview suite', exact: true }).click();
  await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
  assert.equal((await snapshot()).previewing, true);
  const current = await page.evaluate(() => ({ active: window.suiteFinalFixture.controller.getActivation().primary.bundle.files, draft: window.suiteFinalFixture.controller.getSnapshot().draft.files }));
  assert.deepEqual(current.active, current.draft, 'actual clicked Preview activates intended current source');
  assert.deepEqual(await raw(), before, 'Preview does not write saved bytes');
}
const override = (target, entry = null, stylesheet = null, enabled = true) => ({ selector: { kind: 'type', target }, entry, stylesheet, enabled });
let basicStyles; // Captured from the editable source's actual manifest; imported source CSS is retained.
const profiles = () => page.locator('.instance-row');
let savedGlobal, wrappedRaw;
try {
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
  await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
  if (await page.locator('[data-style-choice]').count()) { await page.locator('[data-style-choice] input[value="modern"]').check(); await page.locator('[data-style-choice]').getByRole('button', { name: 'Use this interface', exact: true }).click(); await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired); }
  await openEditor(); basicStyles = [...(await snapshot()).draft.manifest.styles]; await closeEditor();
  await navigate('instances');
  await check('real default entry has two existing business profiles', async () => {
    assert.equal(await profiles().count(), 2);
    assert.equal(await profiles().first().locator('[data-ui-site$=":ProfileCard-name"]').textContent(), 'Original world');
  });
  await check('visible CSS Preview versus exact Save and reload', async () => {
    await openEditor();
    const s = await snapshot(), styles = [...s.draft.manifest.styles, 'Final.css'];
    await patch({ files: { 'Final.css': '.instance-row { outline: 3px solid rgb(10,200,30) !important; }' }, styles });
    await preview();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.instance-row')).outlineColor === 'rgb(10, 200, 30)');
    await editorLocator().getByRole('button', { name: 'Save suite', exact: true }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
    savedGlobal = await raw();
    const library = JSON.parse(Buffer.from(savedGlobal).toString());
    assert.equal(library.kind, 'paradox-ui-suite-library');
    const record = library.suites.find(x => x.instance_id === library.active_suite_id);
    assert.deepEqual(record.overlay['Final.css'], { encoding: 'utf8', text: '.instance-row { outline: 3px solid rgb(10,200,30) !important; }' });
    assert.equal(library.settings, undefined); assert.equal(library.profiles, undefined);
    await closeEditor(); await preserveNativeReload(); await page.reload();
    await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
    await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
    await navigate('instances');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.instance-row')).outlineColor === 'rgb(10, 200, 30)');
    assert.deepEqual(await raw(), savedGlobal);
  });
  await check('one repeated profile uses a real position selector', async () => {
    const selector = await profiles().first().evaluate(element => {
      const owner = window.suiteFinalFixture.owners().find(o => o.target === 'component.profile-card' && o.roots.has(element));
      if (!owner) throw Error('actual profile owner not found');
      return { kind: 'position', target: owner.target, locator: owner.locator };
    });
    await patch({ files: { 'Profile.css': ':scope .instance-row-name strong { color: rgb(190,70,10) !important; }' }, overrides: [{ selector, enabled: true, entry: null, stylesheet: 'Profile.css' }] });
    await preview();
    const colors = await profiles().locator('[data-ui-site$=":ProfileCard-name"]').evaluateAll(xs => xs.map(x => getComputedStyle(x).color));
    assert.equal(colors[0], 'rgb(190, 70, 10)'); assert.notEqual(colors[1], colors[0]);
    assert.deepEqual(await raw(), savedGlobal);
  });
  await check('pick native button, source import/export bytes, isolated scope and business selection', async () => {
    const firstButton = profiles().first().locator('.instance-actions .instance-details-button');
    const active = await page.evaluate(() => window.suiteFinalFixture.snapshot.profiles.activeKey);
    const editor = await openEditor();
    await editor.getByRole('button', { name: 'Pick target', exact: true }).click();
    await firstButton.click();
    await editorLocator().waitFor({ state: 'visible' });
    const picked = (await snapshot()).selection.selector;
    assert.equal(picked.kind, 'position');
    assert.equal(picked.target, 'element.button');
    await page.evaluate(() => {
      const a = window.suiteFinalFixture.controller.actions;
      a.createFile('Single.css', 'css'); a.selectFile('Single.css');
    });
    const content = ':scope { background-color: rgb(40,130,160) !important; outline: 3px solid rgb(240,170,20) !important; }';
    await editorLocator().locator('.suite-source-editor input[type=file]').setInputFiles({ name: 'Single.css', mimeType: 'text/css', buffer: Buffer.from(content) });
    await page.waitForFunction(() => window.suiteFinalFixture.controller.getSnapshot().draft.files['Single.css'].text.length > 0);
    assert.equal(await editorLocator().locator('textarea.ui-code').inputValue(), content);
    const downloaded = page.waitForEvent('download');
    await editorLocator().getByRole('button', { name: 'Export source', exact: true }).click();
    const output = resolve(artifacts, 'Single.css'); await (await downloaded).saveAs(output);
    assert.equal(await readFile(output, 'utf8'), content);
    await patch({ overrides: [{ selector: picked, enabled: true, entry: null, stylesheet: 'Single.css' }] }); await preview();
    const colors = await profiles().locator('.instance-actions .instance-details-button').evaluateAll(xs => xs.map(x => getComputedStyle(x).backgroundColor));
    assert.equal(colors[0], 'rgb(40, 130, 160)'); assert.notEqual(colors[1], colors[0]);
    assert.equal(await page.evaluate(() => window.suiteFinalFixture.snapshot.profiles.activeKey), active);
    assert.deepEqual(await raw(), savedGlobal);
  });
  await check('HTML Original composition and public create callback', async () => {
    await patch({ files: { 'Instances.html': '<section><h2>UI HTML layout</h2><button data-ui-action="actions.profileDraft.openCreate">UI create instance</button><ui-slot></ui-slot></section>' }, overrides: [override('page.instances', 'Instances.html')] }); await preview(); await closeEditor();
    await page.getByRole('heading', { name: 'UI HTML layout', exact: true }).waitFor();
    assert.equal(await profiles().count(), 2);
    await page.getByRole('button', { name: 'UI create instance', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Instance name', exact: true }).fill('UI custom world');
    await page.locator('.profile-dialog form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelectorAll('.instance-row').length === 3);
  });
  await check('open modal draft and root style ownership survive Preview', async () => {
    await profiles().first().getByRole('button', { name: 'More tools for Original world', exact: true }).click(); await page.getByRole('menuitem', { name: 'Rename instance', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Instance name', exact: true }).fill('Keep dialog edits');
    const selector = await page.locator('.modal').evaluate(element => {
      const dom = window.suiteFinalFixture.sourceOwners(element);
      const owner = window.suiteFinalFixture.owners().find(o => o.ownerId === dom.leafOwnerId);
      if (!owner) throw Error('modal native ownership not found');
      return { kind: 'position', target: owner.target, locator: owner.locator };
    });
    await patch({ files: { 'Modal.css': ':scope { outline: 3px solid rgb(1,2,3) !important; }' }, overrides: [{ selector, enabled: true, entry: null, stylesheet: 'Modal.css' }] }); await preview();
    assert.equal(await page.locator('.modal').evaluate(x => getComputedStyle(x).outlineColor), 'rgb(1, 2, 3)');
    assert.notEqual(await page.locator('.business-dialog-heading').evaluate(x => getComputedStyle(x).outlineColor), 'rgb(1, 2, 3)');
    await closeEditor(); assert.equal(await page.getByRole('dialog').getByRole('textbox', { name: 'Instance name', exact: true }).inputValue(), 'Keep dialog edits');
    await page.locator('.business-dialog-heading button').click();
  });
  const cardSource = 'import {useState} from "react";export default function Card({Original,props,snapshot,actions}){const [value,setValue]=useState("");const p=snapshot.profiles.items.find(x=>x.profile.instance_key===props.profileKey).profile;return <section data-testid="ui-tsx-card"><input aria-label={"Local "+p.name} value={value} onChange={e=>setValue(e.currentTarget.value)}/><Original {...props}/><button onClick={()=>actions.profileDraft.openRename(p.instance_key)}>UI rename {p.name}</button></section>}';
  const buttonSource = 'export default function Button({Original,props,children}){return <Original {...props} data-testid="ui-native-button">{children}</Original>}';
  const wrappers = [override('component.profile-card', 'Card.tsx'), override('element.button', 'Button.tsx')];
  await check('three wrappers, forwarded native controls, rename and all business navigation', async () => {
    await patch({ files: { 'Card.tsx': cardSource, 'Button.tsx': buttonSource }, overrides: wrappers }); await preview(); await closeEditor();
    assert.equal(await page.getByTestId('ui-tsx-card').count(), 3);
    assert.ok(await page.getByTestId('ui-native-button').count() > 5);
    await page.getByRole('button', { name: 'UI rename Original world', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Instance name', exact: true }).fill('Renamed through TSX'); await page.locator('.profile-dialog form button[type=submit]').click();
    await page.getByRole('button', { name: 'UI rename Renamed through TSX', exact: true }).waitFor();
    await page.locator('.sidebar-account').click(); await page.waitForFunction(() => window.suiteFinalFixture.snapshot.navigation.routeId === 'accounts');
    await page.locator('.sidebar').getByRole('button', { name: 'Download tasks', exact: true }).click();
    await page.waitForFunction(() => window.suiteFinalFixture.snapshot.navigation.routeId === 'downloads');
    await navigate('instances');
    const active = await page.evaluate(() => window.suiteFinalFixture.snapshot.profiles.activeKey);
    await profiles().filter({ hasText: 'Second world' }).getByRole('button', { name: 'Open details for Second world', exact: true }).click(); await page.locator('.instance-detail-tabs').getByRole('button', { name: 'Mods', exact: true }).click();
    assert.equal(await page.evaluate(() => window.suiteFinalFixture.snapshot.content.selectedProfileKey), 'second-instance');
    assert.equal(await page.evaluate(() => window.suiteFinalFixture.snapshot.profiles.activeKey), active);
    await page.locator('.sidebar').getByRole('button', { name: 'Logs', exact: true }).click();
    await page.waitForFunction(() => window.suiteFinalFixture.snapshot.navigation.routeId === 'logs');
    await navigate('instances'); assert.equal(await page.getByTestId('ui-tsx-card').count(), 3);
    await openEditor(); await editorLocator().getByRole('button', { name: 'Save suite', exact: true }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending); wrappedRaw = await raw(); await closeEditor();
  });
  await check('syntax position feedback retains saved bytes and active preview', async () => {
    await patch({ files: { 'Card.tsx': 'export default function Broken(){ return <section> }' } });
    await editorLocator().getByRole('button', { name: 'Preview suite', exact: true }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
    assert.match((await snapshot()).diagnostics.join('\n'), /Card\.tsx.*\d|\d.*Card\.tsx/s);
    assert.deepEqual(await raw(), wrappedRaw); assert.equal(await page.getByTestId('ui-tsx-card').count(), 3);
    await patch({ files: { 'Card.tsx': cardSource } }); await preview(); await closeEditor();
  });
  await check('CSS-only Preview keeps local DOM/input and selected source draft', async () => {
    await page.getByLabel('Local Second world', { exact: true }).fill('unsaved component input');
    await page.getByLabel('Local Second world', { exact: true }).evaluate(x => { window.task13LocalInput = x; });
    await patch({ files: { 'Final.css': '.instance-row {outline:4px solid rgb(30,80,170)!important}' } });
    await page.evaluate(() => window.suiteFinalFixture.controller.actions.selectFile('Final.css'));
    const value = await editorLocator().locator('textarea.ui-code').inputValue();
    await closeEditor(); await openEditor(); assert.equal(await editorLocator().locator('textarea.ui-code').inputValue(), value);
    await preview(); await closeEditor();
    assert.equal(await page.getByLabel('Local Second world', { exact: true }).inputValue(), 'unsaved component input');
    assert.equal(await page.getByLabel('Local Second world', { exact: true }).evaluate(x => x === window.task13LocalInput), true);
    await openEditor(); await page.evaluate(() => window.suiteFinalFixture.controller.actions.selectFile('Card.tsx'));
    assert.equal(await editorLocator().locator('textarea.ui-code').inputValue(), cardSource);
  });
  await check('allowed raster and rejected URL/script/remote executable sources', async () => {
    const png = JSON.parse(await readFile(new URL('./fixtures/ui-suite/browser-assets.json', import.meta.url), 'utf8')).find(asset => asset.name === 'pixel.png');
    await openEditor();
    await editorLocator().locator('.suite-assets input[type=file]').setInputFiles({ name: 'Allowed.png', mimeType: png.media, buffer: Buffer.from(png.data, 'base64') });
    await page.waitForFunction(() => !!window.suiteFinalFixture.controller.getSnapshot().draft.files['Allowed.png']);
    await patch({ files: { 'Raster.html': '<section><img alt="allowed raster" src="./Allowed.png"/><ui-slot></ui-slot></section>' }, overrides: [override('component.profile-card', 'Raster.html')] }); await preview(); await closeEditor();
    assert.equal(await page.getByAltText('allowed raster').count(), 3);
    assert.equal(await page.getByAltText('allowed raster').first().evaluate(x => x.complete && x.naturalWidth > 0), true);
    const before = await raw();
    for (const [path, text] of [['Bad.html','<a href="jav&#x61;script:window.task13Attack=1">attack</a>'], ['Bad.html','<script>window.task13Attack=1</script>'], ['Bad.tsx','import x from "https://example.invalid/x.js";export default function(){return <p>{x}</p>}']]) {
      await patch({ files: { [path]: text }, overrides: [override('component.profile-card', path)] });
      const result = await page.evaluate(() => window.suiteFinalFixture.controller.actions.preview()); assert.equal(result, false);
      assert.ok((await snapshot()).diagnostics.length > 0); assert.deepEqual(await raw(), before);
      assert.equal(await page.evaluate(() => window.task13Attack), undefined);
    }
  });
  await check('disabled executable is saved without execution or loading', async () => {
    await patch({ files: { 'Disabled.tsx': 'window.task13DisabledExecuted=true;throw Error("disabled source executed");export default function(){return null}' }, overrides: [override('component.profile-card', 'Disabled.tsx', null, false)] });
    await editorLocator().getByRole('button', { name: 'Save suite', exact: true }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
    assert.equal((await snapshot()).dirty, false);
    assert.equal(await page.evaluate(() => window.task13DisabledExecuted), undefined);
    await closeEditor(); assert.equal(await profiles().count(), 3);
    await patch({ files: { 'Card.tsx': cardSource }, overrides: wrappers }); await preview(); await closeEditor();
  });
  await check('render failure has source feedback and original fallback without persistence', async () => {
    const before = await raw();
    await patch({ files: { 'Fault.tsx': 'export default function(){throw Error("Task13 render fault");return <div data-testid="failed-wrapper"/>}' }, overrides: [override('component.profile-card', 'Fault.tsx')] });
    await preview(); await closeEditor();
    assert.equal(await profiles().count(), 3); assert.equal(await page.getByTestId('failed-wrapper').count(), 0);
    assert.match((await snapshot()).diagnostics.join('\n'), /Fault\.tsx.*Task13 render fault/s);
    assert.deepEqual(await raw(), before);
  });
  await check('hidden CSS F12 trusted repair, raw UI-only recovery and old bytes', async () => {
    await patch({ files: { 'Hidden.css': '.app-shell{display:none!important}' }, overrides: [], styles: [...basicStyles, 'Hidden.css'] });
    await preview(); await closeEditor(); await page.locator('.app-shell').waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+Shift+F12');
    const recovery = page.getByRole('dialog', { name: 'UI recovery', exact: true }); await recovery.waitFor();
    const before = await raw(), downloaded = page.waitForEvent('download');
    await recovery.getByRole('button', { name: 'Export recoverable data', exact: true }).click();
    const output = resolve(artifacts, 'recoverable-library.json'); await (await downloaded).saveAs(output);
    assert.deepEqual(Array.from(await readFile(output)), before);
    const library = JSON.parse(Buffer.from(before).toString()); assert.equal(library.settings, undefined); assert.equal(library.profiles, undefined);
    await recovery.getByRole('button', { name: 'Open default editor', exact: true }).click();
    await editorLocator().waitFor(); assert.equal((await snapshot()).mode, 'builtin');
    await patch({ styles: basicStyles, overrides: [] }); await preview(); await closeEditor();
    await page.locator('.app-shell').waitFor(); assert.equal(await profiles().count(), 3);
    await page.keyboard.press('Control+Shift+F12'); await recovery.waitFor();
    await recovery.getByRole('button', { name: 'Reset UI library', exact: true }).click();
    await recovery.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await page.waitForFunction(() => window.suiteFinalFixture.controller.getLibrary()?.suites.length === 0);
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending && window.suiteFinalFixture.controller.getActivation());
    await recovery.waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+Shift+F12'); await recovery.waitFor();
    await recovery.getByRole('button', { name: 'Open default editor', exact: true }).click();
    await editorLocator().waitFor(); await preview(); await closeEditor();
    assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(oldBytes)), oldBytes);
    assert.equal(await profiles().count(), 3); assert.equal(await profiles().first().locator('[data-ui-site$=":ProfileCard-name"]').textContent(), 'Renamed through TSX');
    const backups = await page.evaluate(() => window.foundationDesktop.suiteBackups);
    assert.ok(backups.some(bytes => JSON.stringify(bytes) === JSON.stringify(before)), 'reset preserves previous raw source');
  });
  await check('320x240 normal editor dark heading and Save click', async () => {
    await page.evaluate(() => window.suiteFinalFixture.actions.settings.patchAppearance('theme','dark'));
    await page.setViewportSize({ width: 320, height: 240 }); const editor = await openEditor();
    const rgb = await editor.locator('h1').evaluate(x => getComputedStyle(x).color); assert.ok(rgb.match(/\d+/g).slice(0,3).every(x=>Number(x)>100));
    const save = editor.getByRole('button', { name: 'Save suite', exact: true }); await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=320 && bounds.y>=0 && bounds.y+bounds.height<=240);
    await save.click(); await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
    assert.equal((await snapshot()).dirty, false); assert.ok((await raw()).length > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await closeEditor();
  });
  await check('safe startup skips throwing user factories before execution', async () => {
    await page.setViewportSize({ width: 1240, height: 720 });
    await patch({ files: { 'Unsafe.tsx': 'window.task13UnsafeExecuted=true;export default function(){throw Error("unsafe startup executed")}' }, overrides: [override('component.profile-card','Unsafe.tsx')] });
    await editorLocator().getByRole('button', { name: 'Save suite', exact: true }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().pending);
    const saved = await raw(); await preserveNativeReload(); await page.goto(new URL('?ui-safe=1', page.url()).href);
    await page.waitForFunction(() => window.suiteFinalFixture?.controller.getSnapshot().loaded &&
      window.suiteFinalFixture.controller.getActivation(), null, { timeout: 90000 });
    await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
    assert.equal(await page.evaluate(() => window.task13UnsafeExecuted), undefined);
    await page.keyboard.press('Escape'); await page.evaluate(() => window.suiteFinalFixture.controller.recovery.openBuiltinEditor());
    await editorLocator().waitFor({ state: 'visible' });
    const safeBefore = await page.evaluate(() => {
      const c = window.suiteFinalFixture.controller, trusted = c.getActivation().trusted.bundle;
      return { selectedSuiteId: c.getSnapshot().selectedSuiteId, files: trusted.files, views: trusted.manifest.views,
        routes: trusted.manifest.routes, overrides: trusted.manifest.overrides,
        saveWrites: window.foundationDesktop.calls.filter(call => call.command === 'save_ui_suite_library').length };
    });
    const copyBuiltin = editorLocator().getByRole('button', { name: 'Copy builtin', exact: true });
    assert.equal(await copyBuiltin.count(), 1); await copyBuiltin.click();
    await page.waitForFunction(previous => {
      const s = window.suiteFinalFixture.controller.getSnapshot();
      return !s.pending && s.selectedSuiteId !== previous && s.draft && !s.draft.files['Unsafe.tsx'];
    }, safeBefore.selectedSuiteId);
    const safeDraft = (await snapshot()).draft;
    assert.deepEqual(safeDraft.files, safeBefore.files);
    assert.deepEqual(safeDraft.manifest.views, safeBefore.views);
    assert.deepEqual(safeDraft.manifest.routes, safeBefore.routes);
    assert.deepEqual(safeDraft.manifest.overrides, safeBefore.overrides);
    await preview();
    assert.equal(await page.evaluate(() => window.task13UnsafeExecuted), undefined);
    assert.deepEqual(await raw(), saved);
    assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'save_ui_suite_library').length), safeBefore.saveWrites);
    await closeEditor(); await navigate('instances'); assert.equal(await profiles().count(), 3); assert.deepEqual(await raw(), saved);
  });
  assert.deepEqual(fixture.observedPageErrors, []); assert.deepEqual(fixture.observedCspViolations, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') assert.deepEqual(fixture.observedSourceModuleRequests, []);
} catch (error) {
  report.failure = error.stack; process.exitCode = 1; console.error(error);
  await writeFile(resolve(artifacts,'failure-dom.html'), await page.content());
  await writeFile(resolve(artifacts,'failure-state.json'), JSON.stringify(await snapshot(),null,2));
} finally {
  report.pageErrors=fixture.observedPageErrors; report.sourceRequests=fixture.observedSourceModuleRequests; report.cspViolations=fixture.observedCspViolations;
  report.finished_at=new Date().toISOString(); await writeFile(resolve(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n'); await fixture.close();
}








