import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, openEditor } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';
import { redesignScenarios, redesignViewports, redesignScales, defaultRoutes, redesignConfig, sourceSite, launcherAction, boundaryMode, installRedesignBoundary, assertSameOwner, assertReachable, captureDefaultSurface, assertIndependentReducedMotion, runRedesignScenario, cancelRedesignLogin } from './lib/ui-redesign-scenarios.mjs';

const root = resolve(import.meta.dirname, '../..');
const lane = process.env.PARADOX_TEST_NATIVE_CSP === '1' ? 'compiled' : 'dev';
const out = resolve(process.env.PARADOX_UI_REDESIGN_EVIDENCE || resolve(root, '.test-data/ui-redesign', lane, 'redesign-browser'));
const url = process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434';
const nativeCsp = JSON.parse(await readFile(resolve(root, 'apps/desktop/tauri.conf.json'), 'utf8')).app.security.csp;
const locale = JSON.parse(await readFile(resolve(root, 'ui/src/locales/en-US.json'), 'utf8'));
const text = key => key.split('.').reduce((value, part) => value?.[part], locale) || key;
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), lane, url, scenarios: redesignScenarios, matrix: { suites: ['modern', 'immersive'], themes: ['dark', 'light'], viewports: redesignViewports, scales: redesignScales }, focused: [], rows: [], failures: [] };
const saveReport = () => writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

// These accepted focused scripts retain the domain boundary assertions. The
// redesign matrix adds cross-product coverage on the very same fixture owner.
const focused = [
  ['check-ui-home-browser.mjs', 'PARADOX_HOME_EVIDENCE'],
  ['check-ui-instances-browser.mjs', 'PARADOX_INSTANCES_EVIDENCE'],
  ['check-ui-versions-downloads-browser.mjs', 'PARADOX_TASK6_EVIDENCE'],
  ['check-ui-accounts-discovery-browser.mjs', 'PARADOX_ACCOUNTS_EVIDENCE'],
  ['check-ui-default-settings-browser.mjs', 'PARADOX_TASK8_EVIDENCE'],
  ['check-ui-dialogs-browser.mjs', 'PARADOX_TASK9_EVIDENCE'],
  ['check-ui-logs-responsive-browser.mjs', 'PARADOX_TASK10_EVIDENCE'],
];
if (process.env.PARADOX_REDESIGN_MATRIX_ONLY !== '1') {
  for (const [script, variable] of focused) {
    const scriptPath = resolve(import.meta.dirname, script), evidence = resolve(out, 'focused', script.replace('check-ui-', '').replace('-browser.mjs', ''));
    const bytes = await readFile(scriptPath); // A missing required child fails explicitly.
    await mkdir(evidence, { recursive: true });
    const result = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [scriptPath], { cwd: resolve(root, 'ui'), env: { ...process.env, PARADOX_UI_URL: url, PARADOX_SUITE_BUILTINS: '1', [variable]: evidence }, windowsHide: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
      child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
      child.on('error', reject); child.on('close', (code, signal) => done({ script, evidence, sha256: createHash('sha256').update(bytes).digest('hex'), code, signal, stdout, stderr }));
    });
    await writeFile(resolve(evidence, 'runner.log'), result.stdout + result.stderr);
    report.focused.push({ ...result, stdout: undefined, stderr: undefined });
    if (result.code !== 0) { report.failures.push('focused: ' + script); process.exitCode = 1; }
    await saveReport();
  }
}

