// Run with: node ui/scripts/check-log-preferences.mjs
// Real Hook behavior with controlled IPC completion; no network or sleeps.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { deferred, hookHost, initialConfig, loadApp, uiRoot } from './lib/hook-test-host.mjs';

async function fixture({
  preferences = {},
  holdBootstrap = false,
  holdWrites = false,
  holdSubscription = false,
} = {}) {
  const host = hookHost();
  const configReads = [];
  const historyReads = [];
  const clears = [];
  const writes = [];
  const notifications = [];
  const subscription = deferred();
  let logSequence = 0;
  const server = { config: structuredClone(initialConfig), config_path: 'preferences.json' };
  Object.assign(server.config.settings.personalization, preferences);
  let emitActivity;
  let emitLog;
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          getConfig: () => {
            const response = deferred();
            const snapshot = structuredClone(server);
            configReads.push({ ...response, finish: () => response.resolve(snapshot) });
            if (configReads.length === 1 && !holdBootstrap) response.resolve(snapshot);
            return response.promise;
          },
          saveConfig: (config) => {
            const response = deferred();
            const snapshot = structuredClone(config);
            const write = {
              ...response,
              finish: () => {
                server.config = snapshot;
                response.resolve(structuredClone(snapshot));
              },
            };
            writes.push(write);
            if (!holdWrites) write.finish();
            return response.promise;
          },
          inspectInstances: async () => [],
          subscribe: async (onActivity, onLog) => {
            if (holdSubscription) await subscription.promise;
            emitActivity = onActivity;
            emitLog = onLog;
            return () => {};
          },
          storedLogs: () => {
            const response = deferred();
            historyReads.push(response);
            return response.promise;
          },
          clearStoredLogs: () => {
            const response = deferred();
            clears.push({
              ...response,
              resolve: (boundary = { session: 'current-session', sequence: String(logSequence) }) =>
                response.resolve(boundary),
            });
            return response.promise;
          },
        },
      ],
    ]),
    {
      onNotice: (notice) =>
        notifications.push({ error: notice.kind === 'error', message: notice.message }),
    },
  );
  const { useLauncher } = app('hooks/useLauncher.ts');
  host.mount(useLauncher);
  const launcher = await host.settle();
  return {
    host,
    launcher,
    server,
    configReads,
    historyReads,
    clears,
    writes,
    notifications,
    clock: app.noticeClock,
    subscription,
    emitActivity: (event) => emitActivity(event),
    emitLog: (event) => {
      const record = {
        time: 1704067200,
        id: { session: 'current-session', sequence: String(++logSequence) },
        ...event,
      };
      emitLog(record);
      return record;
    },
  };
}

function patchPreferences(launcher, patch) {
  launcher.patchSettings('personalization', { ...launcher.draft.personalization, ...patch });
}

function stored(message, time = 1704067200) {
  return { level: 'info', message, time };
}

function messages(launcher) {
  return launcher.logs.map((line) => line.message);
}

await test('saved notification preference suppresses completion while errors remain visible', async () => {
  const f = await fixture({ preferences: { notifications: false } });
  f.launcher.notify('ordinary completion');
  f.emitActivity({ action: 'launch', status: 'finished', message: 'game finished' });
  f.launcher.reportError(new Error('controlled failure'));
  f.emitActivity({ action: 'launch', status: 'error', message: 'game failed' });
  const launcher = await f.host.settle();
  assert.deepEqual(f.notifications, [
    { error: true, message: 'controlled failure' },
    { error: true, message: 'game failed' },
  ]);
  assert.ok(messages(launcher).includes('controlled failure'));
});

await test('an unsaved notification draft cannot change current completion behavior', async () => {
  const f = await fixture();
  patchPreferences(f.launcher, { notifications: false });
  (await f.host.settle()).notify('draft completion');
  assert.deepEqual(f.notifications, [{ error: false, message: 'draft completion' }]);
});

await test('translated last-message-only dedup uses strict 1000ms and does not refresh on suppression', async () => {
  const f = await fixture();
  f.launcher.notify('auth.errors.invalid', true);
  const translated = f.notifications.at(-1).message;
  f.clock.advance(999);
  f.launcher.notify(translated, true);
  assert.equal(f.notifications.length, 1);
  f.clock.advance(1);
  f.launcher.notify(translated, true);
  assert.equal(f.notifications.length, 2);
  f.launcher.notify('A');
  f.launcher.notify('B');
  f.launcher.notify('A');
  assert.deepEqual(
    f.notifications.slice(-3).map((notice) => notice.message),
    ['A', 'B', 'A'],
  );
  f.launcher.notify('A', true);
  assert.equal(f.notifications.at(-1).error, true);
  const before = f.notifications.length;
  f.launcher.reportError('A');
  f.launcher.reportError('A');
  assert.equal(f.notifications.length, before);
  assert.equal(messages(await f.host.settle()).filter((message) => message === 'A').length, 2);
  f.clock.advance(5000);
  assert.equal(f.launcher.notices.getSnapshot().length, 0);
});

