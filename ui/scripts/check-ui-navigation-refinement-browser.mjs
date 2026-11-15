import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';
import { assertSameOwner, boundaryMode, installRedesignBoundary, launcherAction, releaseBoundary, sourceSite, waitHeld } from './lib/ui-redesign-scenarios.mjs';
import { globalNavigationTrigger, globalRouteFocusReturn, prepareGlobalRouteControl } from './lib/ui-redesign-navigation.mjs';

// This focused regression is separate from the full 36-context page matrix.
// Run only after application source, manifests and test files are frozen.
const out = resolve(process.env.PARADOX_NAVIGATION_EVIDENCE || fileURLToPath(new URL('../../.test-data/ui-navigation-refinement/current', import.meta.url)));
await mkdir(out, { recursive: true });
const locales = Object.fromEntries(await Promise.all(['en-US', 'zh-CN'].map(async language => [language, JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))])));
const report = { startedAt: new Date().toISOString(), features: [], rows: [], screenshots: [], errors: [], csp: [], sourceRequests: [] };
const viewports = [{ width: 1240, height: 780 }, { width: 640, height: 480 }, { width: 320, height: 240 }];
const task = (id, status, profileKey = 'beta-instance') => ({ id, kind: 'install', profile_key: profileKey, java_major: null, name: 'Download ' + id, status, progress: null, message: 'Real boundary fixture ' + status });