for (const suite of ['modern', 'immersive']) for (const theme of ['dark', 'light']) for (const scale of redesignScales) for (const viewport of redesignViewports) {
  const key = `${suite}-${theme}-${scale}-${viewport.width}x${viewport.height}`;
  const evidence = resolve(out, 'matrix', key);
  await mkdir(evidence, { recursive: true });
  const row = { suite, theme, scale, viewport, checks: [], screenshots: [], reachability: [], sourceHashes: {} };
  report.rows.push(row);
  let fixture;
  try {
    const startUrl = new URL(url); startUrl.searchParams.set('shellHome', suite);
    fixture = await createBrowserFixture({ url: startUrl.href, config: redesignConfig(initialConfig, { theme, scale }), desktopBoundary: true });
    const { page } = fixture; page.setDefaultTimeout(15_000);
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
    await page.evaluate(() => window.suiteBuiltinsFixture.setLanguage('en-US'));
    await installRedesignBoundary(page);
    const capture = async (scenario, phase) => {
      await page.evaluate(() => { const f = window.suiteBuiltinsFixture; f.snapshot.notifications.items.forEach(notice => f.actions.notifications.dismiss(notice.id)); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const path = resolve(evidence, `${scenario}-${phase}.png`);
      const surface = await captureDefaultSurface(page);
      assert.deepEqual(surface.images, [], 'current default source has no image elements');
      assert.deepEqual(surface.backgroundImages, [], 'current default source consumes no background artwork');
      assert.equal(surface.overflow, false, 'root viewport never needs horizontal overflow');
      await page.screenshot({ path });
      row.screenshots.push({ scenario, phase, path, source: 'current-default', sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    };
    const choice = page.locator('[data-style-choice]'), radio = choice.locator('input[value="' + suite + '"]');
    assert.deepEqual(await page.evaluate(() => window.suiteBuiltinsFixture.initialCommit), { active: null, revision: 0 });
    assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'save_ui_suite_library').length), 0);
    await radio.check(); await radio.evaluate(element => { element.dataset.redesignInput = 'retained'; });
    await boundaryMode(page, 'save_ui_suite_library', 'fail');
    await assertReachable(page, choice.getByRole('button', { name: text('onboarding.confirm'), exact: true }), 'first choice confirmation');
    await page.keyboard.press('Enter');
    await choice.getByRole('alert').waitFor();
    row.expectedFirstChoiceDiagnostics = await page.evaluate(() => window.suiteBuiltinsFixture.controller.getSnapshot().diagnostics);
    assert.deepEqual(row.expectedFirstChoiceDiagnostics, ['Task11 save_ui_suite_library failed: ' + 'a long actionable English error description '.repeat(8)], 'the native failure records exactly the deliberately injected save diagnostic');
    assert.equal(await radio.isChecked(), true); assert.equal(await radio.getAttribute('data-redesign-input'), 'retained');
    assert.equal(await page.evaluate(() => window.foundationDesktop.suiteLibrary.revision), 0);
    await capture('style-choice-success-failure', 'failed-CAS-keeps-choice');
    await choice.getByRole('button', { name: text('onboarding.confirm'), exact: true }).click();
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
    await assertSameOwner(page);
    assert.deepEqual(await page.evaluate(() => ({ active: window.foundationDesktop.suiteLibrary.active_suite_id, revision: window.foundationDesktop.suiteLibrary.revision })), { active: 'builtin.' + suite, revision: 1 });
    row.checks.push('pristine_no_write_explicit_failed_CAS_retry_same_input_same_owner');
    const provenance = await page.evaluate(() => { const c = window.suiteBuiltinsFixture.controller, bundle = c.getActivation().primary.bundle; return { manifest: bundle.manifest, bindings: bundle.manifest.views }; });
    row.provenance = provenance;
    for (const descriptor of provenance.manifest.files) row.sourceHashes[descriptor.path] = createHash('sha256').update(await readFile(resolve(root, 'ui/src/ui-suite/builtins', descriptor.path))).digest('hex');
    for (const descriptor of provenance.manifest.files) assert.equal(row.sourceHashes[descriptor.path], descriptor.sha256, 'active bundle matches actual source bytes: ' + descriptor.path);
    const navigate = async routeId => {
      const route = provenance.manifest.routes.find(route => route.id === routeId);
      assert.ok(route, 'Current manifest route exists: ' + routeId);
      if (routeId === 'custom.instance-details') {
        await navigate('instances');
        const card = page.locator('.instance-row[data-profile-key="original-instance"]');
        const details = suite === 'immersive' ? card.locator('button[data-ui-site$=":ProfileCard-view"]') : card.locator('.instance-details-button');
        await assertReachable(page, details, 'full instance details'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'custom.instance-details' && window.suiteBuiltinsFixture.snapshot.navigation.params.profileKey === 'original-instance');
      } else {
        const detailBack = page.locator('#root button[data-ui-site$=":InstanceDetailPage-back"]');
        if (await detailBack.isVisible()) {
          row.reachability.push(await assertReachable(page, detailBack, 'leave full instance details'));
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'instances');
        }
        const mobile = page.locator('.mobile-navigation').getByRole('button', { name: text('responsiveUi.navigation'), exact: true });
        if (await mobile.isVisible()) {
          row.reachability.push(await assertReachable(page, mobile, 'mobile navigation trigger ' + routeId));
          await page.keyboard.press('Enter');
          const menu = page.getByRole('menu'); await menu.waitFor();
          const item = menu.getByRole('menuitem', { name: text(route.title), exact: true }).and(menu.locator('[data-ui-site$="SidebarMenu-route"]'));
          row.reachability.push(await assertReachable(page, item, 'mobile route ' + routeId));
          await page.keyboard.press('Enter'); await menu.waitFor({ state: 'hidden' });
          await page.waitForFunction(element => element === element.getRootNode().activeElement, await mobile.elementHandle(), { timeout: 1000 });
        } else {
          const contextualBack = page.locator('.instance-context-sidebar').getByRole('button', { name: text('instancePages.back'), exact: true });
          if (await contextualBack.isVisible()) {
            row.reachability.push(await assertReachable(page, contextualBack, 'leave contextual details sidebar'));
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'instances');
          }
          const control = routeId === 'accounts' ? page.locator('.sidebar-account') : page.locator('.sidebar').getByRole('button', { name: text(route.title), exact: true });
          row.reachability.push(await assertReachable(page, control, 'navigation ' + routeId));
          await page.keyboard.press('Enter');
        }
      }
      await page.waitForFunction(route => window.suiteBuiltinsFixture.snapshot.navigation.routeId === route, routeId);
      await assertSameOwner(page);
    };
    await runRedesignScenario(page, 'appearance-committed-theme-scale', { navigate, capture, text, theme, scale });
    row.checks.push('appearance-committed-theme-scale');
    await navigate('home'); await capture('style-choice-success-failure', 'explicit-success');
    for (const route of defaultRoutes) { await navigate(route); await capture('default-page', route); }
    row.checks.push('all_nine_default_pages_real_navigation_buttons_and_keyboard');
    for (const scenario of redesignScenarios.filter(name => !['style-choice-success-failure', 'appearance-committed-theme-scale'].includes(name))) {
      await runRedesignScenario(page, scenario, { navigate, capture, text, theme, scale }); row.checks.push(scenario);
    }
    await launcherAction(page, 'navigation.navigate', ['home']);
    const dialogs = [
      ['dialog.profile', 'profileDraft.openCreate', ['1.21.1'], 'profileDraft.cancel'],
      ['dialog.instance-settings', 'instanceDraft.open', ['original-instance'], 'instanceDraft.cancel'],
      ['dialog.import-instances', 'importDraft.open', [], 'importDraft.cancel'],
      ['dialog.remove-profile', 'removal.open', ['original-instance'], 'removal.cancel'],
      ['dialog.close-request', null, [], 'window.respondToClose', ['stay']],
      ['dialog.launch-account', 'launch.request', ['original-instance'], 'launch.cancelSelection'],
      ['dialog.login', 'accounts.login', [], 'accounts.cancelLogin'],
      ['dialog.preset', 'presets.openDialog', [{ kind: 'save' }], 'presets.cancelDialog'],
      ['dialog.argument-template', 'argumentTemplates.openNew', [], 'argumentTemplates.cancel'],
    ];
    for (const [target, open, args, close, closeArgs = []] of dialogs) {
      assert.ok(provenance.bindings[target]?.startsWith(suite + '/'), target + ' has independent current source');
      if (target === 'dialog.login') {
        await navigate('accounts');
        await page.evaluate(() => { window.foundationDesktop.redesign.expired = false; });
      }
      if (target === 'dialog.preset' || target === 'dialog.argument-template') {
        await navigate('settings');
        await launcherAction(page, 'settings.setTab', [target === 'dialog.preset' ? 'appearance' : 'advanced']);
      }
      if (open) await launcherAction(page, open, args, target !== 'dialog.login');
      else await page.evaluate(() => window.foundationDesktop.emit('launcher://close-requested', { game_running: true, downloads_active: false }));
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      assert.equal(await dialog.count(), 1, target + ' uses one actual dialog owner');
      await capture(target, 'open');
      const closeControl = dialog.getByRole('button', { name: text('common.closeDialog'), exact: true });
      if (await closeControl.isEnabled()) row.reachability.push(await assertReachable(page, closeControl, target + ' close'));
      if (target === 'dialog.login') await cancelRedesignLogin(page);
      else await launcherAction(page, close, closeArgs);
      await dialog.waitFor({ state: 'hidden' }); await assertSameOwner(page);
      row.checks.push(target);
    }
    // Full editor/browser customization only at the main baseline, while all
    // default states/dialogs above still run at every legal scale and viewport.
    if (scale === 100 && viewport.width === 1240) {
      row.independentReducedMotion = await assertIndependentReducedMotion(page, { navigate, text });
      row.checks.push('independent_saved_app_motion_and_OS_motion_actual_player_dialog_Portal');
      await customizationJourney(page, suite, row, evidence);
    }
    assert.deepEqual(fixture.observedPageErrors, []);
    assert.deepEqual(fixture.observedCspViolations, []);
    if (lane === 'compiled') { assert.equal(fixture.contentSecurityPolicy, nativeCsp); assert.deepEqual(fixture.observedSourceModuleRequests, []); }
    row.status = 'passed'; console.log('PASS redesign ' + key);
  } catch (error) {
    row.status = 'failed'; row.failure = String(error.stack || error); report.failures.push(key + ': ' + String(error)); process.exitCode = 1;
    if (fixture) await fixture.page.screenshot({ path: resolve(evidence, 'failure.png') }).catch(() => {});
    console.error('FAIL redesign ' + key + ': ' + error);
  } finally {
    if (fixture) { row.pageErrors = fixture.observedPageErrors; row.cspViolations = fixture.observedCspViolations; row.sourceRequests = fixture.observedSourceModuleRequests; row.csp = fixture.contentSecurityPolicy; await fixture.close(); }
    await saveReport();
  }
}
report.finishedAt = new Date().toISOString(); await saveReport();