await test('notification preference changes at save acknowledgement and can be reenabled', async () => {
  const f = await fixture({ holdWrites: true });
  patchPreferences(f.launcher, { notifications: false });
  const saving = (await f.host.settle()).saveSettings();
  (await f.host.settle()).notify('before acknowledgement');
  f.writes[0].finish();
  assert.equal(await saving, true);
  let launcher = await f.host.settle();
  launcher.notify('suppressed after save');
  assert.deepEqual(f.notifications, [{ error: false, message: 'before acknowledgement' }]);
  f.server.config.settings.personalization.notifications = true;
  const enabling = launcher.reloadConfig();
  await f.host.settle();
  f.configReads[1].finish();
  await enabling;
  launcher = await f.host.settle();
  launcher.notify('suppressed after save');
  assert.equal(
    f.notifications.at(-1).message,
    'suppressed after save',
    'suppressed toasts must not enter the deduplication window',
  );
});

await test('disabled history is not read, including an unsaved retain-logs draft', async () => {
  const f = await fixture();
  patchPreferences(f.launcher, { retain_logs: true });
  f.emitLog({ level: 'info', message: 'live log' });
  const launcher = await f.host.settle();
  assert.equal(f.historyReads.length, 0);
  assert.deepEqual(messages(launcher), ['live log']);
});

await test('startup history merges early and concurrent live logs and formats Unix seconds locally', async () => {
  const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
  f.emitLog({ level: 'info', message: 'before bootstrap' });
  assert.equal(f.historyReads.length, 0);
  f.configReads[0].finish();
  await f.host.settle();
  assert.equal(f.historyReads.length, 1, 'saved retention must request history');
  f.emitLog({ level: 'warning', message: 'during history' });
  f.historyReads[0].resolve([stored('previous session')]);
  const launcher = await f.host.settle();
  assert.deepEqual(messages(launcher), ['previous session', 'before bootstrap', 'during history']);
  assert.equal(
    launcher.logs[0].time,
    new Date('2024-01-01T00:00:00Z').toLocaleTimeString('zh-CN', { hour12: false }),
  );
  f.emitLog({ level: 'info', message: 'after history' });
  assert.equal(messages(await f.host.settle()).at(-1), 'after history');
});

await test('history merging retains the newest 500 records with live entries at the end', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  assert.equal(f.historyReads.length, 1);
  for (let i = 0; i < 8; i++) f.emitLog({ level: 'info', message: `live ${i}` });
  f.historyReads[0].resolve(Array.from({ length: 500 }, (_, i) => stored(`past ${i}`)));
  const launcher = await f.host.settle();
  assert.equal(launcher.logs.length, 500);
  assert.equal(launcher.logs[0].message, 'past 8');
  assert.deepEqual(
    messages(launcher).slice(-8),
    Array.from({ length: 8 }, (_, i) => `live ${i}`),
  );
});

await test('saving retention off invalidates pending history while retaining current live logs', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  assert.equal(f.historyReads.length, 1);
  f.emitLog({ level: 'info', message: 'current session' });
  patchPreferences(f.launcher, { retain_logs: false });
  assert.equal(await (await f.host.settle()).saveSettings(), true);
  f.historyReads[0].resolve([stored('obsolete history')]);
  const launcher = await f.host.settle();
  assert.ok(messages(launcher).includes('current session'));
  assert.ok(!messages(launcher).includes('obsolete history'));
});

await test('history read failures remain visible even when completion notifications are disabled', async () => {
  const f = await fixture({ preferences: { retain_logs: true, notifications: false } });
  assert.equal(f.historyReads.length, 1);
  f.historyReads[0].reject(new Error('history unavailable'));
  const launcher = await f.host.settle();
  assert.deepEqual(f.notifications, [{ error: true, message: 'history unavailable' }]);
  assert.deepEqual(messages(launcher), ['history unavailable']);
});

for (const outcome of ['success', 'failure']) {
  await test(`unmount ignores a late history ${outcome}`, async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    assert.equal(f.historyReads.length, 1);
    f.host.unmount();
    if (outcome === 'success') f.historyReads[0].resolve([stored('obsolete')]);
    else f.historyReads[0].reject(new Error('obsolete error'));
    await f.host.settle();
    assert.equal(f.host.updatesAfterUnmount, 0);
    assert.deepEqual(f.notifications, []);
  });
}

