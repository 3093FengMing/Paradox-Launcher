// Run with: node ui/scripts/check-config-reload.mjs
// Exercises the real Hook with controlled IPC responses; no network or sleeps.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  deferred,
  hookHost,
  importedProfile,
  initialConfig,
  loadApp,
  profile,
  uiRoot,
} from './lib/hook-test-host.mjs';

async function fixture({
  holdWrites = false,
  holdBootstrap = false,
  downloads = false,
  holdTaskSnapshot = false,
} = {}) {
  const host = hookHost();
  const reads = [];
  const writes = [];
  const notifications = [];
  const finishedTasks = [];
  const refreshes = [];
  const taskSnapshot = deferred();
  let emitDownloads;
  const server = { config: structuredClone(initialConfig), config_path: 'initial.json' };
  const app = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          getConfig: () => {
            const response = deferred();
            const snapshot = structuredClone(server);
            reads.push({ ...response, finish: () => response.resolve(snapshot) });
            if (reads.length === 1 && !holdBootstrap) response.resolve(snapshot);
            return response.promise;
          },
          saveConfig: (submitted) => {
            const response = deferred();
            const config = structuredClone(submitted);
            const write = {
              ...response,
              config,
              commit: () => (server.config = structuredClone(config)),
              acknowledge: () => response.resolve(structuredClone(config)),
              finish: () => {
                write.commit();
                write.acknowledge();
              },
            };
            writes.push(write);
            if (!holdWrites) write.finish();
            return response.promise;
          },
          inspectInstances: async () => [],
          subscribe: async () => () => {},
          subscribeDownloads: async (onTasks) => {
            emitDownloads = onTasks;
            return () => {};
          },
          downloadTasks: () => taskSnapshot.promise,
        },
      ],
    ]),
    {
      onNotice: (notice) =>
        notifications.push({ error: notice.kind === 'error', message: notice.message }),
    },
  );
  const { useLauncher } = app('hooks/useLauncher.ts');
  const { useDownloadQueue } = app('hooks/useDownloadQueue.ts');
  let currentLauncher;
  const onFinished = (task) => {
    finishedTasks.push(task);
    if (task.kind === 'pack') {
      refreshes.push(currentLauncher.reloadConfig().then(currentLauncher.scan));
    }
  };
  host.mount(() => {
    currentLauncher = useLauncher();
    if (!downloads) return currentLauncher;
    const downloadQueue = useDownloadQueue(currentLauncher.reportError, onFinished);
    return { ...currentLauncher, downloadQueue };
  });
  if (!holdTaskSnapshot) taskSnapshot.resolve([]);
  const launcher = await host.settle();
  if (holdBootstrap) {
    assert.equal(launcher.bootstrap, null);
    assert.equal(
      launcher.getSettingsDraft(),
      null,
      'current draft remains null before accepted bootstrap',
    );
  } else assert.equal(launcher.bootstrap.config.settings.memory_mb, 4096);
  return {
    host,
    launcher,
    server,
    reads,
    writes,
    notifications,
    finishedTasks,
    refreshes,
    taskSnapshot,
    emitDownloads,
  };
}

await test('d13_current_draft_is_detached_and_synchronous: initial, generic/nested patches and reset share one owner', async () => {
  const f = await fixture();
  const owner = f.launcher;
  assert.equal(typeof owner.getSettingsDraft, 'function');
  assert.equal(owner.getSettingsDraft().memory_mb, 4096);
  const detached = owner.getSettingsDraft();
  detached.memory_mb = 1;
  detached.personalization.font = 'detached';
  assert.equal(owner.getSettingsDraft().memory_mb, 4096);
  assert.notEqual(owner.getSettingsDraft().personalization.font, 'detached');
  owner.patchSettings('java_executable', 'manual-before-render');
  owner.patchAppearance('theme', 'light');
  owner.patchPersonalization('font', 'arial');
  assert.equal(owner.getSettingsDraft().java_executable, 'manual-before-render');
  assert.equal(owner.getSettingsDraft().appearance.theme, 'light');
  assert.equal(owner.getSettingsDraft().personalization.font, 'arial');
  assert.equal(
    owner.draft.java_executable,
    initialConfig.settings.java_executable,
    'rendered draft may still lag',
  );
  owner.resetSettings();
  assert.deepEqual(owner.getSettingsDraft(), initialConfig.settings);
  f.host.unmount();
});

