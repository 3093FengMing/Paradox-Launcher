import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { deferred, hookHost, initialConfig, loadApp, uiRoot } from './lib/hook-test-host.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
assert.ok(
  existsSync(resolve(uiRoot, 'src/launcher/LauncherProvider.tsx')),
  'two_views_one_controller_and_config_queue: permanent LauncherProvider is missing',
);
assert.ok(
  existsSync(resolve(uiRoot, 'src/launcher/public/index.ts')),
  'snapshot_is_public_and_readonly: public Context barrel is missing',
);
import { fixture } from './lib/launcher-provider-fixture.mjs';
const customStartupConfig = structuredClone(initialConfig);
customStartupConfig.settings.personalization.startup_page = 'custom.help';
const customHelp = {
  id: 'custom.help',
  entry: 'help.tsx',
  title: 'Help from suite',
  description: 'Suite help',
  navigation: true,
  startupSelectable: true,
  order: 8,
  icon: 'CircleHelp',
};
function builtinRegistry(f) {
  return f.app('lib/navigation.ts').builtinRoutes;
}
await test('builtin_registry_descriptors_reference_existing_views', async () => {
  const f = await fixture();
  for (const route of builtinRegistry(f)) {
    assert.ok(existsSync(resolve(uiRoot, 'src', route.entry)), `builtin entry exists: ${route.id}`);
  }
  f.host.unmount();
});
await test('startup_waits_for_suite_then_applies_once', async () => {
  const f = await fixture({
    holdBootstrap: true,
    initialRouteRegistry: 'suite',
    config: customStartupConfig,
  });
  let a = await f.current();
  assert.equal(a.snapshot.navigation.requestedStartupRouteId, null);
  assert.equal(a.snapshot.navigation.routesReady, false);
  f.reads[0].finish();
  a = await f.current();
  assert.equal(a.snapshot.navigation.requestedStartupRouteId, 'custom.help');
  assert.equal(a.snapshot.navigation.routeId, 'home');
  const actions = a.actions;
  const pending = a.snapshot.navigation;
  const sparse = [...builtinRegistry(f)];
  sparse.length++;
  assert.throws(
    () => a.registry.setActiveRouteRegistry(sparse),
    'a trailing empty slot is not a complete publication',
  );
  a = await f.current();
  assert.deepEqual(a.snapshot.navigation, pending);
  assert.equal(a.snapshot.navigation.routesReady, false);
  assert.equal(a.services.getRouteId(), 'home');
  assert.equal(f.writes.length, 0);
  const routes = [...builtinRegistry(f), { ...customHelp }];
  a.registry.setActiveRouteRegistry(routes);
  assert.equal(
    a.services.getRouteId(),
    'custom.help',
    'publication updates current services synchronously',
  );
  routes.at(-1).title = 'Caller mutation';
  a = await f.current();
  assert.equal(a.snapshot.navigation.routeId, 'custom.help');
  assert.equal(a.snapshot.navigation.routes.at(-1).title, customHelp.title);
  publicValue(a.snapshot.navigation);
  assert.equal(a.actions, actions);
  actions.navigation.navigate('instances');
  actions.settings.setStartupRoute('downloads');
  assert.equal(await actions.settings.save(), true);
  f.server.config.settings.personalization.startup_page = 'downloads';
  await actions.config.reload();
  f.host.reconnectEffects();
  a = await f.current();
  assert.equal(a.snapshot.navigation.requestedStartupRouteId, 'custom.help');
  assert.equal(a.snapshot.navigation.routeId, 'instances');
  assert.equal(f.writes.length, 1, 'only the explicitly requested save writes config');
  f.host.unmount();
});
await test('suite_registry_before_config_also_waits_and_providers_are_isolated', async () => {
  const f = await fixture({
    holdBootstrap: true,
    initialRouteRegistry: 'suite',
    config: customStartupConfig,
  });
  const other = await fixture({ holdBootstrap: true, initialRouteRegistry: 'suite' });
  let a = await f.current();
  const channel = a.registry;
  channel.setActiveRouteRegistry([...builtinRegistry(f), customHelp]);
  a = await f.current();
  assert.equal(a.snapshot.navigation.routesReady, true);
  assert.equal(a.snapshot.navigation.requestedStartupRouteId, null);
  assert.equal(a.snapshot.navigation.routeId, 'home');
  assert.equal((await other.current()).snapshot.navigation.routesReady, false);
  f.reads[0].finish();
  a = await f.current();
  assert.equal(a.snapshot.navigation.routeId, 'custom.help');
  assert.equal(a.registry, channel);
  other.reads[0].finish();
  assert.equal((await other.current()).snapshot.navigation.routeId, 'home');
  f.host.unmount();
  other.host.unmount();
});
await test('missing_custom_route_falls_back_without_rewriting', async () => {
  const f = await fixture({ initialRouteRegistry: 'suite', config: customStartupConfig });
  let a = await f.current();
  a.registry.setActiveRouteRegistry(builtinRegistry(f));
  a = await f.current();
  assert.equal(a.snapshot.navigation.routeId, 'home');
  assert.equal(a.snapshot.navigation.requestedStartupRouteId, 'custom.help');
  a.registry.setActiveRouteRegistry([...builtinRegistry(f), customHelp]);
  a = await f.current();
  assert.equal(a.snapshot.navigation.routeId, 'home', 'reactivation never reapplies startup');
  a.actions.navigation.navigate('custom.help', { profileKey: 'original-instance' });
  a.actions.navigation.setSearch('custom query');
  const immediate = a.services.getNavigation();
  assert.deepEqual(immediate, {
    routeId: 'custom.help',
    params: { profileKey: 'original-instance' },
    search: 'custom query',
  });
  immediate.params.profileKey = 'caller mutation';
  assert.equal(a.services.getNavigation().params.profileKey, 'original-instance');
  await f.current();
  assert.equal(f.contentLists.length, 0);
  assert.equal(f.counts.catalog, 0);
  a.registry.setActiveRouteRegistry(builtinRegistry(f));
  assert.deepEqual(a.services.getNavigation(), { routeId: 'home', params: {}, search: '' });
  a.registry.setActiveRouteRegistry([...builtinRegistry(f), customHelp]);
  a = await f.current();
  assert.equal(a.snapshot.navigation.routeId, 'home');
  assert.equal(f.server.config.settings.personalization.startup_page, 'custom.help');
  assert.equal(a.snapshot.settings.draft.personalization.startup_page, 'custom.help');
  assert.equal(f.writes.length, 0);
  a.actions.navigation.navigate('custom.help', { profileKey: 1 });
  assert.deepEqual(a.services.getNavigation().params, {});
  a.actions.navigation.navigate('downloads', { profileKey: 'original-instance' });
  assert.deepEqual(a.services.getNavigation().params, {});
  await f.current();
  assert.equal(f.counts.catalog, 1);
  a.actions.navigation.navigate('custom.missing', { profileKey: 'original-instance' });
  assert.deepEqual(a.services.getNavigation(), { routeId: 'home', params: {}, search: '' });
  a.actions.settings.patchPersonalization('font', 'serif');
  a.actions.settings.setStartupRoute('custom.help');
  assert.equal(a.services.launcher.getSettingsDraft().personalization.font, 'serif');
  a.actions.settings.setStartupRoute('custom.missing');
  assert.equal(a.services.launcher.getSettingsDraft().personalization.startup_page, 'custom.help');
  f.host.unmount();
});
await test('invalid_complete_registry_preserves_previous_publication', async () => {
  const f = await fixture();
  let a = await f.current();
  const builtin = builtinRegistry(f);
  a.registry.setActiveRouteRegistry([...builtin, customHelp]);
  a.actions.navigation.navigate('custom.help', { profileKey: 'original-instance' });
  a.actions.navigation.setSearch('retained registry search');
  a = await f.current();
  const before = a.snapshot.navigation;
  const current = a.services.getNavigation();
  const trailingHole = [...builtin];
  trailingHole.length++;
  const middleHole = [...builtin.slice(0, 3), undefined, ...builtin.slice(3)];
  delete middleHole[3];
  const inheritedIndex = [...builtin];
  inheritedIndex.length++;
  Object.setPrototypeOf(
    inheritedIndex,
    Object.assign(Object.create(Array.prototype), { 7: customHelp }),
  );
  const oversizedSparse = [...builtin];
  oversizedSparse.length = 40;
  for (const routes of [
    trailingHole,
    middleHole,
    inheritedIndex,
    oversizedSparse,
    [],
    builtin.filter((x) => x.id !== 'home'),
    [...builtin, builtin[0]],
    [...builtin, { ...customHelp, id: 'custom.Bad' }],
    [...builtin, { ...customHelp, order: NaN }],
    [...builtin, { ...customHelp, title: () => 'bad' }],
    [...builtin, { ...customHelp, icon: 'made-up-icon' }],
    [...builtin, { ...customHelp, icon: 'Icon' }],
    [...builtin, { ...customHelp, extra: () => {} }],
    [...builtin, ...Array.from({ length: 33 }, (_, i) => ({ ...customHelp, id: `custom.a${i}` }))],
  ]) {
    assert.throws(() => a.registry.setActiveRouteRegistry(routes));
    a = await f.current();
    assert.deepEqual(a.snapshot.navigation, before);
    assert.deepEqual(a.services.getNavigation(), current);
  }
  let indexGetterCalls = 0;
  const indexAccessor = [...builtin];
  Object.defineProperty(indexAccessor, '7', {
    get() {
      indexGetterCalls++;
      return customHelp;
    },
  });
  assert.throws(() => a.registry.setActiveRouteRegistry(indexAccessor));
  assert.equal(indexGetterCalls, 0, 'container indices must be own data properties');
  assert.deepEqual((await f.current()).snapshot.navigation, before);
  assert.equal(Object.hasOwn(a.actions.navigation, 'setActiveRouteRegistry'), false);
  assert.equal(Object.hasOwn(a.services, 'setActiveRouteRegistry'), false);
  assert.equal(Object.hasOwn(f.app('launcher/public/index.ts'), 'useActiveRouteRegistry'), false);
  let getterCalls = 0;
  const accessor = { ...customHelp };
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get() {
      getterCalls++;
      return 'hidden code';
    },
  });
  assert.throws(() => a.registry.setActiveRouteRegistry([...builtin, accessor]));
  assert.equal(getterCalls, 0, 'descriptor publication only reads data properties');
  a.registry.setActiveRouteRegistry([
    ...builtin,
    ...Array.from({ length: 32 }, (_, i) => ({ ...customHelp, id: `custom.a${i}` })),
  ]);
  assert.equal((await f.current()).snapshot.navigation.routes.length, 39);
  f.host.unmount();
});
function publicValue(value) {
  if (value == null || typeof value !== 'object') {
    assert.notEqual(typeof value, 'function');
    return;
  }
  assert.ok(Object.isFrozen(value));
  assert.ok(!React.isValidElement(value));
  assert.equal(Object.hasOwn(value, 'refresh_token'), false);
  assert.equal(Object.hasOwn(value, 'access_token'), false);
  Object.values(value).forEach(publicValue);
}
await test('settings_reset_cancels_unchanged_template_editor', async () => {
  const f = await fixture();
  const { actions } = await f.current();
  assert.equal(typeof actions.argumentTemplates?.openNew, 'function');
  actions.argumentTemplates.openNew();
  actions.argumentTemplates.patch({ name: 'unfinished' });
  actions.argumentTemplates.setEnvironment([{ key: '', value: 'raw=\n' }]);
  actions.argumentTemplates.apply();
  let state = (await f.current()).snapshot;
  assert.ok(state.drafts.argumentTemplate);
  assert.ok(state.drafts.argumentTemplateError);
  assert.equal(state.settings.dirty, false);
  actions.settings.reset();
  state = (await f.current()).snapshot;
  assert.equal(state.drafts.argumentTemplate, null);
  assert.equal(state.drafts.argumentTemplateError, null);
  assert.deepEqual(state.drafts.environment, []);
  assert.equal(f.writes.length, 0);
  f.host.unmount();
});
await test('template_apply_is_draft_only_and_same_turn_operations_merge_latest', async () => {
  const f = await fixture();
  const { actions, services } = await f.current();
  assert.equal(typeof actions.argumentTemplates?.openNew, 'function');
  assert.equal(typeof services.launcher.updateArgumentTemplates, 'function');
  actions.argumentTemplates.openNew();
  actions.argumentTemplates.patch({ name: 'First' });
  actions.argumentTemplates.setEnvironment([{ key: 'MESSAGE', value: ' line\n=x ' }]);
  actions.argumentTemplates.apply();
  actions.settings.patchPersonalization('font', 'serif');
  actions.argumentTemplates.openNew();
  actions.argumentTemplates.patch({ name: 'Second' });
  actions.argumentTemplates.apply();
  const current = services.launcher.getSettingsDraft();
  assert.deepEqual(
    current.argument_templates.map((x) => x.name),
    ['First', 'Second'],
  );
  assert.equal(current.argument_templates[0].environment.MESSAGE, ' line\n=x ');
  assert.equal(current.personalization.font, 'serif');
  assert.equal(f.writes.length, 0);
  const before = structuredClone(current);
  assert.throws(() =>
    services.launcher.updateArgumentTemplates((list) => {
      list[0].name = 'bad mutation';
      throw new Error('reject updater');
    }),
  );
  assert.deepEqual(services.launcher.getSettingsDraft(), before);
  actions.argumentTemplates.remove(current.argument_templates[0].id);
  actions.argumentTemplates.openEdit(current.argument_templates[1].id);
  actions.argumentTemplates.patch({ name: 'Edited' });
  actions.argumentTemplates.apply();
  assert.deepEqual(
    services.launcher.getSettingsDraft().argument_templates.map((x) => x.name),
    ['Edited'],
  );
  f.host.unmount();
});
await test('appearance_patch_merges_latest_draft_and_preset_samples_invocation', async () => {
  const f = await fixture({ holdWrites: true });
  const { actions } = await f.current();
  assert.equal(typeof actions.presets?.save, 'function');
  actions.settings.patchAppearance('accent_color', '#123456');
  actions.settings.patchAppearance('ui_scale', 110);
  actions.settings.patchPersonalization('font', 'serif');
  const save = actions.presets.save('Current');
  actions.settings.patchAppearance('accent_color', '#abcdef');
  await f.current();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].config.appearance_presets[0].appearance.accent_color, '#123456');
  assert.equal(f.writes[0].config.appearance_presets[0].appearance.ui_scale, 110);
  assert.deepEqual(f.writes[0].config.settings, initialConfig.settings);
  f.writes[0].finish();
  await save;
  const snapshot = (await f.current()).snapshot;
  assert.equal(snapshot.settings.draft.appearance.accent_color, '#abcdef');
  assert.equal(snapshot.settings.draft.appearance.ui_scale, 110);
  assert.equal(snapshot.settings.draft.personalization.font, 'serif');
  publicValue(snapshot.drafts);
  f.host.unmount();
});
await test('preset_invalid_import_retains_shared_input_then_correction_writes_library_only', async () => {
  const f = await fixture({ holdWrites: true });
  const { actions } = await f.current();
  assert.equal(typeof actions.presets?.openDialog, 'function');
  actions.presets.openDialog({ kind: 'import' });
  actions.presets.patchDraft({ json: '{invalid input' });
  await assert.rejects(actions.presets.import('{invalid input'));
  let snapshot = (await f.current()).snapshot;
  assert.equal(snapshot.drafts.preset.json, '{invalid input');
  assert.ok(snapshot.drafts.preset.error);
  assert.equal(snapshot.drafts.preset.pending, false);
  const text = JSON.stringify({
    kind: 'paradox-appearance-preset',
    schema_version: 1,
    name: 'Imported',
    appearance: initialConfig.settings.appearance,
  });
  actions.presets.patchDraft({ json: text });
  const saving = actions.presets.import(text);
  actions.presets.patchDraft({ json: 'must be ignored while pending' });
  actions.presets.cancelDialog();
  actions.presets.openDialog({ kind: 'save' });
  actions.settings.patch('extra_game_arguments', '--unfinished');
  snapshot = (await f.current()).snapshot;
  assert.equal(snapshot.drafts.preset.json, text);
  assert.equal(snapshot.drafts.preset.pending, true);
  f.writes[0].finish();
  await saving;
  snapshot = (await f.current()).snapshot;
  assert.equal(snapshot.drafts.preset, null);
  assert.equal(snapshot.settings.draft.extra_game_arguments, '--unfinished');
  assert.deepEqual(f.server.config.settings, initialConfig.settings);
  assert.equal(f.server.config.appearance_presets.length, 1);
  f.host.unmount();
});
await test('stale_content_identity_not_published: lazy route activation, current profile/root/category and committed search', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.equal(
    typeof a.actions.content?.selectProfile,
    'function',
    'content actions must belong to the permanent Provider',
  );
  assert.equal(f.contentLists.length, 0);
  f.server.config.profiles.push({
    ...f.server.config.profiles[0],
    instance_key: 'b',
    name: 'B',
    game_directory: 'B:/game',
  });
  await a.actions.config.reload();
  await f.current();
  a.actions.navigation.navigate('content', { profileKey: 'original-instance' });
  await f.current();
  assert.equal(f.contentLists.length, 1);
  a.actions.content.selectProfile('b');
  await f.current();
  f.contentLists[0].resolve([
    { name: 'old.jar', category: 'mods', enabled: true, size: 10, record: null },
  ]);
  assert.equal((await f.current()).snapshot.content.list, null);
  f.contentLists[1].resolve([
    { name: 'new.jar', category: 'mods', enabled: true, size: 20, record: null },
  ]);
  assert.equal((await f.current()).snapshot.content.list.profileKey, 'b');
  a.actions.content.beginRemove('new.jar');
  a.actions.content.setCategory('saves');
  assert.equal((await f.current()).snapshot.content.removing, null);
  assert.equal((await f.current()).snapshot.content.list, null);
  a.actions.content.selectProfile(null);
  await f.current();
  await a.actions.config.reload();
  assert.equal((await f.current()).snapshot.content.selectedProfileKey, null);
  a.actions.content.patchSearch({ query: 'first', kind: 'mod' });
  const old = a.actions.content.search();
  await f.current();
  a.actions.content.patchSearch({ query: 'second', kind: 'shader' });
  const next = a.actions.content.search();
  await f.current();
  f.contentSearches[1].resolve({ hits: [], total_hits: 60, offset: 0 });
  await next;
  f.contentSearches[0].resolve({ hits: [{ project_id: 'old' }], total_hits: 1, offset: 0 });
  await old;
  assert.equal((await f.current()).snapshot.content.results.total_hits, 60);
  assert.deepEqual((await f.current()).snapshot.content.request, {
    query: 'second',
    kind: 'shader',
    offset: 0,
  });
  f.host.unmount();
});
await test('expired_login_and_cancel_ownership: prompt expiry, open mutex and ACK waits for final result', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.equal(typeof a.actions.accounts.openLoginPage, 'function');
  const login = a.actions.accounts.login();
  await f.current();
  f.loginBegins[0].resolve({
    id: 'expired',
    user_code: 'CODE',
    verification_uri: 'https://example.test',
    expires_at: 1,
  });
  await f.current();
  await a.actions.accounts.openLoginPage();
  assert.equal(f.promptOpens.length, 0);
  assert.equal((await f.current()).snapshot.accounts.promptExpired, true);
  const cancel = a.actions.accounts.cancelLogin();
  f.loginCancels[0].resolve();
  await cancel;
  assert.equal((await f.current()).snapshot.accounts.pending, true);
  f.loginCompletions[0].reject('auth.errors.cancelled');
  assert.equal(await login, false);
  assert.equal((await f.current()).snapshot.accounts.pending, false);
  a.actions.accounts.patchClientId('unfinished-client');
  await f.current();
  assert.equal((await f.current()).snapshot.accounts.clientIdDraft, 'unfinished-client');
  a.actions.accounts.beginLogout('missing');
  assert.equal((await f.current()).snapshot.accounts.removingId, null);
  a.actions.accounts.beginLogout('a');
  const logout = a.actions.accounts.confirmLogout();
  await f.current();
  assert.equal(await a.actions.accounts.select(null), false);
  f.logouts[0].resolve({ ...f.accounts, accounts: [] });
  assert.equal(await logout, true);
  assert.equal((await f.current()).snapshot.accounts.removingId, null);
  f.host.unmount();
});
await test('java_draft_and_direct_major_guard: raw text, numeric bounds, current game and canonical inspected path', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.equal(typeof a.actions.java.patchDownloadMajor, 'function');
  a.actions.java.patchDownloadMajor('8x');
  assert.equal((await f.current()).snapshot.java.downloadMajorDraft, '8x');
  assert.equal(await a.actions.java.downloadEnteredMajor(), false);
  for (const major of [7, 100, 8.1, NaN, Infinity])
    assert.equal(await a.actions.downloads.java(major), false);
  assert.deepEqual(f.javaDownloads, []);
  const events = f.subscriptions.find((x) => x.kind === 'launcher').callbacks;
  events[0]({ action: 'launch', status: 'running', message: '' });
  assert.equal(await a.actions.downloads.java(17), false);
  events[0]({ action: 'launch', status: 'finished', message: '' });
  a.actions.java.patchDownloadMajor('21');
  assert.equal(await a.actions.java.downloadEnteredMajor(), true);
  assert.deepEqual(f.javaDownloads, [21]);
  const pick = a.actions.java.chooseForSettings();
  f.javaPicks[0].resolve('C:/raw/java');
  await f.current();
  assert.equal(f.javaInspections[0].path, 'C:/raw/java');
  assert.notEqual((await f.current()).snapshot.settings.draft.java_executable, 'C:/raw/java');
  f.javaInspections[0].resolve({
    executable: 'C:/canonical/java.exe',
    java_home: 'C:/canonical',
    major_version: 21,
    version: '21',
    vendor: 'Test',
    architecture: 'x64',
    source: 'manual',
  });
  await pick;
  assert.equal(
    (await f.current()).snapshot.settings.draft.java_executable,
    'C:/canonical/java.exe',
  );
  f.host.unmount();
});
await test('avatar_shared_across_views: permanent cache rejects obsolete identity and reader performs no requests', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.ok(a.snapshot.avatars, 'permanent avatar snapshot must exist');
  f.accounts.accounts[0].skin_url = 'skin-a';
  await a.actions.accounts.reload();
  await f.current();
  assert.equal(f.skinRequests.length, 1);
  f.accounts.accounts[0].skin_url = 'skin-b';
  await a.actions.accounts.reload();
  await f.current();
  f.skinRequests[0].resolve('OLD');
  await f.current();
  assert.equal((await f.current()).snapshot.avatars.a, null);
  f.skinRequests[1].resolve('NEW');
  assert.equal((await f.current()).snapshot.avatars.a, 'data:image/png;base64,NEW');
  await a.actions.accounts.reload();
  await f.current();
  assert.equal(f.skinRequests.length, 2);
  publicValue((await f.current()).snapshot.avatars);
  f.host.unmount();
});
await test('content_root_paging_and_mutation_guards: committed paging, current root and stale mutation release', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.content.selectProfile('original-instance');
  await f.current();
  const entry = { name: 'local.jar', category: 'mods', size: 20, enabled: true, record: null };
  f.contentLists[0].resolve([entry]);
  await f.current();
  await a.actions.content.toggleMod('not-present');
  assert.equal(f.contentMutations.length, 0);
  const mutation = a.actions.content.toggleMod('local.jar');
  await f.current();
  a.actions.content.setCategory('resourcepacks');
  await f.current();
  f.contentMutations[0].resolve();
  await mutation;
  await f.current();
  assert.equal(f.contentLists.length, 2, 'obsolete mutation does not refresh the new category');
  f.contentLists[1].resolve([{ ...entry, category: 'resourcepacks' }]);
  await f.current();
  f.server.config.settings.game_directory = 'D:/changed-root';
  await a.actions.config.reload();
  await f.current();
  assert.equal((await f.current()).snapshot.content.list, null);
  f.contentLists[2].resolve([entry]);
  assert.equal((await f.current()).snapshot.content.list.directory, 'D:/changed-root');
  a.actions.content.patchSearch({ query: 'committed', kind: 'modpack' });
  const search = a.actions.content.search();
  await f.current();
  f.contentSearches[0].resolve({ hits: [], total_hits: 80, offset: 0 });
  await search;
  a.actions.content.patchSearch({ query: 'unfinished', kind: 'shader' });
  const page = a.actions.content.search(20);
  await f.current();
  assert.deepEqual(
    [f.contentSearches[1].query, f.contentSearches[1].kind, f.contentSearches[1].offset],
    ['committed', 'modpack', 20],
  );
  f.contentSearches[1].resolve({ hits: [], total_hits: 80, offset: 20 });
  await page;
  const previous = a.actions.content.search(0);
  await f.current();
  assert.deepEqual(
    [f.contentSearches[2].query, f.contentSearches[2].kind, f.contentSearches[2].offset],
    ['committed', 'modpack', 0],
  );
  f.contentSearches[2].resolve({ hits: [], total_hits: 80, offset: 0 });
  await previous;
  await a.actions.content.search(10020);
  assert.equal(f.contentSearches.length, 3);
  f.host.unmount();
});
await test('prompt_current_mutex_and_cancel_retry: same-turn cancel blocks open, stale open cannot release new prompt', async () => {
  const f = await fixture();
  const a = await f.current();
  const login = a.actions.accounts.login();
  await f.current();
  f.loginBegins[0].resolve({
    id: 'one',
    user_code: 'CODE',
    verification_uri: 'https://example.test',
    expires_at: Date.now() / 1000 + 60,
  });
  await f.current();
  const open = a.actions.accounts.openLoginPage();
  await a.actions.accounts.openLoginPage();
  assert.equal(f.promptOpens.length, 1);
  const cancel = a.actions.accounts.cancelLogin();
  await a.actions.accounts.openLoginPage();
  assert.equal(f.promptOpens.length, 1);
  f.loginCancels[0].reject('auth.network');
  await cancel;
  f.promptOpens[0].resolve();
  await open;
  const retryOpen = a.actions.accounts.openLoginPage();
  assert.equal(f.promptOpens.length, 2, 'failed cancellation restores prompt retry before render');
  f.promptOpens[1].resolve();
  await retryOpen;
  const heldOpen = a.actions.accounts.openLoginPage();
  f.loginCompletions[0].reject('auth.errors.cancelled');
  await login;
  await f.current();
  const nextLogin = a.actions.accounts.login();
  await f.current();
  f.loginBegins[1].resolve({
    id: 'two',
    user_code: 'NEXT',
    verification_uri: 'https://example.test',
    expires_at: Date.now() / 1000 + 60,
  });
  await f.current();
  const newOpen = a.actions.accounts.openLoginPage();
  f.promptOpens[2].reject('obsolete');
  await heldOpen;
  assert.equal((await f.current()).snapshot.accounts.promptActionPending, 'open');
  f.promptOpens[3].resolve();
  await newOpen;
  f.loginCompletions[1].resolve(f.accounts);
  await nextLogin;
  f.host.unmount();
});
await test('java_choose_current_lifecycle_and_manual_edit: reconnect permits current choice and old completion cannot overwrite', async () => {
  const f = await fixture();
  const a = await f.current();
  const old = a.actions.java.chooseForSettings();
  assert.equal(
    a.services.getInteractionState().picking,
    true,
    'Java picker ownership blocks shortcuts before render',
  );
  await f.current();
  f.host.reconnectEffects();
  await f.current();
  const next = a.actions.java.chooseForSettings();
  await f.current();
  assert.equal(
    f.javaPicks.length,
    2,
    'a previous lifecycle picker does not reserve the next lifecycle',
  );
  f.javaPicks[0].resolve('old');
  await old;
  f.javaPicks[1].resolve('new');
  await f.current();
  a.actions.settings.patch('java_executable', 'manual-current');
  await f.current();
  f.javaInspections[0].resolve({
    executable: 'normalized-new',
    java_home: '',
    major_version: 21,
    version: '21',
    vendor: '',
    architecture: 'x64',
    source: 'manual',
  });
  await next;
  assert.equal((await f.current()).snapshot.settings.draft.java_executable, 'manual-current');
  const failure = a.actions.java.chooseForSettings();
  f.javaPicks[2].resolve('bad');
  await f.current();
  f.javaInspections[1].reject('bad java');
  await failure;
  assert.equal((await f.current()).snapshot.settings.draft.java_executable, 'manual-current');
  f.host.unmount();
});
await test('review_java_manual_patch_before_render_survives_inspection: current settings owner protects newer input', async () => {
  const f = await fixture();
  const a = await f.current();
  const pick = a.actions.java.chooseForSettings();
  f.javaPicks[0].resolve('chosen-raw');
  await f.current(); // Inspection is now reserved and held.
  assert.equal(f.javaInspections.length, 1);
  a.actions.settings.patch('java_executable', 'manual-newer-before-render');
  // Deliberately no Provider render between the later edit and completion.
  f.javaInspections[0].resolve({
    executable: 'canonical-older-choice',
    java_home: '',
    major_version: 21,
    version: '21',
    vendor: '',
    architecture: 'x64',
    source: 'manual',
  });
  await pick;
  assert.equal(
    (await f.current()).snapshot.settings.draft.java_executable,
    'manual-newer-before-render',
  );
  f.host.unmount();
});
await test('java_current_draft_at_choice_invocation: an existing same-turn manual draft still allows canonical success', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.settings.patch('java_executable', 'manual-at-invocation');
  const pick = a.actions.java.chooseForSettings();
  f.javaPicks[0].resolve('chosen-raw');
  await f.current();
  f.javaInspections[0].resolve({
    executable: 'canonical-current-choice',
    java_home: '',
    major_version: 21,
    version: '21',
    vendor: '',
    architecture: 'x64',
    source: 'manual',
  });
  await pick;
  assert.equal(
    (await f.current()).snapshot.settings.draft.java_executable,
    'canonical-current-choice',
  );
  f.host.unmount();
});
await test('content_actions_current_boundaries: preview/game/download/saves/vanilla membership and stale picker exclusion', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.content.selectProfile('original-instance');
  await f.current();
  f.contentLists[0].resolve([
    { name: 'local.jar', category: 'mods', size: 1, enabled: true, record: null },
  ]);
  await f.current();
  const events = f.subscriptions.find((x) => x.kind === 'launcher').callbacks;
  events[0]({ action: 'launch', status: 'running', message: '' });
  await a.actions.content.toggleMod('local.jar');
  a.actions.content.beginRemove('local.jar');
  assert.equal(f.contentMutations.length, 0);
  assert.equal((await f.current()).snapshot.content.removing, null);
  events[0]({ action: 'launch', status: 'finished', message: '' });
  a.actions.content.patchSearch({ kind: 'mod' });
  const search = a.actions.content.search();
  await f.current();
  f.contentSearches[0].resolve({
    hits: [
      { project_id: 'mod', title: 'Mod', description: '', project_type: 'mod', downloads: 1 },
      { project_id: 'pack', title: 'Pack', description: '', project_type: 'modpack', downloads: 1 },
    ],
    total_hits: 2,
    offset: 0,
  });
  await search;
  await a.actions.content.installProject('mod', 'mod');
  await a.actions.content.installProject('', 'modpack');
  assert.deepEqual(f.contentEnqueues, []);
  assert.deepEqual(f.packEnqueues, []);
  a.actions.content.selectProfile(null);
  await a.actions.content.installProject('pack', 'modpack');
  assert.deepEqual(f.packEnqueues, [{ source: 'pack', remote: true }]);
  const old = a.actions.content.importPack();
  await f.current();
  f.host.reconnectEffects();
  await f.current();
  const current = a.actions.content.importPack();
  await f.current();
  assert.equal(f.packPicks.length, 2);
  f.packPicks[0].resolve('old-pack');
  await old;
  assert.equal(
    (await f.current()).services.getInteractionState().picking,
    true,
    'stale picker cannot clear the current picker interaction guard',
  );
  f.packPicks[1].resolve(null);
  await current;
  f.host.unmount();
  const preview = await fixture({ desktop: false });
  const p = await preview.current();
  await p.actions.content.importPack();
  p.actions.accounts.beginLogout('a');
  await p.actions.accounts.confirmLogout();
  assert.equal(preview.packPicks.length, 0);
  assert.equal(preview.logouts.length, 0);
  preview.host.unmount();
});
await test('direct_remote_content_ID_without_search: hardcoded IDs retain local member and profile compatibility guards', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.equal(a.snapshot.content.results, null);
  a.actions.content.selectProfile(null);
  await a.actions.content.installProject(' hardcoded-pack ', 'modpack');
  assert.deepEqual(f.packEnqueues, [{ source: 'hardcoded-pack', remote: true }]);
  await a.actions.content.installProject(' ', 'modpack');
  await a.actions.content.installProject('valid-id', 'invalid');
  for (const invalid of ['../escape', 'a/b', 'x'.repeat(129), 21]) {
    await assert.doesNotReject(a.actions.content.installProject(invalid, 'modpack'));
    assert.equal(f.packEnqueues.length, 1, 'invalid remote identifiers never enter the queue');
  }
  await a.actions.content.installProject('valid-id', 'mod');
  assert.equal(f.packEnqueues.length, 1);
  assert.deepEqual(f.contentEnqueues, []);
  a.actions.content.selectProfile('original-instance');
  await f.current();
  f.contentLists[0].resolve([]);
  await f.current();
  await a.actions.content.installProject('valid-mod', 'mod');
  assert.deepEqual(f.contentEnqueues, [], 'Vanilla cannot install mods');
  const resource = a.actions.content.installProject(' direct-resource ', 'resourcepack');
  await f.current();
  assert.deepEqual(f.contentEnqueues, [
    { key: 'original-instance', project: 'direct-resource', kind: 'resourcepack' },
  ]);
  f.contentLists[1].resolve([]);
  await resource;
  f.host.unmount();
});
await test('java_choose_inspect_precedes_deferred_discovery: queued discovery cannot steal the canonical inspection handoff', async () => {
  const f = await fixture();
  const a = await f.current();
  const pick = a.actions.java.chooseForSettings();
  await a.actions.java.discover();
  f.javaPicks[0].resolve('raw-chosen');
  await f.current();
  assert.equal(
    f.javaInspections.length,
    1,
    'choose must inspect even when discovery was requested during the picker',
  );
  assert.equal(f.javaInspections[0].path, 'raw-chosen');
  f.javaInspections[0].resolve({
    executable: 'canonical-chosen',
    java_home: '',
    major_version: 21,
    version: '21',
    vendor: '',
    architecture: 'x64',
    source: 'manual',
  });
  await pick;
  assert.equal((await f.current()).snapshot.settings.draft.java_executable, 'canonical-chosen');
  assert.equal(f.counts.java, 2, 'inspection discovery plus the queued discovery both complete');
  f.host.unmount();
});
await test('current_prompt_and_java_support_before_render: new prompt operation and unsupported discovery use current ACK refs', async (context) => {
  const f = await fixture();
  const a = await f.current();
  context.after(() => f.host.unmount());
  const login = a.actions.accounts.login();
  f.loginBegins[0].resolve({
    id: 'old',
    user_code: 'OLD',
    verification_uri: 'https://example.test',
    expires_at: Date.now() / 1000 + 60,
  });
  await f.current();
  const oldOpen = a.actions.accounts.openLoginPage();
  f.loginCompletions[0].reject('auth.errors.cancelled');
  await login;
  const nextLogin = a.actions.accounts.login();
  f.loginBegins[1].resolve({
    id: 'next',
    user_code: 'NEXT',
    verification_uri: 'https://example.test',
    expires_at: Date.now() / 1000 + 60,
  });
  await new Promise(setImmediate); // Drain IPC promises, deliberately do not render the Provider.
  const newOpen = a.actions.accounts.openLoginPage();
  assert.equal(
    f.promptOpens.length,
    2,
    'a current prompt may reserve open before React renders its ID',
  );
  await f.current();
  f.promptOpens[0].resolve();
  await oldOpen;
  assert.equal((await f.current()).snapshot.accounts.promptActionPending, 'open');
  f.promptOpens[1].resolve();
  await newOpen;
  f.loginCompletions[1].resolve(f.accounts);
  await nextLogin;
  f.server.javaSupported = false;
  await a.actions.java.discover();
  assert.equal(
    await a.actions.downloads.java(17),
    false,
    'discovery support is current immediately after the ACK',
  );
  assert.deepEqual(f.javaDownloads, []);
  f.host.unmount();
});
await test('content_mutation_ACK_releases_pending_before_list_read: refresh remains independent of mutation completion', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.content.selectProfile('original-instance');
  await f.current();
  f.contentLists[0].resolve([
    { name: 'local.jar', category: 'mods', size: 1, enabled: true, record: null },
  ]);
  await f.current();
  let completed = false;
  const mutation = a.actions.content.toggleMod('local.jar').then(() => {
    completed = true;
  });
  f.contentMutations[0].resolve();
  await new Promise(setImmediate);
  assert.equal(completed, true, 'a held post-mutation list read does not retain operation pending');
  assert.equal((await f.current()).snapshot.content.pending, false);
  assert.equal(f.contentLists.length, 2);
  f.contentLists[1].resolve([]);
  await mutation;
  f.host.unmount();
});
await test('content_navigation_identity_before_effect: new route profile never renders prior-profile list', async () => {
  const f = await fixture();
  const a = await f.current();
  f.server.config.profiles.push({
    ...f.server.config.profiles[0],
    instance_key: 'b',
    name: 'B',
    game_directory: 'B:/game',
  });
  await a.actions.config.reload();
  await f.current();
  a.actions.navigation.navigate('content', { profileKey: 'original-instance' });
  await f.current();
  f.contentLists[0].resolve([
    { name: 'old.jar', category: 'mods', enabled: true, size: 1, record: null },
  ]);
  await f.current();
  const start = f.snapshotHistory.length;
  a.actions.navigation.navigate('content', { profileKey: 'b' });
  await f.current();
  assert.ok(
    f.snapshotHistory
      .slice(start)
      .every((snapshot) => snapshot.content.list?.profileKey !== 'original-instance'),
    'the first route render excludes the prior profile before controller effects run',
  );
  f.contentLists[1].resolve([]);
  await f.current();
  f.host.unmount();
});
await test('content_success_notice_uses_current_translation: exported and queued messages stay user-facing', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.content.selectProfile(null);
  await a.actions.content.installProject('direct-pack', 'modpack');
  assert.equal(
    (await f.current()).snapshot.notifications.items.at(-1).message,
    'Queued translated',
  );
  a.actions.content.selectProfile('original-instance');
  a.actions.content.setIncludeSaves(true);
  const exportAction = a.actions.content.exportInstance();
  f.app('i18n.ts').default.language = 'zh-CN';
  assert.deepEqual([f.exports[0].key, f.exports[0].includeSaves], ['original-instance', true]);
  f.exports[0].resolve(true);
  await exportAction;
  assert.equal((await f.current()).snapshot.notifications.items.at(-1).message, 'Exported Chinese');
  f.host.unmount();
});
await test('snapshot_is_public_and_readonly: runtime allowlist, deep freeze and editable internal draft', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.equal(f.reads.length, 1);
  assert.equal(f.accountReads.length, 1);
  assert.equal(f.recoveries.length, 1);
  assert.deepEqual(f.subscriptions.map((x) => x.kind).sort(), ['close', 'downloads', 'launcher']);
  assert.equal(f.subscriptions.filter((x) => x.active).length, 3);
  publicValue(a.snapshot);
  assert.throws(() => {
    a.snapshot.settings.draft.memory_mb = 1;
  }, TypeError);
  assert.deepEqual(a.snapshot.accounts.state.accounts, [{ id: 'a', name: 'Alex', skin_url: null }]);
  assert.equal(JSON.stringify(a.snapshot).includes('SECRET'), false);
  assert.equal(Object.hasOwn(a.actions, 'runAction'), false);
  assert.equal(Object.hasOwn(a.actions, 'services'), false);
  a.actions.settings.patch('memory_mb', 6144);
  a.actions.settings.patchPersonalization('font', 'arial');
  a.actions.settings.patchPersonalization('background_fit', 'contain');
  const b = await f.current();
  assert.equal(a.actions, b.actions);
  assert.equal(b.snapshot.settings.draft.memory_mb, 6144);
  assert.equal(b.snapshot.settings.draft.personalization.font, 'arial');
  assert.equal(b.snapshot.settings.draft.personalization.background_fit, 'contain');
  assert.equal(a.snapshot.settings.draft.memory_mb, 4096);
  assert.equal(
    f.app('launcher/public/index.ts').getProfileCapabilities(b.snapshot, 'original-instance'),
    b.snapshot.profiles.items[0].capabilities,
  );
  f.host.unmount();
});
await test('one_controller_and_config_queue: current-draft actions serialize save, reload and second write; failure releases pending', async () => {
  const f = await fixture({ holdWrites: true });
  const a = await f.current();
  a.actions.settings.patch('memory_mb', 6144);
  await f.current();
  const save = a.actions.settings.save();
  await f.current();
  const reload = a.actions.config.reload();
  a.actions.settings.patch('memory_mb', 8192);
  await f.current();
  const second = a.actions.settings.save();
  await f.current();
  assert.equal(f.writes.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.writes[0].config.settings.memory_mb, 6144);
  f.writes[0].finish();
  assert.equal(await save, true, JSON.stringify((await f.current()).snapshot.logs.lines));
  await f.current();
  assert.equal(f.reads.length, 2);
  await reload;
  await f.current();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].config.settings.memory_mb, 8192);
  f.writes[1].reject(new Error('write failed'));
  assert.equal(await second, false);
  const b = await f.current();
  assert.equal(b.snapshot.settings.saving, false);
  assert.equal(b.snapshot.settings.draft.memory_mb, 8192);
  f.host.unmount();
});
await test('shared navigation preserves unfinished search; navigate clears query and route params', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.navigation.navigate('content', { profileKey: 'original-instance' });
  a.actions.navigation.setSearch('unfinished query');
  const b = await f.current();
  assert.equal(b.snapshot.navigation.search, 'unfinished query');
  assert.equal(b.snapshot.navigation.params.profileKey, 'original-instance');
  a.actions.navigation.navigate('instances');
  const c = await f.current();
  assert.equal(c.snapshot.navigation.search, '');
  assert.deepEqual(c.snapshot.navigation.params, {});
  assert.equal(c.actions, a.actions);
  f.host.unmount();
});
await test('background/directory pick use latest draft and isolate stale completions; closing does not update after teardown', async () => {
  const f = await fixture();
  const a = await f.current();
  const pick = a.actions.settings.chooseBackground();
  a.actions.settings.patchPersonalization('font', 'serif');
  await f.current();
  f.backgrounds[0].resolve('new-background');
  await pick;
  let b = await f.current();
  assert.equal(b.snapshot.settings.draft.personalization.font, 'serif');
  assert.equal(b.snapshot.settings.draft.personalization.background_file, 'new-background');
  const directory = a.actions.settings.chooseGameDirectory();
  const closing = a.actions.window.respondToClose('stay');
  f.host.unmount();
  f.directories[0].resolve('late-directory');
  f.closes[0].reject(new Error('late close error'));
  await Promise.all([directory, closing]);
  assert.equal(f.host.updatesAfterUnmount, 0);
});
await test('reconnect effects: delayed old subscription and bootstrap success/failure cannot own new lifecycle', async () => {
  for (const fail of [false, true]) {
    const f = await fixture({ holdBootstrap: true, holdSubscriptions: true });
    f.host.reconnectEffects();
    await f.current();
    for (const item of f.subscriptions) item.finish();
    if (fail) f.reads[0].reject(new Error('obsolete bootstrap'));
    else {
      const stale = structuredClone(f.server);
      stale.config.settings.memory_mb = 1;
      f.reads[0].resolve(stale);
    }
    const current = await f.current();
    assert.equal(current.snapshot.settings.draft.memory_mb, 4096);
    assert.equal(current.snapshot.config.fatal, null);
    assert.equal(f.subscriptions.filter((x) => x.active).length, 3);
    f.subscriptions[0].callbacks[0]({ action: 'launch', status: 'running', message: 'old' });
    f.subscriptions[1].callbacks[0]([{ id: 'old', kind: 'install', status: 'running' }]);
    f.subscriptions[2].callbacks[0]({ game_running: true, downloads_active: true });
    const after = await f.current();
    assert.equal(after.snapshot.activity, null);
    assert.equal(after.snapshot.downloads.active, false);
    assert.equal(after.snapshot.window.request, null);
    f.host.unmount();
    assert.equal(f.subscriptions.filter((x) => x.active).length, 0);
  }
});
await test('pack completed/failed/cancelled terminals retain reload then scan callback exactly once', async () => {
  const f = await fixture();
  const emit = f.subscriptions.find((x) => x.kind === 'downloads').callbacks[0];
  const tasks = ['completed', 'failed', 'cancelled'].map((status) => ({
    id: status,
    kind: 'pack',
    status,
    profile_key: null,
    java_major: null,
    name: status,
    message: status,
    progress: null,
  }));
  emit(tasks);
  await f.current();
  assert.equal(f.reads.length, 4);
  assert.equal(f.counts.scan, 4);
  emit(tasks);
  await f.current();
  assert.equal(f.reads.length, 4);
  assert.equal(f.counts.scan, 4);
  f.host.unmount();
});
await test('public loadError normalizes arbitrary failure data', async () => {
  const f = await fixture({ accountFailure: true });
  const a = await f.current();
  assert.deepEqual(Object.keys(a.snapshot.accounts.loadError), ['message']);
  assert.equal(JSON.stringify(a.snapshot).includes('ERROR_SECRET'), false);
  f.host.unmount();
});
await test('public barrel/aliases/compiler export no private ownership', async () => {
  const barrel = readFileSync(resolve(uiRoot, 'src/launcher/public/index.ts'), 'utf8');
  assert.doesNotMatch(barrel, /LauncherProvider|LauncherServices|Compatibility|api|hooks\//);
  const compiler = readFileSync(resolve(uiRoot, 'src/ui-suite/publicModules.ts'), 'utf8');
  assert.match(compiler, /from '\.\.\/launcher\/public\/index'/);
  assert.match(compiler, /from '\.\.\/ui-foundation\/index'/);
});

await test('public notifications preserve saved preferences, translation and dedup before the shared store', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.settings.patchPersonalization('notifications', false);
  await f.current();
  const before = a.actions.notifications.publish('success', 'visible before save');
  assert.ok(before);
  await a.actions.settings.save();
  await f.current();
  const suppressed = a.actions.notifications.publish('success', 'suppressed after save');
  assert.equal(suppressed, '');
  const error = a.actions.notifications.publish('error', 'visible error');
  assert.ok(error);
  assert.equal(a.actions.notifications.publish('error', 'visible error'), error);
  const b = await f.current();
  assert.equal(
    b.snapshot.notifications.items.filter((notice) => notice.message === 'visible error').length,
    1,
  );
  f.host.unmount();
});
await test('Java/catalog reconnect: old completion cannot release the next operation pending ownership', async () => {
  for (const domain of ['java', 'catalog']) {
    const host = hookHost();
    const requests = [];
    const run = () => {
      const response = deferred();
      requests.push(response);
      return response.promise;
    };
    const app = loadApp(
      new Map([
        ['react', host.hooks],
        [resolve(uiRoot, 'src/api.ts'), { discoverJava: run, catalog: run }],
      ]),
    );
    const report = () => {};
    const hook =
      domain === 'java' ? app('hooks/useJava.ts').useJava : app('hooks/useCatalog.ts').useCatalog;
    host.mount(() => hook(report));
    let current = await host.settle();
    const command = (value) => (domain === 'java' ? value.discover() : value.refreshCatalog());
    const old = command(current);
    await host.settle();
    host.reconnectEffects();
    current = await host.settle();
    const next = command(current);
    await host.settle();
    assert.equal(requests.length, 2);
    requests[0].resolve(
      domain === 'java'
        ? { installations: [], warnings: [], download_supported: true }
        : { versions: [], source: 'cache' },
    );
    await old;
    current = await host.settle();
    assert.equal(domain === 'java' ? current.busy : current.catalogBusy, true);
    void command(current);
    await host.settle();
    assert.equal(requests.length, 2, 'obsolete finally cannot allow a concurrent next request');
    requests[1].resolve(
      domain === 'java'
        ? { installations: [], warnings: [], download_supported: false }
        : { versions: [], source: 'cache' },
    );
    await next;
    await host.settle();
    // Java intentionally queues one follow-up discovery; release it before cleanup.
    if (requests[2])
      requests[2].resolve({ installations: [], warnings: [], download_supported: false });
    await host.settle();
    host.unmount();
  }
});

