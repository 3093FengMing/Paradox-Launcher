import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initialConfig } from './lib/hook-test-host.mjs';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/launcher-state-browser');
await mkdir(artifacts, { recursive: true });
const config = structuredClone(initialConfig);
config.profiles.push({ ...config.profiles[0], instance_key: 'instance-b', name: 'Instance B' });
const fixture = await createBrowserFixture({ desktopBoundary: true, config });
const { page } = fixture;
const report = { checks: [], errors: fixture.observedPageErrors };
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  await page.waitForFunction(() => typeof window.mountLauncherFixture === 'function');
  await page.evaluate(() => window.mountLauncherFixture());
  await page.waitForFunction(() => {
    const s = window.launcherFixture.views.a?.snapshot;
    return s?.accounts.ready && s.profiles.items.length === 2 && !s.profiles.scanning;
  });
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    window.stateProbe = { held: [], actions: window.launcherFixture.views.a.actions };
    native.invoke = (command, args = {}) => {
      if (['list_content', 'search_content', 'inspect_instances'].includes(command)) {
        window.foundationDesktop.calls.push({ command, args: structuredClone(args) });
        return new Promise((resolve, reject) =>
          window.stateProbe.held.push({ command, args, resolve, reject }),
        );
      }
      return invoke(command, args);
    };
    window.stateProbe.actions.content.selectProfile('instance-b');
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.listRequest?.loading,
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const { a, b } = window.launcherFixture.views;
      return {
        sameSnapshot: a.snapshot === b.snapshot,
        sameActions: a.actions === b.actions,
        frozen: Object.isFrozen(a.snapshot.content.listRequest),
        mutationPending: a.snapshot.content.pending,
        key: a.snapshot.content.listRequest.profileKey,
      };
    }),
    {
      sameSnapshot: true,
      sameActions: true,
      frozen: true,
      mutationPending: false,
      key: 'instance-b',
    },
  );
  await page.evaluate(() => window.stateProbe.held.shift().reject(new Error('List read failed')));
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.listRequest?.error === 'List read failed',
  );
  await page.evaluate(() => {
    void window.stateProbe.actions.content.refresh();
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.listRequest?.loading,
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.content.listRequest.error),
    null,
  );
  await page.evaluate(() => window.stateProbe.held.shift().resolve([]));
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.content.list !== null);
  pass('two_public_consumers_share_frozen_list_read_state_and_retry_without_mutation_pending');

  await page.evaluate(() => {
    window.stateProbe.actions.content.patchSearch({ query: 'original', kind: 'mod' });
    void window.stateProbe.actions.content.search();
    window.stateProbe.held.shift().resolve({ hits: [], total_hits: 100, offset: 0 });
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.results?.total_hits === 100,
  );
  await page.evaluate(() => {
    void window.stateProbe.actions.content.search(20);
    window.stateProbe.held.shift().reject(new Error('Page read failed'));
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.searchError === 'Page read failed',
  );
  assert.deepEqual(
    await page.evaluate(() => {
      window.stateProbe.actions.content.patchSearch({ query: 'different draft', kind: 'shader' });
      void window.stateProbe.actions.content.search(40);
      const invalidCount = window.stateProbe.held.length;
      void window.stateProbe.actions.content.search(20);
      const read = window.stateProbe.held.shift();
      read.resolve({ hits: [], total_hits: 100, offset: 20 });
      return { invalidCount, request: read.args };
    }),
    { invalidCount: 0, request: { query: 'original', category: 'mod', offset: 20 } },
  );
  await page.waitForFunction(() => !window.launcherFixture.views.a.snapshot.content.searching);
  pass('failed_later_search_page_retries_original_query_kind_offset_only');

  await page.evaluate(() => {
    void window.stateProbe.actions.profiles.scan();
  });
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.profiles.scanning);
  await page.evaluate(() => window.stateProbe.held.shift().reject(new Error('Scan failed')));
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.profiles.scanError === 'Scan failed',
  );
  await page.evaluate(() => {
    void window.stateProbe.actions.profiles.scan();
  });
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.profiles.scanning);
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.profiles.scanError),
    null,
  );
  await page.evaluate(() =>
    window.stateProbe.held
      .shift()
      .resolve(window.launcherFixture.views.a.snapshot.profiles.installed),
  );
  await page.waitForFunction(() => !window.launcherFixture.views.a.snapshot.profiles.scanning);
  pass('scan_pending_error_and_retry_are_shared_by_real_context_consumers');

  await page.evaluate(() => window.stateProbe.actions.launch.request('instance-b'));
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.launch.selection?.profileKey === 'instance-b',
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.launch.profileKey),
    null,
  );
  await page.evaluate(() => window.stateProbe.actions.launch.confirmAccount());
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.launch.profileKey === 'instance-b',
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const s = window.launcherFixture.views.a.snapshot;
      return {
        key: s.launch.profileKey,
        phase: s.launch.phase,
        active: s.profiles.activeKey,
        sent: window.foundationDesktop.calls.filter((c) => c.command === 'launch_instance').at(-1)
          .args.key,
      };
    }),
    { key: 'instance-b', phase: 'started', active: 'original-instance', sent: 'instance-b' },
  );
  pass('launch_B_keeps_active_A_and_attributes_accepted_run_to_B');

  const serviceCommands = [
    'get_config',
    'account_state',
    'account_recovery',
    'inspect_instances',
    'plugin:event|listen',
  ];
  const countServices = () =>
    page.evaluate(
      (commands) =>
        window.foundationDesktop.calls.filter((c) => commands.includes(c.command)).length,
      serviceCommands,
    );
  const before = await countServices();
  await page.evaluate(() => window.launcherFixture.replace());
  await page.locator('[data-view="replacement"]').waitFor();
  await page.evaluate(() => window.stateProbe.actions.settings.patch('memory_mb', 6144));
  await page.waitForFunction(
    () => window.launcherFixture.views.b.snapshot.settings.draft.memory_mb === 6144,
  );
  assert.equal(await countServices(), before);
  assert.equal(
    await page.evaluate(() => window.stateProbe.actions === window.launcherFixture.views.b.actions),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.b.snapshot.launch.profileKey),
    'instance-b',
  );
  await page.evaluate(() => window.launcherFixture.restore());
  await page.locator('[data-view="builtin"]').waitFor();
  assert.equal(await countServices(), before);
  pass('source_replacement_and_restore_preserve_launch_owner_and_add_zero_service_subscriptions');

  await page.evaluate(() =>
    window.foundationDesktop.emit('launcher://activity', {
      action: 'launch',
      status: 'finished',
      message: '',
    }),
  );
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.launch.phase === 'idle');
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.launch.profileKey),
    null,
  );
  await page.evaluate(() =>
    window.foundationDesktop.emit('launcher://activity', {
      action: 'launch',
      status: 'running',
      message: '',
    }),
  );
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.launch.phase === 'running',
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.launch.profileKey),
    null,
  );
  pass('terminal_releases_known_key_and_external_running_remains_unknown');
  assert.deepEqual(fixture.observedPageErrors, []);
  await page.screenshot({ path: resolve(artifacts, 'shared-context.png') });
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