await test('d13_current_draft_reload_and_held_ACK: resets and conditional settings/account merges remain current before render', async () => {
  const f = await fixture({ holdWrites: true });
  const owner = f.launcher;
  assert.equal(typeof owner.getSettingsDraft, 'function');
  owner.patchSettings('java_executable', 'C:/submitted-path/java.exe');
  const first = owner.saveSettings();
  await f.host.settle();
  assert.equal(
    f.writes[0].config.settings.java_executable,
    'C:/submitted-path/java.exe',
    'save samples the current owner draft',
  );
  f.writes[0].config.settings.java_executable = 'C:/accepted-path/java.exe';
  f.writes[0].finish();
  assert.equal(await first, true);
  assert.equal(
    owner.getSettingsDraft().java_executable,
    'C:/accepted-path/java.exe',
    'matching ACK commits current normalized settings',
  );
  owner.patchSettings('java_executable', 'C:/second-submission/java.exe');
  const second = owner.saveSettings();
  await f.host.settle();
  owner.patchSettings('java_executable', 'C:/newer-unrendered-path/java.exe');
  owner.patchAppearance('theme', 'light');
  f.writes[1].finish();
  assert.equal(await second, true);
  assert.equal(owner.getSettingsDraft().java_executable, 'C:/newer-unrendered-path/java.exe');
  assert.equal(owner.getSettingsDraft().appearance.theme, 'light');
  owner.patchSettings('offline_username', 'DraftPlayer');
  const account = owner.saveAccount();
  await f.host.settle();
  owner.patchPersonalization('font', 'arial');
  f.writes[2].config.settings.offline_username = 'AckPlayer';
  f.writes[2].finish();
  assert.equal(await account, true);
  assert.equal(owner.getSettingsDraft().offline_username, 'AckPlayer');
  assert.equal(owner.getSettingsDraft().java_executable, 'C:/newer-unrendered-path/java.exe');
  assert.equal(owner.getSettingsDraft().personalization.font, 'arial');
  const laterAccount = owner.saveAccount();
  await f.host.settle();
  owner.patchSettings('offline_username', 'LaterPlayer');
  f.writes[3].config.settings.offline_username = 'OldAck';
  f.writes[3].finish();
  assert.equal(await laterAccount, true);
  assert.equal(owner.getSettingsDraft().offline_username, 'LaterPlayer');
  f.server.config.settings.memory_mb = 6144;
  const reload = owner.reloadConfig();
  await f.host.settle();
  owner.patchSettings('memory_mb', 8192);
  f.reads[1].finish();
  await reload;
  assert.equal(
    owner.getSettingsDraft().memory_mb,
    8192,
    'reload preserves an unsaved current draft',
  );
  owner.resetSettings();
  assert.equal(
    owner.getSettingsDraft().memory_mb,
    6144,
    'reset reads the acknowledged reloaded config before render',
  );
  const snapshots = owner.setSnapshots(true);
  await f.host.settle();
  owner.patchSettings('java_executable', 'C:/manual-with-snapshot-ACK/java.exe');
  f.writes[4].finish();
  await snapshots;
  assert.equal(owner.getSettingsDraft().show_snapshots, true);
  assert.equal(owner.getSettingsDraft().java_executable, 'C:/manual-with-snapshot-ACK/java.exe');
  f.server.config.appearance_presets = [
    {
      id: 'd13-apply',
      name: 'Existing preset',
      appearance: { ...initialConfig.settings.appearance, theme: 'light' },
    },
  ];
  const presetReload = owner.reloadConfig();
  await f.host.settle();
  f.reads[2].finish();
  await presetReload;
  owner.applyAppearancePreset('d13-apply');
  assert.equal(
    owner.getSettingsDraft().appearance.theme,
    'light',
    'existing preset application commits through the same synchronous draft path',
  );
  assert.equal(owner.getSettingsDraft().java_executable, 'C:/manual-with-snapshot-ACK/java.exe');
  f.host.unmount();
});

await test('reload then save: a delayed pack snapshot cannot replace new settings or lose the pack', async () => {
  const f = await fixture();
  f.server.config.profiles.push(structuredClone(importedProfile));
  f.server.config_path = 'reloaded.json';
  const reloading = f.launcher.reloadConfig();
  await f.host.settle();
  f.launcher.patchSettings('memory_mb', 8192);
  const saving = (await f.host.settle()).saveSettings();
  await f.host.settle();
  f.reads[1].finish();
  assert.equal((await Promise.all([reloading, saving]))[1], true);
  let launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.memory_mb, 8192);
  assert.deepEqual(
    f.server.config.profiles.map((item) => item.instance_key),
    ['original-instance', 'imported-pack'],
    'a later save must build on the reloaded pack registration',
  );
  assert.equal(launcher.bootstrap.config_path, 'reloaded.json');
  assert.equal(launcher.saving, false);
  launcher.resetSettings();
  launcher = await f.host.settle();
  assert.equal(launcher.draft.memory_mb, 8192, 'the acknowledged config ref must also be current');
});

