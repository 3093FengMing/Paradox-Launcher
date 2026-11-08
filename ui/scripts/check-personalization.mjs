import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadApp, hookHost, deferred, uiRoot, initialConfig } from './lib/hook-test-host.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { I18nextProvider } = require('react-i18next');
const app = loadApp();
const { appearanceVariables } = app('lib/appearance.ts');
const { defaultPersonalization } = app('lib/preferences.ts');
const { normalizePersonalization } = app('lib/preferences.ts');
const previousStorage = globalThis.localStorage;
const previewStorage = new Map();
const savedImageId = 'a'.repeat(64) + '.png';
globalThis.localStorage = {
  getItem: (key) => previewStorage.get(key) ?? null,
  setItem: (key, value) => previewStorage.set(key, value),
};
try {
  const previewApi = loadApp(new Map([['@tauri-apps/api/core', { isTauri: () => false }]]))('api.ts');
  const fresh = (await previewApi.getConfig()).config;
  assert.equal(fresh.settings.appearance.background_art, false, 'new browser preview configurations start without artwork');
  fresh.settings.appearance.background_art = true;
  fresh.settings.personalization.background_file = savedImageId;
  await previewApi.saveConfig(fresh);
  const serialized = previewStorage.get('paradox-launcher-preview-v1');
  const restored = (await previewApi.getConfig()).config;
  assert.equal(restored.settings.appearance.background_art, true, 'saved artwork preference is preserved');
  assert.equal(restored.settings.personalization.background_file, savedImageId, 'saved artwork file is preserved');
  assert.equal(previewStorage.get('paradox-launcher-preview-v1'), serialized, 'config reads do not migrate saved background data');
} finally {
  if (previousStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previousStorage;
}
assert.equal(initialConfig.settings.appearance.background_art, false, 'new fixture configurations start without artwork');
for (const id of ['modern', 'immersive']) {
  const base = resolve(uiRoot, 'src/ui-suite/builtins', id);
  const manifest = JSON.parse(readFileSync(resolve(base, 'suite.json'), 'utf8'));
  assert.deepEqual(manifest.files.filter((file) => file.kind === 'asset'), [], 'defaults need no packaged artwork');
  for (const file of manifest.files.filter((file) => file.kind === 'css')) {
    const css = readFileSync(resolve(uiRoot, 'src/ui-suite/builtins', file.path), 'utf8');
    assert.doesNotMatch(css, /world\.svg|landscape\.svg|var\(--(?:background|banner)-image/, `${file.path}: defaults ignore saved background variables`);
  }
  assert.doesNotMatch(readFileSync(resolve(base, 'Shell.tsx'), 'utf8'), /has-background/, 'default structure ignores artwork preferences');
}
const routeIds = JSON.parse(
  readFileSync(new URL('./fixtures/route-ids.json', import.meta.url), 'utf8'),
);
const { validateRouteId, resolveRoute } = app('ui-suite/routes.ts');
for (const id of routeIds.valid) {
  assert.equal(validateRouteId(id), id);
  assert.equal(normalizePersonalization({ startup_page: id }).startup_page, id);
}
for (const id of [...routeIds.invalid, null, 1, {}, [], true]) {
  assert.throws(() => validateRouteId(id), /content.errors.preferences/);
  assert.throws(() => normalizePersonalization({ startup_page: id }), /content.errors.preferences/);
}
assert.equal(resolveRoute('custom.absent', [{ id: 'home' }]), 'home');
assert.equal(resolveRoute('custom.help', [{ id: 'home' }, { id: 'custom.help' }]), 'custom.help');
const appearance = {
  interface_style: 'immersive',
  theme: 'dark',
  accent_color: '#6387f5',
  ui_scale: 100,
  border_radius: 14,
  compact_sidebar: false,
  reduce_motion: false,
  background_art: true,
  background_blur: 0,
  background_dim: 8,
  sidebar_opacity: 62,
};
const customImage = 'data:image/png;base64,aGVsbG8=';
for (const [fit, size] of [
  ['cover', 'cover'],
  ['contain', 'contain'],
  ['stretch', '100% 100%'],
]) {
  const variables = appearanceVariables(
    appearance,
    'dark',
    {
      ...defaultPersonalization(),
      background_fit: fit,
      font: 'serif',
    },
    customImage,
  );
  assert.equal(
    variables['--background-image'],
    `url("${customImage}")`,
    'use the imported background',
  );
  assert.equal(variables['--background-size'], size, `apply ${fit} sizing`);
  assert.equal(variables.fontFamily, 'Georgia, "Times New Roman", serif');
}
assert.equal(
  appearanceVariables(
    { ...appearance, background_art: false },
    'dark',
    defaultPersonalization(),
    customImage,
  )['--background-image'],
  'none',
);
assert.equal(
  appearanceVariables(appearance, 'dark')['--background-image'],
  undefined,
);

const { matchesLaunchShortcut } = app('lib/shortcuts.ts');
const keyEvent = {
  key: 'Enter',
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
};
assert.equal(matchesLaunchShortcut(keyEvent, 'Ctrl+Enter'), true);
assert.equal(
  matchesLaunchShortcut({ ...keyEvent, key: 'l', shiftKey: true }, 'Ctrl+Shift+L'),
  true,
);
assert.equal(
  matchesLaunchShortcut({ ...keyEvent, ctrlKey: false, altKey: true }, 'Alt+Enter'),
  true,
);
for (const changed of [
  { repeat: true },
  { isComposing: true },
  { defaultPrevented: true },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
  { ctrlKey: false },
  { key: 'Escape' },
]) {
  assert.equal(matchesLaunchShortcut({ ...keyEvent, ...changed }, 'Ctrl+Enter'), false);
}
const i18n = app('i18n.ts').default;
const { Field } = app('components/ui.tsx');
const fieldMarkup = renderToStaticMarkup(
  React.createElement(
    Field,
    { label: 'Sizing', description: 'Choose an image fit' },
    React.createElement(
      'select',
      null,
      React.createElement('option', { value: 'cover' }, 'Crop to fill'),
    ),
  ),
);
assert.match(
  fieldMarkup,
  /<select[^>]*aria-labelledby="[^"]+"/,
  'select name must refer only to its label, not option text',
);
const PersonalizationSettings = app('components/PersonalizationSettings.tsx').default;
for (const locale of ['zh-CN', 'en-US']) {
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(
    React.createElement(
      I18nextProvider,
      { i18n },
      React.createElement(PersonalizationSettings, {
        value: { ...defaultPersonalization(), background_fit: 'contain', font: 'serif' },
        section: 'appearance',
        desktop: false,
        disabled: false,
        choosing: false,
        background: null,
        onPatch: () => {},
        onChooseBackground: () => {},
      }),
    ),
  );
  assert.match(html, /class="ui-select-value"[^>]*>[^<]*<\/span>/);
  assert.ok(
    html.includes(i18n.t('personalization.fitContain')),
    'the selected fit label is rendered',
  );
  assert.ok(
    html.includes(i18n.t('personalization.fonts.serif')),
    'the selected font label is rendered',
  );
  assert.ok(html.includes(locale === 'zh-CN' ? '导入背景图片' : 'Import background image'));
  assert.ok(!html.includes('personalization.'), 'all controls use resolved translations');
  assert.match(
    html,
    /<button[^>]*disabled=""[^>]*>/,
    'native file picker is unavailable in browser preview',
  );
}

// Exercise the production Hook while controlling only the desktop read boundary.
const host = hookHost();
const first = deferred();
const second = deferred();
const broken = deferred();
const late = deferred();
const errors = [];
const onError = (error) => errors.push(error.message);
const calls = [];
const hookApp = loadApp(
  new Map([
    ['react', host.hooks],
    [
      resolve(uiRoot, 'src/api.ts'),
      {
        readBackground(id) {
          calls.push(id);
          return { first, second, broken, late }[id].promise;
        },
      },
    ],
  ]),
);
const { useBackground } = hookApp('hooks/useBackground.ts');
host.mount(() => {
  const [id, setId] = host.hooks.useState('first');
  return { id, setId, data: useBackground(id, onError) };
});
let state = await host.settle();
assert.equal(state.data, null);
state.setId('second');
state = await host.settle();
second.resolve(customImage);
state = await host.settle();
assert.equal(state.data, customImage);
first.resolve('data:image/png;base64,b2xk');
state = await host.settle();
assert.equal(state.data, customImage, 'late old image must not replace the selected image');
state.setId('broken');
state = await host.settle();
assert.equal(state.data, null, 'old image must not be shown for a different id');
broken.reject(new Error('image missing'));
await host.settle();
assert.deepEqual(errors, ['image missing']);
state.setId('');
state = await host.settle();
assert.equal(state.data, null);
assert.deepEqual(calls, ['first', 'second', 'broken'], 'default background performs no file read');
state.setId('late');
await host.settle();
host.unmount();
late.resolve(customImage);
await host.settle();
assert.equal(host.updatesAfterUnmount, 0);
console.log(
  'Personalization regression passed: image sizing/fonts, bilingual controls, shortcut keys and stale/unmounted image reads.',
);

// Retained handlers from one real Context render merge fields against the current
// permanent draft, including a held background chooser and a replacement view.
const { fixture: providerFixture } = await import('./lib/launcher-provider-fixture.mjs');
const f = await providerFixture();
const current = await f.current();
const actions = current.actions;
const selectedBuiltin = current.snapshot.settings.draft.appearance.interface_style;
const builtinManifest = JSON.parse(readFileSync(resolve(uiRoot, `src/ui-suite/builtins/${selectedBuiltin}/suite.json`), 'utf8'));
const appearanceSource = builtinManifest.views['component.appearance-settings'];
assert.ok(appearanceSource, 'selected builtin has an appearance-settings binding');
const appearanceView = await f.renderView(`ui-suite/builtins/${appearanceSource}`);
const children = (node) =>
  !node || typeof node !== 'object'
    ? []
    : [node, ...React.Children.toArray(node.props?.children).flatMap(children)];
const accent = children(appearanceView).filter(
  (x) => x.type === 'button' && x.props.style?.background,
)[1];
const scale = children(appearanceView).find((x) => x.props.title === 'appearance.scale');
// These two callbacks belong to the same captured view.
accent.props.onClick();
scale.props.onChange(115);
assert.equal((await f.current()).snapshot.settings.draft.appearance.ui_scale, 115);
assert.equal(
  (await f.current()).snapshot.settings.draft.appearance.accent_color,
  accent.props.style.background,
);
const choosing = actions.settings.chooseBackground();
const personalizationView = await f.renderView('components/PersonalizationSettings.tsx', {
  value: current.snapshot.settings.draft.personalization,
  section: 'appearance',
  desktop: true,
  disabled: false,
  choosing: false,
  background: null,
  onPatch: actions.settings.patchPersonalization,
  onChooseBackground: actions.settings.chooseBackground,
});
const selects = children(personalizationView).filter((x) => x.props.options);
selects[0].props.onValueChange('contain');
selects[1].props.onValueChange('serif');
f.backgrounds[0].resolve('C:/new-background.png');
await choosing;
const after = (await f.current()).snapshot;
assert.equal(after.settings.draft.personalization.font, 'serif');
assert.equal(after.settings.draft.personalization.background_fit, 'contain');
assert.equal(after.settings.draft.personalization.background_file, 'C:/new-background.png');
const help = {
  id: 'custom.help',
  entry: 'help.tsx',
  title: 'Help from suite',
  description: 'Suite help',
  navigation: true,
  startupSelectable: true,
  order: 8,
  icon: 'CircleHelp',
};
const routes = [...f.app('lib/navigation.ts').builtinRoutes, help];
const startupView = await f.renderView('components/PersonalizationSettings.tsx', {
  value: { ...after.settings.draft.personalization, startup_page: 'custom.missing' },
  section: 'behavior',
  desktop: true,
  disabled: false,
  choosing: false,
  background: null,
  routes,
  onPatch: actions.settings.patchPersonalization,
  onSetStartupRoute: actions.settings.setStartupRoute,
  onChooseBackground: actions.settings.chooseBackground,
});
const startup = children(startupView).find((x) => x.props.options);
assert.ok(startup.props.options.some((x) => x.value === 'custom.help' && x.label === help.title));
assert.ok(!startup.props.options.some((x) => x.value === 'custom.missing'));
assert.ok(startup.props.placeholder.includes('custom.missing'));
const currentOwner = await f.current();
currentOwner.registry.setActiveRouteRegistry(routes);
startup.props.onValueChange('custom.help');
assert.equal(
  currentOwner.services.launcher.getSettingsDraft().personalization.startup_page,
  'custom.help',
);
assert.equal(currentOwner.services.launcher.getSettingsDraft().personalization.font, 'serif');
const replacement = await f.renderView('components/PersonalizationSettings.tsx', {
  value: after.settings.draft.personalization,
  section: 'appearance',
  desktop: true,
  disabled: false,
  choosing: false,
  background: null,
  onPatch: actions.settings.patchPersonalization,
  onChooseBackground: actions.settings.chooseBackground,
});
assert.equal(children(replacement).filter((x) => x.props.options)[1].props.value, 'serif');
actions.settings.clearBackground();
const cleared = (await f.current()).snapshot.settings.draft.personalization;
assert.equal(cleared.background_file, '', 'public clearBackground remains available');
assert.equal(cleared.font, 'serif', 'clearing the image keeps other saved customization');
f.host.unmount();
console.log('Latest-field appearance/personalization callbacks and held chooser checks passed.');