await test('clear waits for real storage success and then removes existing memory logs', async () => {
  const f = await fixture();
  f.emitLog({ level: 'info', message: 'clear me' });
  const launcher = await f.host.settle();
  const clearing = launcher.clearLogs();
  assert.equal(f.clears.length, 1, 'clear must call storage even when retention is disabled');
  assert.ok(clearing instanceof Promise, 'clear exposes completion to its caller');
  assert.deepEqual(
    messages(await f.host.settle()),
    ['clear me'],
    'failed storage must not be disguised as a successful clear',
  );
  f.clears[0].resolve();
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), []);
});

await test('clear failure reports the error and preserves logs for retry', async () => {
  const f = await fixture({ preferences: { notifications: false } });
  f.emitLog({ level: 'info', message: 'keep me' });
  const clearing = (await f.host.settle()).clearLogs();
  assert.equal(f.clears.length, 1);
  f.clears[0].reject(new Error('cannot clear storage'));
  await clearing;
  const launcher = await f.host.settle();
  assert.deepEqual(messages(launcher), ['keep me', 'cannot clear storage']);
  assert.deepEqual(f.notifications, [{ error: true, message: 'cannot clear storage' }]);
});

await test('a late startup history response cannot restore cleared logs', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  assert.equal(f.historyReads.length, 1);
  f.emitLog({ level: 'info', message: 'old live' });
  const clearing = (await f.host.settle()).clearLogs();
  assert.equal(f.clears.length, 1);
  f.clears[0].resolve();
  await clearing;
  f.emitLog({ level: 'info', message: 'new live' });
  f.historyReads[0].resolve([stored('stale history')]);
  assert.deepEqual(messages(await f.host.settle()), ['new live']);
});

for (const outcome of ['success', 'failure']) {
  await test(`unmount ignores a late clear ${outcome}`, async () => {
    const f = await fixture();
    const clearing = f.launcher.clearLogs();
    assert.equal(f.clears.length, 1);
    f.host.unmount();
    if (outcome === 'success') f.clears[0].resolve();
    else f.clears[0].reject(new Error('obsolete clear'));
    await clearing;
    assert.equal(f.host.updatesAfterUnmount, 0);
    assert.deepEqual(f.notifications, []);
  });
}

await test('first successful configuration fixes startupPage through later saves and reloads', async () => {
  const f = await fixture({ preferences: { startup_page: 'logs' }, holdBootstrap: true });
  assert.equal(f.launcher.startupPage, 'home');
  f.configReads[0].finish();
  let launcher = await f.host.settle();
  assert.equal(launcher.startupPage, 'logs');
  patchPreferences(launcher, { startup_page: 'instances' });
  assert.equal(await (await f.host.settle()).saveSettings(), true);
  launcher = await f.host.settle();
  assert.equal(launcher.startupPage, 'logs');
  f.server.config.settings.personalization.startup_page = 'downloads';
  const reloading = launcher.reloadConfig();
  await f.host.settle();
  f.configReads[1].finish();
  await reloading;
  launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.personalization.startup_page, 'downloads');
  assert.equal(launcher.startupPage, 'logs');
});

await test('an obsolete bootstrap cannot capture the startup page for the current lifecycle', async () => {
  const f = await fixture({ preferences: { startup_page: 'logs' }, holdBootstrap: true });
  f.server.config.settings.personalization.startup_page = 'accounts';
  f.host.reconnectEffects();
  f.configReads[0].finish();
  await f.host.settle();
  f.configReads[1].finish();
  const launcher = await f.host.settle();
  assert.equal(launcher.startupPage, 'accounts');
});

await test('effect reconnect does not overwrite an already captured startup page', async () => {
  const f = await fixture({ preferences: { startup_page: 'content' } });
  assert.equal(f.launcher.startupPage, 'content');
  f.server.config.settings.personalization.startup_page = 'settings';
  f.host.reconnectEffects();
  f.configReads[1].finish();
  const launcher = await f.host.settle();
  assert.equal(launcher.startupPage, 'content');
});

await test('reconnecting effects does not insert the same restored history twice', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  f.historyReads[0].resolve([stored('one historical record')]);
  assert.deepEqual(messages(await f.host.settle()), ['one historical record']);
  f.host.reconnectEffects();
  f.configReads[1].finish();
  await f.host.settle();
  f.historyReads[1]?.resolve([stored('one historical record')]);
  assert.deepEqual(messages(await f.host.settle()), ['one historical record']);
});