await test('save then reload: the reload must read after the save acknowledgement', async () => {
  const f = await fixture({ holdWrites: true });
  f.launcher.patchSettings('memory_mb', 8192);
  const saving = (await f.host.settle()).saveSettings();
  await f.host.settle();
  const reloading = f.launcher.reloadConfig();
  await f.host.settle();
  assert.equal(f.reads.length, 1, 'reload IPC must wait for the pending save');
  f.writes[0].finish();
  assert.equal(await saving, true);
  let launcher = await f.host.settle();
  assert.equal(f.reads.length, 2);
  assert.equal(launcher.saving, true, 'the queue stays pending until the reload completes');
  f.reads[1].finish();
  await reloading;
  launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.memory_mb, 8192);
  assert.equal(launcher.saving, false);
});

await test('rapid reloads preserve invocation order and publish the latest registration', async () => {
  const f = await fixture();
  const first = f.launcher.reloadConfig();
  await f.host.settle();
  f.server.config.profiles.push(structuredClone(importedProfile));
  const second = f.launcher.reloadConfig();
  const third = f.launcher.reloadConfig();
  let launcher = await f.host.settle();
  assert.equal(f.reads.length, 2, 'only the first reload may be in flight');
  assert.equal(launcher.saving, true);
  f.reads[1].finish();
  await first;
  await f.host.settle();
  assert.equal(f.reads.length, 3);
  f.reads[2].finish();
  await second;
  await f.host.settle();
  assert.equal(f.reads.length, 4);
  f.reads[3].finish();
  await third;
  launcher = await f.host.settle();
  assert.deepEqual(
    launcher.bootstrap.config.profiles.map((item) => item.instance_key),
    ['original-instance', 'imported-pack'],
  );
  assert.equal(launcher.saving, false);
});

await test('a failed reload reports the failure and releases the following save', async () => {
  const f = await fixture();
  const reloading = f.launcher.reloadConfig();
  await f.host.settle();
  f.launcher.patchSettings('offline_username', 'NewPlayer');
  const saving = (await f.host.settle()).saveAccount();
  await f.host.settle();
  assert.equal(f.writes.length, 0, 'save must wait even when the pending reload will fail');
  f.reads[1].reject(new Error('controlled reload failure'));
  assert.equal((await Promise.all([reloading, saving]))[1], true);
  const launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.offline_username, 'NewPlayer');
  assert.equal(launcher.saving, false);
  assert.deepEqual(
    f.notifications.filter((item) => item.error),
    [{ error: true, message: 'controlled reload failure' }],
  );
  assert.ok(launcher.logs.some((item) => item.message === 'controlled reload failure'));
});

await test('a failed save does not prevent reload or the next configuration write', async () => {
  const f = await fixture({ holdWrites: true });
  f.launcher.patchSettings('memory_mb', 8192);
  const failedSave = (await f.host.settle()).saveSettings();
  await f.host.settle();
  const reloading = f.launcher.reloadConfig();
  await f.host.settle();
  f.writes[0].reject(new Error('controlled save failure'));
  assert.equal(await failedSave, false);
  await f.host.settle();
  f.reads[1].finish();
  await reloading;
  const selecting = (await f.host.settle()).selectProfile('original-instance');
  await f.host.settle();
  assert.equal(f.writes.length, 2);
  f.writes[1].finish();
  await selecting;
  const launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.memory_mb, 4096);
  assert.equal(launcher.draft.memory_mb, 8192, 'failed save must preserve the unsaved draft');
  assert.equal(launcher.saving, false);
  assert.deepEqual(
    f.notifications.filter((item) => item.error),
    [{ error: true, message: 'controlled save failure' }],
  );
});

await test('reload preserves settings edits made while its snapshot is pending', async () => {
  const f = await fixture();
  f.server.config.settings.memory_mb = 6144;
  const reloading = f.launcher.reloadConfig();
  await f.host.settle();
  f.launcher.patchSettings('memory_mb', 8192);
  f.launcher.patchSettings('offline_username', 'DraftPlayer');
  f.reads[1].finish();
  await reloading;
  const launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.memory_mb, 6144);
  assert.equal(launcher.draft.memory_mb, 8192);
  assert.equal(launcher.draft.offline_username, 'DraftPlayer');
});