for (const language of ['en-US', 'zh-CN']) for (const suite of ['modern', 'immersive']) {
  const config = structuredClone(initialConfig);
  config.settings.language = language;
  config.profiles[0].name = '当前启动目标 Alpha — a long instance name '.repeat(3);
  config.profiles.push({ ...structuredClone(config.profiles[0]), instance_key: 'beta-instance', name: '资源目标 Beta — a long resource target '.repeat(3) });
  const fixture = await createBrowserFixture({ config, desktopBoundary: true, url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}` });
  const { page } = fixture;
  const text = key => key.split('.').reduce((value, part) => value[part], locales[language]);
  const site = name => sourceSite(page, name);
  const a = (path, args = [], wait = true) => launcherAction(page, path, args, wait);
  const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dismissNotices = async () => {
    const dismiss = site('Notifications-dismiss');
    if (await dismiss.count()) await dismiss.first().click();
    await dismiss.waitFor({ state: 'hidden' });
  };
  const waitRoute = (routeId, profileKey) => page.waitForFunction(({ routeId, profileKey }) => { const n = window.suiteBuiltinsFixture.snapshot.navigation; return n.routeId === routeId && (profileKey === undefined || n.params.profileKey === profileKey); }, { routeId, profileKey });
  const emitTasks = async tasks => { await page.evaluate(tasks => { window.foundationDesktop.redesign.tasks = structuredClone(tasks); window.foundationDesktop.emit('launcher://downloads', structuredClone(tasks)); }, tasks); await page.waitForFunction(tasks => JSON.stringify(window.suiteBuiltinsFixture.snapshot.downloads.tasks.map(t => [t.id, t.status])) === JSON.stringify(tasks.map(t => [t.id, t.status])), tasks); await settled(); };
  const activate = async (control, routeId, profileKey) => { await control.scrollIntoViewIfNeeded(); await control.focus(); assert.equal(await control.evaluate(e => document.activeElement === e), true); await page.keyboard.press('Enter'); await waitRoute(routeId, profileKey); await settled(); await assertSameOwner(page); };
  const home = async () => activate(await prepareGlobalRouteControl(page, suite, 'home', text('nav.home')), 'home');
  const hit = async control => { await control.scrollIntoViewIfNeeded(); return control.evaluate(e => { const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.x, y: r.y, width: r.width, height: r.height, inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, hit: h === e || e.contains(h) }; }); };
  try {
    await page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
    assert.equal(await page.evaluate(suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite), true);
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
    await installRedesignBoundary(page);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke, b = window.foundationDesktop.redesign;
      native.invoke = async (command, args = {}) => {
        if (command !== 'retry_task') return original(command, args);
        b.calls.push({ command, args: structuredClone(args) });
        const originalTask = b.tasks.find(task => task.id === args.id);
        if (!originalTask || originalTask.status !== 'failed') throw Error('Retry must use the existing failed task identity');
        const next = { ...originalTask, id: originalTask.id + '-retry', status: 'queued' };
        b.tasks.push(next);
        return structuredClone(next);
      };
    });
    await a('profiles.scan');
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.profiles.items.length === 2);
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.navigation.routes.find(r => r.id === 'accounts').navigation), false, 'registered accounts are reached through the homepage');
    assert.equal(await site('DownloadIndicator-root').count(), 0, 'idle tasks have no corner indicator');
    if (suite === 'immersive') {
      const fonts = await page.locator('.window-title').evaluate(e => ({ name: parseFloat(getComputedStyle(e).fontSize), version: parseFloat(getComputedStyle(e.querySelector('small')).fontSize) }));
      assert.ok(Math.abs(fonts.name - 14) < .2 && Math.abs(fonts.version - 12) < .2, 'default brand and version use the explicit 14/12 typography');
    }

    // Keep a real route hint while exercising both original page owners.
    await a('navigation.navigate', ['custom.versions', { profileKey: 'beta-instance' }]);
    await site('DownloadNavigation-versions').waitFor();
    assert.equal(await page.locator('.download-navigation-tabs > button').count(), 2);
    await site('VersionsPage-search').fill('1.21.1');
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.search === '1.21.1');
    assert.equal(await site('VersionsPage-version').count(), 1, 'version query reaches the existing search action and filters actual catalog rows');
    await activate(site('DownloadNavigation-content'), 'content', 'beta-instance');
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.content.selectedProfileKey === 'beta-instance');
    await page.locator('[data-content-kind="resourcepack"]').click();
    const query = 'resource ownership ' + language;
    await site('Discover-query').fill(query);
    await site('Discover-query').press('Enter');
    await page.waitForFunction(query => window.suiteBuiltinsFixture.snapshot.content.request?.query === query && !window.suiteBuiltinsFixture.snapshot.content.searching, query);
    assert.deepEqual(await page.evaluate(() => window.foundationDesktop.redesign.calls.filter(c => c.command === 'search_content').at(-1).args), { query, category: 'resourcepack', offset: 0 });
    await activate(site('DownloadNavigation-versions'), 'custom.versions', 'beta-instance');
    assert.equal(await site('VersionsPage-search').inputValue(), '', 'route navigation retains the original clear-search contract and resource text never enters the version field');
    await site('VersionsPage-search').fill('1.21.1');
    assert.equal(await site('VersionsPage-version').count(), 1, 'the fresh version search still filters its own actual catalog');
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.content.query), query, 'version search never overwrites the independent resource owner');
    await activate(site('DownloadNavigation-content'), 'content', 'beta-instance');
    assert.equal(await site('Discover-query').inputValue(), query);
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey), 'original-instance', 'resource target and route hint never change the launch target');
    await assertSameOwner(page);

    // Failure history stays reachable while the active-only indicator is hidden.
    await emitTasks([task('failed-identity', 'failed')]);
    assert.equal(await site('DownloadIndicator-root').count(), 0);
    await activate(site('DownloadNavigation-tasks'), 'downloads');
    assert.deepEqual(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.navigation.params), {}, 'the task-history route retains the public route-param contract');
    await site('DownloadQueue-retry').click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.some(t => t.id === 'failed-identity-retry'));
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.find(t => t.id === 'failed-identity').status), 'failed');
    assert.deepEqual(await page.evaluate(() => window.foundationDesktop.redesign.calls.filter(c => c.command === 'retry_task').map(c => c.args)), [{ id: 'failed-identity' }]);
    assert.equal(await site('DownloadIndicator-root').getAttribute('data-active-count'), '1');
    await emitTasks([]);

    // A held native install command tests pending before a task exists.
    await boundaryMode(page, 'enqueue_install', 'hold');
    await a('downloads.install', ['original-instance'], false);
    await waitHeld(page, 'enqueue_install');
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.downloads.pending.includes('install:original-instance'));
    assert.equal(await site('DownloadIndicator-root').getAttribute('data-state'), 'preparing');
    assert.equal(await site('DownloadIndicator-root').getAttribute('data-active-count'), '0');
    const queued = task('held-install', 'queued', 'original-instance');
    await page.evaluate(task => { window.foundationDesktop.redesign.tasks = [task]; }, queued);
    await releaseBoundary(page, 'enqueue_install', { value: queued });
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.downloads.pending.length === 0 && window.suiteBuiltinsFixture.snapshot.downloads.active);
    const indicator = site('DownloadIndicator-root');
    await indicator.focus();
    const indicatorNode = await indicator.elementHandle();
    await emitTasks([{ ...queued, status: 'completed' }]);
    assert.equal(await indicator.getAttribute('data-state'), 'finished');
    assert.equal(await indicator.evaluate((e, original) => e === original && document.activeElement === e, indicatorNode), true, 'terminal update keeps the same actually focused DOM button');
    assert.equal(await indicator.locator('[data-ui-site$=":DownloadIndicator-count"]').count(), 0);
    await page.keyboard.press('Tab');
    await indicator.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.downloads.active), false);
    await emitTasks([]);
    report.features.push({ suite, language, checks: ['two_real_tabs_distinct_search_owners_profile_hint', 'idle_and_failed_history_retry_original_identity', 'pending_active_terminal_real_focus_lifetime'] });

    await activate(await prepareGlobalRouteControl(page, suite, 'instances', text('nav.instances')), 'instances');
    await site('InstancesPage-search').fill('');
    if (suite === 'modern') {
      const inspect = page.locator('.instance-row[data-profile-key="beta-instance"] [data-ui-site$=":ProfileCard-view"]');
      await inspect.focus(); await page.keyboard.press('Enter');
      await page.locator('.instance-inspector-content[data-profile-key="beta-instance"]').waitFor();
      assert.equal(await site('InstanceDetail-directories').count(), 0, 'compact inspector does not duplicate directory details');
      assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey), 'original-instance', 'viewing the inspector does not change the launch target');
    }
    assert.equal((await page.locator('.instances-page').innerText()).includes(config.settings.game_directory), false, 'normal instance management hides its directory while data stays in the original config');
    const details = page.locator('.instance-row[data-profile-key="beta-instance"] [data-ui-site$=":ProfileCard-details"]');
    if (suite === 'modern') await activate(details, 'custom.instance-details', 'beta-instance');
    else await activate(page.locator('.instance-row[data-profile-key="beta-instance"] [data-ui-site$=":ProfileCard-view"]'), 'custom.instance-details', 'beta-instance');
    assert.equal(await site('InstanceDetail-directories').isVisible(), true, 'full detail retains actual base and runtime directories');
    assert.equal(await page.locator('.instance-detail').getAttribute('data-profile-key'), 'beta-instance');
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.content.selectedProfileKey), 'beta-instance');
    await assertSameOwner(page);
    report.features.at(-1).checks.push('normal_instance_and_compact_inspector_hide_paths_full_identity_detail_retains_them');

    // Motion is exercised once per actual suite/language journey, not per layout.
    const routeStage = page.locator('.route-stage');
    const originalStage = await routeStage.elementHandle();
    await routeStage.evaluate(node => {
      const animate = node.animate.bind(node);
      window.__navigationMotionProbe = { calls: [] };
      node.animate = (frames, options) => {
        window.__navigationMotionProbe.calls.push({ frames, options });
        return animate(frames, options);
      };
    });
    const setReduced = async reduced => {
      await a('navigation.navigate', ['settings']);
      await a('settings.patchAppearance', ['reduce_motion', reduced]);
      if (await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.settings.dirty)) assert.equal(await a('settings.save'), true);
      await page.waitForFunction(reduced => window.suiteBuiltinsFixture.snapshot.appearance.value.reduce_motion === reduced, reduced);
      await settled();
      await page.evaluate(() => { window.__navigationMotionProbe.calls = []; });
    };
    await setReduced(true);
    await home();
    assert.equal(await routeStage.evaluate(node => node.getAnimations().length), 0, 'app reduce_motion leaves no route-stage Animation after navigation');
    assert.equal(await page.evaluate(() => window.__navigationMotionProbe.calls.length), 0, 'app reduce_motion never starts a route-stage Animation');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setReduced(false);
    await activate(await prepareGlobalRouteControl(page, suite, 'instances', text('nav.instances')), 'instances');
    assert.equal(await routeStage.evaluate(node => node.getAnimations().length), 0, 'OS prefers-reduced-motion leaves no route-stage Animation after navigation');
    assert.equal(await page.evaluate(() => window.__navigationMotionProbe.calls.length), 0, 'OS prefers-reduced-motion never starts a route-stage Animation');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [routeId, label] of [['settings', text('nav.settings')], ['instances', text('nav.instances')], ['home', text('nav.home')]]) {
      const control = await prepareGlobalRouteControl(page, suite, routeId, label);
      await control.focus(); await page.keyboard.press('Enter'); await waitRoute(routeId);
    }
    await settled();
    assert.equal(await routeStage.evaluate((node, original) => node === original, originalStage), true, 'rapid keyboard navigation preserves the route-stage DOM owner');
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId), 'home');
    const motionCalls = await page.evaluate(() => window.__navigationMotionProbe.calls);
    assert.ok(motionCalls.length >= 2, 'ordinary rapid navigation exercises the public route Animation');
    assert.ok(motionCalls.every(call => call.frames.every(frame => Object.keys(frame).every(key => key === 'opacity'))), 'route feedback does not transform fixed controls');
    await assertSameOwner(page);
    const secondary = site(suite === 'modern' ? 'Home-details' : 'Home-library-import');
    await secondary.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForFunction(selector => document.querySelector(selector).getAnimations().length === 0, `[data-ui-site$=":${suite === 'modern' ? 'Home-details' : 'Home-library-import'}"]`);
    const hoverStyle = node => { const css = getComputedStyle(node), box = node.getBoundingClientRect(); return { border: css.borderTopColor, color: css.color, box: [box.x, box.y, box.width, box.height] }; };
    const beforeHover = await secondary.evaluate(hoverStyle);
    await secondary.hover();
    await page.waitForFunction(({ selector, before }) => { const node = document.querySelector(selector), css = getComputedStyle(node); return css.borderTopColor !== before.border || css.color !== before.color; }, { selector: `[data-ui-site$=":${suite === 'modern' ? 'Home-details' : 'Home-library-import'}"]`, before: beforeHover });
    const afterHover = await secondary.evaluate(hoverStyle);
    assert.ok(beforeHover.box.every((value, index) => Math.abs(value - afterHover.box[index]) <= .5), 'secondary hover changes visible feedback without moving its bounding box');
    const corners = await page.evaluate(suite => {
      const supported = CSS.supports('corner-shape', 'squircle');
      const selectors = suite === 'modern' ? ['.home-workspace-grid', '.home-overview', '.home-account'] : [];
      return { supported, surfaces: selectors.map(selector => ({ selector, value: getComputedStyle(document.querySelector(selector)).cornerShape })) };
    }, suite);
    if (corners.supported && suite === 'modern') assert.ok(corners.surfaces.length === 3 && corners.surfaces.every(surface => surface.value === 'squircle'), 'supported Modern core Home surfaces compute squircle corners');
    report.features.at(-1).motion = { calls: motionCalls, hover: { before: beforeHover, after: afterHover }, corners };
    report.features.at(-1).checks.push('app_and_os_reduced_motion_no_animation_rapid_keyboard_navigation_same_owner', 'secondary_hover_feedback_without_geometry_motion_supported_modern_squircle_surfaces');

    for (const theme of ['dark', 'light']) for (const scale of [85, 120]) for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await a('navigation.navigate', ['settings']);
      await a('settings.patchAppearance', ['theme', theme]);
      await a('settings.patchAppearance', ['ui_scale', scale]);
      if (await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.settings.dirty)) assert.equal(await a('settings.save'), true, 'appearance commits through the existing settings owner');
      await page.waitForFunction(({ theme, scale }) => window.suiteBuiltinsFixture.snapshot.appearance.theme === theme && window.suiteBuiltinsFixture.snapshot.appearance.value.ui_scale === scale && window.foundationDesktop.config.settings.appearance.ui_scale === scale, { theme, scale });
      await dismissNotices();
      await home();
      await emitTasks([task('geometry-active', 'running')]);
      const row = { suite, language, theme, scale, viewport, checks: [] };
      const chrome = await page.locator('.window-bar').evaluate(e => {
        const nav = document.querySelector('.window-navigation'), sidebar = document.querySelector('.sidebar');
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, barWidth: e.clientWidth, barScrollWidth: e.scrollWidth, navigationWidth: nav?.clientWidth ?? 0, navigationScrollWidth: nav?.scrollWidth ?? 0, sidebarHeight: sidebar?.clientHeight ?? 0, sidebarScrollHeight: sidebar?.scrollHeight ?? 0, controlsInside: [...e.querySelectorAll('button')].filter(e => e.getClientRects().length).every(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }) };
      });
      assert.ok(chrome.documentWidth <= chrome.viewportWidth + 1 && chrome.barScrollWidth <= chrome.barWidth + 1 && chrome.controlsInside, JSON.stringify({ row, chrome }));
      if (chrome.navigationWidth) assert.ok(chrome.navigationScrollWidth <= chrome.navigationWidth + 1, 'top navigation has no horizontal scrolling');
      if (suite === 'modern' && chrome.sidebarHeight) assert.ok(chrome.sidebarScrollHeight <= chrome.sidebarHeight + 1, 'Modern global sidebar does not scroll');
      if (suite === 'immersive') assert.equal(await page.locator('.window-navigation:visible .window-route').count(), viewport.width > 900 ? 4 : 0);
      row.chrome = chrome;
      row.checks.push('no_top_horizontal_scroll_stable_chrome');
      const trigger = globalNavigationTrigger(page, suite);
      if (await trigger.isVisible()) {
        await trigger.focus(); await page.keyboard.press('Enter');
        const popup = page.locator(`[data-ui-site$=":${suite === 'immersive' ? 'WindowBar-menu-popup' : 'ModernSidebarMenu-popup'}"]`);
        await popup.waitFor();
        assert.equal(await popup.getByRole('menuitem', { name: text('nav.content'), exact: true }).count(), 0);
        assert.equal(await popup.getByRole('menuitem', { name: text('nav.downloads'), exact: true }).count(), 0);
        await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(e => document.activeElement === e), true, 'Escape returns actual focus to the global navigation trigger');
        row.checks.push('global_menu_escape_real_focus_no_duplicate_download_entries');
      }
      const indicatorBox = await hit(site('DownloadIndicator-root'));
      assert.ok(indicatorBox.inside && indicatorBox.hit, JSON.stringify({ row, indicatorBox }));
      row.indicator = indicatorBox;
      const dock = suite === 'immersive' ? page.locator('.immersive-launch-split') : page.locator('.current-launch-target');
      if (await dock.isVisible() && (suite === 'modern' || viewport.width <= 640)) {
        const actions = suite === 'immersive' ? [page.locator('.immersive-launch-primary'), page.locator('.immersive-launch-select')] : [dock.getByRole('button')];
        for (const control of actions) assert.equal(await control.count(), 1, 'each dock action resolves to exactly one actual button');
        row.dock = [];
        for (const control of actions) {
          const geometry = await hit(control);
          assert.ok(geometry.inside && geometry.hit, JSON.stringify({ row, geometry }));
          const separated = geometry.x + geometry.width <= indicatorBox.x - 1 || indicatorBox.x + indicatorBox.width <= geometry.x - 1 || geometry.y + geometry.height <= indicatorBox.y - 1 || indicatorBox.y + indicatorBox.height <= geometry.y - 1;
          assert.equal(separated, true, 'corner task indicator does not overlap launch or instance-selection controls');
          row.dock.push(geometry);
        }
        row.checks.push('corner_indicator_and_launch_actions_uncovered');
      }
      await assertSameOwner(page);
      assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey), 'original-instance');
      if (viewport.width === 320 && scale === 120) {
        const name = `${suite}-${language}-${theme}-${scale}-${viewport.width}.png`;
        await page.screenshot({ path: resolve(out, name) }); report.screenshots.push(name);
      }
      await emitTasks([]);
      const account = await prepareGlobalRouteControl(page, suite, 'accounts', text('nav.accounts'));
      row.accountButton = await hit(account);
      assert.ok(row.accountButton.inside && row.accountButton.hit, 'homepage account action stays visible and uncovered');
      if (suite === 'modern') {
        const boundary = await account.evaluate(e => { const css = getComputedStyle(e), canvas = document.createElement('canvas'), context = canvas.getContext('2d'); canvas.width = canvas.height = 1; context.fillStyle = css.borderTopColor; context.fillRect(0, 0, 1, 1); return { width: parseFloat(css.borderTopWidth), alpha: context.getImageData(0, 0, 1, 1).data[3] }; });
        assert.ok(boundary.width >= 1 && boundary.alpha > 0, 'the Modern homepage account action has a visible control boundary');
        row.accountBoundary = boundary;
      }
      await activate(account, 'accounts');
      row.accountInputs = [];
      const accountInputs = page.locator('.accounts-page').getByRole('textbox');
      assert.ok(await accountInputs.count() >= 2, 'real client and offline account inputs remain available');
      for (const input of await accountInputs.all()) {
        const geometry = await hit(input);
        assert.ok(geometry.inside && geometry.hit, 'account input geometry is usable at the current window and scale: ' + JSON.stringify({ row, geometry }));
        row.accountInputs.push(geometry);
      }
      row.checks.push('homepage_account_boundary_and_real_small_window_inputs');
      report.rows.push(row);
      console.log(`PASS navigation refinement ${suite}/${language}/${theme}/${scale}/${viewport.width}`);
    }
    const logs = await prepareGlobalRouteControl(page, suite, 'logs', text('nav.logs'));
    const focusReturn = await globalRouteFocusReturn(page, suite, logs);
    await activate(logs, 'logs');
    assert.equal(await focusReturn.evaluate(e => document.activeElement === e), true, 'secondary log navigation retains its stable keyboard focus');
  } catch (error) {
    report.failure = { suite, language, message: error.message, stack: error.stack, actual: await page.evaluate(() => ({ navigation: window.suiteBuiltinsFixture?.snapshot.navigation, downloads: window.suiteBuiltinsFixture?.snapshot.downloads, activeElement: document.activeElement?.outerHTML.slice(0, 400) })).catch(() => null) };
    await page.screenshot({ path: resolve(out, `failure-${suite}-${language}.png`) }).catch(() => {});
    throw error;
  } finally {
    report.errors.push(...fixture.observedPageErrors); report.csp.push(...fixture.observedCspViolations); report.sourceRequests.push(...fixture.observedSourceModuleRequests);
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await fixture.close();
  }
}
assert.equal(report.rows.length, 48);
assert.equal(report.features.length, 4);
assert.deepEqual(report.errors, []); assert.deepEqual(report.csp, []);
if (process.env.PARADOX_TEST_NATIVE_CSP === '1') assert.deepEqual(report.sourceRequests, [], 'compiled+CSP uses no application source modules');
report.finishedAt = new Date().toISOString();
report.scriptSha256 = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS four language/suite feature journeys and ${report.rows.length} focused layout contexts; ${out}`);
