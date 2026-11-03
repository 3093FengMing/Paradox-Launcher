// Real permanent Provider with controlled IPC. View adapters below read its
// actual public React Context; replacement/lifecycle DOM evidence is in browser checks.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { deferred, hookHost, initialConfig, loadApp, uiRoot } from './hook-test-host.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
globalThis.window = {
  listeners: new Map(),
  addEventListener(name, fn) {
    const entries = this.listeners.get(name) ?? new Set();
    entries.add(fn);
    this.listeners.set(name, entries);
  },
  removeEventListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
export async function fixture({
  holdBootstrap = false,
  holdWrites = false,
  holdSubscriptions = false,
  accountFailure = false,
  holdAccounts = false,
  holdSelect = false,
  holdDomainWrites = false,
  desktop = true,
  initialRouteRegistry = 'builtin',
  config = initialConfig,
} = {}) {
  window.listeners.clear(); // Each isolated fixture owns its own event surface, including after RED failures.
  const host = hookHost();
  let renderingView = false;
  const reads = [],
    writes = [],
    subscriptions = [],
    backgrounds = [],
    directories = [],
    closes = [];
  const accountReads = [],
    recoveries = [];
  const server = {
    config: structuredClone(config),
    config_path: 'provider.json',
    javaSupported: true,
  };
  const counts = { scan: 0, java: 0, launch: 0, install: 0, imported: 0, removed: 0, catalog: 0 };
  const selections = [],
    loaderRequests = [],
    importScans = [],
    profileWrites = [],
    javaPicks = [];
  const domainWrites = [];
  const contentLists = [],
    contentSearches = [],
    contentMutations = [],
    skinRequests = [],
    javaInspections = [],
    javaDownloads = [],
    loginBegins = [],
    loginCompletions = [],
    loginCancels = [],
    promptOpens = [],
    logouts = [],
    packPicks = [],
    packEnqueues = [],
    contentEnqueues = [],
    exports = [];
  const hold = (array, args = {}) => {
    const response = deferred();
    array.push({ ...response, ...args });
    return response.promise;
  };
  const installKeys = [],
    launchKeys = [];
  const domainWrite = (kind) => {
    const response = deferred();
    domainWrites.push({ ...response, kind });
    if (!holdDomainWrites) response.resolve(structuredClone(server.config));
    return response.promise;
  };
  const accounts = {
    client_id: 'client',
    active: 'a',
    refresh_token: 'GROUP_SECRET',
    accounts: [
      {
        id: 'a',
        name: 'Alex',
        skin_url: null,
        refresh_token: 'ACCOUNT_SECRET',
        access_token: 'ACCESS_SECRET',
      },
    ],
  };
  const subscribe = (kind, callbacks) => {
    const registered = deferred();
    const item = {
      kind,
      callbacks,
      active: true,
      registered,
      finish: () =>
        registered.resolve(() => {
          item.active = false;
        }),
    };
    subscriptions.push(item);
    if (!holdSubscriptions) item.finish();
    return registered.promise;
  };
  const api = {
    desktop,
    catalog: async () => {
      counts.catalog++;
      return {
        versions: [],
        fetched_at: 0,
        source: 'cache',
        stale: false,
        warning: null,
        error_kind: null,
      };
    },
    getConfig() {
      const response = deferred();
      const snapshot = structuredClone(server);
      reads.push({ ...response, finish: () => response.resolve(snapshot) });
      if (!holdBootstrap || reads.length > 1) response.resolve(snapshot);
      return response.promise;
    },
    saveConfig(config) {
      const response = deferred();
      const value = structuredClone(config);
      const write = {
        ...response,
        config: value,
        finish: () => {
          server.config = value;
          response.resolve(structuredClone(value));
        },
      };
      writes.push(write);
      if (!holdWrites) write.finish();
      return response.promise;
    },
    inspectInstances: async () => {
      counts.scan++;
      return [
        {
          instance_key: 'original-instance',
          game_version: '1.21.1',
          loader: 'vanilla',
          loader_version: '',
          root: `${server.config.settings.game_directory}/versions/original-instance`,
        },
      ];
    },
    subscribe: (...callbacks) => subscribe('launcher', callbacks),
    subscribeDownloads: (...callbacks) => subscribe('downloads', callbacks),
    subscribeCloseRequests: (...callbacks) => subscribe('close', callbacks),
    downloadTasks: async () => [],
    accountState: () => {
      const response = deferred();
      accountReads.push(response);
      if (!accountFailure && !holdAccounts) response.resolve(structuredClone(accounts));
      else if (accountFailure)
        response.reject({ message: 'auth.failure', refresh_token: 'ERROR_SECRET' });
      return response.promise;
    },
    accountRecovery: () => {
      recoveries.push(1);
      return Promise.resolve([]);
    },
    selectAccount: (id) => {
      const response = deferred();
      selections.push({ ...response, id });
      if (!holdSelect) response.resolve({ ...accounts, active: id });
      return response.promise;
    },
    launchInstance: async (key) => {
      counts.launch++;
      launchKeys.push(key);
    },
    enqueueInstall: async (key) => {
      counts.install++;
      installKeys.push(key);
      return [];
    },
    loaderVersions: (loader, game) => {
      const response = deferred();
      loaderRequests.push({ ...response, loader, game });
      return response.promise;
    },
    scanImport: (directory) => {
      const response = deferred();
      importScans.push({ ...response, directory });
      return response.promise;
    },
    importInstances: () => {
      counts.imported++;
      return domainWrite('import');
    },
    removeProfile: () => {
      counts.removed++;
      return domainWrite('remove');
    },
    createProfile: (name, version, loader, loaderVersion) => {
      const response = deferred();
      profileWrites.push({ ...response, name, version, loader, loaderVersion });
      return response.promise;
    },
    updateProfile: (profile) => {
      const response = deferred();
      profileWrites.push({ ...response, profile });
      return response.promise;
    },
    chooseJava: () => {
      const response = deferred();
      javaPicks.push(response);
      return response.promise;
    },
    inspectJava: (path) => hold(javaInspections, { path }),
    enqueueJava: async (major) => {
      javaDownloads.push(major);
      return [];
    },
    listContent: (key, category) => hold(contentLists, { key, category }),
    searchContent: (query, kind, offset) => hold(contentSearches, { query, kind, offset }),
    toggleMod: (key, name) => hold(contentMutations, { key, name }),
    removeContent: (key, category, name) => hold(contentMutations, { key, category, name }),
    accountSkin: (id) => hold(skinRequests, { id }),
    beginLogin: (id) => hold(loginBegins, { id }),
    completeLogin: (id) => hold(loginCompletions, { id }),
    cancelLogin: (id) => hold(loginCancels, { id }),
    openLoginPage: (id) => hold(promptOpens, { id }),
    logoutAccount: (id) => hold(logouts, { id }),
    choosePack: () => hold(packPicks),
    enqueuePack: async (source, remote) => {
      packEnqueues.push({ source, remote });
      return {};
    },
    enqueueContent: async (key, project, kind) => {
      contentEnqueues.push({ key, project, kind });
      return {};
    },
    exportInstance: (key, includeSaves) => hold(exports, { key, includeSaves }),
    discoverJava: async () => {
      counts.java++;
      return { installations: [], warnings: [], download_supported: server.javaSupported };
    },
    chooseBackground: () => {
      const response = deferred();
      backgrounds.push(response);
      return response.promise;
    },
    chooseDirectory: () => {
      const response = deferred();
      directories.push(response);
      return response.promise;
    },
    readBackground: async () => 'data:image/png;base64,AQ==',
    closeLauncher: () => {
      const response = deferred();
      closes.push(response);
      return response.promise;
    },
    clearStoredLogs: async () => null,
  };
  const i18n = {
    t: (key) =>
      key === 'content.queued'
        ? 'Queued translated'
        : key === 'content.exported'
          ? i18n.language === 'zh-CN'
            ? 'Exported Chinese'
            : 'Exported translated'
          : key,
    language: 'en-US',
  };
  const app = loadApp(
    new Map([
      [
        'react',
        {
          ...React,
          ...Object.fromEntries(
            Object.entries(host.hooks).map(([key, hook]) => [
              key,
              (...args) => (renderingView ? React[key](...args) : hook(...args)),
            ]),
          ),
          useContext: (context) => (renderingView ? React.useContext(context) : { editing: false }),
        },
      ],
      ['react-i18next', { useTranslation: () => ({ t: (key) => key }) }],
      [
        resolve(uiRoot, 'src/i18n.ts'),
        {
          __esModule: true,
          default: i18n,
          applyLanguagePreference: async () => {},
          translateRuntimeMessage: (message) => message,
          getFormattingLocale: () => 'en-US',
        },
      ],
      [
        resolve(uiRoot, 'src/ui-runtime/window.ts'),
        {
          minimizeNativeWindow: async () => {},
          maximizeNativeWindow: async () => {},
          requestNativeWindowClose: async () => {},
          startNativeWindowDrag: async () => {},
        },
      ],
      [resolve(uiRoot, 'src/api.ts'), api],
      [
        resolve(uiRoot, 'src/lib/account-avatar.ts'),
        {
          createAccountAvatar: async (skin) => {
            if (skin === 'broken') throw new Error('corrupt');
            return `data:image/png;base64,${skin}`;
          },
        },
      ],
    ]),
  );
  const { LauncherProvider } = app('launcher/LauncherProvider.tsx');
  const snapshotHistory = [];
  const contexts = app('launcher/public/context.ts');
  const compatibility = app('launcher/compatibility.ts');
  // Captured-context adapter proves controlled provider ownership only. It does
  // not call consumers in a flat Hook host; real consumers are a browser test.
  const capture = (element) => {
    const values = new Map();
    while (React.isValidElement(element)) {
      values.set(element.type, element.props.value);
      element = element.props.children;
    }
    snapshotHistory.push(values.get(contexts.LauncherSnapshotContext.Provider));
    return {
      actions: values.get(contexts.LauncherActionsContext.Provider),
      snapshot: values.get(contexts.LauncherSnapshotContext.Provider),
      services: values.get(compatibility.CompatibilityContext.Provider).services,
      registry: [...values.values()].find(
        (value) => typeof value?.setActiveRouteRegistry === 'function',
      ),
    };
  };
  host.mount(() => capture(LauncherProvider({ children: null, initialRouteRegistry })));
  await host.settle();
  return {
    host,
    app,
    reads,
    writes,
    subscriptions,
    accountReads,
    recoveries,
    backgrounds,
    directories,
    closes,
    counts,
    server,
    accounts,
    selections,
    loaderRequests,
    importScans,
    profileWrites,
    javaPicks,
    domainWrites,
    installKeys,
    launchKeys,
    snapshotHistory,
    contentLists,
    contentSearches,
    contentMutations,
    skinRequests,
    javaInspections,
    javaDownloads,
    loginBegins,
    loginCompletions,
    loginCancels,
    promptOpens,
    logouts,
    packPicks,
    packEnqueues,
    contentEnqueues,
    exports,
    current: () => host.settle(),
    async renderView(file, props = {}) {
      const value = await host.settle();
      const Component = app(file).default;
      let tree;
      function Capture() {
        tree = Component(props);
        return null;
      }
      renderingView = true;
      try {
        renderToStaticMarkup(
          React.createElement(
            contexts.LauncherActionsContext.Provider,
            { value: value.actions },
            React.createElement(
              contexts.LauncherSnapshotContext.Provider,
              { value: value.snapshot },
              React.createElement(app('ui-editor/public.ts').UiEditorActionsContext.Provider,
                {value: {open() {}}}, React.createElement(Capture)),
            ),
          ),
        );
      } finally {
        renderingView = false;
      }
      return tree;
    },
  };
}