for (const outcome of ['success', 'failure']) {
  await test(`unmount ignores a late reload ${outcome}`, async () => {
    const f = await fixture();
    const reloading = f.launcher.reloadConfig();
    await f.host.settle();
    f.host.unmount();
    if (outcome === 'success') f.reads[1].finish();
    else f.reads[1].reject(new Error('obsolete reload failure'));
    await reloading;
    assert.equal(f.host.updatesAfterUnmount, 0);
    assert.deepEqual(f.notifications, []);
  });
}

await test('unmount discards queued reloads before they issue another IPC request', async () => {
  const f = await fixture({ holdWrites: true });
  f.launcher.patchSettings('memory_mb', 8192);
  const saving = (await f.host.settle()).saveSettings();
  await f.host.settle();
  const reloading = f.launcher.reloadConfig();
  f.host.unmount();
  f.writes[0].finish();
  await f.host.settle();
  // Resolve an incorrectly issued read too, so the assertion exposes the bug
  // instead of leaving the old implementation waiting on an unowned request.
  if (f.reads[1]) f.reads[1].finish();
  assert.equal((await Promise.all([saving, reloading]))[0], false);
  assert.equal(f.reads.length, 1, 'an obsolete queued operation must not begin');
  assert.equal(f.host.updatesAfterUnmount, 0);
  assert.deepEqual(f.notifications, []);
});

await test('an obsolete save response cannot overwrite the next lifecycle configuration', async () => {
  const f = await fixture({ holdWrites: true });
  f.launcher.patchSettings('memory_mb', 8192);
  const saving = (await f.host.settle()).saveSettings();
  await f.host.settle();
  f.writes[0].commit();
  f.server.config.settings.memory_mb = 12288;
  f.server.config.profiles.push(structuredClone(importedProfile));
  f.host.reconnectEffects();
  f.reads[1].finish();
  await f.host.settle();
  f.writes[0].acknowledge();
  assert.equal(await saving, false);
  let launcher = await f.host.settle();
  launcher.resetSettings();
  launcher = await f.host.settle();
  assert.equal(launcher.draft.memory_mb, 12288, 'stale responses must not update configRef');
  assert.equal(
    launcher.getSettingsDraft().memory_mb,
    12288,
    'stale ACK must not update the current draft ref',
  );
  assert.equal(launcher.saving, false, 'old lifecycle operations must not hold the new UI busy');
  const selecting = launcher.selectProfile('imported-pack');
  await f.host.settle();
  assert.equal(f.writes[1].config.settings.memory_mb, 12288);
  assert.deepEqual(
    f.writes[1].config.profiles.map((item) => item.instance_key),
    ['original-instance', 'imported-pack'],
  );
  f.writes[1].finish();
  await selecting;
});

function packTask(status, id = 'pack-attempt') {
  return {
    id,
    kind: 'pack',
    name: 'Regression pack',
    profile_key: null,
    java_major: null,
    status,
    message: `Controlled ${status}`,
    progress: null,
  };
}

for (const status of ['completed', 'failed', 'cancelled']) {
  await test(`pack ${status}: synchronize the registered instance before the next save`, async () => {
    const f = await fixture({ downloads: true });
    // The desktop registers the retryable instance before installation, so all
    // three terminal outcomes can expose a configuration that the UI must read.
    f.server.config.profiles.push(structuredClone(importedProfile));
    const task = packTask(status);
    f.emitDownloads([task]);
    f.emitDownloads([task]);
    let launcher = await f.host.settle();
    assert.equal(f.reads.length, 2, `${status} must initiate exactly one configuration reload`);
    assert.equal(launcher.downloadQueue.tasks[0].status, status);
    assert.deepEqual(f.notifications, [], 'configuration synchronization is not install success');
    launcher.patchSettings('memory_mb', 8192);
    const saving = (await f.host.settle()).saveSettings();
    await f.host.settle();
    assert.equal(f.writes.length, 0, 'the new settings must wait for registered pack metadata');
    f.reads[1].finish();
    await Promise.all([...f.refreshes, saving]);
    launcher = await f.host.settle();
    assert.equal(launcher.bootstrap.config.settings.memory_mb, 8192);
    assert.deepEqual(
      f.server.config.profiles.map((item) => item.instance_key),
      ['original-instance', 'imported-pack'],
    );
    assert.equal(launcher.downloadQueue.tasks[0].status, status);
    assert.equal(
      f.finishedTasks.length,
      1,
      'repeated task snapshots must not repeat synchronization',
    );
    assert.equal(launcher.saving, false);
  });
}