await test('launch_guards_without_buttons: readiness, pending, config/download/activity and unknown account stay guarded', async () => {
  const f = await fixture({ holdAccounts: true });
  let a = await f.current();
  assert.ok(a.actions.launch, 'permanent launch actions must exist outside App');
  await a.actions.launch.request('original-instance');
  assert.equal(f.counts.launch, 0);
  assert.equal(a.snapshot.launch.selection, null);
  f.accountReads[0].resolve(f.accounts);
  a = await f.current();
  await a.actions.launch.request('missing');
  assert.equal(f.counts.launch, 0);
  await a.actions.launch.request('original-instance');
  a = await f.current();
  a.actions.launch.chooseAccount('unknown');
  assert.equal((await f.current()).snapshot.launch.selection.accountId, 'a');
  const emit = f.subscriptions.find((x) => x.kind === 'downloads').callbacks[0];
  emit([
    { id: 'blocking', kind: 'java', status: 'running', name: 'Java', message: '', progress: null },
  ]);
  await f.current();
  await a.actions.launch.confirmAccount();
  assert.equal(f.selections.length, 0);
  assert.equal(f.counts.launch, 0);
  emit([]);
  await f.current();
  a.actions.launch.cancelSelection();
  f.subscriptions
    .find((x) => x.kind === 'launcher')
    .callbacks[0]({ action: 'launch', status: 'cancelling', message: '' });
  await f.current();
  await a.actions.launch.request('original-instance');
  assert.equal((await f.current()).snapshot.launch.selection, null);
  assert.equal(f.counts.launch, 0);
  f.host.unmount();
});
await test('account_selection_commit_before_launch: single ACK, latest guards and cancel/reopen ownership', async () => {
  for (const outcome of ['success', 'failure', 'download', 'profile', 'cancel']) {
    const f = await fixture({ holdSelect: true });
    const a = await f.current();
    assert.ok(a.actions.launch, 'permanent launch selection owner must exist');
    await a.actions.launch.request('original-instance');
    a.actions.launch.chooseAccount(null);
    const first = a.actions.launch.confirmAccount(),
      second = a.actions.launch.confirmAccount();
    await f.current();
    assert.equal(f.selections.length, 1);
    assert.equal(f.selections[0].id, null);
    assert.equal(f.counts.launch, 0);
    if (outcome === 'download') {
      f.subscriptions
        .find((x) => x.kind === 'downloads')
        .callbacks[0]([
          { id: 'block', kind: 'java', status: 'running', name: '', message: '', progress: null },
        ]);
      await f.current();
    }
    if (outcome === 'profile') {
      f.server.config.profiles[0].game_version = '1.20.1';
      await a.actions.config.reload();
      await f.current();
    }
    if (outcome === 'cancel') {
      a.actions.launch.cancelSelection();
      await a.actions.launch.request('original-instance');
    }
    if (outcome === 'failure') f.selections[0].reject(new Error('select failed'));
    else f.selections[0].resolve({ ...f.accounts, active: null });
    await Promise.all([first, second]);
    const b = await f.current();
    assert.equal(f.counts.launch, outcome === 'success' ? 1 : 0, outcome);
    if (outcome === 'success') assert.equal(b.snapshot.launch.selection, null);
    else if (outcome !== 'cancel')
      assert.ok(b.snapshot.launch.selection, 'failed/revoked submission retains draft');
    assert.equal(b.snapshot.launch.selection?.submitting ?? false, false);
    f.host.unmount();
  }
});
await test('same_tick_launch_guards: account reload and config write reserve ownership before rendering', async () => {
  const f = await fixture({ holdWrites: true });
  const a = await f.current();
  assert.ok(a.actions.launch, 'launch guards must be reachable without rendering a button');
  const reload = a.actions.accounts.reload();
  await a.actions.launch.request('original-instance');
  assert.equal((await f.current()).snapshot.launch.selection, null);
  await reload;
  await f.current();
  const save = a.actions.settings.save();
  await a.actions.launch.request('original-instance');
  assert.equal((await f.current()).snapshot.launch.selection, null);
  f.writes[0].finish();
  await save;
  f.host.unmount();
});
await test('uninstalled_request_uses_existing_install_queue: account readiness does not block enqueue or bypass dedup', async () => {
  const f = await fixture({ holdAccounts: true });
  const a = await f.current();
  f.server.config.profiles[0].game_version = '1.20.1';
  await a.actions.config.reload();
  await f.current();
  f.subscriptions
    .find((x) => x.kind === 'downloads')
    .callbacks[0]([
      { id: 'another', kind: 'java', name: 'Java', status: 'running', message: '', progress: null },
    ]);
  await f.current();
  await Promise.all([
    a.actions.launch.request('original-instance'),
    a.actions.launch.request('original-instance'),
  ]);
  assert.equal(f.counts.install, 1);
  assert.equal(f.counts.launch, 0);
  f.host.unmount();
});
await test('drafts_survive_view_switch: rows stay independent and invalid settings never reach queue', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.ok(a.actions.instanceDraft, 'instance draft must be owned by Provider');
  a.actions.instanceDraft.open('original-instance');
  a.actions.instanceDraft.setEnvironment([{ key: '', value: 'unfinished' }]);
  a.actions.navigation.navigate('settings');
  a.actions.navigation.navigate('instances');
  let b = await f.current();
  assert.equal(b.snapshot.instanceDraft.environment[0].value, 'unfinished');
  assert.equal(await a.actions.instanceDraft.submit(), false);
  assert.equal(f.profileWrites.length, 0);
  assert.equal(
    (await f.current()).snapshot.notifications.items.filter(
      (item) => item.message === 'content.errors.environment',
    ).length,
    1,
  );
  a.actions.instanceDraft.setEnvironment([{ key: 'FOO', value: '  a=b\n' }]);
  const picker = a.actions.instanceDraft.chooseJava();
  assert.equal(await a.actions.instanceDraft.submit(), false);
  a.actions.instanceDraft.cancel();
  a.actions.instanceDraft.open('original-instance');
  a.actions.instanceDraft.patch({ name: 'New ownership' });
  f.javaPicks[0].resolve('C:/old/java.exe');
  await picker;
  b = await f.current();
  assert.equal(b.snapshot.instanceDraft.profile.name, 'New ownership');
  assert.equal(b.snapshot.instanceDraft.profile.overrides.java_executable, undefined);
  assert.equal(b.snapshot.instanceDraft.picking, false);
  a.actions.instanceDraft.setEnvironment([{ key: 'FOO', value: '  a=b\n' }]);
  const submit = a.actions.instanceDraft.submit();
  await f.current();
  assert.deepEqual(f.profileWrites[0].profile.overrides.environment, { FOO: '  a=b\n' });
  f.profileWrites[0].resolve(f.server.config);
  assert.equal(await submit, true);
  assert.equal((await f.current()).snapshot.instanceDraft.profile, null);
  f.host.unmount();
});
await test('import_and_delete_validate_inside_actions: current scan eligibility and exact file confirmation', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.ok(a.actions.importDraft, 'import scan owner must be permanent');
  a.actions.importDraft.open();
  a.actions.importDraft.setDirectory('C:/first');
  const old = a.actions.importDraft.scan();
  a.actions.importDraft.setDirectory('C:/second');
  assert.equal((await f.current()).snapshot.importDraft.scanning, false);
  const next = a.actions.importDraft.scan();
  f.importScans[0].resolve([
    { instance_key: 'old', loader: 'vanilla', game_version: '1.21.1', root: 'C:/first' },
  ]);
  await old;
  assert.equal((await f.current()).snapshot.importDraft.scanning, true);
  f.importScans[1].resolve([
    { instance_key: 'ok', loader: 'vanilla', game_version: '1.21.1', root: 'C:/second' },
    { instance_key: 'modded', loader: 'fabric', game_version: '1.21.1', root: 'C:/second' },
  ]);
  await next;
  await f.current();
  a.actions.importDraft.setSelected(['missing', 'modded']);
  assert.equal(await a.actions.importDraft.submit(), false);
  assert.equal(f.counts.imported, 0);
  a.actions.importDraft.setSelected(['ok']);
  a.actions.importDraft.setDirectory('C:/third');
  assert.equal(await a.actions.importDraft.submit(), false);
  assert.equal(f.counts.imported, 0);
  a.actions.importDraft.cancel();
  a.actions.removal.open('original-instance');
  a.actions.removal.setDeleteFiles(true);
  a.actions.removal.setConfirmation('Original world ');
  assert.equal(await a.actions.removal.submit(), false);
  assert.equal(f.counts.removed, 0);
  a.actions.removal.setConfirmation('Original world');
  const first = a.actions.removal.submit(),
    second = a.actions.removal.submit();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(f.counts.removed, 1);
  f.host.unmount();
});
await test('loader_catalog_current_membership: patch invalidates immediately; explicit query shares one owner', async () => {
  const f = await fixture();
  const a = await f.current();
  assert.ok(a.actions.profileDraft, 'profile draft/catalog owner must be permanent');
  a.actions.profileDraft.openCreate('1.21.1');
  a.actions.profileDraft.patch({ name: 'New', loader: 'fabric' });
  const old = a.actions.catalog.requestLoaders('fabric', '1.21.1');
  a.actions.profileDraft.patch({ version: '1.20.1', loader_version: 'old' });
  assert.equal((await f.current()).snapshot.profileDraft.editor.loader_version, '');
  const current = a.actions.catalog.requestLoaders('fabric', '1.20.1');
  const duplicate = a.actions.catalog.requestLoaders('fabric', '1.20.1');
  assert.equal(f.loaderRequests.length, 2);
  f.loaderRequests[0].resolve([{ version: 'old', stable: true }]);
  await old;
  assert.equal((await f.current()).snapshot.catalog.loaders.pending, true);
  f.loaderRequests[1].resolve([{ version: 'current', stable: true }]);
  await Promise.all([current, duplicate]);
  a.actions.profileDraft.patch({ loader_version: 'old' });
  assert.equal(await a.actions.profileDraft.submit(), false);
  a.actions.profileDraft.patch({ loader_version: 'current' });
  let b = await f.current();
  assert.equal(b.snapshot.profileDraft.canSubmit, true);
  assert.deepEqual(b.snapshot.profileDraft.loaderCatalog, b.snapshot.catalog.loaders);
  const mismatch = a.actions.catalog.requestLoaders('forge', '1.19.4');
  assert.equal(await a.actions.profileDraft.submit(), false);
  f.loaderRequests[2].resolve([{ version: 'current', stable: true }]);
  await mismatch;
  assert.equal(await a.actions.profileDraft.submit(), false);
  assert.equal(f.profileWrites.length, 0);
  f.host.unmount();
});
await test('instance_patch_boundary: only editable fields change; environment overrides update independent rows', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.instanceDraft.open('original-instance');
  a.actions.instanceDraft.patch({ name: 'Changed', loader: 'fabric', instance_key: 'forged' });
  a.actions.instanceDraft.patchOverride('environment', { LITERAL: '  value\n=x' });
  const b = await f.current();
  assert.equal(b.snapshot.instanceDraft.profile.instance_key, 'original-instance');
  assert.equal(b.snapshot.instanceDraft.profile.loader, 'vanilla');
  assert.equal(b.snapshot.instanceDraft.profile.name, 'Changed');
  assert.deepEqual(b.snapshot.instanceDraft.environment, [
    { key: 'LITERAL', value: '  value\n=x' },
  ]);
  f.host.unmount();
});
await test('old_draft_write_completion: instance/import/removal cannot scan, notify or publish after owner teardown', async () => {
  for (const domain of ['instanceDraft', 'importDraft', 'removal'])
    for (const failure of [false, true]) {
      const f = await fixture({ holdDomainWrites: true });
      const a = await f.current();
      if (domain === 'importDraft') {
        a.actions.importDraft.open();
        a.actions.importDraft.setDirectory('C:/import');
        const scan = a.actions.importDraft.scan();
        f.importScans[0].resolve([
          { instance_key: 'ok', loader: 'vanilla', game_version: '1.21.1', root: 'C:/import' },
        ]);
        await scan;
      } else a.actions[domain].open('original-instance');
      const submit = a.actions[domain].submit();
      await f.current();
      const request = domain === 'instanceDraft' ? f.profileWrites[0] : f.domainWrites[0];
      const before = a.services.notices.getSnapshot().length,
        scans = f.counts.scan;
      f.host.unmount();
      if (failure) request.reject(new Error('late write failure'));
      else request.resolve(f.server.config);
      assert.equal(await submit, false);
      assert.equal(f.host.updatesAfterUnmount, 0, domain);
      assert.equal(f.counts.scan, scans, domain);
      assert.equal(a.services.notices.getSnapshot().length, before, domain);
    }
});
await test('private_current_navigation_and_domain_interaction: detached route values and modal ownership survive staged reset', async () => {
  const f = await fixture();
  const a = await f.current();
  a.actions.navigation.navigate('content', { profileKey: 'original-instance' });
  await f.current();
  const route = a.services.getNavigation();
  route.params.profileKey = 'mutation';
  assert.equal(a.services.getNavigation().params.profileKey, 'original-instance');
  a.actions.instanceDraft.open('original-instance');
  a.services.setInteractionState({ modalOpen: false, picking: false });
  assert.equal(a.services.getInteractionState().modalOpen, true);
  await a.actions.launch.request('original-instance');
  assert.equal((await f.current()).snapshot.launch.selection, null);
  a.actions.instanceDraft.cancel();
  assert.equal(a.services.getInteractionState().modalOpen, false);
  f.host.unmount();
});

