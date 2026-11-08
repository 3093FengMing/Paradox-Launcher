import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const out = resolve('../.test-data/inspector-task-4/browser', process.env.PARADOX_FINAL_EVIDENCE ?? 'automatic-run');
await mkdir(out, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
if (process.argv.includes('--page-error-probe')) await page.evaluate(() => { setTimeout(() => { throw Error('Inspector page-error assertion probe'); }, 0); });
page.setDefaultTimeout(20000);
const report = { automatic: true, rows: [] };
const onlyCases = process.env.PARADOX_OVERRIDE_CASES && new RegExp(process.env.PARADOX_OVERRIDE_CASES);
const state = () => page.evaluate(() => window.suiteFinalFixture.controller.getSnapshot());
const preview = async () => {
  const result = await page.evaluate(async () => {
    const c = window.suiteFinalFixture.controller, ok = await c.actions.preview();
    return { ok, diagnostics: c.getSnapshot().diagnostics };
  });
  assert.equal(result.ok, true, result.diagnostics.join('\n'));
  await page.waitForTimeout(100);
};
const editor = () => page.getByRole('dialog', { name: /^(?:UI Suite Editor|UI 套件编辑器)$/ });
const editorLayout = () => page.evaluate(() => {
  const shadow = document.getElementById('paradox-suite-editor').shadowRoot;
  const grid = shadow.querySelector('.suite-editor-grid');
  const files = grid.querySelector('.suite-file-tree'), source = grid.querySelector('.suite-source-editor');
  return {
    order: [...grid.children].map(element => element.classList.contains('suite-source-editor') ? 'source' : element.classList.contains('suite-file-tree') ? 'files' : element.classList.contains('suite-assets') ? 'assets' : element.tagName),
    columns: getComputedStyle(grid).gridTemplateColumns,
    files: files.getBoundingClientRect().toJSON(), source: source.getBoundingClientRect().toJSON(),
  };
});
const download = async action => {
  const pending = page.waitForEvent('download'); await action();
  const file = await pending; return readFile(await file.path());
};
const check = async (name, fn) => {
  if (onlyCases && !onlyCases.test(name)) return;
  try { report.rows.push({ name, detail: await fn() }); console.log('PASS ' + name); }
  catch (error) { report.rows.push({ name, failure: String(error), snapshot: await state(), dom: await page.evaluate(() => { const host=document.getElementById('paradox-suite-editor'), avatar=document.querySelector('.sidebar .account-avatar'), rect=avatar?.getBoundingClientRect(); return {host:host?.style.cssText, hostPointers:host&&getComputedStyle(host).pointerEvents, shadow:host?.shadowRoot.innerHTML, avatar:rect?.toJSON(), hit:rect&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML};}) }); await page.screenshot({path:resolve(out,'failure.png')}); console.error('FAIL ' + name + ' ' + error); process.exitCode = 1; throw error; }
};

async function journey(customEditor) {
  let customLayout = null;
  const captureCustomLayout = async stage => {
    if (!customEditor) return;
    const layout = await editorLayout();
    customLayout.stages.push({ stage, ...layout });
    assert.deepEqual(layout.order, ['source', 'files', 'assets'], `${stage}: changed editor hierarchy remains active`);
    assert.ok(layout.source.left < layout.files.left, `${stage}: source pane stays on the left`);
    assert.ok(layout.source.width > layout.files.width * 2, `${stage}: source pane keeps the wider column`);
  };
  await page.evaluate(async custom => {
    const f = window.suiteFinalFixture, c = f.controller;
    await c.actions.copyBuiltin('immersive', custom ? 'Custom editor override journey' : 'Override journey');
    if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
    f.actions.navigation.navigate('accounts'); c.actions.open();
  }, customEditor);
  await editor().waitFor();
  if (customEditor) {
    await page.waitForFunction(() => window.suiteFinalFixture.snapshot.accounts.ready && !window.suiteFinalFixture.snapshot.accounts.loading);
    await page.evaluate(async () => {
      const f = window.suiteFinalFixture, c = f.controller;
      const owner = f.owners().find(owner => owner.target === 'component.account-avatar' && [...owner.roots].some(root => root.closest('.sidebar')));
      if (!owner) throw Error('Existing sidebar account target missing before editor replacement');
      c.actions.selectTarget({ kind: 'position', target: owner.target, locator: owner.locator });
      c.actions.createFile('R1-retained.css', 'css');
      c.actions.patchFile('R1-retained.css', '/* unfinished draft before editor layout replacement */\n');
      c.actions.selectFile('R1-retained.css');
      f.actions.settings.patch('memory_mb', 6144);
      f.actions.accounts.patchClientId('r1-draft-before-layout');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const s = c.getSnapshot();
      const observe = () => {
        const current = window.suiteFinalFixture;
        const commands = ['get_config', 'account_state', 'account_recovery', 'download_tasks', 'plugin:event|listen', 'plugin:event|unlisten'];
        const calls = window.foundationDesktop.calls.map((call, index) => ({ index, ...structuredClone(call) })).filter(call => commands.includes(call.command));
        return {
          business: structuredClone({ settings: current.snapshot.settings, accounts: current.snapshot.accounts, navigation: current.snapshot.navigation }),
          avatarOwners: current.owners().filter(owner => owner.target === 'component.account-avatar' && [...owner.roots].some(root => root.getRootNode() === document)).map(owner => ({
            ownerId: owner.ownerId, parentOwnerId: owner.parentOwnerId, target: owner.target,
            locator: structuredClone(owner.locator), stability: owner.stability, metadata: structuredClone(owner.metadata),
            roots: [...owner.roots].map(root => ({ connected: root.isConnected, inDocument: root.getRootNode() === document, html: root.outerHTML, ownership: current.sourceOwners(root) })),
          })),
          observedCalls: calls, commandCounts: Object.fromEntries(commands.map(command => [command, calls.filter(call => call.command === command).length])),
        };
      };
      window.overrideLayoutContinuity = { controller: c, editorActions: c.actions, launcherActions: f.actions,
        suiteId: s.selectedSuiteId, selection: structuredClone(s.selection), selectedFile: s.selectedFile,
        retainedFile: structuredClone(s.draft.files['R1-retained.css']),
        editorComponent: c.getActivation().primary.prepared.views.get('tool.editor'),
        businessRoots: [...document.querySelectorAll('.account-avatar')],
        avatarOwners: [...f.owners()].filter(owner => owner.target === 'component.account-avatar' && [...owner.roots].some(root => root.getRootNode() === document)).map(owner => ({ ownerId: owner.ownerId, parentOwnerId: owner.parentOwnerId, roots: [...owner.roots] })),
        observe, before: observe() };
    });
    await editor().locator('.suite-editor-grid').scrollIntoViewIfNeeded();
    const before = await editorLayout();
    await page.screenshot({ path: resolve(out, 'editor-layout-before.png') });
    const replacement = await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      const path = c.getSnapshot().draft.manifest.views['tool.editor'];
      const original = c.getSnapshot().draft.files[path].text;
      const views = '        <UiView data-ui-site="Editor-26" id="tool.editor.files" Original={FileTree} />\n        <UiView data-ui-site="Editor-27" id="tool.editor.source" Original={SourceEditor} />';
      if (!original.includes(views)) throw Error('Canonical editor file/source view sequence changed');
      const source = original.replace('suite-editor ui-editor', 'suite-editor ui-editor custom-journey-editor')
        .replace('<div data-ui-site="Editor-body"', '<div data-custom-editor-layout="public-source" data-ui-site="Editor-body"')
        .replace(views, '        <UiView data-ui-site="Editor-27" id="tool.editor.source" Original={SourceEditor} />\n        <UiView data-ui-site="Editor-26" id="tool.editor.files" Original={FileTree} />');
      const stylePath = 'common/editor/style.css', originalCss = c.getSnapshot().draft.files[stylePath].text;
      const css = originalCss + '\n/* Copied editor: source workspace first, file navigator second. */\n.custom-journey-editor .suite-editor-grid { grid-template-columns: minmax(0, 3fr) minmax(130px, 1fr); }\n@media (max-width: 600px) { .custom-journey-editor .suite-editor-grid { grid-template-columns: minmax(0, 1fr); } }\n';
      c.actions.patchFile(path, source);
      c.actions.patchFile(stylePath, css);
      if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const f = window.suiteFinalFixture, s = c.getSnapshot(), prior = window.overrideLayoutContinuity;
      return { path, original, source, stylePath, originalCss, css, continuity: {
        sameController: c === prior.controller, sameEditorActions: c.actions === prior.editorActions,
        sameLauncherActions: f.actions === prior.launcherActions, sameSuite: s.selectedSuiteId === prior.suiteId,
        beforeSelection: prior.selection, afterSelection: structuredClone(s.selection),
        beforeFile: prior.selectedFile, afterFile: s.selectedFile,
        beforeRetainedFile: prior.retainedFile, afterRetainedFile: structuredClone(s.draft.files['R1-retained.css']),
        memoryDraft: f.snapshot.settings.draft.memory_mb,
        replacedEditorComponent: c.getActivation().primary.prepared.views.get('tool.editor') !== prior.editorComponent,
        sameBusinessRoots: prior.businessRoots.every(root => root.isConnected && [...document.querySelectorAll('.account-avatar')].includes(root)),
        before: prior.before, after: prior.observe(),
        priorOwnerLifetime: prior.avatarOwners.map(owner => ({ ownerId: owner.ownerId, parentOwnerId: owner.parentOwnerId,
          stillRegistered: f.owners().some(current => current.ownerId === owner.ownerId),
          roots: owner.roots.map(root => ({ connected: root.isConnected, html: root.outerHTML, ownership: f.sourceOwners(root) })),
        })),
      } };
    });
    await editor().waitFor();
    await page.locator('[data-custom-editor-layout]').waitFor();
    await editor().locator('.suite-editor-grid').scrollIntoViewIfNeeded();
    const after = await editorLayout();
    customLayout = { before, after, replacement, stages: [] };
    await writeFile(resolve(out, 'editor-layout-replacement.json'), JSON.stringify(customLayout, null, 2));
    await page.screenshot({ path: resolve(out, 'editor-layout-after.png') });
    assert.deepEqual(before.order, ['files', 'source', 'assets']);
    assert.deepEqual(after.order, ['source', 'files', 'assets'], 'custom source must actually move the source editor before the file tree');
    assert.ok(after.source.left < after.files.left, 'custom source pane must be visibly on the left');
    assert.ok(after.source.width > after.files.width * 2, 'custom source pane must use the wider column');
    const continuity = replacement.continuity;
    for (const key of ['sameController', 'sameEditorActions', 'sameLauncherActions', 'sameSuite', 'replacedEditorComponent']) assert.equal(continuity[key], true, key);
    assert.deepEqual(continuity.afterSelection, continuity.beforeSelection, 'existing full selection survives editor replacement');
    assert.equal(continuity.afterFile, continuity.beforeFile, 'existing source tab survives editor replacement');
    assert.deepEqual(continuity.afterRetainedFile, continuity.beforeRetainedFile, 'existing unfinished draft file survives editor replacement');
    assert.equal(continuity.memoryDraft, 6144, 'unfinished business draft survives editor replacement');
    assert.deepEqual(continuity.after.business, continuity.before.business, 'public business state and drafts survive executable editor replacement');
    assert.deepEqual(continuity.after.observedCalls, continuity.before.observedCalls, 'editor replacement causes no observed bootstrap, listen or unlisten calls');
    await editor().getByRole('button', { name: 'Close editor', exact: true }).click();
    const clientInput = page.getByPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', { exact: true });
    assert.equal(await clientInput.inputValue(), 'r1-draft-before-layout', 'remounted account input displays the retained draft');
    await clientInput.fill('r1-callback-after-layout');
    await page.waitForFunction(() => window.suiteFinalFixture.snapshot.accounts.clientIdDraft === 'r1-callback-after-layout');
    const callback = await page.evaluate(async () => {
      const prior = window.overrideLayoutContinuity, f = window.suiteFinalFixture;
      const marker = 'R1 subscription delivery after executable editor replacement';
      const beforeLogCount = f.snapshot.logs.lines.filter(line => line.message === marker).length;
      window.foundationDesktop.emit('launcher://log', { id: { session: 'r1-layout', sequence: '1' }, level: 'info', message: marker, time: 0 });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      f.controller.actions.open();
      const s = f.controller.getSnapshot();
      return { marker, beforeLogCount, afterLogCount: window.suiteFinalFixture.snapshot.logs.lines.filter(line => line.message === marker).length,
        beforeClientId: prior.before.business.accounts.clientIdDraft, afterClientId: window.suiteFinalFixture.snapshot.accounts.clientIdDraft,
        sameLauncherActions: window.suiteFinalFixture.actions === prior.launcherActions,
        selection: structuredClone(s.selection), selectedFile: s.selectedFile, retainedFile: structuredClone(s.draft.files['R1-retained.css']),
        after: prior.observe(),
      };
    });
    customLayout.callback = callback;
    await writeFile(resolve(out, 'editor-layout-business-continuity.json'), JSON.stringify({ continuity, callback }, null, 2));
    assert.equal(callback.sameLauncherActions, true, 'real account input continues through the original action owner');
    assert.equal(callback.afterClientId, 'r1-callback-after-layout', 'real remounted input callback updates the public business draft');
    assert.equal(callback.beforeLogCount, 0);
    assert.equal(callback.afterLogCount, 1, 'one fixture event still reaches the business log subscription after replacement');
    assert.deepEqual(callback.after.observedCalls, continuity.before.observedCalls, 'callback and event delivery cause no observed bootstrap or subscription replacement');
    assert.deepEqual(callback.selection, continuity.beforeSelection);
    assert.equal(callback.selectedFile, continuity.beforeFile);
    assert.deepEqual(callback.retainedFile, continuity.beforeRetainedFile);
    assert.equal(callback.after.business.settings.draft.memory_mb, 6144);
    assert.deepEqual(callback.after.business.accounts.state, continuity.before.business.accounts.state);
    await editor().waitFor();
    await captureCustomLayout('business_callback_reopen');
  }
  // Pick the real sidebar account position through the actual capture service.
  await page.evaluate(() => window.suiteFinalFixture.controller.actions.beginPick());
  await page.waitForTimeout(350);
  await page.locator('.sidebar .account-avatar').first().hover();
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().picking);
  const selected = await page.evaluate(() => {
    const c = window.suiteFinalFixture.controller, s = c.getSnapshot();
    const target = [s.currentTarget, ...s.targetAncestors].find(t => t?.selector.target === 'component.account-avatar');
    if (!target) throw Error('Real sidebar account avatar owner missing');
    c.actions.selectTarget(target.selector); return target.selector;
  });
  assert.equal(selected.kind, 'position');
  await page.evaluate(() => { window.overrideJourneyRoots = [...document.querySelectorAll('.account-avatar')]; window.overrideJourneyColors = window.overrideJourneyRoots.map(r => getComputedStyle(r).backgroundColor); });
  await editor().getByRole('button', { name: 'Create or open CSS override', exact: true }).click();
  const positionPath = (await state()).selection.filePath;
  assert.match(positionPath, /^overrides\/[a-f0-9]{64}\/style\.css$/);
  await editor().getByRole('textbox', { name: 'Suite source', exact: true }).fill('.account-avatar { background: rgb(111, 22, 33) !important; }');
  await preview();
  const position = await page.evaluate(() => ({
    colors: [...document.querySelectorAll('.account-avatar')].map(r => getComputedStyle(r).backgroundColor),
    before: window.overrideJourneyColors,
    sameRoots: window.overrideJourneyRoots.every(r => r.isConnected && [...document.querySelectorAll('.account-avatar')].includes(r)),
  }));
  assert.equal(position.colors.filter((color, i) => color !== position.before[i]).length, 1, 'position changes exactly one real account position');
  assert.equal(position.sameRoots, true, 'CSS-only preview preserves real business DOM');
  await captureCustomLayout('position_css_preview');
  await page.evaluate(() => window.suiteFinalFixture.controller.actions.setScope('type'));
  await editor().getByRole('button', { name: 'Create or open CSS override', exact: true }).click();
  const typePath = (await state()).selection.filePath;
  assert.notEqual(typePath, positionPath);
  await editor().getByRole('textbox', { name: 'Suite source', exact: true }).fill('.account-avatar { background: rgb(44, 55, 66) !important; }');
  await preview();
  const type = await page.evaluate(() => [...document.querySelectorAll('.account-avatar')].map(r => getComputedStyle(r).backgroundColor));
  assert.equal(type.every((color, i) => color !== position.before[i]), true, 'type changes all real positions including the exact override');
  await captureCustomLayout('type_css_preview');
  const saved = (await state()).draft.manifest.overrides;
  assert.equal(await page.evaluate(() => window.suiteFinalFixture.controller.actions.save()), true);
  const persisted = await page.evaluate(() => structuredClone(window.foundationDesktop.suiteLibrary));
  const raw = await page.evaluate(() => [...window.foundationDesktop.suiteRaw]);
  await page.addInitScript(({ library, raw }) => {
    const restore = s => { s.suiteLibrary = library; s.suiteRaw = new Uint8Array(raw); return s; };
    if (window.foundationDesktop) restore(window.foundationDesktop);
    else { let value; Object.defineProperty(window, 'foundationDesktop', { configurable: true, get: () => value, set: s => { value = restore(s); } }); }
  }, { library: persisted, raw });
  await page.reload();
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
  await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
  assert.deepEqual((await state()).draft.manifest.overrides, saved, 'actual page reload reads the persisted complete bindings');
  assert.deepEqual(await page.evaluate(() => [...window.foundationDesktop.suiteRaw]), raw, 'actual page reload retains exact persisted raw bytes');
  await page.evaluate(() => window.suiteFinalFixture.controller.actions.open());
  await editor().waitFor();
  if (customEditor) {
    const draft = (await state()).draft, replacement = customLayout.replacement;
    assert.equal(draft.files[replacement.path].text, replacement.source, 'actual reload retains changed editor source');
    assert.equal(draft.files[replacement.stylePath].text, replacement.css, 'actual reload retains operative editor layout CSS');
    assert.deepEqual(draft.files['R1-retained.css'], replacement.continuity.beforeRetainedFile, 'actual reload retains preexisting unfinished file');
  }
  await captureCustomLayout('saved_page_reload');
  const bytes = await download(() => page.evaluate(() => window.suiteFinalFixture.controller.actions.exportDraft()));
  await writeFile(resolve(out, customEditor ? 'custom-editor.paradox-ui' : 'normal-editor.paradox-ui'), bytes);
  assert.equal(await page.evaluate(bytes => window.suiteFinalFixture.controller.actions.importBundle(new File([new Uint8Array(bytes)], 'journey.paradox-ui')), [...bytes]), true);
  assert.deepEqual((await state()).draft.manifest.overrides, saved, 'actual export/reimport preserves complete bindings');
  await preview();
  if (customEditor) {
    const draft = (await state()).draft, replacement = customLayout.replacement;
    assert.equal(draft.files[replacement.path].text, replacement.source, 'actual ZIP reimport retains changed editor source');
    assert.equal(draft.files[replacement.stylePath].text, replacement.css, 'actual ZIP reimport retains operative editor layout CSS');
    assert.deepEqual(draft.files['R1-retained.css'], replacement.continuity.beforeRetainedFile, 'actual ZIP reimport retains preexisting unfinished file');
  }
  await captureCustomLayout('export_reimport_preview');
  await page.evaluate(selector => window.suiteFinalFixture.controller.actions.selectTarget(selector), selected);
  if (process.env.PARADOX_CAPTURE_TASK4 === '1' && !customEditor) {
    await editor().locator('.ui-target-details').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('../docs/screenshots/ui-framework-select.png') });
    await editor().locator('.ui-target-preview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve('../docs/screenshots/ui-framework-inspector.png') });
    await page.evaluate(() => window.suiteFinalFixture.controller.actions.beginPick());
    await page.locator('.sidebar .account-avatar').first().hover();
    await page.screenshot({ path: resolve('../docs/screenshots/ui-framework-picker.png') });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 320, height: 240 });
  assert.equal(await editor().getByRole('button', { name: 'Save suite', exact: true }).isVisible(), true);
  const saveRect = await editor().getByRole('button', { name: 'Save suite', exact: true }).boundingBox();
  assert.ok(saveRect.y >= 0 && saveRect.y + saveRect.height <= 240, 'Save remains in the real 320×240 viewport');
  if (customEditor) {
    const layout = await editorLayout();
    customLayout.stages.push({ stage: 'minimum_window', ...layout });
    assert.deepEqual(layout.order, ['source', 'files', 'assets']);
    assert.equal(layout.source.left, layout.files.left, 'custom editor uses one column at the minimum window size');
    assert.ok(layout.source.top < layout.files.top, 'custom source pane stays first in the responsive layout');
    await page.screenshot({ path: resolve(out, 'custom-editor-320.png') });
    await writeFile(resolve(out, 'editor-layout-final.json'), JSON.stringify(customLayout, null, 2));
  }
  if (process.env.PARADOX_CAPTURE_TASK4 === '1' && !customEditor) await page.screenshot({ path: resolve('../docs/screenshots/ui-framework-editor-320x240.png') });
  await page.setViewportSize({ width: 1240, height: 720 });
  return { selected, positionPath, typePath, position, type, saved, exportedBytes: bytes.length, customEditor, customLayout, saveRect };
}