await test('pending packs and unsuccessful non-pack tasks do not trigger completion effects', async () => {
  const f = await fixture({ downloads: true });
  for (const status of ['queued', 'running', 'cancelling']) {
    f.emitDownloads([packTask(status)]);
  }
  const unsuccessful = ['install', 'java', 'content'].flatMap((kind) =>
    ['failed', 'cancelled'].map((status) => ({
      ...packTask(status, `${kind}-${status}`),
      kind,
      profile_key: kind === 'java' ? null : profile.instance_key,
      java_major: kind === 'java' ? 21 : null,
    })),
  );
  f.emitDownloads(unsuccessful);
  await f.host.settle();
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.finishedTasks, []);
  f.emitDownloads(
    unsuccessful
      .filter((task) => task.status === 'failed')
      .map((task) => ({ ...task, status: 'completed' })),
  );
  await f.host.settle();
  assert.equal(f.finishedTasks.length, 3, 'successful non-pack completion behavior is retained');
});

await test('a new retry attempt synchronizes once after an earlier failed pack attempt', async () => {
  const f = await fixture({ downloads: true });
  const failed = packTask('failed');
  f.server.config.profiles.push(structuredClone(importedProfile));
  f.emitDownloads([failed]);
  await f.host.settle();
  assert.equal(f.reads.length, 2);
  f.reads[1].finish();
  await Promise.all(f.refreshes);
  const retry = packTask('completed', 'pack-retry');
  f.emitDownloads([failed, retry]);
  f.emitDownloads([failed, retry]);
  await f.host.settle();
  assert.equal(f.reads.length, 3, 'a new task id represents a new completed attempt');
  f.reads[2].finish();
  await Promise.all(f.refreshes);
  const launcher = await f.host.settle();
  assert.deepEqual(
    f.finishedTasks.map((task) => task.id),
    ['pack-attempt', 'pack-retry'],
  );
  assert.equal(launcher.bootstrap.config.profiles.length, 2);
});

for (const status of ['failed', 'cancelled']) {
  await test(`the initial task snapshot synchronizes an already ${status} pack`, async () => {
    const f = await fixture({ downloads: true, holdTaskSnapshot: true });
    f.server.config.profiles.push(structuredClone(importedProfile));
    f.taskSnapshot.resolve([packTask(status)]);
    await f.host.settle();
    assert.equal(f.reads.length, 2, 'terminal task recovery must also work without a live event');
    f.reads[1].finish();
    await Promise.all(f.refreshes);
    const launcher = await f.host.settle();
    assert.equal(launcher.bootstrap.config.profiles.length, 2);
    assert.equal(launcher.downloadQueue.tasks[0].status, status);
    assert.deepEqual(f.notifications, []);
  });
}

await test('a stale download snapshot cannot erase a pack terminal event or repeat its reload', async () => {
  const f = await fixture({ downloads: true, holdTaskSnapshot: true });
  f.server.config.profiles.push(structuredClone(importedProfile));
  f.emitDownloads([packTask('failed')]);
  await f.host.settle();
  assert.equal(f.reads.length, 2);
  f.reads[1].finish();
  await Promise.all(f.refreshes);
  f.taskSnapshot.resolve([]);
  const launcher = await f.host.settle();
  assert.equal(launcher.downloadQueue.tasks[0].status, 'failed');
  assert.equal(launcher.bootstrap.config.profiles.length, 2);
  assert.equal(f.reads.length, 2);
  assert.equal(f.finishedTasks.length, 1);
});

await test('a download event delivered after unmount cannot enqueue a configuration reload', async () => {
  const f = await fixture({ downloads: true });
  f.host.unmount();
  f.emitDownloads([packTask('cancelled')]);
  await f.host.settle();
  assert.equal(f.reads.length, 1);
  assert.deepEqual(f.finishedTasks, []);
  assert.equal(f.host.updatesAfterUnmount, 0);
});

