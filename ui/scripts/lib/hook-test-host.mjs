// Controlled Hook host and TypeScript loader for deterministic UI regressions.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createFakeClock } from './fake-clock.mjs';

export const uiRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const ts = require('typescript');

export function loadApp(
  overrides = new Map(),
  { isolateCustomization = true, noticeClock = createFakeClock(), onNotice } = {},
) {
  // Business Hook tests call components directly with a controlled Hook host.
  // Keep that host focused on business state; real HOCs have separate runtime
  // and browser checks. Pass isolateCustomization:false for those integrations.
  const customizationPath = resolve(uiRoot, 'src/customization/Customizable.tsx');
  const customizationAdapter = { customComponent: (_target, Original) => Original };
  const cache = new Map();
  function load(file) {
    if (overrides.has(file)) return overrides.get(file);
    // Node checks do not render CSS; the browser fixture exercises actual styles.
    if (file.endsWith('.css')) return {};
    if (isolateCustomization && file === customizationPath) return customizationAdapter;
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
      // Node Hook checks have no Vite build plan; they exercise the lazy source compiler.
      if (name === 'virtual:ui-suite-graph-plans') return { compilerSignature: 'node-hook-host', plans: [] };
      if (name === '@paradox/launcher')
        return load(resolve(uiRoot, 'src/launcher/public/index.ts'));
      if (name === '@paradox/ui') return load(resolve(uiRoot, 'src/ui-foundation/index.ts'));
      if (!name.startsWith('.')) return require(name);
      const base = resolve(dirname(file), /\.css(?:\?|$)/.test(name) ? name.split('?')[0] : name);
      if (base.endsWith('.css') && name.includes('?inline')) return readFileSync(base, 'utf8');
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`].find(existsSync);
      assert.ok(target, `Cannot resolve ${name} from ${file}`);
      return load(target);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    // Exercise the real store while giving every Hook fixture controlled time.
    if (file === resolve(uiRoot, 'src/ui-runtime/notices.ts')) {
      const create = module.exports.createNoticeStore;
      module.exports.createNoticeStore = (clock = noticeClock) => {
        const store = create(clock), seen = new Set();
        store.subscribe(() => { for (const notice of store.getSnapshot()) if (!seen.has(notice.id)) { seen.add(notice.id); onNotice?.(notice); } });
        return store;
      };
    }
    return module.exports;
  }
  const app = (name) => load(resolve(uiRoot, 'src', name));
  app.noticeClock = noticeClock;
  return app;
}

// Real suite compilation/resolution for Node integration checks. Only browser
// blob-module loading is adapted; compiler, public modules and layer selection run unchanged.
export function suiteRenderHost(overrides = new Map()) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const app = loadApp(overrides, { isolateCustomization: false });
  const graphPath = resolve(uiRoot, 'src/ui-suite/module-graph-runtime.ts');
  const graph = app('ui-suite/module-graph-runtime.ts');
  let moduleSource;
  overrides.set(graphPath, {
    ...graph,
    moduleBlobSource(value) {
      moduleSource = graph.moduleBlobSource(value);
      return moduleSource;
    },
  });
  const compiler = app('ui-suite/compiler.ts');
  const preparedApi = app('ui-suite/prepared.ts');
  const { SuiteProvider } = app('ui-suite/SuiteProvider.tsx');
  const { UiFoundationProvider } = app('ui-foundation/environment.tsx');
  const { LauncherSnapshotContext, LauncherActionsContext } = app('launcher/public/context.ts');
  const { ActiveRouteRegistryContext } = app('launcher/routeRegistry.ts');
  const { UiEditorControllerContext } = app('ui-editor/controller.tsx');
  const prepared = new Set();
  let activation, nextModule = 0;
  const controller = {
    subscribe: () => () => {},
    getActivation: () => activation,
    reportRenderError(error) { throw error; },
  };
  const el = React.createElement;
  return {
    app,
    async compile(bundle, scope = preparedApi.createSuiteRuntimeScope(), draft = true, options = {}) {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      const moduleUrls = new Set();
      URL.createObjectURL = blob => {
        if (blob.type !== 'text/javascript') return create.call(URL, blob);
        assert.equal(typeof moduleSource, 'string');
        const source = moduleSource;
        moduleSource = undefined;
        const url = `node-suite-module:${++nextModule}`;
        overrides.set(url, vm.runInThisContext(
          '(function(){\n' + source.replace('export function initialize', 'function initialize') +
            '\nreturn {initialize};})()',
        ));
        moduleUrls.add(url);
        return url;
      };
      URL.revokeObjectURL = url => {
        if (moduleUrls.has(url)) overrides.delete(url);
        else revoke.call(URL, url);
      };
      try {
        const value = await (draft ? compiler.compileSuiteDraftInScope : compiler.compileSuiteInScope)(bundle, scope, options);
        prepared.add(value);
        return value;
      } finally {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        for (const url of moduleUrls) overrides.delete(url);
      }
    },
    activate(primary, trusted) {
      activation = {
        primary: { layerId: 'node.current', prepared: primary },
        parent: null,
        trusted: { layerId: 'node.trusted', prepared: trusted },
      };
    },
    render(children, protectedMode = false) {
      assert.ok(activation, 'Install an actual compiled current and trusted suite');
      return renderToStaticMarkup(el(LauncherSnapshotContext.Provider, { value: {} },
        el(LauncherActionsContext.Provider, { value: {} },
          el(ActiveRouteRegistryContext.Provider, { value: { setActiveRouteRegistry() {} } },
            el(UiEditorControllerContext.Provider, { value: controller },
              el(UiFoundationProvider, {
                value: { theme: 'dark', variables: {}, portalContainer: null, protectedMode },
              }, el(SuiteProvider, { fallback: activation.trusted.prepared }, children)),
            ),
          ),
        ),
      ));
    },
    dispose() { for (const value of prepared) value.dispose(); },
  };
}

// Like the cancellation regression host, this supplies Hook state and effects.
// Reconnecting effects also checks that obsolete asynchronous responses cannot
// publish into the next effect lifecycle. Native React/DOM behavior is separate.
export function hookHost() {
  const slots = [];
  const effectSlots = new Set();
  let index = 0;
  let effects = [];
  let dirty = true;
  let mounted = true;
  let updatesAfterUnmount = 0;
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
          if (!mounted) {
            updatesAfterUnmount++;
            return;
          }
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
    useMemo(factory, deps) {
      const slot = index++;
      if (changed(slots[slot]?.deps, deps)) slots[slot] = { value: factory(), deps };
      return slots[slot].value;
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const [snapshot, setSnapshot] = hooks.useState(getSnapshot);
      hooks.useEffect(() => subscribe(() => setSnapshot(getSnapshot())), [subscribe, getSnapshot]);
      return snapshot;
    },
    useEffect(effect, deps) {
      const slot = index++;
      effectSlots.add(slot);
      if (changed(slots[slot]?.deps, deps)) {
        effects.push(() => {
          slots[slot]?.cleanup?.();
          slots[slot] = { deps, effect, cleanup: effect() };
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
      for (let render = 0; render < 20; render++) {
        if (dirty && mounted) {
          dirty = false;
          index = 0;
          current = run();
          const pending = effects;
          effects = [];
          pending.forEach((effect) => effect());
        }
        // Drain currently runnable Promise work, without advancing held IPCs.
        await setImmediate();
        if (!dirty || !mounted) return current;
      }
      assert.fail('Hook did not settle after 20 renders');
    },
    reconnectEffects() {
      for (const slot of effectSlots) slots[slot]?.cleanup?.();
      for (const slot of effectSlots) slots[slot].cleanup = slots[slot].effect();
    },
    unmount() {
      for (const slot of effectSlots) slots[slot]?.cleanup?.();
      mounted = false;
    },
    get updatesAfterUnmount() {
      return updatesAfterUnmount;
    },
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export const profile = {
  instance_key: 'original-instance',
  name: 'Original world',
  game_version: '1.21.1',
  loader: 'vanilla',
  loader_version: '',
  game_directory: null,
  overrides: {},
};
export const importedProfile = {
  ...profile,
  instance_key: 'imported-pack',
  name: 'Imported pack',
  loader: 'fabric',
  loader_version: '0.16.0',
};
export const initialConfig = {
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
