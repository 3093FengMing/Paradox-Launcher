import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const out = resolve('.test-data/default-ui-task6', process.env.PARADOX_TASK6_EVIDENCE || 'focused');
await mkdir(out, { recursive: true });
const report = { rows: [], sourceHashes: {} };
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.settings.show_snapshots = false;
for (const suite of ['modern', 'immersive']) {
  const fixture = await createBrowserFixture({ desktopBoundary: true, config, url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}` });
  const { page } = fixture, checks = [];
  const site = name => name === 'ProfileDialog-loader'
    ? page.getByRole('combobox', { name: 'Instance type', exact: true })
    : name === 'ProfileDialog-loader-version'
      ? page.getByRole('combobox', { name: 'Loader version', exact: true })
      : name === 'ProfileDialog-name'
        ? page.locator('.profile-dialog #profile-name')
        : name === 'ProfileDialog-version'
          ? page.getByRole('textbox', { name: 'Minecraft version', exact: true })
          : page.locator(`[data-ui-site$=":${name}"]`);
  const act = (fn, arg) => page.evaluate(fn, arg);
  const wait = fn => page.waitForFunction(fn);
  const pass = name => { checks.push(name); console.log(`PASS ${suite}: ${name}`); };
  const screenshot = name => page.screenshot({ path: resolve(out, `${name}-${suite}.png`) });
  try {
    await wait(() => window.suiteBuiltinsFixture?.ready);
    assert.equal(await act(suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite), true);
    await wait(() => !window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
    await act(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      const state = {
        catalogCalls: [], loaderCalls: [], calls: [], tasks: [], heldLoaders: [],
        failCatalog: false, failCreate: false, failRetry: false, holdLoaders: false, holdCancel: false,
        catalog: {
          versions: [{ id: '1.21.1', kind: 'release' }, ...Array.from({ length: 134 }, (_, i) => ({ id: '1.20.' + i, kind: 'release' })), { id: '24w14a', kind: 'snapshot' }, { id: '24w15a', kind: 'snapshot' }, { id: 'old_alpha', kind: 'old_alpha' }],
          fetched_at: 1700000000, source: 'cache', stale: true, warning: 'Fixture stale catalog retained', error_kind: 'network',
        },
      };
      window.task6Boundary = state;
      native.invoke = async (command, args = {}) => {
        if (command === 'catalog') {
          state.catalogCalls.push(structuredClone(args));
          if (state.failCatalog) throw Error('Task 6 catalog refresh failed');
          return structuredClone(state.catalog);
        }
        if (command === 'loader_versions') {
          state.loaderCalls.push(structuredClone(args));
          if (state.holdLoaders) return new Promise(resolve => state.heldLoaders.push({ args, resolve }));
          return [{ version: args.loader + '-' + args.game + '-stable', stable: true }, { version: args.loader + '-' + args.game + '-experimental', stable: false }];
        }
        if (command === 'create_profile' && state.failCreate) throw Error('Task 6 create failed; draft retained');
        if (command === 'download_tasks') return structuredClone(state.tasks);
        if (command === 'cancel_task') {
          state.calls.push({ command, args: structuredClone(args) });
          if (state.holdCancel) await new Promise(resolve => state.releaseCancel = resolve);
          state.tasks = state.tasks.map(task => task.id === args.id ? { ...task, status: 'cancelling' } : task);
          window.foundationDesktop.emit('launcher://downloads', structuredClone(state.tasks));
          return;
        }
        if (command === 'retry_task') {
          state.calls.push({ command, args: structuredClone(args) });
          if (state.failRetry) throw Error('Task 6 retry failed');
          const task = state.tasks.find(task => task.id === args.id);
          if (!task || !['failed', 'cancelled'].includes(task.status)) throw Error('Invalid retry');
          const next = { ...task, id: task.id + '-new', name: task.name + ' retry', status: 'queued' };
          state.tasks.push(next);
          return structuredClone(next);
        }
        if (command === 'enqueue_install') {
          state.calls.push({ command, args: structuredClone(args) });
          const task = { id: 'install-' + args.key, kind: 'install', profile_key: args.key, name: 'Explicit install', java_major: null, status: 'queued', progress: null, message: 'Queued' };
          state.tasks.push(task);
          return structuredClone(task);
        }
        if (command === 'inspect_instances') return window.foundationDesktop.config.profiles.filter(p => p.instance_key !== 'created-fixture').map(p => ({ ...p, root: '/fixture/' + p.instance_key }));
        return original(command, args);
      };
    });
    await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('downloads'));
    await site('DownloadsPage-root').waitFor();
    assert.equal(await act(() => window.task6Boundary.catalogCalls.length), 0, 'downloads route does not load the version catalog');
    await site('DownloadsPage-versions').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.catalog.versions.length === 138);
    assert.equal(await site('VersionsPage-version').count(), 100);
    assert.equal(await site('VersionsPage-cache').innerText().then(text => /cache/i.test(text)), true);
    assert.match(await site('VersionsPage-cache').innerText(), /outdated|stale|expired|过期/i);
    if (suite === 'modern') assert.equal(await page.locator('.versions-cache-copy').evaluate(e => getComputedStyle(e).display), 'grid');
    await site('VersionsPage-more').click();
    assert.equal(await site('VersionsPage-version').count(), 135);
    await site('VersionsPage-snapshots').check();
    await wait(() => window.suiteBuiltinsFixture.snapshot.config.value.settings.show_snapshots);
    await site('VersionsPage-kind').filter({ hasText: 'Snapshot' }).click();
    assert.equal(await site('VersionsPage-version').count(), 2);
    await site('VersionsPage-kind').filter({ hasText: 'Historical' }).click();
    assert.equal(await site('VersionsPage-version').count(), 1);
    await site('VersionsPage-snapshots').uncheck();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.config.value.settings.show_snapshots);
    assert.equal(await site('VersionsPage-version').count(), 100, 'hidden snapshots force release regardless of previous local group');
    await act(() => { window.task6Boundary.failCatalog = true; });
    await site('VersionsPage-refresh').click();
    await site('VersionsPage-error').waitFor();
    assert.match(await site('VersionsPage-error').innerText(), /refresh failed/);
    assert.equal(await site('VersionsPage-version').count(), 100, 'last catalog retained after refresh failure');
    assert.equal(await act(() => window.task6Boundary.catalogCalls.at(-1).forceRefresh), true);
    pass('versions_route_mount_cache_staleness_refresh_failure_138_versions_local_types_and_real_load_more');
    await act(() => { window.task6Boundary.failCatalog = false; });
    await site('VersionsPage-retry').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.catalog.busy);
    for (const theme of ['dark', 'light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      await page.waitForFunction(theme => window.suiteBuiltinsFixture.snapshot.appearance.theme === theme, theme);
      await screenshot('current-default-versions-' + theme + '-1240');
    }
    await site('VersionsPage-search').fill('1.21.1');
    assert.equal(await site('VersionsPage-version').count(), 1);
    await site('VersionsPage-create').click();
    await site('ProfileDialog-name').waitFor();
    await wait(() => document.activeElement?.id === 'profile-name');
    assert.equal(await site('ProfileDialog-version').inputValue(), '1.21.1');
    await site('ProfileDialog-name').fill('Task 6 created instance');
    await act(() => { window.task6Boundary.holdLoaders = true; });
    await site('ProfileDialog-loader').click();
    await page.getByRole('option', { name: 'Fabric', exact: true }).click();
    await wait(() => window.task6Boundary.heldLoaders.length === 1);
    await act(() => { window.task6Boundary.holdLoaders = false; });
    await site('ProfileDialog-version').fill('1.20.1');
    await site('ProfileDialog-loader').click();
    await page.getByRole('option', { name: 'Quilt', exact: true }).click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.profileDraft.loaderCatalog.pending && window.suiteBuiltinsFixture.snapshot.profileDraft.loaderCatalog.request?.loader === 'quilt');
    await act(() => window.task6Boundary.heldLoaders[0].resolve([{ version: 'late-wrong-fabric', stable: true }]));
    await site('ProfileDialog-loader-version').click();
    await page.getByRole('option', { name: 'quilt-1.20.1-stable', exact: true }).waitFor();
    assert.equal(await page.getByRole('option', { name: 'late-wrong-fabric', exact: true }).count(), 0);
    assert.equal(await page.getByRole('option', { name: /experimental/ }).count(), 1);
    await page.getByRole('option', { name: 'quilt-1.20.1-stable', exact: true }).click();
    assert.deepEqual(await act(() => window.task6Boundary.loaderCalls.map(c => [c.loader, c.game])), [['fabric', '1.21.1'], ['quilt', '1.20.1']], '300ms owner coalesces intermediate pair');
    await act(() => { window.task6Boundary.failCreate = true; });
    await site('ProfileDialog-submit').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.profileDraft.pending);
    assert.equal(await site('ProfileDialog-name').inputValue(), 'Task 6 created instance');
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.profileDraft.editor.loader_version), 'quilt-1.20.1-stable');
    await screenshot('state-create-failure-preserved');
    await act(() => { window.task6Boundary.failCreate = false; });
    await site('ProfileDialog-submit').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.profileDraft.editor === null && window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'instances');
    assert.equal(await act(() => window.task6Boundary.calls.filter(c => c.command === 'enqueue_install').length), 0, 'creation never guesses new identity or auto-installs');
    await page.locator('[data-profile-key="created-fixture"]').getByRole('button', { name: 'Install', exact: true }).click();
    await wait(() => window.task6Boundary.calls.some(c => c.command === 'enqueue_install' && c.args.key === 'created-fixture'));
    pass('focused_create_loader_pair_debounce_late_result_isolation_failure_retains_draft_explicit_known_instance_install');
    await act(() => {
      window.task6Boundary.tasks = [];
      window.foundationDesktop.emit('launcher://downloads', []);
    });
    await wait(() => !window.suiteBuiltinsFixture.snapshot.downloads.active && window.suiteBuiltinsFixture.snapshot.downloads.pending.length === 0);
    await act(() => window.suiteBuiltinsFixture.actions.profileDraft.openRename('created-fixture'));
    await site('ProfileDialog-name').waitFor();
    assert.equal(await site('ProfileDialog-version').isDisabled(), true);
    assert.equal(await site('ProfileDialog-loader').count(), 0);
    await site('ProfileDialog-name').fill('Task 6 renamed instance');
    await site('ProfileDialog-submit').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.profileDraft.editor === null);
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.profiles.items.find(p => p.profile.instance_key === 'created-fixture').profile.name), 'Task 6 renamed instance');
    assert.equal(await act(() => window.task6Boundary.loaderCalls.length), 2);
    await act(() => window.suiteBuiltinsFixture.actions.profileDraft.openRename('original-instance'));
    await site('ProfileDialog-name').waitFor();
    await site('ProfileDialog-cancel').click();
    // The installed profile's original identity is passed for explicit repair.
    await page.locator('[data-profile-key="original-instance"]').locator('[data-ui-site$=":ProfileCard-menu-trigger"]').click();
    await site('ProfileCard-repair').click();
    await wait(() => window.task6Boundary.calls.some(c => c.command === 'enqueue_install' && c.args.key === 'original-instance'));
    pass('rename_name_only_and_explicit_installed_repair_identity');
    await act(() => {
      const progress = { total_files: 10, completed_files: 4, downloaded_files: 2, reused_files: 2, failed_files: 1, transferred_bytes: 2048, completed_bytes: 4096, active_bytes: 1024, total_bytes: null, bytes_per_second: 256, current_file: '/fixture/libraries/a-very-long-directory/'.repeat(8) + 'current.jar' };
      window.task6Boundary.tasks = ['queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed'].map((status, i) => ({ id: 'task-' + status, name: 'Task ' + status, status, kind: ['install', 'java', 'content', 'pack'][i % 4], profile_key: i === 0 ? 'original-instance' : null, java_major: i === 1 ? 21 : null, message: 'Fixture message ' + status, progress: status === 'queued' ? null : { ...progress, total_bytes: status === 'completed' ? 10240 : null } }));
      window.foundationDesktop.emit('launcher://downloads', structuredClone(window.task6Boundary.tasks));
      window.suiteBuiltinsFixture.actions.navigation.navigate('downloads');
    });
    await site('DownloadsPage-root').waitFor();
    assert.equal(await site('DownloadQueue-task').count(), 6);
    if (suite === 'modern') assert.equal(await page.locator('.queue-inspect').first().evaluate(e => getComputedStyle(e).justifyContent), 'start');
    assert.equal(await site('DownloadQueue-status-filter').locator('option').count(), 7);
    assert.equal(await site('DownloadQueue-kind-filter').locator('option').count(), 5);
    const running = site('DownloadQueue-task').filter({ hasText: 'Task running' });
    assert.doesNotMatch(await running.locator('.queue-progress-copy').innerText(), /%/);
    assert.match(await running.locator('.queue-progress-copy').innerText(), /4 \/ 10 files/);
    assert.match(await running.locator('.queue-progress-copy').innerText(), /5.0 KiB/);
    assert.match(await running.locator('.queue-progress-copy').innerText(), /256 B\/s/);
    assert.equal(await running.locator('progress').getAttribute('max'), '10');
    await site('DownloadQueue-status-filter').selectOption('failed');
    assert.equal(await site('DownloadQueue-task').count(), 1);
    await site('DownloadQueue-kind-filter').selectOption('pack');
    assert.equal(await site('DownloadQueue-task').count(), 0);
    await site('DownloadQueue-clear').click();
    const failedTask = site('DownloadQueue-task').filter({ hasText: 'Task failed' });
    await act(() => { window.task6Boundary.failRetry = true; });
    await failedTask.locator('[data-ui-site$=":DownloadQueue-retry"]').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.notifications.items.some(n => n.message.includes('Task 6 retry failed')));
    assert.equal(await site('DownloadQueue-task').count(), 6);
    await act(() => { window.task6Boundary.failRetry = false; });
    await failedTask.locator('[data-ui-site$=":DownloadQueue-retry"]').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.some(task => task.id === 'task-failed-new'));
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.find(task => task.id === 'task-failed').status), 'failed');
    assert.equal(await act(() => window.task6Boundary.calls.filter(c => c.command === 'retry_task').every(c => c.args.id === 'task-failed')), true);
    await act(() => { window.task6Boundary.holdCancel = true; });
    await running.locator('[data-ui-site$=":DownloadQueue-cancel"]').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.downloads.pending.includes('task-running'));
    assert.equal(await running.locator('[data-ui-site$=":DownloadQueue-cancel"]').isDisabled(), true);
    await act(() => { window.task6Boundary.releaseCancel(); });
    await wait(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.find(task => task.id === 'task-running').status === 'cancelling');
    assert.equal(await running.locator('[data-ui-site$=":DownloadQueue-cancel"]').count(), 0);
    assert.equal(await running.locator('[data-ui-site$=":DownloadQueue-cancelling"]').isDisabled(), true);
    assert.equal(await act(() => window.task6Boundary.calls.filter(c => c.command === 'cancel_task' && c.args.id === 'task-running').length), 1);
    pass('six_status_four_kind_filters_unknown_bytes_real_file_progress_retry_new_id_original_retained_cancel_pending');
    if (suite === 'modern') await running.locator('[data-ui-site$=":DownloadQueue-show-details"]').click();
    else await running.locator('summary').click();
    const detail = suite === 'modern' ? page.locator('aside.queue-details') : running.locator('details');
    assert.match(await detail.innerText(), /2.0 KiB/);
    assert.match(await detail.innerText(), /Bytes in active files/);
    assert.match(await detail.innerText(), /Fixture message running/);
    assert.match(await detail.innerText(), /current.jar/);
    await act(() => {
      const f = window.suiteBuiltinsFixture;
      for (const notice of f.snapshot.notifications.items) f.actions.notifications.dismiss(notice.id);
    });
    for (const theme of ['dark', 'light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      await page.waitForFunction(theme => window.suiteBuiltinsFixture.snapshot.appearance.theme === theme, theme);
      for (const viewport of [{ width: 1240, height: 720 }, { width: 640, height: 480 }, { width: 320, height: 240 }]) {
        await page.setViewportSize(viewport);
        if (viewport.width === 1240) {
          await page.locator('.workspace > main').evaluate(e => { e.scrollTop = 0; });
          await screenshot('current-default-downloads-' + theme + '-1240');
        }
        await detail.locator('[data-ui-site$=":DownloadQueue-current-file"]').scrollIntoViewIfNeeded();
        assert.equal(await detail.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true, 'long filename fits task details');
        assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
        await screenshot('current-default-download-details-' + theme + '-' + viewport.width);
      }
    }
    pass('real_bytes_speed_reused_failed_current_message_facts_and_small_window_detail');
    assert.deepEqual(fixture.observedPageErrors, []);
    assert.deepEqual(fixture.observedCspViolations, []);
    report.rows.push({ suite, checks, errors: fixture.observedPageErrors, csp: fixture.observedCspViolations });
  } catch (error) {
    await screenshot('failure').catch(() => {});
    report.rows.push({ suite, checks, error: error.stack, pageErrors: fixture.observedPageErrors });
    throw error;
  } finally {
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
    await fixture.close();
  }
}
for (const suite of ['modern', 'immersive']) for (const file of ['pages/VersionsPage.tsx', 'pages/DownloadsPage.tsx', 'components/DownloadQueue.tsx', 'dialogs/ProfileDialog.tsx', 'styles/versions.css', 'styles/downloads.css', 'styles/profile-dialog.css']) {
  const path = 'src/ui-suite/builtins/' + suite + '/' + file;
  report.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
}
const displayHelper = 'src/ui-suite/builtins/common/lib/download-display.ts';
report.sourceHashes[displayHelper] = createHash('sha256').update(await readFile(displayHelper)).digest('hex');
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
console.log('Task 6 actual-source versions/downloads checks passed.');
