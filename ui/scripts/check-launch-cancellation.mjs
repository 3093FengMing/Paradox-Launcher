// Run with: node ui/scripts/check-launch-cancellation.mjs
// Uses the installed compiler and React renderer; no test dependencies required.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp as loadHookApp } from './lib/hook-test-host.mjs';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { I18nextProvider } = require('react-i18next');

function loadApp(overrides = new Map()) {
  const cache = new Map();
  function load(file) {
    if (overrides.has(file)) return overrides.get(file);
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
    const module = { exports: {} };
    cache.set(file, module);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      transformers: {
        before: [
          (context) => {
            const visit = (node) =>
              ts.isMetaProperty(node)
                ? ts.factory.createObjectLiteralExpression()
                : ts.visitEachChild(node, visit, context);
            return (source) => ts.visitNode(source, visit);
          },
        ],
      },
    }).outputText;
    const localRequire = (name) => {
      if (overrides.has(name)) return overrides.get(name);
      if (!name.startsWith('.')) return require(name);
      const base = resolve(dirname(file), /\.css(?:\?|$)/.test(name) ? name.split('?')[0] : name);
      if (base.endsWith('.css')) return readFileSync(base, 'utf8');
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`].find(existsSync);
      assert.ok(target, `Cannot resolve ${name} from ${file}`);
      return load(target);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  }
  return (name) => load(resolve(uiRoot, 'src', name));
}

const profile = {
  instance_key: 'regression-instance',
  name: 'Regression world',
  game_version: '1.21.1',
  loader: 'vanilla',
  loader_version: '',
  game_directory: null,
  overrides: {},
};
const config = {
  schema_version: 1,
  profiles: [profile],
  active_profile: profile.instance_key,
  appearance_presets: [],
  settings: {
    language: 'zh-CN',
    offline_username: 'Player',
    game_directory: 'C:\\Games\\Regression',
    java_executable: '',
    memory_mb: 4096,
    minimum_memory_mb: 512,
    show_snapshots: false,
    resolution_width: 1280,
    resolution_height: 720,
    extra_jvm_arguments: '',
    extra_game_arguments: '',
    close_behavior: 'ask',
    network: {
      timeout_seconds: 30,
      max_concurrent_downloads: 8,
      max_retries: 3,
      proxy_url: '',
      mirror_url: '',
    },
    personalization: {
      background_file: '',
      background_fit: 'cover',
      font: 'system',
      startup_page: 'home',
      notifications: true,
      retain_logs: false,
      shortcuts: true,
      launch_shortcut: 'Ctrl+Enter',
    },
    argument_templates: [],
    appearance: {
      interface_style: 'immersive',
      theme: 'dark',
      accent_color: '#6387f5',
      border_radius: 14,
      ui_scale: 100,
      compact_sidebar: false,
      reduce_motion: false,
      background_art: true,
      background_blur: 0,
      background_dim: 8,
      sidebar_opacity: 62,
    },
  },
};
const activity = (status, action = 'launch') => ({
  action,
  status,
  message: status === 'cancelling' ? '正在停止启动或游戏进程' : '正在检查 Java 并构建启动命令',
});
const noop = () => {};
const app = loadApp();
const ActivityBar = app('components/ActivityBar.tsx').default;
const ImmersiveHome = app('components/ImmersiveHome.tsx').default;
const i18n = app('i18n.ts').default;

function controls(Component, busy) {
  const props =
    Component === ActivityBar
      ? { activity: busy, onStop: noop, onLogs: noop }
      : {
          config,
          active: profile,
          busy,
          queueActive: false,
          desktop: true,
          installed: true,
          onCreate: noop,
          onPage: noop,
          onSelect: noop,
          onLaunch: noop,
          onStop: noop,
          onCustomize: noop,
        };
  const html = renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n }, React.createElement(Component, props)),
  );
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([, attributes, content]) => ({ attributes, text: content.replace(/<[^>]*>/g, '') }),
  );
  return { html, buttons };
}

for (const Component of [ActivityBar, ImmersiveHome]) {
  const name = Component.name;
  const preparing = controls(Component, activity('started'));
  assert.ok(
    preparing.buttons.some(
      (button) => button.text === '取消启动' && !button.attributes.includes('disabled'),
    ),
    `${name}: preparing a launch must offer an enabled cancel button`,
  );
  const running = controls(Component, activity('running'));
  assert.ok(
    running.buttons.some(
      (button) => button.text === '停止游戏' && !button.attributes.includes('disabled'),
    ),
  );
  const cancelling = controls(Component, activity('cancelling'));
  assert.ok(
    cancelling.buttons.some(
      (button) => button.text === '正在停止…' && button.attributes.includes('disabled'),
    ),
  );
  assert.ok(cancelling.html.includes('正在停止启动或游戏进程'));
  if (Component === ImmersiveHome) {
    assert.ok(
      cancelling.buttons
        .find((button) => button.attributes.includes('immersive-launch-primary'))
        .attributes.includes('disabled'),
    );
    assert.ok(
      !controls(Component, null)
        .buttons.find((button) => button.attributes.includes('immersive-launch-primary'))
        .attributes.includes('disabled'),
    );
  }
}

const { isLaunchActive, canStopLaunch, isCancelling } = app('lib/activity.ts');
for (const [status, active, stoppable, cancelling] of [
  ['started', true, true, false],
  ['running', true, true, false],
  ['cancelling', true, false, true],
  ['finished', false, false, false],
  ['error', false, false, false],
]) {
  assert.equal(isLaunchActive(activity(status)), active);
  assert.equal(canStopLaunch(activity(status)), stoppable);
  assert.equal(isCancelling(activity(status)), cancelling);
  assert.equal(isLaunchActive(activity(status, 'install')), false);
  assert.equal(canStopLaunch(activity(status, 'install')), false);
}
assert.equal(isLaunchActive(null), false);
assert.equal(canStopLaunch(undefined), false);
assert.equal(isCancelling(null), false);

// The repository has no DOM or hook renderer dependency. This small host runs
// the real Hook with hosted state, refs, effects and dependency tracking. Desktop
// IPC and toast output use doubles; React lifecycle and DOM behavior are left
// to browser verification.
function hookHost() {
  const slots = [];
  let index = 0;
  let effects = [];
  let dirty = true;
  let current;
  let run;
  const changed = (a, b) =>
    !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const hooks = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[slot],
        (next) => {
          const value = typeof next === 'function' ? next(slots[slot]) : next;
          if (!Object.is(value, slots[slot])) {
            slots[slot] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (changed(slots[slot]?.deps, deps)) slots[slot] = { callback, deps };
      return slots[slot].callback;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (changed(slots[slot]?.deps, deps)) {
        effects.push(() => {
          slots[slot]?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  return {
    hooks,
    mount(callback) {
      run = callback;
    },
    async settle() {
      for (let turn = 0; turn < 10; turn++) {
        if (dirty) {
          dirty = false;
          index = 0;
          current = run();
          const pending = effects;
          effects = [];
          pending.forEach((effect) => effect());
        }
        await Promise.resolve();
      }
      return current;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const host = hookHost();
let emit;
let stopCalls = 0;
let launchCalls = 0;
let stop = deferred();
let launch = deferred();
const notifications = [];
const hookApp = loadHookApp(
  new Map([
    ['react', host.hooks],
    [
      resolve(uiRoot, 'src/api.ts'),
      {
        getConfig: async () => ({ config, config_path: 'regression.json' }),
        inspectInstances: async () => [],
        subscribe: async (onActivity) => {
          emit = onActivity;
          return noop;
        },
        stopGame: () => {
          stopCalls++;
          return stop.promise;
        },
        launchInstance: (key) => {
          assert.equal(key, profile.instance_key);
          launchCalls++;
          return launch.promise;
        },
      },
    ],
  ]),
  { onNotice: (notice) => notifications.push(notice.message) },
);
host.mount(hookApp('hooks/useLauncher.ts').useLauncher);
let launcher = await host.settle();
const starting = launcher.runAction('launch', profile);
launcher = await host.settle();
assert.equal(launcher.busy.status, 'started');
emit(activity('started'));
launcher = await host.settle();
const stopping = launcher.stopGame();
const duplicate = launcher.stopGame();
assert.equal(stopCalls, 1, 'rapid stop clicks must issue only one IPC request');
emit(activity('cancelling'));
launcher = await host.settle();
assert.equal(launcher.busy.status, 'cancelling');
await launcher.runAction('launch', profile);
assert.equal(launchCalls, 1, 'cancelling must prevent another launch');
stop.resolve();
await Promise.all([stopping, duplicate]);
launcher = await host.settle();
assert.equal(
  launcher.busy.status,
  'cancelling',
  'stop acknowledgment must not synthesize completion',
);
assert.deepEqual(
  notifications,
  [],
  'stop acknowledgment must not synthesize a success notification',
);
await launcher.stopGame();
assert.equal(stopCalls, 1, 'backend cancelling state must also prevent another stop request');
launch.reject(new Error('late launch response'));
await starting;
launcher = await host.settle();
assert.equal(
  launcher.busy.status,
  'cancelling',
  'late launch failure cannot clear backend-owned activity',
);
emit({ action: 'launch', status: 'finished', message: '启动已取消' });
launcher = await host.settle();
assert.equal(launcher.busy, null, 'backend terminal event must release busy');

emit(activity('running'));
launcher = await host.settle();
stop = deferred();
const failedStop = launcher.stopGame();
emit(activity('cancelling'));
launcher = await host.settle();
assert.equal(launcher.busy.status, 'cancelling');
emit({ ...activity('running'), message: '停止游戏失败，请重试' });
stop.reject(new Error('停止游戏失败，请重试'));
await failedStop;
launcher = await host.settle();
assert.equal(launcher.busy.status, 'running', 'stop failure must preserve backend activity');
assert.equal(launcher.busy.message, '停止游戏失败，请重试');
stop = deferred();
const retry = launcher.stopGame();
assert.equal(stopCalls, 3, 'failed stop must release the pending request guard');
emit({ action: 'launch', status: 'error', message: 'game exited' });
launcher = await host.settle();
assert.equal(launcher.busy, null);
stop.resolve();
await retry;

launcher = await host.settle();
launch = deferred();
const rejectedCommand = launcher.runAction('launch', profile);
launcher = await host.settle();
assert.equal(launcher.busy.status, 'started');
launch.reject(new Error('launch validation failed before registration'));
await rejectedCommand;
launcher = await host.settle();
assert.equal(
  launcher.busy,
  null,
  'command rejection before registration must release optimistic busy',
);

const originalAccounts = {
  client_id: '7fd2b4de-f119-4ab8-8d8e-906af5efe6f3',
  active: null,
  accounts: [],
};
const loggedInAccounts = {
  ...originalAccounts,
  active: 'regression-account',
  accounts: [{ id: 'regression-account', name: 'Regression player' }],
};
const loginPrompt = {
  id: 'regression-login',
  user_code: 'REGRESSION',
  verification_uri: 'https://www.microsoft.com/link',
  expires_at: 2000000000,
};

async function accountLoginFixture() {
  const host = hookHost();
  const completion = deferred();
  const cancellation = deferred();
  const errors = [];
  let cancelCalls = 0;
  let completionCalls = 0;
  const onError = (error) => errors.push(error);
  const accountApp = loadApp(
    new Map([
      ['react', host.hooks],
      [
        resolve(uiRoot, 'src/api.ts'),
        {
          accountState: async () => originalAccounts,
          accountRecovery: async () => [],
          beginLogin: async () => loginPrompt,
          completeLogin: (id) => {
            assert.equal(id, loginPrompt.id);
            completionCalls++;
            return completion.promise;
          },
          cancelLogin: (id) => {
            assert.equal(id, loginPrompt.id);
            cancelCalls++;
            return cancellation.promise;
          },
        },
      ],
    ]),
  );
  const { useAccounts } = accountApp('hooks/useAccounts.ts');
  host.mount(() => useAccounts(onError));
  let accounts = await host.settle();
  assert.equal(accounts.ready, true);
  const login = accounts.login();
  accounts = await host.settle();
  assert.equal(completionCalls, 1);
  assert.equal(accounts.pending, true);
  assert.equal(accounts.prompt, loginPrompt);
  const cancel = accounts.cancel();
  await accounts.cancel();
  assert.equal(cancelCalls, 1, 'concurrent account cancel clicks must share one IPC request');
  return { host, completion, cancellation, errors, login, cancel };
}

for (const outcome of ['cancelled', 'failed', 'successful']) {
  const fixture = await accountLoginFixture();
  fixture.cancellation.resolve();
  await fixture.cancel;
  let accounts = await fixture.host.settle();
  assert.equal(
    accounts.pending,
    true,
    `${outcome}: cancel acknowledgment must wait for final login completion`,
  );
  assert.equal(accounts.prompt, loginPrompt, `${outcome}: cancel acknowledgment must keep prompt`);
  assert.equal(accounts.state, originalAccounts);
  assert.deepEqual(fixture.errors, []);
  if (outcome === 'successful') fixture.completion.resolve(loggedInAccounts);
  else fixture.completion.reject(`auth.errors.${outcome === 'cancelled' ? 'cancelled' : 'vault'}`);
  assert.equal(await fixture.login, outcome === 'successful');
  accounts = await fixture.host.settle();
  assert.equal(accounts.pending, false, `${outcome}: final completion must release pending`);
  assert.equal(accounts.prompt, null, `${outcome}: final completion must clear prompt`);
  assert.equal(accounts.state, outcome === 'successful' ? loggedInAccounts : originalAccounts);
  assert.deepEqual(fixture.errors, outcome === 'failed' ? ['auth.errors.vault'] : []);
}

for (const acknowledgement of ['successful', 'failed']) {
  const fixture = await accountLoginFixture();
  fixture.completion.resolve(loggedInAccounts);
  assert.equal(await fixture.login, true);
  let accounts = await fixture.host.settle();
  assert.equal(accounts.pending, false);
  assert.equal(accounts.prompt, null);
  assert.equal(accounts.state, loggedInAccounts);
  if (acknowledgement === 'successful') fixture.cancellation.resolve();
  else fixture.cancellation.reject('auth.errors.service');
  await fixture.cancel;
  accounts = await fixture.host.settle();
  assert.equal(accounts.pending, false);
  assert.equal(accounts.prompt, null);
  assert.equal(
    accounts.state,
    loggedInAccounts,
    'late cancel acknowledgment must preserve the successful account state',
  );
  assert.deepEqual(
    fixture.errors,
    [],
    'late cancel failure must not report a completed login error',
  );
}

{
  const fixture = await accountLoginFixture();
  fixture.cancellation.reject('auth.errors.service');
  await fixture.cancel;
  let accounts = await fixture.host.settle();
  assert.deepEqual(fixture.errors, ['auth.errors.service']);
  assert.equal(accounts.pending, true, 'failed cancellation IPC must keep awaiting login result');
  assert.equal(accounts.prompt, loginPrompt);
  assert.equal(accounts.state, originalAccounts);
  fixture.completion.reject('auth.errors.cancelled');
  assert.equal(await fixture.login, false);
  accounts = await fixture.host.settle();
  assert.equal(accounts.pending, false);
  assert.equal(accounts.prompt, null);
  assert.equal(accounts.state, originalAccounts);
  assert.deepEqual(fixture.errors, ['auth.errors.service']);
}

for (const [language, stopFailure] of [
  ['zh-CN', '停止游戏失败，请重试'],
  ['en-US', 'Could not stop the game. Try again.'],
]) {
  await i18n.changeLanguage(language);
  const { translateRuntimeMessage } = app('i18n.ts');
  assert.equal(translateRuntimeMessage('停止游戏失败，请重试'), stopFailure);
  assert.equal(translateRuntimeMessage('启动已取消'), i18n.t('runtime.launchCancelled'));
  assert.equal(
    translateRuntimeMessage('正在停止启动或游戏进程'),
    i18n.t('runtime.cancellingLaunch'),
  );
  const warning = translateRuntimeMessage('auth.errors.rollback: secret-credential-diagnostic');
  assert.equal(warning, i18n.t('auth.errors.rollback'));
  assert.ok(!warning.includes('secret-credential-diagnostic'));
  for (const Component of [ActivityBar, ImmersiveHome]) {
    assert.ok(
      controls(Component, activity('started')).buttons.some(
        (button) => button.text === i18n.t('common.cancelLaunch'),
      ),
    );
    assert.ok(
      controls(Component, activity('cancelling')).buttons.some(
        (button) =>
          button.text === i18n.t('common.stopping') && button.attributes.includes('disabled'),
      ),
    );
  }
}
console.log(
  'Launch cancellation regression passed: both controls, helpers, IPC serialization, terminal events and bilingual messages.',
);
console.log(
  'Account login cancellation regression passed: 6 controlled scenarios for final-result ownership and late cancel acknowledgments.',
);