async function customizationJourney(page, suite, row, evidence) {
  await launcherAction(page, 'navigation.navigate', ['home']);
  const editor = await openEditor(page), source = editor.locator('textarea.ui-code');
  const priorDiagnostics = await page.evaluate(() => window.suiteBuiltinsFixture.controller.getSnapshot().diagnostics);
  assert.deepEqual(priorDiagnostics, row.expectedFirstChoiceDiagnostics, 'the successful first-choice retry retains only its known diagnostic history');
  const preview = async () => {
    await editor.getByRole('button', { name: text('uiSuiteEditor.preview'), exact: true }).click();
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().pending);
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.controller.getSnapshot().previewing), true);
    assert.deepEqual(await page.evaluate(() => window.suiteBuiltinsFixture.controller.getSnapshot().diagnostics), priorDiagnostics, 'successful Preview adds no diagnostics and preserves the known save-error history');
    await assertSameOwner(page);
  };
  await page.evaluate(async () => {
    const c = window.suiteBuiltinsFixture.controller;
    c.actions.selectTarget({ kind: 'type', target: 'page.home' });
    if (!await c.actions.createSelectionOverride('tsx')) throw Error('Home TSX override creation failed');
  });
  await source.fill('export default function Journey({Original,props}){return <section data-ui-site="redesign-custom-home"><input data-ui-site="redesign-custom-input" aria-label="Retained customization input" defaultValue=""/><Original {...props}/></section>}');
  await preview();
  await page.evaluate(() => window.suiteBuiltinsFixture.controller.actions.close());
  const input = page.locator('#root').getByLabel('Retained customization input'); await input.fill('unfinished local input');
  await input.evaluate(element => { window.foundationDesktop.redesign.input = element; });
  await openEditor(page);
  await page.evaluate(async () => { const c = window.suiteBuiltinsFixture.controller; c.actions.selectTarget({ kind: 'type', target: 'page.home' }); if (!await c.actions.createSelectionOverride('css')) throw Error('Home CSS creation failed'); });
  await source.fill(':scope input {color:rgb(31,99,151)}'); await preview();
  assert.equal(await input.evaluate(element => element === window.foundationDesktop.redesign.input), true);
  assert.equal(await input.inputValue(), 'unfinished local input');
  assert.equal(await input.evaluate(element => getComputedStyle(element).color), 'rgb(31, 99, 151)');
  await page.evaluate(async () => { const c = window.suiteBuiltinsFixture.controller; c.actions.selectTarget({ kind: 'type', target: 'component.window-bar' }); if (!await c.actions.createSelectionOverride('html')) throw Error('Window HTML creation failed'); });
  await source.fill('<section data-redesign-html><ui-slot/></section>'); await preview();
  assert.equal(await page.locator('[data-redesign-html] .window-controls').count(), 1, 'HTML Original forwards actual window controls');
  await editor.getByRole('button', { name: text('uiSuiteEditor.save'), exact: true }).click();
  await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().pending);
  const savedSuite = await page.evaluate(() => window.suiteBuiltinsFixture.controller.getSnapshot().selectedSuiteId);
  await page.evaluate(() => window.suiteBuiltinsFixture.actions.settings.patch('memory_mb', 7168));
  const other = suite === 'modern' ? 'immersive' : 'modern';
  await page.evaluate(async other => { if (!await window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + other)) throw Error('Other suite switch failed'); }, other);
  await assertSameOwner(page);
  assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.settings.draft.memory_mb), 7168, 'suite switch retains real business draft');
  await page.evaluate(async id => { if (!await window.suiteBuiltinsFixture.controller.actions.selectSuite(id)) throw Error('Saved customization restore failed'); }, savedSuite);
  await page.evaluate(() => window.suiteBuiltinsFixture.controller.actions.close());
  await openEditor(page);
  await editor.getByRole('button', { name: text('uiSuiteEditor.save'), exact: true }).click();
  await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().pending);
  await editor.getByRole('button', { name: text('uiSuiteEditor.export'), exact: true }).click();
  const archive = await page.evaluate(() => window.suiteBuiltinsFixture.exportedArchive());
  await writeFile(resolve(evidence, 'customization-export.zip'), new Uint8Array(archive));
  assert.equal(await page.evaluate(bytes => window.suiteBuiltinsFixture.importArchive(bytes), archive), true);
  await preview();
  const expectedFiles = await page.evaluate(() => structuredClone(window.suiteBuiltinsFixture.controller.getSnapshot().draft.files));
  await editor.getByRole('button', { name: text('uiSuiteEditor.save'), exact: true }).click();
  await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().pending);
  await page.evaluate(() => window.suiteBuiltinsFixture.controller.actions.close());
  await assertSameOwner(page);
  // Restart deliberately uses the existing root's supported remount. Its new
  // owner is separate from the retained-owner suite-switch assertion above.
  await page.evaluate(() => window.suiteBuiltinsFixture.restart());
  assert.deepEqual(await page.evaluate(() => window.suiteBuiltinsFixture.controller.getActivation().primary.bundle.files), expectedFiles);
  row.checks.push('custom_source_TSX_Original_HTML_Original_CSS_retains_input_actual_editor_save_export_reimport_restart_same_owner_suite_switch_drafts');
}