await test('a pack terminal event during bootstrap reloads after the initial configuration arrives', async () => {
  const f = await fixture({ downloads: true, holdBootstrap: true });
  f.server.config.profiles.push(structuredClone(importedProfile));
  f.emitDownloads([packTask('failed')]);
  await f.host.settle();
  assert.equal(f.reads.length, 1, 'the reload must wait for the initial configuration');
  f.reads[0].finish();
  await f.host.settle();
  assert.equal(f.reads.length, 2, 'a terminal event received during loading must not be lost');
  f.reads[1].finish();
  await Promise.all(f.refreshes);
  const launcher = await f.host.settle();
  assert.deepEqual(
    launcher.bootstrap.config.profiles.map((item) => item.instance_key),
    ['original-instance', 'imported-pack'],
  );
  assert.equal(launcher.saving, false);
  assert.deepEqual(f.notifications, []);
});

await test('a superseded bootstrap response cannot replace the current lifecycle configuration', async () => {
  const f = await fixture({ holdBootstrap: true });
  f.server.config.settings.memory_mb = 12288;
  f.host.reconnectEffects();
  f.reads[1].finish();
  await f.host.settle();
  f.reads[0].finish();
  const launcher = await f.host.settle();
  assert.equal(launcher.bootstrap.config.settings.memory_mb, 12288);
  assert.equal(launcher.draft.memory_mb, 12288);
  assert.equal(
    launcher.getSettingsDraft().memory_mb,
    12288,
    'obsolete bootstrap cannot overwrite the current draft ref',
  );
  assert.equal(launcher.saving, false);
  assert.deepEqual(f.notifications, []);
});

await test('task4_atomic_templates_current_owner_validation_and_null_bootstrap', async () => {
  const waiting = await fixture({ holdBootstrap: true });
  const empty = await waiting.host.settle();
  let invoked = false;
  assert.equal(
    empty.updateArgumentTemplates(() => {
      invoked = true;
      return [];
    }),
    false,
  );
  assert.equal(invoked, false);
  waiting.host.unmount();
  const f = await fixture();
  const a = await f.host.settle();
  const template = {
    id: 'a72f88e2-a1ee-4a13-843c-49360b6e58a2',
    name: 'First',
    jvm: '',
    game: '',
    environment: {},
  };
  assert.equal(
    a.updateArgumentTemplates(() => [template]),
    true,
  );
  template.name = 'caller mutation';
  assert.equal(a.getSettingsDraft().argument_templates[0].name, 'First');
  const before = structuredClone(a.getSettingsDraft());
  assert.throws(() => a.updateArgumentTemplates(() => [{ ...template, name: '' }]));
  assert.deepEqual(a.getSettingsDraft(), before);
  a.patchAppearance('accent_color', '#123456');
  a.updateArgumentTemplates((current) => {
    a.patchPersonalization('font', 'serif');
    return current.map((x) => ({ ...x, name: 'Updated' }));
  });
  assert.equal(a.getSettingsDraft().personalization.font, 'serif');
  assert.equal(a.getSettingsDraft().appearance.accent_color, '#123456');
  assert.equal(a.getSettingsDraft().argument_templates[0].name, 'Updated');
  f.host.unmount();
});
await test('task4_preset_held_library_ack_and_queued_current_merge_preserve_unfinished_settings', async () => {
  const f = await fixture({ holdWrites: true });
  const a = await f.host.settle();
  a.patchAppearance('accent_color', '#123456');
  const first = a.saveAppearancePreset('First current');
  a.patchAppearance('accent_color', '#abcdef');
  a.patchPersonalization('font', 'serif');
  await f.host.settle();
  assert.equal(f.writes[0].config.appearance_presets[0].appearance.accent_color, '#123456');
  assert.deepEqual(f.writes[0].config.settings, initialConfig.settings);
  const second = a.saveAppearancePreset('Second current');
  const id = f.writes[0].config.appearance_presets[0].id;
  const rename = a.renameAppearancePreset(id, 'Queued rename');
  a.patchSettings('extra_game_arguments', '--unfinished');
  f.writes[0].finish();
  await first;
  await f.host.settle();
  assert.equal(f.writes[1].config.appearance_presets.length, 2);
  assert.equal(f.writes[1].config.appearance_presets[1].appearance.accent_color, '#abcdef');
  f.writes[1].finish();
  await second;
  await f.host.settle();
  assert.equal(f.writes[2].config.appearance_presets[0].name, 'Queued rename');
  f.writes[2].finish();
  await rename;
  assert.equal(a.getSettingsDraft().extra_game_arguments, '--unfinished');
  assert.equal(a.getSettingsDraft().personalization.font, 'serif');
  assert.equal(a.getSettingsDraft().appearance.accent_color, '#abcdef');
  assert.deepEqual(f.server.config.settings, initialConfig.settings);
  f.host.unmount();
});
