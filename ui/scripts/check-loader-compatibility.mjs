// Run with: node ui/scripts/check-loader-compatibility.mjs
// Host the real dialog with controlled effects, debounce timers and catalog IPC.
// Native DOM validation and Base UI focus behavior remain browser checks.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialConfig } from './lib/hook-test-host.mjs';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');

function loadDialog(overrides) {
  // This direct-call Hook host isolates loader debounce/catalog state. The
  // customization renderer is exercised by its own runtime/browser tests.
  const customizationPath = resolve(uiRoot, 'src/customization/Customizable.tsx');
  const cache = new Map();
  function load(file) {
    if (overrides.has(file)) return overrides.get(file);
    if (file.endsWith('.css')) return {};
    if (file === customizationPath) return { customComponent: (_target, Original) => Original };
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
      if (name === 'react' && overrides.has(name))
        return { ...require(name), ...overrides.get(name) };
      if (overrides.has(name)) return overrides.get(name);
      if (!name.startsWith('.')) return require(name);
      const base = resolve(dirname(file), /\.css(?:\?|$)/.test(name) ? name.split('?')[0] : name);
      if (base.endsWith('.css') && name.includes('?inline')) return readFileSync(base, 'utf8');
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`].find(existsSync);
      assert.ok(target, `Cannot resolve ${name} from ${file}`);
      return load(target);
    };
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    Dialog: load(resolve(uiRoot, 'src/components/ProfileDialog.tsx')).default,
    useProfileDraftController: load(resolve(uiRoot, 'src/launcher/controllers/profileDraft.ts'))
      .useProfileDraftController,
  };
}

function hookHost() {
  const slots = [];
  let index = 0;
  let dirty = true;
  let effects = [];
  let run;
  let current;
  const hooks = {
    useRef(initial) {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    },
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[slot],
        (value) => {
          const next = typeof value === 'function' ? value(slots[slot]) : value;
          if (!Object.is(next, slots[slot])) {
            slots[slot] = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot].deps[i]))) {
        effects.push(() => {
          slots[slot]?.cleanup?.();
          slots[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const host = {
    hooks,
    mount(callback) {
      run = callback;
    },
    invalidate() {
      dirty = true;
    },
    render() {
      if (dirty) {
        dirty = false;
        index = 0;
        current = run();
      }
      return current;
    },
    async settle() {
      for (let turn = 0; turn < 12; turn++) {
        host.render();
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
        await Promise.resolve();
      }
      return current;
    },
  };
  return host;
}

function find(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const match = find(child, predicate);
      if (match) return match;
    }
  } else if (tree && typeof tree === 'object') {
    if (predicate(tree)) return tree;
    return find(tree.props?.children, predicate);
  }
}

function fixture(initial = {}) {
  const host = hookHost();
  const editor = {
    name: 'Loader regression',
    version: '1.21.1',
    loader: 'neoforge',
    loader_version: '',
    ...initial,
  };
  let saves = 0;
  let nextTimer = 0;
  const timers = new Map();
  const requests = [];
  globalThis.window = {
    setTimeout(callback) {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  let controller;
  const config = structuredClone(initialConfig);
  config.profiles[0] = {
    ...config.profiles[0],
    instance_key: initial.editKey ?? 'existing-profile',
    name: editor.name,
    game_version: editor.version,
    loader: editor.loader,
    loader_version: editor.loader_version,
  };
  const services = {
    launcher: {
      draft: config.settings,
      versions: [],
      getGuardState: () => ({ config, busy: null, saving: false, installed: [] }),
      saveProfile: async () => {
        saves++;
        return true;
      },
    },
    downloads: { getGuardState: () => ({ active: false, pending: [] }) },
    getInteractionState: () => ({
      editorOpen: false,
      picking: false,
      modalOpen: false,
      closeRequested: false,
    }),
    navigate() {},
  };
  const { Dialog, useProfileDraftController } = loadDialog(
    new Map([
      ['react', host.hooks],
      [
        '@paradox/launcher',
        {
          useLauncherSnapshot: () => ({
            profileDraft: controller.snapshot,
            settings: { saving: false },
          }),
          useLauncherActions: () => ({ profileDraft: controller.actions }),
        },
      ],
      [
        'react-i18next',
        { ...require('react-i18next'), useTranslation: () => ({ t: (key) => key }) },
      ],
    ]),
  );
  services.api = {
    loaderVersions(loader, game) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      requests.push({ loader, game, resolve, reject });
      return promise;
    },
  };
  let initialized = false;
  host.mount(() => {
    controller = useProfileDraftController(services);
    return Dialog({
      theme: 'dark',
      variables: {},
      reduceMotion: false,
      keyboardNavigation: false,
    });
  });
  return {
    host,
    requests,
    get editor() {
      return controller.snapshot.editor;
    },
    get saves() {
      return saves;
    },
    replace(patch) {
      controller.actions.patch(patch);
    },
    changeGame(version) {
      find(
        host.render(),
        (node) => node.type === 'input' && node.props.id !== 'profile-name',
      ).props.onChange({ target: { value: version } });
    },
    choose(version) {
      find(host.render(), (node) => node.props.options && node.props.required).props.onValueChange(
        version,
      );
    },
    submit() {
      find(host.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
    },
    saveDisabled() {
      return find(host.render(), (node) => node.type === 'button' && node.props.type === 'submit')
        .props.disabled;
    },
    options() {
      const select = find(host.render(), (node) => node.props.options && node.props.required);
      return select?.props.options.map((option) => option.value);
    },
    async request() {
      await host.settle();
      if (!initialized) {
        initialized = true;
        if (editor.editKey) controller.actions.openRename(editor.editKey);
        else {
          controller.actions.openCreate(editor.version);
          controller.actions.patch({ name: editor.name, loader: editor.loader });
          controller.actions.patch({ loader_version: editor.loader_version });
        }
        await host.settle();
      }
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
      await host.settle();
      return requests.at(-1);
    },
  };
}

const failures = [];
async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(error);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await check('changing Minecraft immediately clears the old loader selection', async () => {
  for (const [loader, version] of [
    ['fabric', '0.16.10'],
    ['quilt', '0.27.1'],
    ['forge', '52.0.7'],
    ['neoforge', '21.1.265'],
  ]) {
    const dialog = fixture({ loader, loader_version: version });
    const request = await dialog.request();
    assert.equal(request.loader, loader);
    request.resolve([{ version, stable: true }]);
    await dialog.host.settle();
    assert.equal(dialog.saveDisabled(), false);
    dialog.changeGame('26.3');
    assert.equal(dialog.editor.loader_version, '');
    assert.equal(dialog.editor.loader, loader);
    assert.equal(dialog.saveDisabled(), true);
  }
});

await check('an old catalog cannot authorize submission before new effects run', async () => {
  const dialog = fixture({ loader_version: '21.1.265' });
  (await dialog.request()).resolve([{ version: '21.1.265', stable: true }]);
  await dialog.host.settle();
  dialog.replace({ version: '26.3' });
  assert.equal(dialog.saveDisabled(), true);
  dialog.submit();
  assert.equal(dialog.saves, 0);
});

await check('pending, failed and empty catalogs reject direct form submission', async () => {
  for (const outcome of ['pending', 'failed', 'empty']) {
    const dialog = fixture({ loader_version: '21.1.265' });
    const request = await dialog.request();
    if (outcome === 'failed') request.reject(new Error('loaders.errors.network'));
    if (outcome === 'empty') request.resolve([]);
    await dialog.host.settle();
    assert.equal(dialog.saveDisabled(), true, outcome);
    dialog.submit();
    assert.equal(dialog.saves, 0, outcome);
  }
});

await check('only a version in the current catalog can create a loader instance', async () => {
  const dialog = fixture({ version: '26.3', loader_version: '21.1.265' });
  (await dialog.request()).resolve([{ version: '26.3.0.100', stable: true }]);
  await dialog.host.settle();
  assert.equal(dialog.saveDisabled(), true);
  dialog.choose('26.3.0.100');
  await dialog.host.settle();
  assert.equal(dialog.saveDisabled(), false);
  dialog.submit();
  assert.equal(dialog.saves, 1);
});

await check(
  'late success and failure from the old game cannot replace the current catalog',
  async () => {
    for (const outcome of ['success', 'failure']) {
      const dialog = fixture();
      const oldRequest = await dialog.request();
      dialog.changeGame('26.3');
      const currentRequest = await dialog.request();
      assert.equal(currentRequest.game, '26.3');
      currentRequest.resolve([{ version: '26.3.0.100', stable: true }]);
      await dialog.host.settle();
      dialog.choose('26.3.0.100');
      if (outcome === 'success') oldRequest.resolve([{ version: '21.1.265', stable: true }]);
      else oldRequest.reject(new Error('loaders.errors.network'));
      await dialog.host.settle();
      assert.deepEqual(dialog.options(), ['', '26.3.0.100']);
      assert.equal(dialog.saveDisabled(), false);
    }
  },
);

await check('vanilla creation and renaming do not require a loader catalog', async () => {
  for (const initial of [
    { loader: 'vanilla' },
    { editKey: 'existing-profile', loader_version: '21.1.265' },
  ]) {
    const dialog = fixture(initial);
    await dialog.request();
    assert.equal(dialog.requests.length, 0);
    assert.equal(dialog.saveDisabled(), false);
    dialog.submit();
    assert.equal(dialog.saves, 1);
  }
});

assert.equal(failures.length, 0, `${failures.length} loader compatibility regressions failed`);
console.log(
  'Loader compatibility regression passed: catalog identity, version changes, submit guards and stale responses.',
);