await test('saving retention on loads history only after the saved acknowledgement', async () => {
  const f = await fixture({ holdWrites: true });
  patchPreferences(f.launcher, { retain_logs: true });
  const saving = (await f.host.settle()).saveSettings();
  await f.host.settle();
  assert.equal(f.historyReads.length, 0);
  f.writes[0].finish();
  assert.equal(await saving, true);
  await f.host.settle();
  assert.equal(f.historyReads.length, 1);
  f.historyReads[0].resolve([stored('earlier session')]);
  assert.equal(messages(await f.host.settle())[0], 'earlier session');
});

await test('reenabling retention after successful restoration does not duplicate history', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  f.historyReads[0].resolve([stored('one historical record')]);
  let launcher = await f.host.settle();
  patchPreferences(launcher, { retain_logs: false });
  await (await f.host.settle()).saveSettings();
  launcher = await f.host.settle();
  patchPreferences(launcher, { retain_logs: true });
  await (await f.host.settle()).saveSettings();
  await f.host.settle();
  f.historyReads[1]?.resolve([stored('one historical record')]);
  launcher = await f.host.settle();
  assert.equal(
    messages(launcher).filter((message) => message === 'one historical record').length,
    1,
  );
});

await test('a late historical read failure stays silent after retention is saved off', async () => {
  const f = await fixture({ preferences: { retain_logs: true, notifications: false } });
  patchPreferences(f.launcher, { retain_logs: false });
  await (await f.host.settle()).saveSettings();
  f.historyReads[0].reject(new Error('disabled history failed'));
  const launcher = await f.host.settle();
  assert.deepEqual(f.notifications, []);
  assert.ok(!messages(launcher).includes('disabled history failed'));
});

await test('a clear cancels pending history failures while it waits for storage', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  const clearing = f.launcher.clearLogs();
  f.historyReads[0].reject(new Error('cancelled history failed'));
  await f.host.settle();
  assert.deepEqual(f.notifications, []);
  f.clears[0].resolve();
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), []);
});

await test('a successful clear stays empty when effects reconnect later', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  const clearing = f.launcher.clearLogs();
  f.clears[0].resolve();
  await clearing;
  f.host.reconnectEffects();
  f.configReads[1].finish();
  await f.host.settle();
  f.historyReads[0].resolve([stored('obsolete original snapshot')]);
  f.historyReads[1]?.resolve([stored('obsolete reconnected snapshot')]);
  assert.deepEqual(messages(await f.host.settle()), []);
});

await test('concurrent clear requests share storage work and cannot erase logs after completion', async () => {
  const f = await fixture();
  const first = f.launcher.clearLogs();
  const second = f.launcher.clearLogs();
  assert.equal(f.clears.length, 1, 'one pending clear must own the disk operation');
  f.clears[0].resolve();
  await first;
  f.emitLog({ level: 'info', message: 'after clear' });
  await second;
  assert.deepEqual(messages(await f.host.settle()), ['after clear']);
  const third = f.launcher.clearLogs();
  assert.equal(f.clears.length, 2, 'completion must release a later deliberate clear');
  f.clears[1].resolve();
  await third;
  assert.deepEqual(messages(await f.host.settle()), []);
});

await test('history started during a pending clear cannot restore logs after storage succeeds', async () => {
  const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
  const clearing = f.launcher.clearLogs();
  f.configReads[0].finish();
  await f.host.settle();
  assert.equal(f.historyReads.length, 1);
  f.clears[0].resolve();
  await clearing;
  f.historyReads[0].resolve([stored('read during clear')]);
  assert.deepEqual(messages(await f.host.settle()), []);
});

for (const outcome of ['success', 'failure']) {
  await test(`a reconnected lifecycle ignores an obsolete clear ${outcome}`, async () => {
    const f = await fixture();
    const clearing = f.launcher.clearLogs();
    f.host.reconnectEffects();
    f.configReads[1].finish();
    await f.host.settle();
    f.emitLog({ level: 'info', message: 'new lifecycle log' });
    if (outcome === 'success') f.clears[0].resolve();
    else f.clears[0].reject(new Error('obsolete clear failure'));
    await clearing;
    assert.deepEqual(messages(await f.host.settle()), ['new lifecycle log']);
    assert.deepEqual(f.notifications, []);
  });
}

