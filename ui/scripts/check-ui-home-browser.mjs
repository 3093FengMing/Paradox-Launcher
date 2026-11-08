import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const out = resolve('.test-data/default-ui-task4', process.env.PARADOX_HOME_EVIDENCE || 'focused');
await mkdir(out, { recursive: true });
const report = { rows: [] };
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.profiles[0].name = 'Alpha world';
config.profiles.push({ ...config.profiles[0], instance_key: 'beta-instance', name: 'Beta world' });
for (const suite of ['immersive', 'modern']) {
  const fixture = await createBrowserFixture({ desktopBoundary: true, config, url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}` });
  const { page } = fixture;
  const checks = [];
  const pass = name => { checks.push(name); console.log(`PASS ${suite}: ${name}`); };
  const primary = () => page.locator(suite === 'immersive' ? '.immersive-launch-primary' : '.launch-button');
  const selectedState = () => page.locator('.home-instance-state');
  const act = (fn, arg) => page.evaluate(fn, arg);
  const wait = fn => page.waitForFunction(fn);
  const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await wait(() => window.suiteBuiltinsFixture?.ready);
    await act(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    await wait(() => !window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
    await page.locator('.' + suite + '-shell').waitFor();
    await act(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      window.homeBoundary = { mode: 'installed', configMode: 'normal' };
      native.invoke = async (command, args) => {
        const state = window.homeBoundary;
        if (command === 'get_config' && state.configMode === 'hold') await new Promise(resolve => state.releaseConfig = resolve);
        if (command === 'get_config' && state.configMode === 'fail') throw Error('Task 4 configuration retry');
        if (command === 'inspect_instances') {
          const profiles = window.foundationDesktop.config.profiles;
          return profiles.filter(p => state.mode !== 'missing' || p.instance_key !== 'original-instance').map(p => ({ ...p, loader: state.mode === 'repair' && p.instance_key === 'original-instance' ? 'fabric' : p.loader, loader_version: state.mode === 'repair' ? '0.16.0' : p.loader_version, root: `${p.game_directory ?? window.foundationDesktop.config.settings.game_directory}/versions/${p.instance_key}` }));
        }
        if (command === 'account_skin') {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e5975b'; ctx.fillRect(0, 0, 64, 64);
          return canvas.toDataURL();
        }
        if (command.startsWith('plugin:window|')) { window.foundationDesktop.calls.push({ command, args }); return; }
        return original(command, args);
      };
    });
    for (const theme of ['dark', 'light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      await page.waitForFunction(theme => window.suiteBuiltinsFixture.snapshot.appearance.theme === theme && document.querySelector('.app-shell').dataset.theme === theme, theme);
      await settled();
      const canvas = await page.locator('.app-shell').evaluate(e => getComputedStyle(e).backgroundColor);
      assert.equal(canvas, suite === 'immersive' ? (theme === 'light' ? 'rgb(237, 241, 248)' : 'rgb(38, 50, 71)') : (theme === 'light' ? 'rgb(243, 246, 250)' : 'rgb(16, 21, 30)'));
      for (const viewport of [{ width: 1240, height: 720 }, { width: 640, height: 480 }, { width: 320, height: 240 }]) {
        await page.setViewportSize(viewport);
        await page.locator('.workspace > main').evaluate(e => { e.scrollTop = 0; });
        await page.locator('.sidebar').evaluate(e => { e.scrollTop = 0; });
        await primary().scrollIntoViewIfNeeded();
        const box = await primary().boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, 'primary horizontal reachability');
        assert.ok(await page.locator('.sidebar').evaluate(e => e.clientWidth < innerWidth / 2));
        assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
        if (suite === 'immersive' && viewport.width <= 640) assert.equal(await page.locator('.immersive-launch-area').evaluate(e => getComputedStyle(e).position), 'static');
        await page.screenshot({ path: resolve(out, `current-default-${suite}-${theme}-${viewport.width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1240, height: 720 });
    await act(async () => { window.foundationDesktop.config.settings.appearance.theme = 'dark'; await window.suiteBuiltinsFixture.actions.config.reload(); });
    pass('both_themes_canonical_default_screenshots_1240_640_320');
    assert.equal(await primary().isDisabled(), false);
    assert.match(await selectedState().innerText(), /Installed/);
    // Real public account reload and cached-avatar generation; no remote skin URL reaches markup.
    await act(async () => {
      window.foundationDesktop.accounts.accounts[0].skin_url = 'https://textures.minecraft.net/texture/fixture';
      await window.suiteBuiltinsFixture.actions.accounts.reload();
    });
    await wait(() => !!window.suiteBuiltinsFixture.snapshot.avatars['account-a']);
    assert.ok(await page.locator('.account-avatar img').count() >= 2);
    assert.equal(await page.locator('.account-avatar img').first().getAttribute('src').then(s => s.startsWith('data:image/png')), true);
    assert.ok(!(await page.locator('.app-shell').innerHTML()).includes('https://textures.minecraft.net'));
    await act(async () => window.suiteBuiltinsFixture.actions.accounts.select(null));
    assert.match(await page.locator(suite === 'immersive' ? '.immersive-account-link' : '.home-account').innerText(), /Player/);
    assert.equal(await page.locator('.account-avatar img').count(), 0);
    await act(async () => window.suiteBuiltinsFixture.actions.accounts.select('account-a'));
    pass('active_microsoft_name_cached_avatar_identity_and_offline_fallback');
    await page.locator(suite === 'immersive' ? '.immersive-hint-copy button' : '.home-personalize').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'settings');
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.settings.tab), 'appearance');
    await page.locator('.sidebar').getByRole('button', { name: 'Play', exact: true }).click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'home');
    pass('appearance_deep_link_and_registry_home_return');
    // Each window action uses the existing public owner.
    for (const name of ['Minimize window', 'Maximize or restore window']) {
      const button = page.locator('.window-controls').getByRole('button', { name, exact: true });
      await button.focus(); await page.keyboard.press('Enter');
    }
    assert.ok((await act(() => window.foundationDesktop.calls.filter(c => c.command.startsWith('plugin:window|')))).length >= 1);
    await page.locator('.sidebar-account').focus(); await page.keyboard.press('Enter');
    await wait(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'accounts');
    await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('home'));
    pass('keyboard_account_and_window_actions');
    if (suite === 'immersive') {
      const trigger = page.locator('.immersive-launch-select');
      await trigger.focus(); await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor();
      await page.keyboard.press('b'); await page.keyboard.press('Enter');
      await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey === 'beta-instance');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle(), { timeout: 3000 });
      await trigger.focus(); await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      await page.waitForFunction(element => element === document.activeElement, await trigger.elementHandle(), { timeout: 3000 });
      assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
      await act(async () => window.suiteBuiltinsFixture.actions.profiles.select('original-instance'));
      pass('upward_split_menu_keyboard_typeahead_selection_escape_focus');
    }
    // Launch-account selection and actual B launch remain separate from selected A.
    await primary().click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await wait(() => !window.suiteBuiltinsFixture.snapshot.launch.selection);
    await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), suite === 'immersive' ? '.immersive-launch-primary' : '.launch-button', { timeout: 3000 });
    assert.equal(await primary().evaluate(e => e === document.activeElement), true);
    await primary().focus(); await page.keyboard.press('Control+Enter');
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), suite === 'immersive' ? '.immersive-launch-primary' : '.launch-button');
    await act(async () => window.suiteBuiltinsFixture.actions.launch.request('beta-instance'));
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.launch.selection.profileKey), 'beta-instance');
    await act(async () => window.suiteBuiltinsFixture.actions.launch.confirmAccount());
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'started');
    assert.equal(await primary().evaluate(e => e === document.activeElement), false, 'successful launch does not refocus a disabled action');
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.launch.profileKey), 'beta-instance');
    assert.match(await selectedState().innerText(), /Installed/);
    assert.doesNotMatch(await selectedState().innerText(), /Launching|Running/);
    assert.match(await page.locator('.activity-bar').innerText(), /Beta world.*Launching/);
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Game active' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'running');
    assert.match(await page.locator('.activity-bar').innerText(), /Beta world.*Running/);
    assert.match(await selectedState().innerText(), /Installed/);
    assert.equal(await primary().isDisabled(), true);
    await page.screenshot({ path: resolve(out, `state-${suite}-B-running-A-selected.png`) });
    await page.setViewportSize({ width: 320, height: 240 });
    const stop = page.locator('.activity-bar').getByRole('button', { name: 'Stop game' });
    await stop.scrollIntoViewIfNeeded(); await stop.focus(); await page.keyboard.press('Enter');
    assert.equal(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'stop_game').length), 1);
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'cancelling', message: 'Stopping' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'cancelling');
    assert.equal(await page.locator('.activity-bar button.secondary').isDisabled(), true);
    assert.match(await selectedState().innerText(), /Installed/);
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Done' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'idle');
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Unknown runtime' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'running');
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.launch.profileKey), null);
    assert.match(await page.locator('.activity-bar').innerText(), /Game.*Running/);
    assert.doesNotMatch(await page.locator('.activity-bar').innerText(), /Alpha|Beta/);
    assert.match(await selectedState().innerText(), /Installed/);
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Done' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'idle');
    await page.setViewportSize({ width: 1240, height: 720 });
    pass('launch_selection_dialog_return_focus_B_owned_started_running_unknown_cancelling_320_stop');
    for (const mode of ['repair', 'missing']) {
      await act(async mode => { window.homeBoundary.mode = mode; await window.suiteBuiltinsFixture.actions.profiles.scan(); }, mode);
      await wait(() => !window.suiteBuiltinsFixture.snapshot.profiles.scanning);
      assert.match(await primary().innerText(), mode === 'repair' ? /Repair game/ : /Install game/);
      if (mode === 'repair') assert.match(await page.locator('.home-instance-state, .home-version').allTextContents().then(x => x.join(' ')), /fabric/);
    }
    await act(() => window.foundationDesktop.emit('launcher://downloads', [{ id: 'task-beta', kind: 'install', name: 'Beta install', profile_key: 'beta-instance', java_major: null, status: 'queued', message: '', progress: null }]));
    await wait(() => window.suiteBuiltinsFixture.snapshot.downloads.active);
    assert.equal(await primary().isDisabled(), false, 'unrelated queued install must not block install A');
    await primary().click();
    assert.equal(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'enqueue_install' && c.args.key === 'original-instance').length), 1);
    await act(() => window.foundationDesktop.emit('launcher://downloads', [{ id: 'task-alpha', kind: 'install', name: 'Alpha install', profile_key: 'original-instance', java_major: null, status: 'running', message: '', progress: null }]));
    await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.items[0].installing);
    assert.equal(await primary().isDisabled(), true);
    assert.match(await primary().innerText(), /Installing/);
    await act(() => window.foundationDesktop.emit('launcher://downloads', []));
    await act(async () => { window.homeBoundary.mode = 'installed'; await window.suiteBuiltinsFixture.actions.profiles.scan(); });
    pass('actual_loader_repair_install_unrelated_queue_allowed_same_instance_queue_disabled');
    await act(async () => { window.foundationDesktop.config.active_profile = null; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey === null);
    assert.equal(await selectedState().count(), 0);
    assert.match(await primary().innerText(), /Choose instance/);
    await primary().click();
    if (suite === 'immersive') { await page.getByRole('menu').waitFor(); await page.keyboard.press('Escape'); }
    else assert.equal(await page.locator('[data-profile-choice]').first().evaluate(e => e === document.activeElement), true);
    await act(async () => { window.homeProfiles = window.foundationDesktop.config.profiles; window.foundationDesktop.config.profiles = []; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.items.length === 0);
    assert.match(await primary().innerText(), /Create game instance/);
    await primary().click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    await act(async () => { window.foundationDesktop.config.profiles = window.homeProfiles; window.foundationDesktop.config.active_profile = 'original-instance'; await window.suiteBuiltinsFixture.actions.config.reload(); });
    pass('active_key_absent_choose_and_empty_create_original_draft');
    // Actual sources remain individually replaceable; registry changes do not resurrect hidden links.
    await act(async suite => {
      const c = window.suiteBuiltinsFixture.controller;
      await c.actions.copyBuiltin(suite, 'Task 4 registry fixture');
      if (!await c.actions.preview()) throw Error('Copied source preview failed');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const primary = document.querySelector('.immersive-launch-primary, .launch-button');
      window.homePrimaryBeforeCSS = primary;
      primary.focus();
      const css = `${suite}/styles/home.css`;
      c.actions.patchFile(css, c.getSnapshot().draft.files[css].text + '\n.home-action-reason { letter-spacing: .01em; }');
      if (!await c.actions.preview()) throw Error('CSS-only source preview failed');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (primary !== document.querySelector('.immersive-launch-primary, .launch-button')) throw Error('CSS-only edit remounted the primary button');
      // New component files participate in the same source registry and can each be edited.
      for (const id of ['component.window-bar','component.app-sidebar','component.account-avatar','component.activity-bar']) {
        const path = c.getSnapshot().draft.manifest.views[id];
        if (!path.startsWith(suite + '/components/')) throw Error('component mapping not owned by suite');
        c.actions.patchFile(path, c.getSnapshot().draft.files[path].text.replace('data-ui-site=', `data-task4-component="${id}" data-ui-site=`));
      }
      if (!await c.actions.preview()) throw Error('component source preview failed');
      c.actions.createFile('RouteProbe.tsx', 'tsx');
      c.actions.patchFile('RouteProbe.tsx', 'export default()=> <h2 data-ui-site="registry-probe">Registered route probe</h2>');
      const manifest = c.getSnapshot().draft.manifest;
      c.actions.patchManifest({ views: { ...manifest.views, 'page.custom.probe': 'RouteProbe.tsx' }, routes: [...manifest.routes.map(r => ['settings','accounts','downloads'].includes(r.id) ? { ...r, navigation: false } : r.id === 'instances' ? { ...r, title: 'Library renamed' } : r), { id:'custom.probe',entry:'RouteProbe.tsx',title:'Registry probe',description:'Probe',navigation:true,startupSelectable:true,order:1,icon:'UnknownIcon' }] });
      if (!await c.actions.preview()) throw Error('registry fixture preview failed');
      c.actions.close();
    }, suite);
    assert.equal(await page.locator('.sidebar-account').count(), 0);
    assert.ok(await page.locator('[data-task4-component="component.window-bar"]').count());
    assert.ok(await page.locator('[data-task4-component="component.app-sidebar"]').count());
    assert.ok(await page.locator('[data-task4-component="component.account-avatar"]').count());
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Source component probe' }));
    await page.locator('[data-task4-component="component.activity-bar"]').waitFor();
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Done' }));
    assert.equal(await page.locator('.home-personalize, .immersive-customize-hint').count(), 0);
    assert.equal(await page.locator('.window-controls').getByRole('button', { name: 'Help and settings' }).count(), 0);
    await page.locator('.sidebar').getByRole('button', { name: 'Library renamed', exact: true }).waitFor();
    await page.locator('.sidebar').getByRole('button', { name: 'Registry probe', exact: true }).click();
    await page.getByRole('heading', { name: 'Registered route probe' }).waitFor();
    await page.locator('.sidebar').getByRole('button', { name: 'Play', exact: true }).click();
    await primary().waitFor();
    await page.screenshot({ path: resolve(out, `source-customized-fixture-${suite}-registry.png`) });
    pass('source_components_individually_editable_primary_CSS_identity_hidden_registry_custom_routes');
    // Host states use the same existing loader/reload owner after remount.
    await act(() => { window.homeBoundary.configMode = 'hold'; void window.suiteBuiltinsFixture.restart(); });
    await page.locator('.source-loading').waitFor();
    assert.equal(await page.locator('.source-loading').getAttribute('data-ui-source'), `${suite}/Loading.tsx`);
    await act(() => { window.homeBoundary.configMode = 'fail'; window.homeBoundary.releaseConfig(); });
    await page.locator('.source-error').waitFor();
    assert.equal(await page.locator('.source-error').getAttribute('data-ui-source'), `${suite}/Error.tsx`);
    await act(() => { window.homeBoundary.configMode = 'normal'; });
    await page.locator('.source-error').getByRole('button', { name: /Retry|重试/ }).click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.config.ready && !window.suiteBuiltinsFixture.snapshot.config.fatal);
    await page.locator('.source-error').waitFor({ state: 'detached' });
    pass('source_loading_fatal_and_existing_config_reload_retry');
    assert.deepEqual(fixture.observedPageErrors, []);
    assert.deepEqual(fixture.observedCspViolations, []);
    report.rows.push({ suite, checks, errors: fixture.observedPageErrors, cspViolations: fixture.observedCspViolations });
  } catch (error) {
    console.log('failure focus', await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 300), config: window.suiteBuiltinsFixture?.snapshot.config, commands: window.foundationDesktop?.calls.slice(-10), boundary: window.homeBoundary, capability: window.suiteBuiltinsFixture?.snapshot.profiles.items[0]?.capabilities.launch, launch: window.suiteBuiltinsFixture?.snapshot.launch, dialog: !!document.querySelector('[role="dialog"]') })));
    await page.screenshot({ path: resolve(out, `failure-${suite}.png`) });
    report.rows.push({ suite, checks, failure: String(error), errors: fixture.observedPageErrors });
    throw error;
  } finally { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); await fixture.close(); }
}

// Browser-only capability is real public projection, not disabled by local UI logic.
const browserConfig = structuredClone(config);
const browserFixture = await createBrowserFixture({ config: browserConfig });
try {
  const page = browserFixture.page;
  await page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
  for (const suite of ['immersive','modern']) {
    await page.evaluate(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    const primary = page.locator(suite === 'immersive' ? '.immersive-launch-primary' : '.launch-button');
    await primary.waitFor(); assert.equal(await primary.isDisabled(), true);
    assert.match(await page.locator('.home-action-reason').innerText(), /desktop app/);
    assert.equal(await page.locator('.window-controls button:disabled').count(), 3);
  }
  report.rows.push({ suite: 'browser-only', checks: ['desktop_capabilities_and_disabled_window_controls'] });
} finally { await browserFixture.close(); await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); }