function shortcut(patch = {}) {
  const event = {
    key: 'Enter',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...patch,
  };
  for (const listener of window.listeners.get('keydown') ?? []) listener(event);
}
globalThis.Element = class Element {};
await test('fix1_public_install_current_eligibility: game, writes, missing profile/config, desktop and same-profile accepted tasks block before render', async () => {
  for (const blocked of [
    'running',
    'cancelling',
    'write',
    'missing',
    'config',
    'desktop',
    'queued-task',
    'running-task',
    'cancelling-task',
  ]) {
    const f = await fixture({
      holdWrites: true,
      holdBootstrap: blocked === 'config',
      desktop: blocked !== 'desktop',
    });
    const a = await f.current();
    let save;
    if (blocked === 'running' || blocked === 'cancelling')
      f.subscriptions
        .find((x) => x.kind === 'launcher')
        .callbacks[0]({ action: 'launch', status: blocked, message: blocked });
    if (blocked === 'write') save = a.actions.settings.save();
    if (blocked.endsWith('-task'))
      f.subscriptions
        .find((x) => x.kind === 'downloads')
        .callbacks[0]([
          {
            id: 'same',
            kind: 'install',
            profile_key: 'original-instance',
            name: 'Same profile',
            status: blocked.split('-')[0],
            message: '',
            progress: null,
          },
        ]);
    assert.equal(
      await a.actions.downloads.install(blocked === 'missing' ? 'unknown' : 'original-instance'),
      false,
      blocked,
    );
    assert.equal(f.counts.install, 0, blocked);
    if (!['missing', 'config'].includes(blocked))
      assert.equal(
        (await f.current()).snapshot.profiles.items[0].capabilities.install.allowed,
        false,
        blocked,
      );
    if (save) {
      await f.current();
      f.writes[0].finish();
      await save;
    }
    f.host.unmount();
  }
});
await test('fix1_install_repair_and_queue: installed repair and unrelated queueing share immediate dedup without account readiness', async () => {
  const repair = await fixture();
  const r = await repair.current();
  assert.equal(
    r.snapshot.profiles.items[0].capabilities.install.allowed,
    true,
    'installed profile remains repairable',
  );
  const results = await Promise.all([
    r.actions.downloads.install('original-instance'),
    r.actions.downloads.install('original-instance'),
  ]);
  assert.deepEqual(results, [true, false]);
  assert.deepEqual(repair.installKeys, ['original-instance']);
  repair.host.unmount();
  const f = await fixture({ holdAccounts: true });
  const a = await f.current();
  f.server.config.profiles[0].game_version = '1.20.1';
  await a.actions.config.reload();
  await f.current();
  f.subscriptions
    .find((x) => x.kind === 'downloads')
    .callbacks[0]([
      {
        id: 'other',
        kind: 'install',
        profile_key: 'other-profile',
        name: 'Other',
        status: 'running',
        message: '',
        progress: null,
      },
    ]);
  assert.equal((await f.current()).snapshot.profiles.items[0].capabilities.install.allowed, true);
  await Promise.all([
    a.actions.downloads.install('original-instance'),
    a.actions.launch.request('original-instance'),
  ]);
  assert.deepEqual(f.installKeys, ['original-instance']);
  assert.equal(f.counts.launch, 0);
  f.host.unmount();
});
await test('fix1_shortcut_current_event_and_config_ACK: accepted download/game and saved preferences/profile win before render', async () => {
  for (const changed of [
    'download',
    'running',
    'cancelling',
    'write',
    'disabled',
    'shortcut',
    'active',
  ]) {
    const f = await fixture({ holdWrites: true });
    const a = await f.current();
    f.accounts.accounts = [];
    f.accounts.active = null;
    await a.actions.accounts.reload();
    await f.current();
    let save;
    if (changed === 'download') {
      f.server.config.profiles[0].game_version = '1.20.1';
      await a.actions.config.reload();
      await f.current();
      f.subscriptions
        .find((x) => x.kind === 'downloads')
        .callbacks[0]([
          {
            id: 'other',
            kind: 'java',
            name: 'Java',
            status: 'running',
            message: '',
            progress: null,
          },
        ]);
    } else if (['running', 'cancelling'].includes(changed)) {
      f.subscriptions
        .find((x) => x.kind === 'launcher')
        .callbacks[0]({ action: 'launch', status: changed, message: changed });
    } else if (changed === 'write') save = a.actions.settings.save();
    else {
      if (changed === 'disabled') f.server.config.settings.personalization.shortcuts = false;
      if (changed === 'shortcut')
        f.server.config.settings.personalization.launch_shortcut = 'Alt+Enter';
      if (changed === 'active') {
        f.server.config.profiles.push({
          ...f.server.config.profiles[0],
          instance_key: 'current-active',
          name: 'Current',
          game_version: '1.20.1',
        });
        f.server.config.active_profile = 'current-active';
      }
      await a.actions.config.reload(); // deliberately no host settle after acknowledged config
    }
    shortcut();
    assert.deepEqual(f.installKeys, changed === 'active' ? ['current-active'] : [], changed);
    assert.equal(f.counts.launch, 0, changed);
    if (save) {
      await f.current();
      f.writes[0].finish();
      await save;
    }
    f.host.unmount();
  }
});
await test('consumer TypeScript contract rejects nested writes and private exports', () => {
  const ts = require('typescript');
  const configPath = resolve(uiRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, uiRoot).options;
  options.baseUrl = uiRoot;
  const probe = resolve(uiRoot, 'src/__launcher_public_types_probe.ts');
  const source = `import { useLauncherSnapshot, useLauncherActions, LauncherProvider, LauncherServices, useLauncher } from '@paradox/launcher';
const snapshot = useLauncherSnapshot(); snapshot.settings.draft!.memory_mb = 1; snapshot.profiles.items.push(null);
useLauncherActions().settings.patch('memory_mb', 6144);`;
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    resolve(name) === probe
      ? ts.createSourceFile(name, source, languageVersion, true)
      : readSource(name, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([probe], options, host);
  assert.ok(program.getSourceFile(probe), 'virtual consumer source is part of the program');
  const diagnostics = program.getSemanticDiagnostics(program.getSourceFile(probe));
  assert.equal(
    diagnostics.filter((diagnostic) => diagnostic.code === 2305).length,
    3,
    diagnostics.map((x) => ts.flattenDiagnosticMessageText(x.messageText, ' ')).join('; '),
  );
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 2540));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 2339));
});