try {
  await page.locator('[data-style-choice]').waitFor();
  await page.locator('[data-style-choice] input[value="modern"]').check();
  await page.locator('[data-style-choice]').getByRole('button', { name: '使用此界面', exact: true }).click();
  await page.locator('[data-style-choice]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
  await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
  await check('pick_edit_preview_save_reload_export', () => journey(false));
  await check('self_custom_editor_pick_edit_preview_save_reload_export', () => journey(true));
  await check('html_tsx_props_events_refs_original_and_exact_reset', async () => {
    await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      if (c.getSnapshot().selectedSuiteId.startsWith('builtin.')) await c.actions.copyBuiltin('immersive', 'HTML TSX props journey');
      window.overrideJourneyCalls = []; window.overrideJourneyRefs = {};
      c.actions.createFile('JourneyRow.tsx', 'tsx');
      c.actions.patchFile('JourneyRow.tsx', 'export default function Row({props}){return <button {...props} data-ui-site="Journey-original" data-journey-original>{props.label}</button>}');
      c.actions.createFile('JourneyAccounts.tsx', 'tsx');
      c.actions.patchFile('JourneyAccounts.tsx', `import {Fragment,useCallback} from 'react';import {UiView,UiIdentity} from '@paradox/ui';function Original(props){return <button {...props} data-ui-site="Journey-original" data-journey-original>{props.label}</button>}export default function Accounts(){const refs=useCallback(node=>{if(node)window.overrideJourneyRefs[node.dataset.journeyId]=node},[]);return <Fragment key="journey"><UiIdentity key="identity" data-ui-site="Journey-identity" namespace="account" value="account-a">{['one','two'].map(id=><UiView key={id} data-ui-site="Journey-view" id="component.inspector-journey" Original={Original} props={{label:'Account '+id,'data-journey-id':id,ref:refs,onClick:e=>window.overrideJourneyCalls.push({id,type:e.type})}}/>)}</UiIdentity></Fragment>}`);
      c.actions.patchManifest({ views: { ...c.getSnapshot().draft.manifest.views, 'page.accounts': 'JourneyAccounts.tsx', 'component.inspector-journey': 'JourneyRow.tsx' }, routes: c.getSnapshot().draft.manifest.routes.map(r => r.id === 'accounts' ? { ...r, entry: 'JourneyAccounts.tsx' } : r) });
      window.suiteFinalFixture.actions.navigation.navigate('accounts');
    });
    await preview();
    await page.evaluate(() => {
      const f = window.suiteFinalFixture, owner = f.owners().find(o => o.target === 'component.inspector-journey' && o.locator.calls.some(call => call.key === 'one'));
      if (!owner) throw Error('Keyed journey UiView owner missing');
      f.controller.actions.selectTarget({ kind: 'position', target: owner.target, locator: owner.locator }); f.controller.actions.open();
    });
    await page.evaluate(() => window.suiteFinalFixture.controller.actions.createSelectionOverride('html'));
    const html = (await state()).selection.filePath;
    await page.evaluate(path => window.suiteFinalFixture.controller.actions.patchFile(path, '<button data-ui-site="Journey-html" data-ui-props>{{props.label}}</button>'), html);
    await preview();
    const htmlTarget = (await state()).currentTarget;
    assert.equal(htmlTarget.status, 'resolved'); assert.equal(htmlTarget.matchCount, 1);
    await editor().getByRole('button', { name: 'Close editor', exact: true }).click();
    await page.locator('[data-ui-site$=":Journey-html"]').click();
    assert.deepEqual(await page.evaluate(() => window.overrideJourneyCalls), [{ id: 'one', type: 'click' }]);
    assert.equal(await page.evaluate(() => window.overrideJourneyRefs.one === document.querySelector('[data-ui-site$=":Journey-html"]')), true);
    assert.equal(await page.locator('[data-journey-original]').count(), 1);
    await page.evaluate(() => window.suiteFinalFixture.controller.actions.open());
    await page.evaluate(() => window.suiteFinalFixture.controller.actions.createSelectionOverride('tsx'));
    const tsx = (await state()).selection.filePath;
    assert.ok((await state()).draft.files[html], 'switch retains former HTML file');
    await page.evaluate(path => window.suiteFinalFixture.controller.actions.patchFile(path, 'export default function Replacement({props,Original}){return <Original {...props} data-ui-site="Journey-delegated" data-journey-delegated/>}'), tsx);
    await preview();
    const tsxTarget = (await state()).currentTarget;
    assert.equal(tsxTarget.status, 'resolved', 'Original continuation retains the exact logical view owner'); assert.equal(tsxTarget.matchCount, 1);
    assert.deepEqual(tsxTarget.selector, htmlTarget.selector);
    await editor().getByRole('button', { name: 'Close editor', exact: true }).click();
    await page.locator('[data-journey-delegated]').click();
    assert.deepEqual(await page.evaluate(() => window.overrideJourneyCalls), [{ id: 'one', type: 'click' }, { id: 'one', type: 'click' }]);
    assert.equal(await page.evaluate(() => window.overrideJourneyRefs.one === document.querySelector('[data-journey-delegated]')), true);
    await page.evaluate(() => { const c = window.suiteFinalFixture.controller; c.actions.resetSelectionOverride(); c.actions.open(); });
    const retained = await state(); assert.ok(retained.draft.files[html]); assert.ok(retained.draft.files[tsx]); assert.equal(retained.selection.filePath, null);
    await preview(); assert.equal(await page.evaluate(() => document.querySelectorAll('[data-journey-original]').length), 2, 'only the two actual business roots are counted; mirror is readonly');
    return { html, tsx, htmlTarget, tsxTarget, calls: await page.evaluate(() => window.overrideJourneyCalls), retainedFiles: [html, tsx] };
  });
  await check('bilingual_theme_source_controls_and_fixed_raw_recovery', async () => {
    const rows = [];
    for (const language of ['zh-CN', 'en-US']) for (const theme of ['dark', 'light']) {
      await page.evaluate(async ({language, theme}) => { const f = window.suiteFinalFixture; await f.setLanguage(language); f.actions.settings.patchAppearance('theme', theme); }, {language, theme});
      assert.equal(await editor().locator('[data-ui-site$=":TargetDetails-source-controls"]').count(), 1);
      rows.push({language, theme, controls: await editor().locator('[data-ui-site$=":TargetDetails-source-controls"]').innerText()});
    }
    await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
    const before = await page.evaluate(() => [...window.foundationDesktop.suiteRaw]);
    await page.evaluate(() => { const c = window.suiteFinalFixture.controller, path = c.getSnapshot().draft.manifest.views['tool.editor']; c.actions.patchFile(path, 'export default function BrokenEditor(){throw Error("task4 recovery fixture")}'); });
    await preview(); await page.keyboard.press('Control+Shift+F12');
    assert.equal(await page.getByRole('button', { name: 'Disable user UI', exact: true }).isVisible(), true);
    const raw = await download(() => page.evaluate(() => window.suiteFinalFixture.controller.recovery.exportRecoverable()));
    assert.deepEqual([...raw], before, 'Recovery exports saved raw bytes unchanged');
    assert.equal((await state()).draft.files[(await state()).draft.manifest.views['tool.editor']].text.includes('BrokenEditor'), true);
    return { rows, rawBytes: raw.length, recovery: true };
  });
  await page.waitForTimeout(350);
  assert.deepEqual(fixture.observedPageErrors, [], 'all startup and settled journey page errors');
  assert.deepEqual(fixture.observedCspViolations, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') { assert.ok(fixture.contentSecurityPolicy); assert.deepEqual(fixture.observedSourceModuleRequests, []); }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  report.csp = fixture.contentSecurityPolicy; report.sourceRequests = fixture.observedSourceModuleRequests;
  report.errors = fixture.observedPageErrors; report.cspViolations = fixture.observedCspViolations;
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await fixture.close();
}