await test('overlapping disk history and live events render each shared identity only once', async () => {
  const f = await fixture({ preferences: { retain_logs: true }, holdBootstrap: true });
  const first = f.emitLog({ level: 'info', message: 'repeated game message' });
  const second = f.emitLog({ level: 'info', message: 'repeated game message' });
  f.configReads[0].finish();
  await f.host.settle();
  f.historyReads[0].resolve([stored('legacy history'), first, second]);
  const launcher = await f.host.settle();
  assert.deepEqual(messages(launcher), [
    'legacy history',
    'repeated game message',
    'repeated game message',
  ]);
});

await test('a delayed live event already in the disk snapshot does not create a duplicate', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  const first = { ...stored('same text'), id: { session: 'current-session', sequence: '1' } };
  f.historyReads[0].resolve([first]);
  await f.host.settle();
  f.emitLog(first);
  f.emitLog({ ...first, id: { ...first.id, sequence: '2' } });
  assert.deepEqual(messages(await f.host.settle()), ['same text', 'same text']);
});

await test('clear acknowledgement preserves records after its server boundary and rejects late older events', async () => {
  const f = await fixture();
  const old = f.emitLog({ level: 'info', message: 'old record' });
  const clearing = (await f.host.settle()).clearLogs();
  const fresh = f.emitLog({ level: 'info', message: 'after server clear' });
  f.clears[0].resolve(old.id);
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), ['after server clear']);
  f.emitLog(old);
  f.emitLog(fresh);
  f.emitLog({ level: 'info', message: 'after server clear' });
  assert.deepEqual(messages(await f.host.settle()), ['after server clear', 'after server clear']);
});

await test('a server clear removes prior sessions and legacy history without clearing newer records', async () => {
  const f = await fixture({ preferences: { retain_logs: true } });
  f.historyReads[0].resolve([
    stored('legacy without identity'),
    { ...stored('earlier process'), id: { session: 'previous-session', sequence: '999999' } },
  ]);
  const clearing = (await f.host.settle()).clearLogs();
  f.emitLog({ level: 'info', message: 'new record' });
  f.clears[0].resolve({ session: 'current-session', sequence: '0' });
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), ['new record']);
});

await test('clear sequence comparisons preserve precision beyond JavaScript safe integers', async () => {
  const f = await fixture();
  f.emitLog({
    ...stored('before boundary'),
    id: { session: 'current-session', sequence: '9007199254740992' },
  });
  const clearing = (await f.host.settle()).clearLogs();
  f.emitLog({
    ...stored('after boundary'),
    id: { session: 'current-session', sequence: '9007199254740993' },
  });
  f.clears[0].resolve({ session: 'current-session', sequence: '9007199254740992' });
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), ['after boundary']);
});

await test('a local error reported during a pending clear remains visible after acknowledgement', async () => {
  const f = await fixture();
  f.launcher.reportError(new Error('old local error'));
  const clearing = (await f.host.settle()).clearLogs();
  f.launcher.reportError(new Error('new local error'));
  f.clears[0].resolve({ session: 'current-session', sequence: '0' });
  await clearing;
  assert.deepEqual(messages(await f.host.settle()), ['new local error']);
});

await test('startup history waits until live subscription is established so no records fall into a gap', async () => {
  const f = await fixture({ preferences: { retain_logs: true }, holdSubscription: true });
  assert.equal(
    f.historyReads.length,
    0,
    'take the snapshot only after live delivery is established',
  );
  f.subscription.resolve();
  await f.host.settle();
  assert.equal(f.historyReads.length, 1);
  const live = f.emitLog({ level: 'info', message: 'overlapping live record' });
  f.historyReads[0].resolve([stored('before subscription'), live]);
  assert.deepEqual(messages(await f.host.settle()), [
    'before subscription',
    'overlapping live record',
  ]);
});

for (const timing of ['before snapshot', 'after snapshot']) {
  await test(`an old live record arriving ${timing} cannot evict newer retained records`, async () => {
    const f = await fixture({ preferences: { retain_logs: true } });
    const oldest = { ...stored('record 1'), id: { session: 'current-session', sequence: '1' } };
    if (timing === 'before snapshot') f.emitLog(oldest);
    f.historyReads[0].resolve(
      Array.from({ length: 500 }, (_, i) => ({
        ...stored(`record ${i + 2}`),
        id: { session: 'current-session', sequence: String(i + 2) },
      })),
    );
    await f.host.settle();
    if (timing === 'after snapshot') f.emitLog(oldest);
    const launcher = await f.host.settle();
    assert.equal(launcher.logs.length, 500);
    assert.equal(launcher.logs[0].message, 'record 2');
    assert.equal(launcher.logs.at(-1).message, 'record 501');
  });
}