await test('appearance_drafts_guards_limits_rows_and_latest_reference_protection', async () => {
  const f = await fixture();
  const { actions, services } = await f.current();
  for (let i = 0; i < 16; i++) {
    actions.argumentTemplates.openNew();
    actions.argumentTemplates.patch({ name: `Template ${i}` });
    actions.argumentTemplates.apply();
  }
  actions.argumentTemplates.openNew();
  assert.equal((await f.current()).snapshot.drafts.argumentTemplate, null);
  const id = services.launcher.getSettingsDraft().argument_templates[0].id;
  actions.argumentTemplates.openEdit(id);
  actions.argumentTemplates.patch({ name: 'Still editable at capacity' });
  const rows = [
    { key: 'DUP', value: ' first=\n' },
    { key: 'DUP', value: '' },
  ];
  actions.argumentTemplates.patch({ environment: rows });
  rows[0].value = 'caller mutated';
  actions.argumentTemplates.apply();
  let snapshot = (await f.current()).snapshot;
  assert.deepEqual(snapshot.drafts.environment, [
    { key: 'DUP', value: ' first=\n' },
    { key: 'DUP', value: '' },
  ]);
  assert.ok(snapshot.drafts.argumentTemplateError);
  assert.equal(snapshot.settings.draft.argument_templates[0].name, 'Template 0');
  actions.argumentTemplates.setEnvironment([]);
  actions.argumentTemplates.apply();
  assert.equal(services.launcher.getSettingsDraft().argument_templates.length, 16);
  f.server.config.profiles[0].overrides.argument_template = id;
  await actions.config.reload();
  actions.argumentTemplates.remove(id);
  assert.equal(services.launcher.getSettingsDraft().argument_templates.length, 16);
  assert.equal(
    (await f.current()).snapshot.drafts.argumentTemplateError,
    'argumentTemplates.inUse',
  );
  const unreferenced = services.launcher.getSettingsDraft().argument_templates[1].id;
  actions.argumentTemplates.openEdit(unreferenced);
  actions.argumentTemplates.remove(unreferenced);
  assert.equal((await f.current()).snapshot.drafts.argumentTemplate, null);
  assert.equal(services.launcher.getSettingsDraft().argument_templates.length, 15);
  const emit = f.subscriptions.find((x) => x.kind === 'downloads').callbacks[0];
  emit([
    { id: 'blocking', kind: 'java', status: 'running', name: 'Java', message: '', progress: null },
  ]);
  actions.argumentTemplates.openEdit(id);
  actions.argumentTemplates.remove(id);
  actions.presets.openDialog({ kind: 'save' });
  await actions.presets.save('Blocked');
  assert.equal((await f.current()).snapshot.drafts.argumentTemplate, null);
  assert.equal((await f.current()).snapshot.drafts.preset, null);
  assert.equal(f.writes.length, 0);
  emit([]);
  f.host.unmount();
});
await test('preset_direct_crud_dialog_identity_clipboard_and_reconnect', async () => {
  const f = await fixture();
  const { actions } = await f.current();
  await actions.presets.save('One');
  let snapshot = (await f.current()).snapshot;
  const id = snapshot.config.value.appearance_presets[0].id;
  actions.presets.openDialog({ kind: 'rename', id });
  assert.equal((await f.current()).snapshot.drafts.preset.name, 'One');
  actions.presets.patchDraft({ name: 'unfinished rename' });
  await actions.presets.save('Other direct call');
  assert.equal((await f.current()).snapshot.drafts.preset.name, 'unfinished rename');
  await assert.rejects(actions.presets.rename(id, '\u0001'));
  assert.ok((await f.current()).snapshot.drafts.preset.error);
  await actions.presets.rename(id, 'Renamed');
  assert.equal((await f.current()).snapshot.drafts.preset, null);
  actions.presets.openDialog({ kind: 'export', id });
  const text = actions.presets.export(id);
  assert.equal((await f.current()).snapshot.drafts.preset.json, text);
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copies = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      platform: 'Win32',
      clipboard: {
        writeText(value) {
          const response = deferred();
          copies.push({ ...response, value });
          return response.promise;
        },
      },
    },
  });
  try {
    const first = actions.presets.copyExport(id);
    actions.presets.cancelDialog();
    assert.equal((await f.current()).snapshot.drafts.preset.pending, true);
    copies[0].reject(new Error('Clipboard denied'));
    await assert.rejects(first);
    assert.equal((await f.current()).snapshot.drafts.preset.error, 'presets.errors.clipboard');
    assert.equal(copies[0].value, text);
    const old = actions.presets.copyExport(id);
    f.host.reconnectEffects();
    await f.current();
    actions.presets.cancelDialog();
    actions.presets.openDialog({ kind: 'save' });
    actions.presets.patchDraft({ name: 'new owner dialog' });
    copies[1].resolve();
    await old;
    assert.equal((await f.current()).snapshot.drafts.preset.name, 'new owner dialog');
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
  actions.presets.cancelDialog();
  actions.presets.apply(id);
  assert.equal(f.writes.length, 3);
  await actions.presets.remove(id);
  await assert.rejects(actions.presets.rename(id, 'Missing'));
  assert.equal((await f.current()).snapshot.config.value.appearance_presets.length, 1);
  f.host.unmount();
});
await test('preset_deleted_during_export_retains_missing_id_error', async () => {
  const f = await fixture();
  const { actions, services } = await f.current();
  await actions.presets.save('To export');
  const id = (await f.current()).snapshot.config.value.appearance_presets[0].id;
  actions.presets.openDialog({ kind: 'export', id });
  await services.launcher.removeAppearancePreset(id);
  await f.current();
  await assert.rejects(actions.presets.copyExport(id));
  assert.equal((await f.current()).snapshot.drafts.preset.error, 'presets.errors.missing');
  f.host.unmount();
});
await test('appearance_drafts_direct_game_write_and_capacity_guards_preserve_validation', async () => {
  const f = await fixture({ holdWrites: true });
  const { actions } = await f.current();
  const emit = f.subscriptions.find((x) => x.kind === 'launcher').callbacks[0];
  emit({ action: 'launch', status: 'running', message: '' });
  actions.argumentTemplates.openNew();
  actions.presets.openDialog({ kind: 'save' });
  await actions.presets.save('Blocked by game');
  assert.equal((await f.current()).snapshot.drafts.argumentTemplate, null);
  assert.equal(f.writes.length, 0);
  emit({ action: 'launch', status: 'finished', message: '' });
  await f.current();
  actions.argumentTemplates.openNew();
  actions.argumentTemplates.patch({ name: 'Held editor' });
  const save = actions.settings.save();
  actions.argumentTemplates.patch({ name: 'must be blocked before render' });
  actions.argumentTemplates.apply();
  await actions.presets.save('Blocked by write');
  await f.current();
  assert.equal(f.writes.length, 1);
  assert.equal((await f.current()).snapshot.drafts.argumentTemplate.name, 'Held editor');
  f.writes[0].finish();
  await save;
  actions.argumentTemplates.cancel();
  f.host.unmount();
  const capacity = await fixture();
  const a = (await capacity.current()).actions;
  capacity.server.config.appearance_presets = Array.from({ length: 32 }, (_, index) => ({
    id: `preset-${index}`,
    name: `Preset ${index}`,
    appearance: structuredClone(initialConfig.settings.appearance),
  }));
  await a.config.reload();
  a.presets.openDialog({ kind: 'save' });
  assert.equal((await capacity.current()).snapshot.drafts.preset, null);
  await assert.rejects(a.presets.save('Over capacity'));
  assert.equal(capacity.writes.length, 0);
  capacity.host.unmount();
});
await test('t4_r1_direct_clipboard_pending_is_public_and_does_not_lock_templates', async () => {
  for (const outcome of ['success', 'failure', 'reconnect', 'unmount']) {
    const f = await fixture();
    const { actions } = await f.current();
    await actions.presets.save('Clipboard source');
    const id = (await f.current()).snapshot.config.value.appearance_presets[0].id;
    actions.argumentTemplates.openNew();
    actions.argumentTemplates.patch({ name: 'Before clipboard' });
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const copies = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        platform: 'Win32',
        userAgent: 'Task4 regression',
        clipboard: {
          writeText(text) {
            const response = deferred();
            copies.push({ ...response, text });
            return response.promise;
          },
        },
      },
    });
    try {
      const copy = actions.presets.copyExport(id);
      const caught = copy.catch((error) => error);
      actions.argumentTemplates.patch({ name: 'Typed during clipboard' });
      assert.equal(
        (await f.current()).snapshot.drafts.argumentTemplate.name,
        'Typed during clipboard',
      );
      const pending = (await f.current()).snapshot;
      assert.equal(pending.drafts.preset, null);
      assert.equal(pending.settings.saving, false);
      assert.equal(pending.drafts.presetPending, true);
      publicValue(pending.drafts);
      assert.throws(() => {
        pending.drafts.presetPending = false;
      }, TypeError);
      actions.argumentTemplates.apply();
      actions.presets.openDialog({ kind: 'save' });
      await actions.presets.copyExport(id);
      assert.equal(copies.length, 1, 'preset mutex rejects duplicate direct copy');
      assert.equal((await f.current()).snapshot.drafts.preset, null);
      assert.equal(
        (await f.current()).snapshot.settings.draft.argument_templates[0].name,
        'Typed during clipboard',
      );
      if (outcome === 'unmount') {
        f.host.unmount();
        copies[0].resolve();
        await caught;
        assert.equal(f.host.updatesAfterUnmount, 0);
        assert.equal(f.writes.length, 1);
        continue;
      }
      if (outcome === 'reconnect') {
        f.host.reconnectEffects();
        assert.equal((await f.current()).snapshot.drafts.presetPending, false);
        const next = actions.presets.copyExport(id);
        const nextCaught = next.catch((error) => error);
        copies[0].resolve();
        await caught;
        assert.equal(
          (await f.current()).snapshot.drafts.presetPending,
          true,
          'old completion cannot release current pending',
        );
        copies[1].resolve();
        await nextCaught;
      } else {
        if (outcome === 'failure') copies[0].reject(new Error('Clipboard denied'));
        else copies[0].resolve();
        const result = await caught;
        assert.equal(result instanceof Error, outcome === 'failure');
      }
      assert.equal((await f.current()).snapshot.drafts.presetPending, false);
      actions.presets.openDialog({ kind: 'save' });
      assert.equal((await f.current()).snapshot.drafts.preset.request.kind, 'save');
      assert.equal(f.writes.length, 1, 'copy and template apply add zero config writes');
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      f.host.unmount();
    }
  }
});
