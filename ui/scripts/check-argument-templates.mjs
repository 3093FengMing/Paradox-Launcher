import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookHost, loadApp, initialConfig } from './lib/hook-test-host.mjs';
import { fixture as providerFixture } from './lib/launcher-provider-fixture.mjs';
import test from 'node:test';
import { deferred } from './lib/hook-test-host.mjs';

const uiRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');

function descendants(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props?.children).flatMap(descendants)];
}
const template = {
  id: 'a72f88e2-a1ee-4a13-843c-49360b6e58a2',
  name: 'Performance',
  jvm: '-Dsource=template',
  game: '--demo',
  environment: { PARADOX_TEST_VALUE: 'template', KEEP: 'yes' },
};
const settings = {
  game_directory: 'C:/Games',
  java_executable: '',
  memory_mb: 4096,
  minimum_memory_mb: 512,
  resolution_width: 1280,
  resolution_height: 720,
  extra_jvm_arguments: '-Dsource=global',
  extra_game_arguments: '--fullscreen',
  argument_templates: [template],
};
let saved;
const failures = [];
const props = {
  profile: {
    instance_key: 'test',
    name: 'Test',
    game_version: '1.21.1',
    loader: 'vanilla',
    loader_version: '',
    game_directory: null,
    overrides: {},
  },
  settings,
  saving: false,
  theme: 'dark',
  variables: {},
  reduceMotion: true,
  keyboardNavigation: true,
  onClose() {},
  onError: (error) => failures.push(error),
  onSave: async (profile) => {
    saved = profile;
    return true;
  },
};
// Keep the permanent controller in the flat utility host while the presentation
// is re-created. Real Context/DOM replacement is covered by the browser fixture.
const instanceHost = hookHost();
const instanceConfig = structuredClone(initialConfig);
instanceConfig.settings = { ...instanceConfig.settings, ...settings };
instanceConfig.profiles = [structuredClone(props.profile)];
const instanceServices = {
  launcher: {
    draft: instanceConfig.settings,
    getGuardState: () => ({ config: instanceConfig, installed: [], busy: null, saving: false }),
    reportError: props.onError,
    updateProfile: async (profile) => {
      saved = structuredClone(profile);
      instanceConfig.profiles = [structuredClone(profile)];
      return true;
    },
  },
  downloads: { getGuardState: () => ({ active: false, pending: [] }) },
  api: { desktop: false },
  getInteractionState: () => ({
    editorOpen: false,
    picking: false,
    modalOpen: false,
    closeRequested: false,
  }),
};
let instanceController;
const instanceApp = loadApp(
  new Map([
    ['react', { ...React, ...instanceHost.hooks }],
    ['react-i18next', { useTranslation: () => ({ t: (key) => key }) }],
    [resolve(uiRoot, 'src/i18n.ts'), { __esModule: true, default: { t: (key) => key } }],
    [
      '@paradox/launcher',
      {
        useLauncherSnapshot: () => ({
          instanceDraft: instanceController.snapshot,
          config: { value: instanceConfig },
          settings: { saving: false },
          window: { desktop: false },
        }),
        useLauncherActions: () => ({ instanceDraft: instanceController.actions }),
      },
    ],
  ]),
);
const InstanceDialog = instanceApp('components/InstanceSettingsDialog.tsx').default;
const useInstanceDraftController = instanceApp(
  'launcher/controllers/instanceDraft.ts',
).useInstanceDraftController;
instanceHost.mount(() => {
  instanceController = useInstanceDraftController(instanceServices);
  return InstanceDialog(props);
});
await instanceHost.settle();
instanceController.actions.open('test');
const host = { render: () => instanceHost.settle() };
let tree = await host.render();
const selector = descendants(tree).find((node) => node.props.options);
assert.ok(selector, 'instance settings must expose the argument template selector');
selector.props.onValueChange(template.id);
tree = await host.render();
const inherited = descendants(tree).find(
  (node) => node.props.label === 'instanceDialog.jvmArguments',
);
assert.equal(
  inherited.props.inherited,
  '-Dsource=template',
  'template selection must change the inherited arguments',
);
assert.equal(inherited.props.source, 'Performance');
inherited.props.onChange('');
tree = await host.render();
descendants(tree)
  .find((node) => node.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await host.render();
assert.equal(saved.overrides.argument_template, template.id);
assert.equal(
  saved.overrides.extra_jvm_arguments,
  '',
  'explicit empty arguments must survive submission',
);
assert.equal(
  props.profile.overrides.argument_template,
  undefined,
  'editing must not mutate the stored profile',
);

instanceController.actions.open('test');
tree = await host.render();
const environmentEditor = descendants(tree).find((node) => node.type?.name === 'EnvironmentEditor');
environmentEditor.props.onChange([
  { key: 'PARADOX_TEST_VALUE', value: 'instance\nvalue=x' },
  { key: 'EMPTY', value: '' },
]);
tree = await host.render();
descendants(tree)
  .find((node) => node.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await host.render();
assert.deepEqual(saved.overrides.environment, {
  PARADOX_TEST_VALUE: 'instance\nvalue=x',
  EMPTY: '',
});
const beforeInvalid = saved;
instanceController.actions.open('test');
tree = await host.render();
descendants(tree)
  .find((node) => node.type?.name === 'EnvironmentEditor')
  .props.onChange([{ key: 'JAVA_TOOL_OPTIONS', value: '-Xmx1G' }]);
tree = await host.render();
descendants(tree)
  .find((node) => node.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await host.render();
assert.equal(saved, beforeInvalid, 'invalid environment must not reach the save boundary');
assert.equal(failures.length, 1);
instanceHost.unmount();

function button(tree, key) {
  return descendants(tree).find(
    (node) => node.type === 'button' && React.Children.toArray(node.props.children).includes(key),
  );
}
// Migrated controlled views read the real Provider/public Context. No fake
// template props, local child-key remount or alternate settings draft remains.
const f = await providerFixture();
f.server.config.settings.argument_templates = [structuredClone(template)];
f.server.config.profiles[0].overrides.argument_template = template.id;
const { actions } = await f.current();
await actions.config.reload();
actions.settings.reset();
const renderTemplates = () => f.renderView('components/ArgumentTemplates.tsx');
let templatesTree = await renderTemplates();
const removeButton = descendants(templatesTree).find(
  (node) => node.props['aria-label'] === 'argumentTemplates.remove',
);
assert.equal(removeButton.props.disabled, true, 'a referenced template cannot be removed');
removeButton.props.onClick();
assert.equal((await f.current()).snapshot.settings.draft.argument_templates.length, 1);
button(templatesTree, 'argumentTemplates.edit').props.onClick();
templatesTree = await renderTemplates();
descendants(templatesTree)
  .find((node) => node.props.label === 'argumentTemplates.name')
  .props.children.props.onChange({ target: { value: 'Updated in editor' } });
assert.equal((await f.current()).snapshot.settings.draft.argument_templates[0].name, 'Performance');
templatesTree = await renderTemplates();
button(templatesTree, 'argumentTemplates.apply').props.onClick();
assert.equal(
  (await f.current()).snapshot.settings.draft.argument_templates[0].name,
  'Updated in editor',
);
assert.equal(template.name, 'Performance');
assert.equal(f.writes.length, 0, 'apply does not persist config');
button(await renderTemplates(), 'argumentTemplates.add').props.onClick();
templatesTree = await renderTemplates();
descendants(templatesTree)
  .find((node) => node.props.label === 'argumentTemplates.name')
  .props.children.props.onChange({ target: { value: 'New template' } });
descendants(templatesTree)
  .find((node) => node.props.label === 'instanceDialog.jvmArguments')
  .props.children.props.onChange({ target: { value: '-Dnew=true' } });
descendants(templatesTree)
  .find((node) => node.type?.name === 'EnvironmentEditor')
  .props.onChange([{ key: 'NEW_VALUE', value: 'x=y\nline two' }]);
button(await renderTemplates(), 'argumentTemplates.apply').props.onClick();
let changed = (await f.current()).snapshot.settings.draft.argument_templates;
assert.equal(changed.length, 2);
assert.equal(changed[1].jvm, '-Dnew=true');
assert.deepEqual(changed[1].environment, { NEW_VALUE: 'x=y\nline two' });
assert.notEqual(changed[1].id, template.id);
descendants(await renderTemplates())
  .filter((node) => node.props['aria-label'] === 'argumentTemplates.remove')[1]
  .props.onClick();
assert.equal((await f.current()).snapshot.settings.draft.argument_templates.length, 1);
f.host.unmount();

for (const scenario of ['editing', 'creating', 'edited-and-applied', 'created-and-applied']) {
  const f = await providerFixture();
  f.server.config.settings.argument_templates = [{ ...structuredClone(template), name: 'Saved' }];
  const { actions } = await f.current();
  await actions.config.reload();
  actions.settings.reset();
  const savedSettings = structuredClone((await f.current()).snapshot.settings.draft);
  const render = () => f.renderView('components/ArgumentTemplates.tsx');
  const creating = scenario.startsWith('creat');
  button(
    await render(),
    creating ? 'argumentTemplates.add' : 'argumentTemplates.edit',
  ).props.onClick();
  descendants(await render())
    .find((node) => node.props.label === 'argumentTemplates.name')
    .props.children.props.onChange({ target: { value: 'Discarded' } });
  if (scenario.endsWith('applied')) {
    button(await render(), 'argumentTemplates.apply').props.onClick();
    assert.equal(
      (await f.current()).snapshot.settings.draft.argument_templates.at(-1).name,
      'Discarded',
    );
    descendants(await render())
      .filter(
        (node) =>
          node.type === 'button' &&
          React.Children.toArray(node.props.children).includes('argumentTemplates.edit'),
      )
      .at(-1)
      .props.onClick();
  } else assert.deepEqual((await f.current()).snapshot.settings.draft, savedSettings);
  const current = await f.current();
  const page = await f.renderView('pages/SettingsPage.tsx', {
    draft: current.snapshot.settings.draft,
    configPath: 'settings.json',
    tab: 'advanced',
    dirty: false,
    busy: false,
    saving: false,
    choosingBackground: false,
    background: null,
    javaPanel: null,
    presetsPanel: null,
    onTabChange() {},
    onSave() {},
    onChooseDirectory() {},
    onChooseBackground() {},
    onPatch: actions.settings.patch,
  });
  button(page, 'settings.reset').props.onClick();
  assert.equal(button(await render(), 'argumentTemplates.apply'), undefined, scenario);
  assert.deepEqual((await f.current()).snapshot.settings.draft, savedSettings);
  button(await render(), 'argumentTemplates.edit').props.onClick();
  assert.equal(
    descendants(await render()).find((node) => node.props.label === 'argumentTemplates.name').props
      .children.props.value,
    'Saved',
  );
  button(await render(), 'argumentTemplates.apply').props.onClick();
  assert.deepEqual(
    (await f.current()).snapshot.settings.draft.argument_templates,
    savedSettings.argument_templates,
  );
  assert.equal(f.writes.length, 0);
  f.host.unmount();
}

const { environmentFromRows, environmentRows, saveArgumentTemplate, removeArgumentTemplate } =
  loadApp()('lib/argument-templates.ts');
assert.deepEqual(
  environmentFromRows(
    [
      { key: 'MESSAGE', value: ' line one\nline two=x ' },
      { key: 'EMPTY', value: '' },
    ],
    true,
  ),
  { MESSAGE: ' line one\nline two=x ', EMPTY: '' },
);
assert.deepEqual(
  environmentFromRows(environmentRows(template.environment), true),
  template.environment,
);
for (const rows of [
  [
    { key: 'Path', value: 'first' },
    { key: 'PATH', value: 'second' },
  ],
  [
    { key: 'VALID', value: 'first' },
    { key: 'VALID', value: 'second' },
  ],
  [{ key: 'JAVA_TOOL_OPTIONS', value: '-Xmx1G' }],
  [{ key: '1BAD', value: 'x' }],
  [{ key: 'OK', value: '\0' }],
  [{ key: 'OK', value: '界'.repeat(2731) }],
])
  assert.throws(() => environmentFromRows(rows, true));
assert.deepEqual(
  environmentFromRows(
    [
      { key: 'Path', value: 'first' },
      { key: 'PATH', value: 'second' },
    ],
    false,
  ),
  { Path: 'first', PATH: 'second' },
);
const draft = { ...template, name: 'Renamed', environment: environmentRows(template.environment) };
const updated = saveArgumentTemplate([template], draft, true);
assert.equal(updated.length, 1);
assert.equal(updated[0].name, 'Renamed');
assert.equal(template.name, 'Performance');
assert.throws(() => saveArgumentTemplate([], { ...draft, name: '' }, true));
assert.throws(() => removeArgumentTemplate([template], template.id, [template.id]));
assert.deepEqual(removeArgumentTemplate([template], template.id, []), []);
const full = Array.from({ length: 16 }, (_, index) => ({
  ...template,
  id: `a72f88e2-a1ee-4a13-843c-${String(index).padStart(12, '0')}`,
}));
assert.throws(() => saveArgumentTemplate(full, draft, true));
assert.equal(saveArgumentTemplate(full, { ...draft, id: full[0].id }, true).length, 16);
console.log('Argument template input, CRUD and instance inheritance checks passed.');
await test('t4_r1_actual_context_template_handlers_and_preset_toolbar_agree_during_direct_copy', async () => {
  for (const outcome of ['success', 'failure']) {
    const f = await providerFixture();
    const { actions } = await f.current();
    await actions.presets.save('Clipboard source');
    const id = (await f.current()).snapshot.config.value.appearance_presets[0].id;
    actions.argumentTemplates.openNew();
    actions.argumentTemplates.patch({ name: 'Before clipboard' });
    const response = deferred();
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Task4 regression',
        platform: 'Win32',
        clipboard: { writeText: () => response.promise },
      },
    });
    try {
      const copy = actions.presets.copyExport(id).catch((error) => error);
      let tree = await f.renderView('components/ArgumentTemplates.tsx');
      const field = descendants(tree).find((node) => node.props.label === 'argumentTemplates.name')
        .props.children;
      const apply = button(tree, 'argumentTemplates.apply');
      assert.equal(field.props.disabled, false);
      assert.equal(apply.props.disabled, false);
      field.props.onChange({ target: { value: 'Typed while visibly enabled' } });
      assert.equal(
        (await f.current()).snapshot.drafts.argumentTemplate.name,
        'Typed while visibly enabled',
      );
      apply.props.onClick();
      assert.equal(
        (await f.current()).snapshot.settings.draft.argument_templates[0].name,
        'Typed while visibly enabled',
      );
      tree = await f.renderView('components/AppearancePresets.tsx', {
        theme: 'dark',
        variables: {},
        reduceMotion: true,
        keyboardNavigation: false,
      });
      for (const key of ['presets.import', 'presets.saveCurrent']) {
        const control = button(tree, key);
        assert.equal(control.props.disabled, true, `${key} reflects direct preset pending`);
        control.props.onClick();
      }
      assert.equal((await f.current()).snapshot.drafts.preset, null);
      assert.equal((await f.current()).snapshot.drafts.presetPending, true);
      if (outcome === 'failure') response.reject(new Error('Clipboard denied'));
      else response.resolve();
      await copy;
      tree = await f.renderView('components/AppearancePresets.tsx', {
        theme: 'dark',
        variables: {},
        reduceMotion: true,
        keyboardNavigation: false,
      });
      assert.equal(button(tree, 'presets.saveCurrent').props.disabled, false);
      button(tree, 'presets.saveCurrent').props.onClick();
      assert.equal((await f.current()).snapshot.drafts.preset.request.kind, 'save');
      assert.equal((await f.current()).snapshot.drafts.presetPending, false);
      assert.equal(f.writes.length, 1);
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      f.host.unmount();
    }
  }
});
await test('t4_r1_existing_unmatched_dialog_cancel_reflects_direct_preset_pending', async () => {
  const f = await providerFixture();
  const { actions } = await f.current();
  await actions.presets.save('Clipboard source');
  const id = (await f.current()).snapshot.config.value.appearance_presets[0].id;
  actions.presets.openDialog({ kind: 'save' });
  actions.presets.patchDraft({ name: 'Unfinished dialog' });
  const response = deferred();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: 'Task4 regression',
      platform: 'Win32',
      clipboard: { writeText: () => response.promise },
    },
  });
  try {
    const copy = actions.presets.copyExport(id);
    const tree = await f.renderView('components/AppearancePresets.tsx', {
      theme: 'dark',
      variables: {},
      reduceMotion: true,
      keyboardNavigation: false,
    });
    assert.equal(
      (await f.current()).snapshot.drafts.preset.pending,
      false,
      'copy is not the save dialog submission',
    );
    assert.equal(
      button(tree, 'presets.cancel').props.disabled,
      true,
      'cancel reflects the shared preset mutex',
    );
    button(tree, 'presets.cancel').props.onClick();
    assert.equal((await f.current()).snapshot.drafts.preset.name, 'Unfinished dialog');
    response.resolve();
    await copy;
    const released = await f.renderView('components/AppearancePresets.tsx', {
      theme: 'dark',
      variables: {},
      reduceMotion: true,
      keyboardNavigation: false,
    });
    assert.equal(button(released, 'presets.cancel').props.disabled, false);
    button(released, 'presets.cancel').props.onClick();
    assert.equal((await f.current()).snapshot.drafts.preset, null);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
    f.host.unmount();
  }
});
