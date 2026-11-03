import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out = resolve('../.test-data/task-10-editor', process.env.PARADOX_EDITOR_EVIDENCE ?? 'dev');
await mkdir(out, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const report = { csp: fixture.contentSecurityPolicy, errors: fixture.observedPageErrors,
  cspViolations: fixture.observedCspViolations, sourceRequests: fixture.observedSourceModuleRequests, rows: [] };
try {
  await page.waitForFunction(() => window.suiteEditorFixture?.controller.getSnapshot().loaded && window.suiteEditorFixture.controller.getActivation());
  await page.evaluate(() => window.suiteEditorFixture.setLanguage('en-US'));
  const run = async (name, work) => { await work(); report.rows.push(name); console.log(`PASS ${name}`); };
  await run('same_context_self_replace_and_close_reopen', async () => {
    await page.evaluate(async () => {
      const { controller: c } = window.suiteEditorFixture;
      await c.actions.copyBuiltin('modern', 'Browser draft'); c.actions.open();
      c.actions.patchFile('Editor.tsx', `import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';export default function Editor(){const s=useUiEditorSnapshot(),a=useUiEditorActions();return <section role="dialog" aria-label="Replacement editor" style={{pointerEvents:'auto',background:'#223',color:'white',padding:20}}><h1>Replacement editor</h1><span data-pending>{s.pending}</span><button onClick={()=>a.close()}>Close</button></section>}`);
      if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
    });
    await page.getByRole('dialog', { name: 'Replacement editor' }).waitFor();
    const state = await page.evaluate(() => {
      const c = window.suiteEditorFixture.controller; c.actions.close(); c.actions.open(); return c.getSnapshot();
    });
    assert.equal(state.dirty, true); assert.match(state.draft.files['Editor.tsx'].text, /Replacement editor/);
  });
  await run('original_file_read_and_library_conflict_preserve_draft', async () => {
    const result = await page.evaluate(async () => {
      const c = window.suiteEditorFixture.controller; let resolve;
      const held = new Promise((yes) => resolve = yes);
      c.actions.selectFile('a.tsx'); const work = c.actions.importSource({ name: 'a.tsx', size: 1, text: () => held });
      c.actions.selectFile('b.tsx'); resolve('export default () => null; // imported a'); await work;
      const before = c.getSnapshot().draft.files['a.tsx'].text;
      window.foundationDesktop.suiteLibrary.revision++;
      const saved = await c.actions.save();
      return { before, after: c.getSnapshot().draft.files['a.tsx'].text, saved, diagnostics: c.getSnapshot().diagnostics };
    });
    assert.equal(result.saved, false); assert.equal(result.before, result.after); assert.ok(result.diagnostics.length > 0);
  });
  await run('crashed_editor_hidden_css_f12_export_and_protected_repair', async () => {
    await page.evaluate(async () => {
      const c = window.suiteEditorFixture.controller;
      c.actions.patchFile('Editor.tsx', 'export default function BrokenEditor(){throw new Error("fixture editor render failure")}');
      c.actions.patchFile('style.css', '.app-shell{visibility:hidden}');
      if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
    });
    await page.locator('[data-editor-crash]').waitFor();
    assert.equal(await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).visibility), 'hidden');
    await page.keyboard.press('Control+Shift+F12');
    const recovery = page.getByRole('dialog', { name: 'UI recovery', exact: true }); await recovery.waitFor();
    assert.equal(await page.evaluate(() => window.suiteEditorFixture.controller.getSnapshot().suspended), true);
    const download = page.waitForEvent('download');
    await recovery.getByRole('button', { name: 'Export recoverable data', exact: true }).click(); await download;
    await recovery.getByRole('button', { name: 'Open default editor', exact: true }).click();
    await page.getByRole('dialog', { name: 'Fixture suite editor' }).waitFor();
    assert.ok(await page.evaluate(() => window.suiteEditorFixture.normalControls > 0), 'Normal ShadowRoot preserves the incoming same-renderer foundation bridge');
    const result = await page.evaluate(async () => {
      const c = window.suiteEditorFixture.controller;
      const retained = c.getSnapshot().draft.files['Editor.tsx'].text;
      c.actions.patchFile('Editor.tsx', window.suiteEditorFixture.editorSource);
      return { retained, preview: await c.actions.preview() };
    });
    assert.match(result.retained, /BrokenEditor/); assert.equal(result.preview, true);
    await page.evaluate(() => window.suiteEditorFixture.controller.actions.open());
  });
  await run('css_only_preview_keeps_actual_editor_input_and_component_identity', async () => {
    const input = page.getByRole('textbox', { name: 'Local editor input' });
    await input.fill('keep local input');
    const result = await page.evaluate(async () => {
      const c = window.suiteEditorFixture.controller;
      const before = c.getActivation().primary.prepared.views.get('tool.editor');
      c.actions.patchFile('style.css', '.app-shell{color:rgb(111,122,133)}');
      const preview = await c.actions.preview();
      return { preview, same: before === c.getActivation().primary.prepared.views.get('tool.editor') };
    });
    assert.equal(result.preview, true); assert.equal(result.same, true); assert.equal(await input.inputValue(), 'keep local input');
  });
  for (const language of ['en-US', 'zh-CN']) for (const viewport of [{ width: 1240, height: 720 }, { width: 320, height: 240 }]) {
    await page.setViewportSize(viewport); await page.evaluate((lang) => window.suiteEditorFixture.setLanguage(lang), language);
    await page.keyboard.press('Control+Shift+F12');
    await page.locator('.ui-fixed-recovery').waitFor();
    await page.screenshot({ path: resolve(out, `${language}-${viewport.width}.png`) });
    const bounds = await page.evaluate(() => {
      const root = document.getElementById('paradox-suite-recovery').shadowRoot;
      const panel = root.querySelector('.ui-fixed-recovery'), rect = panel.getBoundingClientRect();
      return { width: rect.width, height: rect.height, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight,
        foreground: getComputedStyle(panel).color, font: getComputedStyle(panel).fontFamily,
        protectedRoots: document.querySelectorAll('#paradox-suite-recovery').length };
    });
    assert.equal(bounds.protectedRoots, 1); assert.ok(bounds.width <= viewport.width); assert.ok(bounds.height <= viewport.height);
    assert.equal(bounds.foreground, 'rgb(238, 238, 238)'); assert.match(bounds.font, /system-ui/);
    report.rows.push({ language, viewport, bounds });
  }
  await run('recovery_confirmation_and_bounded_equivalent_publication', async () => {
    await page.evaluate(() => window.suiteEditorFixture.setLanguage('en-US'));
    const recovery = page.getByRole('dialog', { name: 'UI recovery', exact: true });
    await recovery.getByRole('button', { name: 'Reset UI library', exact: true }).click();
    await recovery.getByRole('alertdialog', { name: 'Confirm UI library reset' }).waitFor();
    await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
    const before = await page.evaluate(() => ({ renders: window.suiteEditorFixture.renders, leases: window.suiteEditorFixture.leases }));
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.suiteEditorFixture.controller.actions.cancelPick(); });
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => ({ renders: window.suiteEditorFixture.renders, leases: window.suiteEditorFixture.leases }));
    assert.equal(after.leases, before.leases); assert.ok(after.renders - before.renders <= 2);
  });
  await run('corrupt_exact_raw_export_and_recovery_reset_independent_of_editor', async () => {
    await page.evaluate(() => {
      window.foundationDesktop.suiteRaw = new Uint8Array([255, 0, 65]);
      window.foundationDesktop.suiteLibrary = null;
      window.suiteEditorFixture.reconnect();
    });
    await page.waitForFunction(() => window.suiteEditorFixture.controller.getLibrary() === null && window.suiteEditorFixture.controller.getSnapshot().suspended);
    const recovery = page.getByRole('dialog', { name: 'UI recovery', exact: true }); await recovery.waitFor();
    const downloading = page.waitForEvent('download');
    await recovery.getByRole('button', { name: 'Export recoverable data', exact: true }).click();
    const download = await downloading, path = await download.path();
    assert.deepEqual([...await readFile(path)], [255, 0, 65]);
    await recovery.getByRole('button', { name: 'Reset UI library', exact: true }).click();
    await recovery.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await page.waitForFunction(() => window.suiteEditorFixture.controller.getSnapshot().pending !== 'reset');
    const status = await page.evaluate(() => ({ library: window.suiteEditorFixture.controller.getLibrary(), snapshot: window.suiteEditorFixture.controller.getSnapshot() }));
    const library = status.library; assert.equal(library?.revision, 1, JSON.stringify(status.snapshot.diagnostics));
    assert.deepEqual(library.suites, []);
  });
  assert.deepEqual(report.cspViolations, []); assert.deepEqual(report.errors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') { assert.ok(report.csp); assert.deepEqual(report.sourceRequests, []); }
} finally { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); await fixture.close(); }
