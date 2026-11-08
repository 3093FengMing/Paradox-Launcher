import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

// Run only after the root has integrated and frozen Tasks 5/6/7.
const out = resolve('.test-data/default-ui-task7', process.env.PARADOX_ACCOUNTS_EVIDENCE || 'focused');
await mkdir(out, { recursive: true });
const report = { fixture: 'suite-builtins-test: actual sources, one LauncherProvider, native boundary only', rows: [], sources: {}, screenshots: [] };
for (const suite of ['modern', 'immersive']) {
  for (const file of ['pages/AccountsPage.tsx', 'pages/DiscoverPage.tsx', 'dialogs/AccountLoginDialog.tsx', 'styles/accounts.css', 'styles/discover.css', 'styles/account-login.css']) {
    const path = `${suite}/${file}`;
    report.sources[path] = createHash('sha256').update(await readFile(resolve('src/ui-suite/builtins', path))).digest('hex');
  }
}
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.profiles[0].name = 'Fabric workshop';
config.profiles[0].loader = 'fabric';
config.profiles[0].loader_version = '0.16.0';
config.profiles.push({ ...config.profiles[0], instance_key: 'vanilla-instance', name: 'Vanilla world', loader: 'vanilla', loader_version: '' });

for (const suite of ['modern', 'immersive']) {
  const fixture = await createBrowserFixture({ desktopBoundary: true, config, url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}` });
  const { page } = fixture, checks = [];
  const site = name => name === 'Discover-target-select' ? page.locator('.discover-target').getByRole('combobox') : page.locator(`[data-ui-site$=":${name}"]`);
  const pass = name => { checks.push(name); console.log(`PASS ${suite}: ${name}`); };
  const act = (fn, value) => page.evaluate(fn, value);
  const wait = fn => page.waitForFunction(fn);
  const clearNotices = async () => {
    await act(() => { const f = window.suiteBuiltinsFixture; for (const notice of f.snapshot.notifications.items) f.actions.notifications.dismiss(notice.id); });
    await wait(() => !document.querySelector('.ui-notice'));
  };
  const screenshot = async (name, provenance) => {
    if (!name.startsWith('failure')) await clearNotices();
    const path = resolve(out, `${name}-${suite}.png`);
    await page.screenshot({ path });
    report.screenshots.push({ path, provenance, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  };
  try {
    await wait(() => window.suiteBuiltinsFixture?.ready);
    await act(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    await act(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      const b = window.accountDiscoveryBoundary = { recovery: ['orphan-one'], loadFail: false, searchMode: 'results', heldSearches: [], commands: [], beginMode: 'normal', expires: false, copyMode: 'hold', openMode: 'hold', cancelMode: 'hold', installMode: 'success', packMode: 'success', pickerMode: 'normal' };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: code => { b.copiedCode = code; b.copyCalls = (b.copyCalls || 0) + 1; return new Promise((resolve, reject) => { b.releaseCopy = resolve; b.rejectCopy = reject; }); } } });
      native.invoke = async (command, args = {}) => {
        b.commands.push({ command, args: structuredClone(args) });
        if (command === 'account_state' && b.loadFail) throw Error('Task7 account vault unavailable');
        if (command === 'account_recovery') return [...b.recovery];
        if (command === 'clear_account_recovery') { b.recovery = b.recovery.filter(id => id !== args.accountId); return [...b.recovery]; }
        if (command === 'configure_microsoft') { window.foundationDesktop.accounts.client_id = args.clientId; return structuredClone(window.foundationDesktop.accounts); }
        if (command === 'refresh_account') return structuredClone(window.foundationDesktop.accounts);
        if (command === 'logout_account') { window.foundationDesktop.accounts.accounts = window.foundationDesktop.accounts.accounts.filter(row => row.id !== args.id); if (window.foundationDesktop.accounts.active === args.id) window.foundationDesktop.accounts.active = null; return structuredClone(window.foundationDesktop.accounts); }
        if (command === 'begin_login') {
          b.requestId = args.requestId;
          if (b.beginMode === 'fail') throw Error('Task7 login network failure');
          if (b.beginMode === 'hold') await new Promise(resolve => b.releaseBegin = resolve);
          return { id: args.requestId, user_code: 'ABCD-EFGH', verification_uri: 'https://www.microsoft.com/link', expires_at: Math.floor(Date.now() / 1000) + (b.expires ? -1 : 600) };
        }
        if (command === 'complete_login') return new Promise((resolve, reject) => { b.finishLogin = resolve; b.failLogin = reject; });
        if (command === 'open_login_page') { if (b.openMode === 'hold') await new Promise((resolve, reject) => { b.releaseOpen = resolve; b.rejectOpen = reject; }); return; }
        if (command === 'cancel_login') { if (b.cancelMode === 'hold') await new Promise((resolve, reject) => { b.releaseCancel = resolve; b.rejectCancel = reject; }); return; }
        if (command === 'search_content') {
          if (b.searchMode === 'fail') throw Error('Task7 Modrinth unavailable');
          const result = { hits: Array.from({ length: b.searchMode === 'empty' ? 0 : Math.min(20, 45 - args.offset) }, (_, i) => ({ project_id: `project_${args.offset + i}`, title: `${args.query || 'Popular'} project ${args.offset + i + 1}`, description: 'A project returned by the native Modrinth search boundary.', project_type: args.category, downloads: 12400 + i })), total_hits: b.searchMode === 'empty' ? 0 : 45, offset: args.offset, limit: 20 };
          if (b.searchMode === 'hold') return new Promise((resolve, reject) => b.heldSearches.push({ args, result, resolve, reject }));
          return result;
        }
        if (command === 'enqueue_content') { if (b.installMode === 'fail') throw Error('No compatible resource version'); return { id: 'content-test', status: 'completed' }; }
        if (command === 'enqueue_pack') { if (b.packMode === 'fail') throw Error('Task7 remote pack unavailable'); return { id: 'pack-test', status: 'completed' }; }
        if (command === 'choose_pack') { if (b.pickerMode === 'hold') return new Promise(resolve => b.releasePicker = resolve); return 'C:/fixture/local.mrpack'; }
        return original(command, args);
      };
      window.fixtureStableActions = window.suiteBuiltinsFixture.actions;
      window.fixtureStableController = window.suiteBuiltinsFixture.controller;
      window.suiteBuiltinsFixture.actions.navigation.navigate('accounts');
    });
    await site('Accounts-page').waitFor();
    assert.equal(await site('Accounts-page').getAttribute('data-ui-source'), `${suite}/pages/AccountsPage.tsx`);
    await site('Accounts-client-id').fill('11111111-1111-1111-1111-111111111111');
    await site('Accounts-save-client').click();
    await wait(() => !!window.suiteBuiltinsFixture.snapshot.accounts.state.client_id && !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    await act(() => window.suiteBuiltinsFixture.actions.accounts.reload());
    await site('Accounts-recovery').waitFor();
    await site('Accounts-clear-recovery').click();
    await site('Accounts-recovery').waitFor({ state: 'detached' });
    await site('Accounts-name').fill('Task7Player');
    await site('Accounts-save-name').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.config.value.settings.offline_username === 'Task7Player');
    await site('Accounts-use-offline').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.state.active === null);
    await page.locator('[data-account-id="account-b"] [data-ui-site$=":Accounts-select"]').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.state.active === 'account-b');
    await page.locator('[data-account-id="account-b"] [data-ui-site$=":Accounts-refresh"]').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    await page.locator('[data-account-id="account-a"] [data-ui-site$=":Accounts-logout"]').click();
    await site('Accounts-cancel-logout').click();
    await page.locator('[data-account-id="account-a"] [data-ui-site$=":Accounts-logout"]').click();
    await site('Accounts-confirm-logout').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.state.accounts.length === 1);
    assert.equal(await page.locator('[data-account-id="account-b"] .badge').count(), 1);
    pass('single_offline_configuration_select_refresh_logout_existing_owner_and_recovery');

    await act(async () => { window.accountDiscoveryBoundary.loadFail = true; await window.suiteBuiltinsFixture.actions.accounts.reload(); });
    await site('Accounts-load-error').waitFor();
    assert.equal(await site('Accounts-login').isDisabled(), true);
    await act(() => { window.accountDiscoveryBoundary.loadFail = false; });
    await site('Accounts-reload').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.ready);
    await clearNotices();
    pass('account_load_error_public_reload_and_readiness');

    for (const theme of ['dark', 'light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      for (const width of [1240, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 240 : 720 });
        for (const name of ['Accounts-name', 'Accounts-save-name', 'Accounts-client-id', 'Accounts-login', 'Accounts-refresh']) {
          await site(name).scrollIntoViewIfNeeded();
          const box = await site(name).boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1, name + ' horizontally reachable');
          assert.ok(box.y >= 0 && box.y + box.height <= (width === 320 ? 240 : 720) + 1, name + ' vertically reachable');
        }
        assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
        await page.locator('.workspace > main').evaluate(e => e.scrollTop = 0);
        await screenshot(`current-default-accounts-${theme}-${width}`, 'Current unmodified builtin page, real native-boundary data');
      }
    }
    await page.setViewportSize({ width: 1240, height: 720 });
    await act(() => { window.accountDiscoveryBoundary.beginMode = 'fail'; });
    await site('Accounts-login').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    assert.ok(await act(() => window.suiteBuiltinsFixture.snapshot.notifications.items.some(item => item.message.includes('Task7 login network failure'))));
    assert.equal(await site('Accounts-login').isEnabled(), true);
    await act(() => { window.accountDiscoveryBoundary.beginMode = 'normal'; });
    await site('Accounts-login').click();
    await site('Login-code').waitFor();
    await site('Login-copy').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === 'copy');
    assert.equal(await site('Login-open').isDisabled(), true);
    const other = suite === 'modern' ? 'immersive' : 'modern';
    const promptId = await act(() => window.suiteBuiltinsFixture.snapshot.accounts.prompt.id);
    await act(async other => { window.suiteBuiltinsFixture.actions.accounts.patchClientId('unfinished-client'); await window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + other); }, other);
    await site('Login-code').waitFor();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.accounts.prompt.id), promptId);
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.accounts.clientIdDraft), 'unfinished-client');
    assert.equal(await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'begin_login').length), 2);
    assert.equal(await act(() => window.fixtureStableActions === window.suiteBuiltinsFixture.actions && window.fixtureStableController === window.suiteBuiltinsFixture.controller), true);
    await act(() => window.accountDiscoveryBoundary.releaseCopy());
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
    await site('Login-copy').click();
    await act(() => window.accountDiscoveryBoundary.rejectCopy(Error('Task7 clipboard unavailable')));
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
    await site('Login-copy').click();
    await act(() => window.accountDiscoveryBoundary.releaseCopy());
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
    await site('Login-open').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === 'open');
    assert.equal(await site('Login-copy').isDisabled(), true);
    await act(() => window.accountDiscoveryBoundary.rejectOpen(Error('Task7 open failed')));
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
    await site('Login-open').click();
    await act(() => window.accountDiscoveryBoundary.releaseOpen());
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
    await act(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    await screenshot('current-default-login-prompt', 'Current builtin dialog, same public prompt retained through suite switch');
    await page.setViewportSize({ width: 320, height: 240 });
    for (const name of ['Login-open', 'Login-copy', 'Login-cancel']) { await site(name).scrollIntoViewIfNeeded(); const box = await site(name).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 321 && box.y >= 0 && box.y + box.height <= 241); }
    await screenshot('current-default-login-320', 'Current builtin dialog at 320 by 240');
    await site('Login-cancel').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.cancelling);
    await act(() => window.accountDiscoveryBoundary.releaseCancel());
    assert.equal(await site('Login-cancel').isDisabled(), true);
    assert.equal(await site('Login-code').count(), 1, 'cancel ACK does not prematurely dismiss prompt');
    await act(() => window.accountDiscoveryBoundary.failLogin('auth.errors.cancelled'));
    await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    await site('Login-code').waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1240, height: 720 });
    await act(() => { window.accountDiscoveryBoundary.expires = true; });
    await site('Accounts-login').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptExpired);
    assert.equal(await site('Login-copy').isDisabled(), true);
    assert.equal(await site('Login-open').isDisabled(), true);
    await site('Login-cancel').click();
    await act(() => { window.accountDiscoveryBoundary.releaseCancel(); window.accountDiscoveryBoundary.failLogin('auth.errors.cancelled'); window.accountDiscoveryBoundary.expires = false; });
    await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    await act(() => { window.accountDiscoveryBoundary.beginMode = 'hold'; window.accountDiscoveryBoundary.cancelMode = 'normal'; });
    await site('Accounts-login').click();
    await site('Accounts-cancel-start').waitFor();
    assert.equal(await site('Login-code').count(), 0);
    await site('Accounts-cancel-start').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.cancelling);
    await act(() => window.accountDiscoveryBoundary.releaseBegin());
    await wait(() => !!window.suiteBuiltinsFixture.snapshot.accounts.prompt);
    assert.equal(await act(() => { const b = window.accountDiscoveryBoundary; return b.commands.filter(x => x.command === 'cancel_login' && x.args.id === b.requestId).length; }), 2, 'late prompt cancelled again after pre-prompt cancellation');
    await act(() => { window.accountDiscoveryBoundary.failLogin('auth.errors.cancelled'); window.accountDiscoveryBoundary.beginMode = 'normal'; window.accountDiscoveryBoundary.cancelMode = 'hold'; });
    await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    pass('actual_login_failure_retry_pending_copy_open_retry_expiry_cancel_ACK_and_suite_switch');

    await act(() => { window.suiteBuiltinsFixture.actions.navigation.navigate('content'); window.suiteBuiltinsFixture.actions.content.selectProfile('original-instance'); });
    await site('Discover-page').waitFor();
    assert.equal(await site('Discover-page').getAttribute('data-ui-source'), `${suite}/pages/DiscoverPage.tsx`);
    assert.equal(await site('Discover-kind').count(), 4);
    await site('Discover-query').fill('Sodium');
    await site('Discover-submit').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.results?.hits.length === 20);
    assert.equal(await site('Discover-result').count(), 20);
    assert.match(await site('Discover-target-summary').innerText(), /Fabric workshop.*fabric/);
    await site('Discover-query').fill('unfinished search');
    await act(async other => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + other), other);
    assert.equal(await site('Discover-query').inputValue(), 'unfinished search');
    assert.match(await site('Discover-request-title').innerText(), /Sodium/);
    await act(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    await site('Discover-next').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.results?.offset === 20);
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.content.request.query), 'Sodium');
    await act(() => { window.accountDiscoveryBoundary.searchMode = 'fail'; });
    await site('Discover-next').click();
    await site('Discover-error').waitFor();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.content.request.offset), 40);
    await act(() => { window.accountDiscoveryBoundary.searchMode = 'results'; });
    await site('Discover-retry').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.results?.offset === 40);
    assert.equal(await site('Discover-result').count(), 5);
    assert.equal(await site('Discover-next').isDisabled(), true);
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.content.request.query), 'Sodium');
    await site('Discover-previous').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.results?.offset === 20);
    pass('four_kinds_20_item_pagination_failure_retries_exact_request_and_retained_drafts');

    await act(() => { window.accountDiscoveryBoundary.searchMode = 'hold'; window.suiteBuiltinsFixture.actions.content.patchSearch({ query: 'Old request' }); void window.suiteBuiltinsFixture.actions.content.search(); });
    await wait(() => window.accountDiscoveryBoundary.heldSearches.length === 1);
    await site('Discover-query').fill('New request');
    await site('Discover-submit').click();
    await wait(() => window.accountDiscoveryBoundary.heldSearches.length === 2);
    await act(() => { const b = window.accountDiscoveryBoundary; b.heldSearches[1].resolve(b.heldSearches[1].result); });
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.searching);
    await act(() => { const b = window.accountDiscoveryBoundary; b.heldSearches[0].resolve(b.heldSearches[0].result); });
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.content.request.query), 'New request');
    assert.match(await site('Discover-project-title').first().innerText(), /New request/);
    await act(() => window.suiteBuiltinsFixture.actions.content.selectProfile(null));
    assert.equal(await site('Discover-install').first().isDisabled(), true);
    await site('Discover-no-target').waitFor();
    await act(() => window.suiteBuiltinsFixture.actions.content.selectProfile('vanilla-instance'));
    await site('Discover-vanilla').waitFor();
    assert.equal(await site('Discover-install').first().isDisabled(), true);
    await act(() => { window.suiteBuiltinsFixture.actions.content.selectProfile('original-instance'); window.accountDiscoveryBoundary.installMode = 'fail'; });
    await site('Discover-install').first().click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.ok(await act(() => window.suiteBuiltinsFixture.snapshot.notifications.items.some(item => item.message.includes('No compatible resource version'))));
    assert.equal(await site('Discover-install').first().isEnabled(), true);
    await act(() => { window.accountDiscoveryBoundary.installMode = 'success'; });
    await site('Discover-install').first().click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'enqueue_content').at(-1).args), { key: 'original-instance', project: 'project_0', category: 'mod' });
    await act(() => { window.accountDiscoveryBoundary.searchMode = 'results'; window.accountDiscoveryBoundary.packMode = 'fail'; window.suiteBuiltinsFixture.actions.content.selectProfile(null); });
    await page.locator('[data-content-kind="modpack"]').click();
    await site('Discover-submit').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.searching);
    await site('Discover-install').first().click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'enqueue_pack').at(-1).args), { source: 'project_0', remote: true });
    assert.ok(await act(() => window.suiteBuiltinsFixture.snapshot.notifications.items.some(item => item.message.includes('Task7 remote pack unavailable'))));
    await act(() => { window.accountDiscoveryBoundary.packMode = 'success'; });
    await site('Discover-import').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'enqueue_pack').at(-1).args), { source: 'C:/fixture/local.mrpack', remote: false });
    const packCount = await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'enqueue_pack').length);
    await act(() => { window.accountDiscoveryBoundary.pickerMode = 'hold'; });
    await site('Discover-import').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.pending);
    await act(() => { window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Task7 picker recheck' }); });
    await wait(() => !!window.suiteBuiltinsFixture.snapshot.activity);
    await act(() => window.accountDiscoveryBoundary.releasePicker('C:/fixture/late.mrpack'));
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.equal(await act(() => window.accountDiscoveryBoundary.commands.filter(x => x.command === 'enqueue_pack').length), packCount);
    await act(() => { window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Task7 picker recheck finished' }); window.accountDiscoveryBoundary.pickerMode = 'normal'; });
    await wait(() => !window.suiteBuiltinsFixture.snapshot.activity);
    await clearNotices();
    pass('late_search_isolation_explicit_target_vanilla_guard_no_compatible_version_and_remote_local_pack_boundaries');

    for (const theme of ['dark', 'light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      for (const width of [1240, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 240 : 720 });
        for (const name of ['Discover-query', 'Discover-submit', 'Discover-target-select', 'Discover-next']) {
          await site(name).scrollIntoViewIfNeeded(); const box = await site(name).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= (width === 320 ? 240 : 720) + 1, name + ' reachability');
        }
        assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
        await page.locator('.workspace > main').evaluate(e => e.scrollTop = 0);
        await screenshot(`current-default-discover-${theme}-${width}`, 'Current unmodified builtin discovery, real 20-item Modrinth boundary result');
      }
    }
    await act(async () => { window.accountDiscoveryBoundary.searchMode = 'empty'; await window.suiteBuiltinsFixture.actions.content.search(); });
    await site('Discover-empty').waitFor();
    await act(async () => { window.foundationDesktop.config.profiles = []; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await site('Discover-create').waitFor();
    await site('Discover-create').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.profileDraft.editor !== null || window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'custom.versions');
    await act(() => window.suiteBuiltinsFixture.actions.profileDraft.cancel());
    pass('empty_results_no_instances_create_and_320_reachability_both_themes');

    await page.setViewportSize({ width: 1240, height: 720 });
    await act(async suite => {
      const c = window.suiteBuiltinsFixture.controller;
      await c.actions.copyBuiltin(suite, 'Task7 source customization');
      const p = c.getSnapshot().draft.manifest.views['page.content'];
      c.actions.patchFile(p, c.getSnapshot().draft.files[p].text.replace('>Modrinth</h2>', '>Task7 customized discovery</h2>'));
      if (!await c.actions.preview()) throw Error('Task7 source preview failed');
      window.suiteBuiltinsFixture.actions.navigation.navigate('content');
    }, suite);
    await page.getByRole('heading', { name: 'Task7 customized discovery', exact: true }).waitFor();
    await screenshot('source-customized-fixture-discover', 'Copied builtin with explicit source heading edit; not current-default evidence');
    assert.equal(await act(() => window.fixtureStableActions === window.suiteBuiltinsFixture.actions && window.fixtureStableController === window.suiteBuiltinsFixture.controller), true);
    assert.deepEqual(fixture.observedPageErrors, []);
    assert.deepEqual(fixture.observedCspViolations, []);
    pass('actual_source_editing_same_root_provenance_no_page_errors');
    report.rows.push({ suite, checks, errors: fixture.observedPageErrors });
  } catch (error) {
    await screenshot('failure', 'Failure diagnostic; not accepted default evidence');
    report.rows.push({ suite, checks, failure: String(error), errors: fixture.observedPageErrors, state: await act(() => ({ accounts: window.suiteBuiltinsFixture?.snapshot.accounts, content: window.suiteBuiltinsFixture?.snapshot.content, commands: window.accountDiscoveryBoundary?.commands.slice(-12) })) });
    throw error;
  } finally {
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await fixture.close();
  }
}
