import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, openEditor } from './lib/ui-browser-fixture.mjs';
const artifacts = resolve(
  import.meta.dirname,
  '../../.test-data/launcher-public-api-browser',
  process.env.PARADOX_LAUNCHER_EVIDENCE || '.',
);
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const report = {
  checks: [],
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  const editor = await openEditor(page);
  await page.keyboard.press('Control+Enter');
  assert.equal(await page.getByRole('dialog', { name: '选择启动身份', exact: true }).count(), 0);
  await editor.locator('header button').click();
  await page.keyboard.press('Control+Enter');
  await page
    .getByRole('dialog', { name: '选择启动身份', exact: true })
    .waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: '选择启动身份', exact: true })
    .waitFor({ state: 'hidden' });
  pass('global_launch_shortcut_is_blocked_while_normal_editor_is_open');
  if (!process.env.PARADOX_TEST_NATIVE_CSP)
    await page.evaluate(async () => {
      if (!window.mountLauncherFixture) {
        const entry = document.querySelector('script[type="module"][src*="/src/main.tsx"]');
        const { root } = await import(entry.src);
        const { installLauncherFixture } = await import('/src/ui-tests/launcher-view-fixture.tsx');
        installLauncherFixture(root);
      }
    });
  await page.waitForFunction(() => typeof window.mountLauncherFixture === 'function');
  await page.evaluate(() => {
    window.foundationDesktop.accounts.accounts = [];
    window.mountLauncherAppFixture();
  });
  await page.waitForFunction(() => window.launcherFixture.views.a?.snapshot.accounts.ready);
  await page.evaluate(() => window.launcherFixture.views.a.actions.accounts.reload());
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.accounts.state.accounts.length === 0,
  );
  await page.evaluate(() => {
    window.appOwnerActions = window.launcherFixture.views.a.actions;
    window.beforeAppReplacement = window.foundationDesktop.calls.length;
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    window.suiteCommands = { holds: new Set(), held: [] };
    native.invoke = async (command, args) => {
      const value = await invoke(command, args);
      if (window.suiteCommands.holds.delete(command))
        return new Promise((resolve, reject) =>
          window.suiteCommands.held.push({ command, resolve: () => resolve(value), reject }),
        );
      return value;
    };
  });
  await page.evaluate(() => window.launcherFixture.replaceApp());
  await page.locator('[data-app-replacement]').waitFor();
  report.shortcutContext = await page.evaluate(() => ({
    snapshot: window.launcherFixture.views.a.snapshot,
    focused: document.activeElement?.tagName,
  }));
  await page.evaluate(() => {
    window.foundationDesktop.calls = [];
  });
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(100);
  report.shortcutAfter = await page.evaluate(() => ({
    snapshot: window.launcherFixture.views.a.snapshot,
    calls: window.foundationDesktop.calls,
  }));
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'launch_instance').length,
    ),
    1,
    'shortcut_survives_app_replacement: permanent installed/ready dispatch must survive actual App unmount',
  );
  pass('shortcut_survives_app_replacement');
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.actions === window.appOwnerActions),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.foundationDesktop.calls.filter((x) =>
        ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(
          x.command,
        ),
      ),
    ),
    [],
  );
  const finishLaunch = async () => {
    await page.evaluate(() =>
      window.foundationDesktop.emit('launcher://activity', {
        action: 'launch',
        status: 'finished',
        message: 'Done',
      }),
    );
    await page.waitForFunction(
      () => window.launcherFixture.views.a.snapshot.launch.phase === 'idle',
    );
  };
  await finishLaunch();
  report.fix1Install = await page.evaluate(async () => {
    const actions = window.launcherFixture.views.a.actions;
    const results = [];
    for (const status of ['running', 'cancelling']) {
      window.foundationDesktop.calls = [];
      window.foundationDesktop.emit('launcher://activity', {
        action: 'launch',
        status,
        message: status,
      });
      results.push({
        gate: status,
        accepted: await actions.downloads.install('original-instance'),
        calls: window.foundationDesktop.calls.filter((x) => x.command === 'enqueue_install').length,
      });
    }
    window.foundationDesktop.emit('launcher://activity', {
      action: 'launch',
      status: 'finished',
      message: 'Done',
    });
    window.foundationDesktop.calls = [];
    window.foundationDesktop.emit('launcher://downloads', [
      {
        id: 'same',
        kind: 'install',
        profile_key: 'original-instance',
        status: 'running',
        name: 'Same',
        message: '',
        progress: null,
      },
    ]);
    results.push({
      gate: 'same-profile',
      accepted: await actions.downloads.install('original-instance'),
      calls: window.foundationDesktop.calls.filter((x) => x.command === 'enqueue_install').length,
    });
    window.foundationDesktop.emit('launcher://downloads', []);
    window.foundationDesktop.calls = [];
    const repair = await Promise.all([
      actions.downloads.install('original-instance'),
      actions.downloads.install('original-instance'),
    ]);
    return {
      results,
      repair,
      repairCalls: window.foundationDesktop.calls.filter((x) => x.command === 'enqueue_install')
        .length,
    };
  });
  assert.deepEqual(report.fix1Install, {
    results: [
      { gate: 'running', accepted: false, calls: 0 },
      { gate: 'cancelling', accepted: false, calls: 0 },
      { gate: 'same-profile', accepted: false, calls: 0 },
    ],
    repair: [true, false],
    repairCalls: 1,
  });
  pass('fix1_replacement_public_install_current_game_task_guards_and_repair_dedup');
  report.fix1Shortcut = await page.evaluate(async () => {
    const actions = window.launcherFixture.views.a.actions;
    const dispatch = () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    window.foundationDesktop.config.profiles[0].game_version = '1.20.1';
    await actions.config.reload();
    window.foundationDesktop.calls = [];
    const renderedDownload = window.launcherFixture.views.a.snapshot.downloads.active;
    window.foundationDesktop.emit('launcher://downloads', [
      { id: 'other', kind: 'java', status: 'running', name: 'Java', message: '', progress: null },
    ]);
    dispatch();
    const blockedInstallCalls = window.foundationDesktop.calls.filter(
      (x) => x.command === 'enqueue_install',
    ).length;
    window.foundationDesktop.emit('launcher://downloads', []);
    window.foundationDesktop.config.profiles[0].game_version = '1.21.1';
    window.foundationDesktop.config.settings.personalization.shortcuts = false;
    await actions.config.reload();
    window.foundationDesktop.calls = [];
    dispatch();
    const blockedLaunchCalls = window.foundationDesktop.calls.filter(
      (x) => x.command === 'launch_instance',
    ).length;
    window.foundationDesktop.config.settings.personalization.shortcuts = true;
    await actions.config.reload();
    return { renderedDownload, blockedInstallCalls, blockedLaunchCalls };
  });
  assert.deepEqual(report.fix1Shortcut, {
    renderedDownload: false,
    blockedInstallCalls: 0,
    blockedLaunchCalls: 0,
  });
  pass('fix1_replacement_shortcut_current_download_event_and_saved_preference_ACK');
  const blockedShortcut = async (name) => {
    await page.evaluate(() => {
      window.foundationDesktop.calls = [];
    });
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(30);
    assert.equal(
      await page.evaluate(
        () => window.foundationDesktop.calls.filter((x) => x.command === 'launch_instance').length,
      ),
      0,
      name,
    );
    pass(`replacement_shortcut_blocks_${name}`);
  };
  await page.getByRole('textbox', { name: 'Replacement typing' }).focus();
  await blockedShortcut('typing');
  await page.getByRole('textbox', { name: 'Replacement typing' }).evaluate((node) => node.blur());
  const replacementEditor = await openEditor(page);
  await blockedShortcut('editor');
  await replacementEditor.locator('header button').click();
  await replacementEditor.waitFor({ state: 'hidden' });
  for (const [command, action, ready] of [
    ['account_state', 'reload', () => !window.launcherFixture.views.a.snapshot.accounts.ready],
    ['select_account', 'select', () => window.launcherFixture.views.a.snapshot.accounts.pending],
    ['save_config', 'save', () => window.launcherFixture.views.a.snapshot.settings.saving],
  ]) {
    await page.evaluate(
      ({ command, action }) => {
        window.suiteCommands.holds.add(command);
        const actions = window.launcherFixture.views.a.actions;
        window.heldAction =
          action === 'save'
            ? actions.settings.save()
            : action === 'select'
              ? actions.accounts.select(null)
              : actions.accounts.reload();
      },
      { command, action },
    );
    await page.waitForFunction(ready);
    await blockedShortcut(
      command === 'account_state'
        ? 'account_not_ready'
        : command === 'select_account'
          ? 'account_pending'
          : 'config_pending',
    );
    await page.waitForFunction(() => window.suiteCommands.held.length > 0);
    await page.evaluate(async () => {
      window.suiteCommands.held.shift().resolve();
      await window.heldAction;
    });
  }
  await page.evaluate(() =>
    window.foundationDesktop.emit('launcher://downloads', [
      { id: 'block', kind: 'java', name: 'Java', status: 'running', message: '', progress: null },
    ]),
  );
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.downloads.active);
  await blockedShortcut('download');
  await page.evaluate(() => window.foundationDesktop.emit('launcher://downloads', []));
  await page.waitForFunction(() => !window.launcherFixture.views.a.snapshot.downloads.active);
  await page.evaluate(() => window.launcherFixture.views.a.actions.profileDraft.openCreate());
  await blockedShortcut('domain_modal');
  await page.evaluate(() => window.launcherFixture.views.a.actions.profileDraft.cancel());
  await page.evaluate(() => {
    window.foundationDesktop.backgroundPending = true;
    window.pick = window.launcherFixture.views.a.actions.settings.chooseBackground();
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.settings.choosingBackground,
  );
  await blockedShortcut('picker');
  await page.evaluate(async () => {
    window.foundationDesktop.releaseBackground(null);
    await window.pick;
    window.foundationDesktop.backgroundPending = false;
  });
  await page.evaluate(() =>
    window.foundationDesktop.emit('launcher://close-requested', {
      game_running: false,
      downloads_active: false,
    }),
  );
  await page.waitForFunction(() => window.launcherFixture.views.a.snapshot.window.request !== null);
  await blockedShortcut('close_request');
  await page.evaluate(() => window.launcherFixture.views.a.actions.window.respondToClose('stay'));
  for (const status of ['running', 'cancelling']) {
    await page.evaluate(
      (status) =>
        window.foundationDesktop.emit('launcher://activity', {
          action: 'launch',
          status,
          message: status,
        }),
      status,
    );
    await page.waitForFunction(
      (status) => window.launcherFixture.views.a.snapshot.launch.phase === status,
      status,
    );
    await blockedShortcut(status);
  }
  await finishLaunch();
  await page.evaluate(() =>
    window.launcherFixture.views.a.actions.settings.patchPersonalization('shortcuts', false),
  );
  await page.evaluate(() => {
    window.foundationDesktop.calls = [];
  });
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() =>
    window.foundationDesktop.calls.some((x) => x.command === 'launch_instance'),
  );
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'launch_instance').length,
    ),
    1,
  );
  await finishLaunch();
  await page.evaluate(() => window.launcherFixture.views.a.actions.settings.save());
  await blockedShortcut('saved_shortcuts_disabled');
  await page.evaluate(async () => {
    const a = window.launcherFixture.views.a.actions;
    a.settings.patchPersonalization('shortcuts', true);
    await a.settings.save();
  });
  await page.evaluate(async () => {
    window.foundationDesktop.config.active_profile = null;
    await window.launcherFixture.views.a.actions.config.reload();
  });
  await blockedShortcut('missing_active_profile');
  await page.evaluate(async () => {
    window.foundationDesktop.config.active_profile = 'original-instance';
    await window.launcherFixture.views.a.actions.config.reload();
  });
  await page.evaluate(() => {
    window.foundationDesktop.calls = [];
    for (const patch of [
      { repeat: true },
      { isComposing: true },
      { metaKey: true },
      { shiftKey: true },
    ])
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          ...patch,
        }),
      );
    document.body.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'launch_instance').length,
    ),
    0,
  );
  pass('replacement_shortcut_preserves_saved_preference_and_keyboard_cancellation_guards');
  await page.evaluate(() => window.launcherFixture.restore());
  await page.locator('.app-shell').waitFor();
  await page.evaluate(() =>
    window.launcherFixture.views.a.actions.instanceDraft.open('original-instance'),
  );
  const instanceDialog = page.getByRole('dialog', { name: '实例设置', exact: true });
  await instanceDialog.waitFor();
  await instanceDialog.getByRole('button', { name: '添加环境变量', exact: true }).click();
  await instanceDialog
    .getByRole('textbox', { name: '变量 1 的值', exact: true })
    .fill('unfinished');
  await page.evaluate(() => {
    window.beforeInstanceReplacement = window.foundationDesktop.calls.length;
  });
  await page.evaluate(() => window.launcherFixture.replaceInstance());
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator('[data-instance-replacement]').count(),
    1,
    'instance replacement must preserve its per-profile customization identity',
  );
  await page.locator('[data-instance-replacement]').waitFor();
  assert.equal(
    await page.getByRole('textbox', { name: 'Replacement environment value' }).inputValue(),
    'unfinished',
  );
  await page.getByRole('textbox', { name: 'Replacement environment key' }).fill('TEST_VALUE');
  await page
    .getByRole('textbox', { name: 'Replacement environment value' })
    .fill('continued\nvalue=x');
  await page.evaluate(() => window.launcherFixture.restore());
  await instanceDialog.waitFor();
  assert.equal(
    await instanceDialog.getByRole('textbox', { name: '变量 1 的值', exact: true }).inputValue(),
    'continued\nvalue=x',
  );
  assert.equal(
    await instanceDialog.getByRole('textbox', { name: '变量 1 的名称', exact: true }).inputValue(),
    'TEST_VALUE',
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.foundationDesktop.calls
        .slice(window.beforeInstanceReplacement)
        .filter((x) =>
          ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(
            x.command,
          ),
        ),
    ),
    [],
  );
  await instanceDialog.getByRole('button', { name: '保存实例设置', exact: true }).click();
  await instanceDialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.config.profiles[0].overrides.environment.TEST_VALUE,
    ),
    'continued\nvalue=x',
  );
  pass('drafts_survive_view_switch_real_instance_dialog_replacement_restore_and_continued_edit');
  await page.evaluate(() => {
    window.foundationDesktop.accounts.accounts = [
      { id: 'account-a', name: 'Alex', skin_url: null },
      { id: 'account-b', name: 'Steve', skin_url: null },
    ];
  });
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__;
    const invoke = native.invoke;
    const transform = native.transformCallback;
    const listeners = new Set();
    const callbacks = new Map();
    window.launcherOwnership = { listeners, callbacks, holdRead: false, held: [] };
    native.transformCallback = (callback, once) => {
      const id = transform(callback, once);
      callbacks.set(id, callback);
      return id;
    };
    native.invoke = async (command, args) => {
      if (command === 'get_config' && window.launcherOwnership.holdRead) {
        window.launcherOwnership.holdRead = false;
        const old = await invoke(command, args);
        return new Promise((resolve, reject) =>
          window.launcherOwnership.held.push({ resolve: () => resolve(old), reject }),
        );
      }
      const value = await invoke(command, args);
      if (command === 'plugin:event|listen') listeners.add(value);
      if (command === 'plugin:event|unlisten') listeners.delete(args.eventId);
      return value;
    };
    window.foundationDesktop.calls = [];
    window.foundationDesktop.accounts.refresh_token = 'GROUP_SECRET';
    for (const account of window.foundationDesktop.accounts.accounts) {
      account.access_token = 'ACCESS_SECRET';
      account.refresh_token = 'REFRESH_SECRET';
    }
    window.mountLauncherFixture(false);
  });
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.b?.snapshot.config.ready &&
      window.launcherFixture.views.b?.snapshot.accounts.ready,
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      bootstraps: window.foundationDesktop.calls.filter((x) => x.command === 'get_config').length,
      accounts: window.foundationDesktop.calls.filter((x) => x.command === 'account_state').length,
      recovery: window.foundationDesktop.calls.filter((x) => x.command === 'account_recovery')
        .length,
      active: window.launcherOwnership.listeners.size,
      sameActions:
        window.launcherFixture.views.a.actions === window.launcherFixture.views.b.actions,
      unmarkedProvider: window.launcherFixture.unmarkedProvider,
      secrets: JSON.stringify(window.launcherFixture.views.a.snapshot).includes('SECRET'),
    })),
    {
      bootstraps: 1,
      accounts: 1,
      recovery: 1,
      active: 5,
      sameActions: true,
      unmarkedProvider: true,
      secrets: false,
    },
  );
  pass('two_real_context_consumers_one_bootstrap_account_batch_and_five_native_listeners');
  report.aliasRuntime = await page.evaluate(() => window.launcherFixture.aliasRuntime);
  report.aliasTargets = await page.evaluate(() =>
    window.launcherFixture
      .targets()
      .filter((target) =>
        /businesshost|environmenthost|localnamespacehost|localcustomizationhost/i.test(target),
      ),
  );
  assert.deepEqual(report.aliasRuntime, {
    namedBusiness: true,
    localBusiness: true,
    chainedBusiness: true,
    localCustomization: true,
    namedEnvironment: true,
    directNamespace: true,
    localEnvironment: true,
    chainedEnvironment: true,
    localNamespace: true,
  });
  assert.deepEqual(report.aliasTargets, []);
  pass('immutable_local_private_aliases_preserve_actual_JSX_runtime_original_types');
  await page.evaluate(() => {
    window.sharedActions = window.launcherFixture.views.a.actions;
    window.beforeReplaceCalls = window.foundationDesktop.calls.length;
    window.sharedActions.settings.patch('memory_mb', 6144);
    window.sharedActions.navigation.setSearch('unfinished shared search');
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.b.snapshot.settings.draft.memory_mb === 6144,
  );
  await page.evaluate(() => window.launcherFixture.replace());
  await page.locator('[data-view="replacement"]').waitFor();
  await page.waitForFunction(
    () => window.launcherFixture.views.b.snapshot.settings.draft.memory_mb === 6144,
  );
  const after = await page.evaluate(() => ({
    memory: window.launcherFixture.views.b.snapshot.settings.draft.memory_mb,
    search: window.launcherFixture.views.b.snapshot.navigation.search,
    stable:
      window.launcherFixture.views.a.actions === window.sharedActions &&
      window.launcherFixture.views.b.actions === window.sharedActions,
    calls: window.foundationDesktop.calls
      .slice(window.beforeReplaceCalls)
      .filter((x) =>
        ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(
          x.command,
        ),
      ),
    active: window.launcherOwnership.listeners.size,
    privateTargets: window.launcherFixture
      .targets()
      .filter((x) =>
        /businesshost|launcherprovider|customizationprovider|environmenthost|uifoundationprovider|localnamespacehost|localcustomizationhost/i.test(
          x,
        ),
      ),
    visibleTargets: window.launcherFixture
      .targets()
      .filter((x) => /test\.launcher\.view|control.button|layout.app|node.main.app/.test(x)),
  }));
  assert.equal(after.memory, 6144);
  assert.equal(after.search, 'unfinished shared search');
  assert.equal(after.stable, true);
  assert.deepEqual(after.calls, []);
  assert.equal(after.active, 5);
  assert.deepEqual(after.privateTargets, []);
  assert.ok(after.visibleTargets.length >= 3);
  report.afterReplacement = after;
  pass('actual_compiled_public_view_replacement_preserves_draft_search_actions_and_owner');
  await page.evaluate(() => window.launcherFixture.restore());
  await page.locator('[data-view="builtin"]').waitFor();
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.b.actions === window.sharedActions),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.b.snapshot.navigation.search),
    'unfinished shared search',
  );
  pass('consumer_restore_remount_preserves_unfinished_shared_query');
  await page.evaluate(() => {
    window.foundationDesktop.calls = [];
    window.mountLauncherFixture(true);
  });
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.b?.snapshot.accounts.ready &&
      window.launcherOwnership.listeners.size === 5,
  );
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'get_config').length,
    ),
    process.env.PARADOX_TEST_NATIVE_CSP ? 1 : 2,
  );
  pass(
    process.env.PARADOX_TEST_NATIVE_CSP
      ? 'production_StrictMode_wrapper_keeps_five_live_listeners'
      : 'real_React_StrictMode_cleanup_keeps_five_live_listeners',
  );
  // A pending old owner reload cannot publish success/failure into a fresh owner.
  for (const failure of [false, true]) {
    await page.evaluate(() => {
      window.launcherOwnership.holdRead = true;
      window.oldReload = window.launcherFixture.views.a.actions.config.reload();
    });
    await page.waitForFunction(() => window.launcherOwnership.held.length > 0);
    await page.evaluate((failure) => {
      window.mountLauncherFixture(failure);
    }, failure);
    await page.waitForFunction(
      () =>
        window.launcherFixture.views.b?.snapshot.config.ready &&
        window.launcherOwnership.listeners.size === 5,
    );
    await page.evaluate(async (failure) => {
      const held = window.launcherOwnership.held.shift();
      if (failure) held.reject(new Error('old owner failure'));
      else held.resolve();
      await window.oldReload;
    }, failure);
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.settings.draft.memory_mb),
      4096,
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.config.fatal),
      null,
    );
  }
  pass('fresh_provider_isolates_old_pending_config_result');
  for (const failure of [false, true]) {
    await page.evaluate(() => {
      window.launcherOwnership.holdRead = true;
      window.mountLauncherFixture(false);
    });
    await page.waitForFunction(() => window.launcherOwnership.held.length > 0);
    await page.evaluate(() => window.mountLauncherFixture(true));
    await page.waitForFunction(
      () =>
        window.launcherFixture.views.b?.snapshot.config.ready &&
        window.launcherOwnership.listeners.size === 5,
    );
    await page.evaluate((failure) => {
      const held = window.launcherOwnership.held.shift();
      if (failure) held.reject(new Error('old bootstrap failure'));
      else held.resolve();
    }, failure);
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.settings.draft.memory_mb),
      4096,
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.config.fatal),
      null,
    );
  }
  pass('fresh_real_provider_ignores_late_old_bootstrap_success_and_failure');
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#987654';
    ctx.fillRect(0, 0, 64, 64);
    const skin = canvas.toDataURL('image/png');
    window.task3 = {
      lists: [],
      searches: [],
      holdList: false,
      holdSearch: false,
      javaSupported: true,
    };
    native.invoke = async (command, args = {}) => {
      const task = window.task3;
      if (
        [
          'account_skin',
          'list_content',
          'search_content',
          'discover_java',
          'inspect_java',
          'choose_java',
          'enqueue_java',
        ].includes(command)
      ) {
        window.foundationDesktop.calls.push({ command, args: structuredClone(args) });
        if (command === 'account_skin') return skin;
        if (command === 'list_content') {
          const value = [
            {
              name: `${args.key}-${args.category}.jar`,
              category: args.category,
              size: 2048,
              enabled: true,
              record: null,
            },
          ];
          if (task.holdList) return new Promise((resolve) => task.lists.push({ args, resolve }));
          return value;
        }
        if (command === 'search_content') {
          const value = {
            hits: [
              {
                project_id: 'pack',
                title: args.query,
                description: 'Fixture pack',
                project_type: 'modpack',
                downloads: 42,
              },
            ],
            total_hits: 60,
            offset: args.offset,
          };
          if (task.holdSearch)
            return new Promise((resolve) => task.searches.push({ args, resolve }));
          return value;
        }
        if (command === 'discover_java')
          return { installations: [], warnings: [], download_supported: task.javaSupported };
        if (command === 'choose_java') return 'C:/raw-java';
        if (command === 'inspect_java')
          return {
            executable: 'C:/canonical/java.exe',
            java_home: 'C:/canonical',
            major_version: 21,
            version: '21',
            vendor: 'Fixture',
            architecture: 'x64',
            source: 'manual',
          };
        return {
          id: `java-${args.majorVersion}`,
          kind: 'java',
          name: 'Java',
          status: 'completed',
          message: '',
          progress: null,
        };
      }
      return invoke(command, args);
    };
    window.foundationDesktop.accounts.accounts = [
      { id: 'account-a', name: 'Alex', skin_url: 'fixture-skin-source' },
    ];
    window.foundationDesktop.accounts.active = 'account-a';
    window.foundationDesktop.calls = [];
    window.mountLauncherAppFixture();
  });
  await page.waitForFunction(() => window.launcherFixture.views.a?.snapshot.avatars['account-a']);
  assert.equal(await page.locator('[data-shared-avatar]').count(), 2);
  await page.evaluate(() => window.launcherFixture.views.a.actions.navigation.navigate('accounts'));
  await page.locator('.account-grid').waitFor();
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'account_skin').length,
    ),
    1,
  );
  await page.evaluate(() => {
    window.task3Actions = window.launcherFixture.views.a.actions;
    window.task3Actions.accounts.patchClientId('client-draft-survives');
    window.task3Actions.java.patchDownloadMajor('8x');
    window.task3Actions.content.patchSearch({ query: 'unfinished-content' });
    window.task3Actions.navigation.navigate('content', { profileKey: 'original-instance' });
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.list?.entries.length === 1,
  );
  const beforeCopies = await page.evaluate(() => window.foundationDesktop.calls.length);
  await page.evaluate(() => window.launcherFixture.copyDomains());
  await page.locator('[data-domain-copies]').waitFor();
  await page.waitForTimeout(50);
  assert.deepEqual(
    await page.evaluate(
      (start) =>
        window.foundationDesktop.calls
          .slice(start)
          .filter((x) =>
            [
              'list_content',
              'search_content',
              'account_skin',
              'get_config',
              'account_state',
              'plugin:event|listen',
            ].includes(x.command),
          ),
      beforeCopies,
    ),
    [],
  );
  pass('task3_real_copied_domain_views_share_one_content_request_and_avatar_cache');
  await page.evaluate(() => window.launcherFixture.replaceDomains());
  await page.locator('[data-domain-replacement="content"]').first().waitFor();
  assert.equal(
    await page.getByLabel('Replacement content query').first().inputValue(),
    'unfinished-content',
  );
  assert.equal(
    await page.getByLabel('Replacement client ID').inputValue(),
    'client-draft-survives',
  );
  assert.equal(await page.getByLabel('Replacement Java major').inputValue(), '8x');
  await page.getByLabel('Replacement content query').first().fill('replacement-search');
  await page.getByRole('button', { name: 'Replacement search', exact: true }).first().click();
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.b.snapshot.content.results?.hits[0]?.title ===
      'replacement-search',
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.b.actions === window.task3Actions),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'search_content').length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'account_skin').length,
    ),
    1,
  );
  pass('task3_compiled_content_account_and_java_replacements_retain_drafts_and_current_actions');
  await page.evaluate(async () => {
    const a = window.task3Actions;
    window.task3MajorResults = await Promise.all([
      a.java.downloadEnteredMajor(),
      a.downloads.java(7),
      a.downloads.java(100),
    ]);
    await a.java.chooseForSettings();
  });
  assert.deepEqual(await page.evaluate(() => window.task3MajorResults), [false, false, false]);
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.a.snapshot.settings.draft.java_executable ===
      'C:/canonical/java.exe',
  );
  await page.evaluate(async () => {
    window.task3.javaSupported = false;
    await window.task3Actions.java.discover();
    window.task3Unsupported = await window.task3Actions.downloads.java(21);
  });
  assert.equal(await page.evaluate(() => window.task3Unsupported), false);
  pass('task3_browser_java_direct_guard_and_choose_inspect_canonical_path');
  await page.evaluate(() => {
    window.task3.holdList = true;
    window.task3Actions.content.setCategory('resourcepacks');
  });
  await page.waitForFunction(() => window.task3.lists.length === 1);
  await page.evaluate(() => window.task3Actions.content.setCategory('shaderpacks'));
  await page.waitForFunction(() => window.task3.lists.length === 2);
  await page.evaluate(() =>
    window.task3.lists[0].resolve([
      { name: 'obsolete', category: 'resourcepacks', size: 1, enabled: true, record: null },
    ]),
  );
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.content.list),
    null,
  );
  await page.evaluate(() =>
    window.task3.lists[1].resolve([
      { name: 'current', category: 'shaderpacks', size: 1, enabled: true, record: null },
    ]),
  );
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.content.list?.entries[0]?.name === 'current',
  );
  pass('task3_real_renderer_excludes_late_old_content_category_response');
  await page.evaluate(() => {
    window.task3.holdList = false;
  });
  const beforeFault = fixture.observedPageErrors.length;
  await page.evaluate(() => window.launcherFixture.replaceDomains(true));
  await page.locator('.content-layout').first().waitFor();
  await page.evaluate(() => window.task3Actions.content.refresh());
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.a.snapshot.content.list?.entries[0]?.name ===
      'original-instance-shaderpacks.jar',
  );
  report.expectedViewFaults = fixture.observedPageErrors.splice(beforeFault);
  assert.ok(
    report.expectedViewFaults.every((message) => message.includes('Task3 controlled view fault')),
  );
  await page.evaluate(() => window.launcherFixture.restore());
  await page.locator('.content-layout').first().waitFor();
  assert.equal(
    await page.evaluate(() => window.launcherFixture.views.a.snapshot.accounts.clientIdDraft),
    'client-draft-survives',
  );
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.calls.filter((x) => x.command === 'account_skin').length,
    ),
    1,
  );
  pass('task3_rendered_view_fault_falls_back_and_same_permanent_controller_continues_querying');
  if (!process.env.PARADOX_TEST_NATIVE_CSP) {
    const base = process.env.PARADOX_UI_URL || 'http://127.0.0.1:1421';
    const modules = {};
    for (const name of [
      'main.tsx',
      'ui-tests/launcher-view-fixture.tsx',
      'launcher/LauncherProvider.tsx',
      'App.tsx',
    ]) {
      const response = await fetch(`${base}/src/${name}`);
      assert.equal(response.status, 200);
      modules[name] = await response.text();
      await writeFile(
        resolve(artifacts, name.replaceAll('/', '-') + '.transformed.txt'),
        modules[name],
      );
    }
    assert.doesNotMatch(
      modules['main.tsx'],
      /data-ui-node[^\n]*(?:launcherprovider|customizationprovider)/i,
    );
    assert.doesNotMatch(
      modules['ui-tests/launcher-view-fixture.tsx'],
      /data-ui-node[^\n]*(?:businesshost|environmenthost|customizationprovider|uifoundationprovider|localnamespacehost|localcustomizationhost)/i,
    );
    assert.doesNotMatch(modules['launcher/LauncherProvider.tsx'], /data-ui-node|data-ui-view/);
    assert.match(modules['main.tsx'], /data-ui-node[^\n]*app/i);
    assert.match(modules['App.tsx'], /data-ui-node/);
    assert.match(modules['ui-tests/launcher-view-fixture.tsx'], /data-ui-node[^\n]*localbutton/i);
    pass('actual_Vite_private_and_aliased_callsite_exclusion_visible_App_remains_instrumented');
  } else {
    assert.ok(report.csp);
    assert.deepEqual(fixture.observedSourceModuleRequests, []);
    pass('compiled_foundation_test_harness_under_exact_native_CSP_without_source_requests');
  }
  assert.deepEqual(fixture.observedPageErrors, []);
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(
    resolve(
      artifacts,
      process.env.PARADOX_TEST_NATIVE_CSP ? 'report-production-csp.json' : 'report-dev.json',
    ),
    JSON.stringify(report, null, 2),
  );
  await fixture.close();
}
