import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/default-ui-task9-dialogs', process.env.PARADOX_TASK9_EVIDENCE || 'current-default');
await mkdir(artifacts, { recursive: true });
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.settings.java_executable = 'C:/fixture/java.exe';
config.settings.argument_templates = [{ id: '572f6aa0-574c-4e48-945d-7140a171d4e5', name: 'Inherited arguments', jvm: '-Dtemplate=literal', game: '--template', environment: { INHERITED_VALUE: 'line one\nline two=x' } }];
config.profiles[0].overrides.argument_template = config.settings.argument_templates[0].id;
const fixture = await createBrowserFixture({ url: process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434', config, desktopBoundary: true });
const { page } = fixture;
const locale = JSON.parse(await readFile(new URL('../src/locales/en-US.json', import.meta.url), 'utf8'));
const text = (key, args = {}) => key.split('.').reduce((v, p) => v[p], locale).replace(/{{(\w+)}}/g, (_, key) => String(args[key] ?? ''));
const ownedFiles = ['common/lib/dialog-display.ts', ...['immersive', 'modern'].flatMap(suite => [
  'Shell.tsx', 'components/EnvironmentEditor.tsx', 'components/AppearancePresets.tsx', 'components/ArgumentTemplates.tsx',
  'pages/AccountsPage.tsx', 'styles/business-dialogs.css', ...['AccountLoginDialog', 'AppearancePresetDialog',
    'ArgumentTemplateDialog', 'CloseRequestDialog', 'ImportInstancesDialog', 'InstanceSettingsDialog',
    'LaunchAccountDialog', 'LauncherDialog', 'ProfileDialog', 'RemoveProfileDialog'].map(name => 'dialogs/' + name + '.tsx'),
].map(path => suite + '/' + path))];
const sourceHashes = await Promise.all(ownedFiles.map(async path => {
  const bytes = await readFile(new URL('../src/ui-suite/builtins/' + path, import.meta.url));
  return { path: 'ui/src/ui-suite/builtins/' + path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const scriptBytes = await readFile(new URL(import.meta.url));
sourceHashes.push({ path: 'ui/scripts/check-ui-dialogs-browser.mjs', bytes: scriptBytes.length, sha256: createHash('sha256').update(scriptBytes).digest('hex') });
const report = { startedAt: new Date().toISOString(), url: page.url(), checks: [], screenshots: [], reachability: [], provenance: {}, themes: [], customTargets: [], scale: [], savedOverrides: [], sourceHashes, errors: fixture.observedPageErrors, cspErrors: fixture.observedCspViolations, sourceRequests: fixture.observedSourceModuleRequests };
const pass = async name => { await notices(); report.checks.push(name); console.log('PASS ' + name); };
const site = value => {
  const name = value.replace(/^(Modern|Immersive)/, '');
  const inputLabels = {
    'InstanceSettings-name': 'instances.name', 'ProfileDialog-name': 'instances.name',
    'Import-directory': 'importDialog.gameRoot', 'Remove-confirm': 'removeDialog.confirmName',
    'Preset-name': 'presets.name', 'Preset-import': 'presets.json', 'Preset-export': 'presets.json',
    'Template-name': 'argumentTemplates.name', 'Template-jvm': 'instanceDialog.jvmArguments',
    'Template-game': 'instanceDialog.gameArguments',
  };
  if (inputLabels[name]) return page.getByRole('dialog').getByLabel(text(inputLabels[name]), { exact: true });
  const selectLabels = { 'InstanceSettings-template': 'argumentTemplates.select', 'LaunchAccount-select': 'auth.select' };
  if (selectLabels[name]) return page.getByRole('dialog').getByRole('combobox', { name: text(selectLabels[name]), exact: true });
  return page.locator('[data-ui-site="' + value + '"], [data-ui-site$=":' + value + '"]');
};
const overrideSite = (prefix, field, part) => {
  const labels = { minimum_memory_mb: 'settings.minimumMemory', jvm: 'instanceDialog.jvmArguments', java: 'settings.javaExecutable' };
  const label = text(labels[field]);
  return part === 'toggle'
    ? site(prefix + 'InstanceSettings-override-toggle').and(page.getByRole('checkbox', { name: text('instanceDialog.overrideLabel', { label }), exact: true }))
    : page.getByRole('dialog').getByLabel(label, { exact: true });
};
const environmentSite = (_prefix, part, index = 0) => page.getByRole('dialog').getByLabel(text(part === 'key' ? 'argumentTemplates.variableName' : 'argumentTemplates.variableValue', { index: index + 1 }), { exact: true });
const wait = (fn, arg) => page.waitForFunction(fn, arg);
const snapshot = path => page.evaluate(path => { let v = window.suiteBuiltinsFixture.snapshot; for (const p of path.split('.')) v = v[p]; return structuredClone(v); }, path);
const action = async (name, args = [], awaitResult = true) => {
  if (['instanceDraft.open', 'importDraft.open', 'profileDraft.openCreate', 'profileDraft.openRename',
    'removal.open', 'removal.openResidual', 'presets.openDialog', 'argumentTemplates.openNew',
    'argumentTemplates.openEdit', 'launch.request', 'accounts.login'].includes(name)) await notices();
  return page.evaluate(async ({ name, args, awaitResult }) => { let fn = window.suiteBuiltinsFixture.actions; for (const p of name.split('.')) fn = fn[p]; const result = fn(...args); if (awaitResult) return await result; }, { name, args, awaitResult });
};
const mode = (command, mode) => page.evaluate(({ command, mode }) => { window.task9Boundary.modes[command] = mode; }, { command, mode });
const held = command => wait(command => (window.task9Boundary.held[command]?.length ?? 0) > 0, command);
const release = (command, failure = false, value) => page.evaluate(({ command, failure, value }) => { const gate = window.task9Boundary.held[command].shift(); if (failure) gate.reject(Error('Task9 held failure ' + 'long error '.repeat(25))); else gate.resolve(value === undefined ? gate.normal() : value); }, { command, failure, value });
const count = command => page.evaluate(command => window.foundationDesktop.calls.filter(call => call.command === command).length, command);
const notices = () => page.evaluate(() => { const f = window.suiteBuiltinsFixture; for (const n of f.snapshot.notifications.items) f.actions.notifications.dismiss(n.id); });
const finishLogin = failure => page.evaluate(failure => {
  const gate = window.task9Boundary.complete.shift();
  if (!gate) throw Error('No actual complete_login request awaits a terminal result');
  gate.reject(failure === 'auth.errors.cancelled' ? failure : Error(failure));
}, failure);
async function dialogTheme(suite, theme) {
  const actual = await page.getByRole('dialog').evaluate(dialog => ({ resolved: window.suiteBuiltinsFixture.snapshot.appearance.theme, committed: window.foundationDesktop.config.settings.appearance.theme, dom: dialog.closest('.dialog-theme')?.getAttribute('data-theme') }));
  assert.equal(actual.committed, theme, suite + ' native committed theme');
  assert.equal(actual.resolved, theme, suite + ' public resolved theme');
  assert.equal(actual.dom, theme, suite + ' actual Dialog theme');
  return actual;
}
async function shot(name, suite, theme, sourceMode = 'current-default') {
  await notices(); await mkdir(resolve(artifacts, sourceMode), { recursive: true });
  const actualTheme = await dialogTheme(suite, theme);
  const path = resolve(artifacts, sourceMode, suite + '-' + theme + '-' + name + '.png');
  await page.screenshot({ path });
  report.screenshots.push({ path, suite, theme, actualTheme, sourceMode, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
}
async function reachable(control, suite, theme, kind) {
  await notices();
  const actualTheme = await dialogTheme(suite, theme);
  await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  const g = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x: r.x, y: r.y, width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
  });
  assert.ok(g.inside && g.hit, suite + '/' + theme + '/' + kind + ' is reachable at 320x240: ' + JSON.stringify(g));
  report.reachability.push({ suite, theme, kind, actualTheme, ...g });
}
async function guarded(prefix, openPath) {
  assert.equal(await site(prefix + '-cancel').isDisabled(), true, 'footer cancel blocked');
  await page.keyboard.press('Escape');
  assert.ok(await snapshot(openPath), 'Escape keeps pending dialog');
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: text('common.closeDialog'), exact: true }).isDisabled(), true, 'close button blocked');
}
async function choose(trigger, option) {
  await trigger.click(); const listbox = page.getByRole('listbox'); await listbox.waitFor();
  await listbox.getByRole('option', { name: option, exact: true }).click();
  await listbox.waitFor({ state: 'hidden' });
}
async function openSettings() { await action('navigation.navigate', ['settings']); await action('settings.setTab', ['appearance']); }
async function commitAppearance(field, value) {
  await openSettings();
  await action('settings.patchAppearance', [field, value]);
  await wait(({ field, value }) => window.suiteBuiltinsFixture.snapshot.settings.draft.appearance[field] === value, { field, value });
  assert.equal(await action('settings.save'), true, 'real settings owner commits ' + field);
  await wait(({ field, value }) => window.foundationDesktop.config.settings.appearance[field] === value && !window.suiteBuiltinsFixture.snapshot.settings.saving, { field, value });
  await action('navigation.navigate', ['instances']);
  await wait(({ field, value }) => window.suiteBuiltinsFixture.snapshot.appearance.value[field] === value, { field, value });
}
async function customizeWhole(target, identity, marker) {
  const titles = { 'dialog.profile': 'instances.rename', 'dialog.launch-account': 'auth.launchTitle', 'dialog.login': 'auth.login', 'dialog.preset': 'presets.dialog.save.title', 'dialog.argument-template': 'argumentTemplates.editor' };
  let title;
  if (target === 'dialog.remove-profile') {
    const removal = await snapshot('removal'), current = await snapshot('config.value');
    title = text('removeDialog.title', { name: removal.recovery?.name ?? current.profiles.find(profile => profile.instance_key === identity.value)?.name ?? identity.value });
  } else title = text(titles[target]);
  await page.getByRole('dialog', { name: title, exact: true }).waitFor();
  await page.evaluate(async ({ target, identity, marker }) => {
    const c = window.suiteBuiltinsFixture.controller;
    c.actions.selectTarget({ kind: 'business', target, identity });
    if (!(await c.actions.createSelectionOverride('tsx'))) throw Error(target + ' business selection failed');
    c.actions.patchFile(c.getSnapshot().selectedFile, 'export default function DialogOriginal({props,children,Original}){return <div data-ui-site="' + marker + '"><Original {...props}>{children}</Original></div>}');
    if (!(await c.actions.preview())) throw Error(target + ' Original preview failed');
  }, { target, identity, marker });
  await site(marker).waitFor({ state: 'attached' });
  await page.getByRole('dialog', { name: title, exact: true }).waitFor();
  report.customTargets.push({ target, identity, marker, title, originalDialogVisible: true });
}

try {
  await wait(() => window.suiteBuiltinsFixture?.ready);
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, original = native.invoke, desktop = window.foundationDesktop;
    const b = window.task9Boundary = { modes: {}, held: {}, nextKey: null, sequence: 0, clipboard: [], complete: [], cancelAcks: [], expiredNext: false, deleteOutcome: 'normal', retryOutcome: 'normal',
      scanResults: [
        { instance_key: 'import-vanilla', game_version: '1.21.1', loader: 'vanilla', loader_version: '', root: 'C:/import/versions/import-vanilla' },
        { instance_key: 'import-forge', game_version: '1.21.1', loader: 'forge', loader_version: 'test', root: 'C:/import/versions/import-forge' },
        { instance_key: 'import-unknown', game_version: null, loader: 'vanilla', loader_version: '', root: 'C:/import/versions/import-unknown' },
      ] };
    const gated = async (command, args, normal) => {
      const next = b.modes[command]; delete b.modes[command];
      if (next === 'fail') throw Error('Task9 failure ' + 'long failure text '.repeat(30));
      if (next === 'hold') return new Promise((resolve, reject) => (b.held[command] ??= []).push({ resolve, reject, normal, args: structuredClone(args) }));
      return normal();
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
      b.clipboard.push(text); return gated('clipboard', { text }, () => undefined);
    } } });
    native.invoke = async (command, args = {}) => {
      const normal = async () => {
        if (command === 'choose_directory') return null;
        if (command === 'choose_java') return 'C:/selected/java.exe';
        if (command === 'inspect_java') return { executable: args.path, java_home: 'C:/selected', major_version: 21, version: '21.0.5', vendor: 'Task9', architecture: 'x64', source: 'manual' };
        if (command === 'scan_import') return structuredClone(b.scanResults);
        if (command === 'create_profile') {
          const key = b.nextKey ?? ('task9-created-' + ++b.sequence); b.nextKey = null;
          const profile = { instance_key: key, name: args.name, game_version: args.version, loader: args.loader, loader_version: args.loaderVersion, game_directory: null, overrides: {} };
          desktop.config.profiles.push(profile); return structuredClone(desktop.config);
        }
        if (command === 'import_instances') {
          for (const key of args.keys) if (!desktop.config.profiles.some(p => p.instance_key === key)) {
            const entry = b.scanResults.find(i => i.instance_key === key); desktop.config.profiles.push({ ...entry, name: key, game_directory: args.directory, overrides: {} });
          }
          return structuredClone(desktop.config);
        }
        if (command === 'remove_profile') {
          const removed = desktop.config.profiles.find(p => p.instance_key === args.key);
          desktop.config.profiles = desktop.config.profiles.filter(p => p.instance_key !== args.key);
          if (desktop.config.active_profile === args.key) desktop.config.active_profile = desktop.config.profiles[0]?.instance_key ?? null;
          const partial = b.deleteOutcome === 'partial'; b.deleteOutcome = 'normal';
          return { config: structuredClone(desktop.config), file_removal: null, file_removal_error: partial ? 'Task9 retained file error ' + 'unbroken'.repeat(40) : null, file_removal_retry: partial ? 'retained-token-' + ++b.sequence : null, instance_root: partial ? 'C:/retained/' + args.key + '/' + 'long-directory-'.repeat(20) : null, removed_name: removed?.name };
        }
        if (command === 'retry_profile_files') {
          const partial = b.retryOutcome === 'partial'; b.retryOutcome = 'normal';
          return { config: structuredClone(desktop.config), file_removal: null, file_removal_error: partial ? 'Task9 next file error' : null, file_removal_retry: partial ? 'replacement-token-' + ++b.sequence : null, instance_root: partial ? 'C:/replacement/' + 'long-directory-'.repeat(25) : null };
        }
        if (command === 'begin_login') {
          const prompt = { id: args.requestId, user_code: 'TASK9-CODE', verification_uri: 'https://www.microsoft.com/link', expires_at: Math.floor(Date.now() / 1000) + (b.expiredNext ? -1 : 600) };
          b.expiredNext = false; return prompt;
        }
        if (command === 'configure_microsoft') { desktop.accounts.client_id = args.clientId; return structuredClone(desktop.accounts); }
        if (command === 'complete_login') return new Promise((resolve, reject) => b.complete.push({ resolve, reject, id: args.id }));
        if (command === 'cancel_login') { b.cancelAcks.push(args.id); return; }
        if (command === 'copy_login_code' || command === 'open_login_page') return;
        if (command === 'list_content') return [{ name: 'same-name.jar', enabled: true, size: 24 }];
        if (command === 'remove_content') return;
        return original(command, args);
      };
      const own = ['choose_directory','choose_java','inspect_java','scan_import','create_profile','import_instances','remove_profile','retry_profile_files','configure_microsoft','begin_login','complete_login','cancel_login','copy_login_code','open_login_page','list_content','remove_content'].includes(command);
      if (own) desktop.calls.push({ command, args: structuredClone(args) });
      return gated(command, args, normal);
    };
    window.task9StableActions = window.suiteBuiltinsFixture.actions;
    window.task9StableController = window.suiteBuiltinsFixture.controller;
    window.task9Bootstrap = desktop.calls.filter(c => ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(c.command)).length;
  });
  const originalKey = config.profiles[0].instance_key;
  for (const suite of ['modern', 'immersive']) {
    const p = suite === 'modern' ? 'Modern' : 'Immersive';
    await page.evaluate(async suite => { if (!(await window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite))) throw Error('Suite selection failed'); }, suite);
    report.provenance[suite] = await page.evaluate(suite => {
      const f = window.suiteBuiltinsFixture, manifest = f.controller.getSnapshot().draft.manifest;
      const ids = ['component.launcher-dialog','control.environment-editor','dialog.profile','dialog.login','dialog.instance-settings','dialog.import-instances','dialog.remove-profile','dialog.close-request','dialog.launch-account','dialog.preset','dialog.argument-template'];
      return { selected: f.controller.getSnapshot().selectedSuiteId, schema: manifest.schema_version, api: manifest.api_version, views: Object.fromEntries(ids.map(id => [id, manifest.views[id]])), files: manifest.files, suite };
    }, suite);
    for (const [id, path] of Object.entries(report.provenance[suite].views)) assert.ok(path.startsWith(suite + '/'), suite + ' has its own ' + id);
    assert.equal(report.provenance[suite].schema, 1); assert.equal(report.provenance[suite].api, 1);
    for (const expected of sourceHashes.filter(file => file.path.includes('/common/') || file.path.includes('/' + suite + '/'))) {
      const path = expected.path.replace('ui/src/ui-suite/builtins/', '');
      const actual = report.provenance[suite].files.find(file => file.path === path);
      assert.ok(actual, suite + ' materializes owned source ' + path);
      assert.equal(actual.sha256, expected.sha256, suite + ' runs exact raw owned source ' + path);
      assert.equal(actual.bytes, expected.bytes);
    }
    for (const theme of ['dark', 'light']) {
      await commitAppearance('theme', theme);
      assert.equal(await snapshot('appearance.theme'), theme, 'committed suite theme');
      report.themes.push({ suite, theme, committed: await page.evaluate(() => window.foundationDesktop.config.settings.appearance.theme), resolved: await snapshot('appearance.theme') });
      await page.setViewportSize({ width: 1240, height: 720 });

      await action('instanceDraft.open', [originalKey]); await site(p + 'InstanceSettings-name').waitFor();
      await site(p + 'InstanceSettings-name').fill('Task9 ' + suite);
      await overrideSite(p, 'minimum_memory_mb', 'toggle').check();
      await overrideSite(p, 'minimum_memory_mb', 'input').fill('255');
      assert.equal(await site(p + 'InstanceSettings-submit').isDisabled(), true);
      await overrideSite(p, 'minimum_memory_mb', 'input').fill('512');
      await overrideSite(p, 'jvm', 'toggle').check();
      await overrideSite(p, 'jvm', 'textarea').fill('');
      assert.equal(await snapshot('instanceDraft.profile.overrides.extra_jvm_arguments'), '', 'empty explicit JVM override');
      await mode('choose_directory', 'hold'); await site(p + 'InstanceSettings-choose-directory').click(); await held('choose_directory');
      await guarded(p + 'InstanceSettings', 'instanceDraft.profile');
      assert.equal(await site(p + 'InstanceSettings-name').isDisabled(), true);
      await release('choose_directory', false, null); await wait(() => !window.suiteBuiltinsFixture.snapshot.instanceDraft.picking);
      await mode('choose_directory', 'hold'); await site(p + 'InstanceSettings-choose-directory').click(); await held('choose_directory'); await release('choose_directory', false, 'C:/task9/instances'); await wait(() => window.suiteBuiltinsFixture.snapshot.instanceDraft.profile.game_directory === 'C:/task9/instances');
      const oldJava = await snapshot('instanceDraft.profile.overrides.java_executable');
      await mode('inspect_java', 'fail'); await site(p + 'InstanceSettings-choose-java').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.instanceDraft.picking);
      assert.equal(await snapshot('instanceDraft.profile.overrides.java_executable'), oldJava, 'failed inspection does not patch Java');
      await notices();
      await site(p + 'InstanceSettings-choose-java').click(); await wait(() => window.suiteBuiltinsFixture.snapshot.instanceDraft.profile.overrides.java_executable === 'C:/selected/java.exe');
      assert.equal(await overrideSite(p, 'java', 'input').getAttribute('readonly'), '');
      if (!(await snapshot('instanceDraft.environment')).length) await site(p + 'EnvironmentEditor-add').click();
      await environmentSite(p, 'key').fill('TEST_VALUE'); await environmentSite(p, 'value').fill(' literal\nvalue=x\n');
      await page.setViewportSize({ width: 320, height: 240 }); await reachable(site(p + 'InstanceSettings-submit'), suite, theme, 'instance save'); await reachable(site(p + 'InstanceSettings-cancel'), suite, theme, 'instance cancel'); await shot('instance-settings', suite, theme);
      await mode('update_profile', 'hold'); await site(p + 'InstanceSettings-submit').click(); await held('update_profile'); await guarded(p + 'InstanceSettings', 'instanceDraft.profile'); await release('update_profile', true);
      await wait(() => !window.suiteBuiltinsFixture.snapshot.instanceDraft.pending);
      assert.equal(await snapshot('instanceDraft.environment.0.value'), ' literal\nvalue=x\n', 'owner failure preserves literal value');
      await notices();
      await site(p + 'InstanceSettings-submit').click(); await site(p + 'InstanceSettings-name').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(key => window.foundationDesktop.config.profiles.find(p => p.instance_key === key).overrides.environment.TEST_VALUE, originalKey), ' literal\nvalue=x\n');
      await pass(suite + '/' + theme + ': instance picker inspection numeric limits empty override literal environment pending failure success');

      await action('importDraft.open'); await site(p + 'Import-directory').waitFor();
      assert.equal(await site(p + 'Import-results').count(), 0);
      await site(p + 'Import-directory').fill('C:/task9/import');
      await mode('scan_import', 'hold'); await site(p + 'Import-scan').click(); await held('scan_import'); await guarded(p + 'Import', 'importDraft.open');
      await action('importDraft.cancel'); await release('scan_import'); await wait(() => !window.suiteBuiltinsFixture.snapshot.importDraft.open);
      await action('importDraft.open'); await site(p + 'Import-directory').fill('C:/task9/import');
      await site(p + 'Import-scan').click(); await wait(() => window.suiteBuiltinsFixture.snapshot.importDraft.instances !== null);
      assert.deepEqual(await snapshot('importDraft.selected'), ['import-vanilla']);
      assert.equal(await site(p + 'Import-result-select').count(), 3);
      assert.equal(await site(p + 'Import-result-select').nth(1).isDisabled(), true);
      assert.equal(await site(p + 'Import-result-select').nth(2).isDisabled(), true);
      await site(p + 'Import-directory').fill('C:/task9/changed'); assert.equal(await site(p + 'Import-results').count(), 0); assert.equal(await site(p + 'Import-submit').isDisabled(), true);
      await site(p + 'Import-scan').click(); await site(p + 'Import-results').waitFor();
      await reachable(site(p + 'Import-submit'), suite, theme, 'import'); await shot('import-results', suite, theme);
      await mode('import_instances', 'hold'); await site(p + 'Import-submit').click(); await held('import_instances'); await guarded(p + 'Import', 'importDraft.open'); await release('import_instances', true);
      await wait(() => !window.suiteBuiltinsFixture.snapshot.importDraft.pending); assert.equal(await snapshot('importDraft.open'), true);
      await notices();
      await site(p + 'Import-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.importDraft.open);
      await action('importDraft.open'); await site(p + 'Import-directory').fill('C:/empty'); await page.evaluate(() => { window.task9Boundary.savedScanResults = window.task9Boundary.scanResults; window.task9Boundary.scanResults = []; }); await site(p + 'Import-scan').click(); await site(p + 'Import-empty').waitFor(); await site(p + 'Import-cancel').click(); await page.evaluate(() => { window.task9Boundary.scanResults = window.task9Boundary.savedScanResults; });
      await pass(suite + '/' + theme + ': import stale scan directory invalidation unsupported missing version empty failed submit success cancel');

      await action('profileDraft.openCreate', ['1.21.1']); await site('ProfileDialog-name').waitFor();
      assert.equal(await site('ProfileDialog-name').evaluate(e => e === document.activeElement), true, 'name Input ref receives initial focus');
      await site('ProfileDialog-name').fill('Removal ' + suite + ' ' + theme);
      await shot('profile-create', suite, theme);
      await mode('create_profile', 'hold'); await reachable(site('ProfileDialog-submit'), suite, theme, 'profile create'); await site('ProfileDialog-submit').click(); await held('create_profile');
      assert.equal(await site('ProfileDialog-cancel').isDisabled(), true); await page.keyboard.press('Escape'); assert.ok(await snapshot('profileDraft.editor'));
      await release('create_profile', true); await wait(() => !window.suiteBuiltinsFixture.snapshot.profileDraft.pending); assert.equal(await site('ProfileDialog-name').inputValue(), 'Removal ' + suite + ' ' + theme);
      await notices();
      await site('ProfileDialog-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.profileDraft.editor);
      const removeKey = await page.evaluate(() => window.foundationDesktop.config.profiles.at(-1).instance_key);
      await action('removal.open', [removeKey]); await site(p + 'Remove-cancel').waitFor();
      assert.equal(await site(p + 'Remove-cancel').evaluate(e => e === document.activeElement), true, 'safe deletion initial focus');
      await site(p + 'Remove-delete').check(); await site(p + 'Remove-confirm').fill('wrong name'); assert.equal(await site(p + 'Remove-submit').isDisabled(), true);
      const exactName = await page.evaluate(key => window.foundationDesktop.config.profiles.find(p => p.instance_key === key).name, removeKey);
      await site(p + 'Remove-confirm').fill(exactName + ' '); assert.equal(await site(p + 'Remove-submit').isDisabled(), true);
      await site(p + 'Remove-confirm').fill(exactName);
      await page.evaluate(() => { window.task9Boundary.deleteOutcome = 'partial'; }); await site(p + 'Remove-submit').click(); await wait(() => !!window.suiteBuiltinsFixture.snapshot.removal.recovery);
      const firstToken = await snapshot('removal.recovery.token'); assert.equal(await site(p + 'Remove-confirm').count(), 0);
      await reachable(site(p + 'Remove-submit'), suite, theme, 'residual retry'); await shot('residual-long-error', suite, theme);
      await site(p + 'Remove-cancel').click(); await action('removal.openResidual', [firstToken]); await site(p + 'Remove-recovery').waitFor();
      await page.evaluate(() => { window.task9Boundary.retryOutcome = 'partial'; }); await site(p + 'Remove-submit').click(); await wait(token => window.suiteBuiltinsFixture.snapshot.removal.recovery.token !== token, firstToken);
      const replacement = await snapshot('removal.recovery.token'); assert.ok(replacement.startsWith('replacement-token-'));
      await notices();
      await mode('retry_profile_files', 'hold'); await site(p + 'Remove-submit').click(); await held('retry_profile_files'); await guarded(p + 'Remove', 'removal.profileKey'); await release('retry_profile_files');
      await wait(() => !window.suiteBuiltinsFixture.snapshot.removal.profileKey);
      assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(c => c.command === 'retry_profile_files').at(-1).args.token), replacement);
      assert.equal((await snapshot('removal.residuals')).some(r => r.token === replacement), false);
      await pass(suite + '/' + theme + ': profile real ref pending failure create exact deletion retained missing-profile token retry replacement');

      await openSettings(); await action('presets.openDialog', [{ kind: 'save' }]); await site(p + 'Preset-name').waitFor(); await site(p + 'Preset-name').fill('Task9 preset ' + suite + theme); await site(p + 'Preset-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.preset);
      const presetId = await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.config.value.appearance_presets.at(-1).id);
      await action('presets.openDialog', [{ kind: 'rename', id: presetId }]); await site(p + 'Preset-name').fill('Renamed ' + suite); await reachable(site(p + 'Preset-submit'), suite, theme, 'preset rename'); await site(p + 'Preset-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.preset);
      await action('presets.openDialog', [{ kind: 'import' }]); await site(p + 'Preset-import').fill('{bad json'); await site(p + 'Preset-submit').click(); await site(p + 'Preset-error').waitFor(); assert.equal(await site(p + 'Preset-import').inputValue(), '{bad json'); await shot('preset-import-error', suite, theme); await site(p + 'Preset-cancel').click();
      await action('presets.openDialog', [{ kind: 'export', id: presetId }]); const exported = await site(p + 'Preset-export').inputValue(); await mode('clipboard', 'fail'); await site(p + 'Preset-submit').click(); await site(p + 'Preset-error').waitFor(); await notices(); await mode('clipboard', 'hold'); await site(p + 'Preset-submit').click(); await held('clipboard'); await guarded(p + 'Preset', 'drafts.preset'); await release('clipboard'); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.presetPending); assert.equal(await site(p + 'Preset-submit').innerText(), 'Copied'); assert.equal(await site(p + 'Preset-export').inputValue(), exported); await reachable(site(p + 'Preset-cancel'), suite, theme, 'preset export close'); await site(p + 'Preset-cancel').click();
      await action('presets.openDialog', [{ kind: 'export', id: presetId }]); assert.notEqual(await site(p + 'Preset-submit').innerText(), 'Copied', 'new export lifecycle clears copied acknowledgement'); await site(p + 'Preset-cancel').click();
      await action('presets.openDialog', [{ kind: 'import' }]); await site(p + 'Preset-import').fill(exported); await site(p + 'Preset-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.preset);
      await action('presets.openDialog', [{ kind: 'remove', id: presetId }]); await reachable(site(p + 'Preset-submit'), suite, theme, 'preset remove'); await site(p + 'Preset-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.preset);
      await pass(suite + '/' + theme + ': preset all five modes import error owner input clipboard failure pending real copy lifecycle reset');

      await action('settings.setTab', ['advanced']); await action('argumentTemplates.openNew'); await site(p + 'Template-name').waitFor(); await site(p + 'Template-name').fill('Task9 template'); await site(p + 'Template-jvm').fill('-Dliteral=one\n-Dsecond=two'); await site(p + 'EnvironmentEditor-add').click(); await environmentSite(p, 'key').fill('JAVA_TOOL_OPTIONS'); await environmentSite(p, 'value').fill(' value\nwith=equals\n'); await reachable(site(p + 'Template-submit'), suite, theme, 'template apply'); await site(p + 'Template-submit').click(); await site(p + 'Template-error').waitFor();
      await environmentSite(p, 'key').fill('TASK9_LITERAL'); await shot('template-environment', suite, theme); await site(p + 'Template-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.drafts.argumentTemplate);
      const templateId = await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.settings.draft.argument_templates.at(-1).id);
      assert.equal(await page.evaluate(id => window.suiteBuiltinsFixture.snapshot.settings.draft.argument_templates.find(t => t.id === id).environment.TASK9_LITERAL, templateId), ' value\nwith=equals\n');
      await action('argumentTemplates.openEdit', [templateId]); await site(p + 'Template-name').fill('Edited Task9 template'); await site(p + 'Template-cancel').click(); await action('argumentTemplates.remove', [config.settings.argument_templates[0].id]); assert.ok((await snapshot('settings.draft.argument_templates')).some(t => t.id === config.settings.argument_templates[0].id), 'in-use original template stays');
      await pass(suite + '/' + theme + ': template owner validation literal empty multiline edit cancel in-use remove guard');

      await action('navigation.navigate', ['instances']); await action('launch.request', [originalKey]); await site(p + 'LaunchAccount-select').waitFor();
      await choose(site(p + 'LaunchAccount-select'), 'Steve'); assert.equal(await snapshot('launch.selection.accountId'), 'account-b'); await shot('launch-account', suite, theme); await site(p + 'LaunchAccount-cancel').click();
      await action('launch.request', [originalKey]); await choose(site(p + 'LaunchAccount-select'), text('auth.offlineOption', { name: 'Player' }));
      await mode('select_account', 'hold'); await site(p + 'LaunchAccount-submit').click(); await held('select_account'); await guarded(p + 'LaunchAccount', 'launch.selection'); await release('select_account', true); await wait(() => !window.suiteBuiltinsFixture.snapshot.launch.selection?.submitting); assert.ok(await snapshot('launch.selection'));
      await notices();
      const launchBefore = await count('launch_instance');
      await site(p + 'LaunchAccount-submit').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.launch.selection);
      await wait(expected => window.foundationDesktop.calls.filter(call => call.command === 'launch_instance').length === expected, launchBefore + 1);
      assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'launch_instance').at(-1).args.key), originalKey);
      assert.equal(await page.evaluate(() => window.foundationDesktop.accounts.active), null, 'actual native launch uses selected offline account');
      await page.evaluate(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Task9 boundary launch finished' }));
      await wait(() => !window.suiteBuiltinsFixture.snapshot.activity);
      await pass(suite + '/' + theme + ': launch real account offline choice pending cancel guards failed selection success');

      await action('navigation.navigate', ['accounts']);
      if (!(await snapshot('accounts.state.client_id'))) {
        const clientId = '11111111-1111-1111-1111-111111111111';
        await action('accounts.patchClientId', [clientId]); assert.equal(await action('accounts.configure', [clientId]), true);
        await wait(clientId => window.suiteBuiltinsFixture.snapshot.accounts.state.client_id === clientId && !window.suiteBuiltinsFixture.snapshot.accounts.pending, clientId);
        assert.equal(await snapshot('accounts.state.client_id'), clientId);
      }
      await mode('begin_login', 'fail'); assert.equal(await action('accounts.login'), false); assert.equal(await snapshot('accounts.prompt'), null); assert.equal(await snapshot('accounts.pending'), false);
      assert.ok((await snapshot('notifications.items')).some(item => item.message.includes('Task9 failure')), 'login start failure reaches the original error owner'); assert.equal(await site('Accounts-login').isEnabled(), true); await notices();
      await action('accounts.login', [], false); await site('Login-cancel').waitFor(); assert.equal(await site('Login-cancel').isDisabled(), false);
      const loginId = await snapshot('accounts.prompt.id');
      await mode('open_login_page', 'hold'); await site('Login-open').click(); await held('open_login_page'); assert.equal(await site('Login-cancel').isDisabled(), false); await release('open_login_page');
      await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
      await mode('clipboard', 'hold'); await site('Login-copy').click(); await held('clipboard'); assert.equal(await site('Login-cancel').isDisabled(), false); await release('clipboard'); await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptActionPending === null);
      await reachable(site('Login-cancel'), suite, theme, 'login cancel'); await shot('login-device-code', suite, theme);
      await mode('cancel_login', 'hold'); await site('Login-cancel').click(); await held('cancel_login'); assert.equal(await site('Login-cancel').isDisabled(), true); await page.keyboard.press('Escape'); assert.equal(await snapshot('accounts.prompt.id'), loginId); await release('cancel_login', true); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.cancelling);
      assert.equal(await snapshot('accounts.prompt.id'), loginId); assert.equal(await snapshot('accounts.pending'), true); assert.equal(await site('Login-cancel').isEnabled(), true); assert.ok((await snapshot('notifications.items')).some(item => item.message.includes('Task9 held failure')), 'failed cancellation restores original retry'); await notices();
      await mode('cancel_login', 'hold'); await site('Login-cancel').click(); await held('cancel_login'); await release('cancel_login'); await wait(id => window.task9Boundary.cancelAcks.includes(id), loginId);
      assert.equal(await snapshot('accounts.prompt.id'), loginId, 'cancel ACK retains actual prompt until terminal completion'); assert.equal(await snapshot('accounts.pending'), true); assert.equal(await site('Login-cancel').isDisabled(), true);
      await finishLogin('auth.errors.cancelled'); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.prompt && !window.suiteBuiltinsFixture.snapshot.accounts.pending);
      await page.evaluate(() => window.task9Boundary.expiredNext = true); await action('accounts.login', [], false); await site('Login-cancel').waitFor(); await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptExpired);
      const expiredId = await snapshot('accounts.prompt.id'); assert.equal(await site('Login-copy').isDisabled(), true); assert.equal(await site('Login-open').isDisabled(), true); assert.equal(await site('Login-cancel').isEnabled(), true); assert.equal(await site('Login-status').innerText(), text('auth.codeExpired')); await shot('login-expired', suite, theme);
      await site('Login-cancel').click(); await wait(id => window.task9Boundary.cancelAcks.includes(id), expiredId); assert.equal(await snapshot('accounts.prompt.id'), expiredId); await finishLogin('auth.errors.cancelled'); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
      await action('accounts.login', [], false); await site('Login-copy').waitFor(); const closingId = await snapshot('accounts.prompt.id'); await mode('clipboard', 'hold'); await site('Login-copy').click(); await held('clipboard');
      assert.equal(await snapshot('accounts.promptActionPending'), 'copy'); await finishLogin('Task9 login completion failure'); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.prompt && !window.suiteBuiltinsFixture.snapshot.accounts.pending);
      assert.ok((await snapshot('notifications.items')).some(item => item.message.includes('Task9 login completion failure')), 'login terminal failure reaches original owner'); await notices();
      await action('accounts.login', [], false); await site('Login-cancel').waitFor(); const nextLoginId = await snapshot('accounts.prompt.id'); assert.notEqual(nextLoginId, closingId); assert.equal(await snapshot('accounts.promptActionPending'), null);
      await release('clipboard', true); assert.equal(await snapshot('accounts.prompt.id'), nextLoginId); assert.equal(await snapshot('accounts.promptActionPending'), null); assert.deepEqual(await snapshot('notifications.items'), [], 'late clipboard failure after close cannot affect the replacement prompt'); assert.equal(await site('Login-cancel').isEnabled(), true);
      await site('Login-cancel').click(); await wait(id => window.task9Boundary.cancelAcks.includes(id), nextLoginId); await finishLogin('auth.errors.cancelled'); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
      await action('accounts.beginLogout', ['account-b']); await site('Accounts-confirm-logout').waitFor(); await site('Accounts-cancel-logout').click(); assert.equal(await snapshot('accounts.removingId'), null);
      await pass(suite + '/' + theme + ': login action waiting cancellable cancel pending guard original owner inline logout cancel start failure retry cancellation failure expiry ACK terminal result late clipboard isolation');

      await action('navigation.navigate', ['instances']);
      for (const choice of ['stay', 'background', 'stop']) {
        await page.evaluate(() => window.foundationDesktop.emit('launcher://close-requested', { game_running: true, downloads_active: true }));
        await site(p + 'Close-stay').waitFor(); assert.equal(await site(p + 'Close-stay').evaluate(e => e === document.activeElement), true);
        await reachable(site(p + 'Close-' + choice), suite, theme, 'close ' + choice); await shot('close-choices-' + choice, suite, theme);
        await mode('close_launcher', 'hold'); await site(p + 'Close-' + choice).click(); await held('close_launcher'); await page.keyboard.press('Escape'); assert.ok(await snapshot('window.request')); for (const name of ['stay', 'background', 'stop']) assert.equal(await site(p + 'Close-' + name).isDisabled(), true); await release('close_launcher'); await wait(() => !window.suiteBuiltinsFixture.snapshot.window.request);
        assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(c => c.command === 'close_launcher').at(-1).args.mode), choice);
      }
      await page.evaluate(() => window.foundationDesktop.emit('launcher://close-requested', { game_running: false, downloads_active: true })); await site(p + 'Close-stay').waitFor(); await page.keyboard.press('Escape'); await wait(() => !window.suiteBuiltinsFixture.snapshot.window.request); assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(c => c.command === 'close_launcher').at(-1).args.mode), 'stay');
      await pass(suite + '/' + theme + ': close distinct stop background stay native request pending safe focus Escape responds stay');
      await page.setViewportSize({ width: 1240, height: 720 });
    }

    // One source copy, permanent business owner, public business selector and Original.
    await action('navigation.navigate', ['instances']);
    await page.evaluate(async suite => window.suiteBuiltinsFixture.controller.actions.copyBuiltin(suite, 'Task9 dialog composition ' + suite), suite);
    await action('instanceDraft.open', [originalKey]); await site(p + 'InstanceSettings-name').fill('Draft survives Original');
    const before = await count('get_config'), accountBefore = await count('account_state'), listenerBefore = await count('plugin:event|listen');
    await page.evaluate(async ({ key }) => {
      const c = window.suiteBuiltinsFixture.controller;
      c.actions.selectTarget({ kind: 'business', target: 'dialog.instance-settings', identity: { namespace: 'profile', value: key } });
      if (!(await c.actions.createSelectionOverride('tsx'))) throw Error('Business dialog override unavailable');
      c.actions.patchFile(c.getSnapshot().selectedFile, 'export default function Task9Dialog({props,children,Original}){return <div data-ui-site="Task9-business-original"><Original {...props}>{children}</Original></div>}');
      if (!(await c.actions.preview())) throw Error('Dialog Original preview failed');
    }, { key: originalKey });
    await site('Task9-business-original').waitFor({ state: 'attached' });
    await page.getByRole('dialog', { name: text('instances.settings'), exact: true }).waitFor();
    assert.equal(await site(p + 'InstanceSettings-name').inputValue(), 'Draft survives Original');
    await environmentSite(p, 'value').fill('continued\nvalue=x');
    await site(p + 'InstanceSettings-cancel').click();
    await action('profileDraft.openRename', [originalKey]);
    await customizeWhole('dialog.profile', { namespace: 'profile', value: originalKey }, 'Task9-profile-original');
    await site('ProfileDialog-name').fill('Rename owner remains'); assert.equal(await snapshot('profileDraft.editor.name'), 'Rename owner remains'); await site('ProfileDialog-cancel').click();
    await action('removal.open', [originalKey]); await customizeWhole('dialog.remove-profile', { namespace: 'profile', value: originalKey }, 'Task9-remove-original'); await site(p + 'Remove-cancel').click();
    await action('launch.request', [originalKey]); await customizeWhole('dialog.launch-account', { namespace: 'profile', value: originalKey }, 'Task9-launch-original'); await site(p + 'LaunchAccount-cancel').click();
    await action('navigation.navigate', ['accounts']); await action('accounts.login', [], false); await site('Login-cancel').waitFor();
    const promptId = await snapshot('accounts.prompt.id'); await customizeWhole('dialog.login', { namespace: 'login', value: promptId }, 'Task9-login-original'); assert.equal(await snapshot('accounts.prompt.id'), promptId); await site('Login-cancel').click(); await wait(id => window.task9Boundary.cancelAcks.includes(id), promptId); assert.equal(await snapshot('accounts.prompt.id'), promptId); await finishLogin('auth.errors.cancelled'); await wait(() => !window.suiteBuiltinsFixture.snapshot.accounts.pending);
    await openSettings(); await action('presets.openDialog', [{ kind: 'save' }]); await customizeWhole('dialog.preset', { namespace: 'appearance-preset', value: 'save' }, 'Task9-preset-original'); await site(p + 'Preset-name').fill('Preset owned input'); assert.equal(await snapshot('drafts.preset.name'), 'Preset owned input'); await site(p + 'Preset-cancel').click();
    await action('settings.setTab', ['advanced']); await action('argumentTemplates.openNew'); const newTemplateId = await snapshot('drafts.argumentTemplate.id'); await customizeWhole('dialog.argument-template', { namespace: 'argument-template', value: newTemplateId }, 'Task9-template-original'); await site(p + 'Template-name').fill('Template owned input'); assert.equal(await snapshot('drafts.argumentTemplate.name'), 'Template owned input'); await site(p + 'Template-cancel').click();
    await action('navigation.navigate', ['instances']);
    await action('profileDraft.openCreate', ['1.21.1']); await site('ProfileDialog-name').fill('Ref and events');
    await page.evaluate(async () => {
      const c = window.suiteBuiltinsFixture.controller;
      c.actions.selectTarget({ kind: 'type', target: 'control.input' }); await c.actions.createSelectionOverride('tsx');
      c.actions.patchFile(c.getSnapshot().selectedFile, 'export default function Task9Input({props,children,Original}){return <Original {...props} data-task9-ref="kept">{children}</Original>}');
      c.actions.selectTarget({ kind: 'type', target: 'component.launcher-dialog' }); await c.actions.createSelectionOverride('tsx');
      c.actions.patchFile(c.getSnapshot().selectedFile, 'import {Menu} from "@paradox/ui"; export default function Task9Shell({props,children,Original}){return <Original {...props}>{children}<Menu.Root><Menu.Trigger data-ui-site="Task9-menu-trigger">Dialog menu</Menu.Trigger><Menu.Portal><Menu.Positioner><Menu.Popup data-ui-site="Task9-menu-popup"><Menu.Item data-ui-site="Task9-menu-item">Menu item</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root></Original>}');
      if (!(await c.actions.preview())) throw Error('Ref shell preview failed');
    });
    await site('ProfileDialog-name').waitFor(); assert.equal(await site('ProfileDialog-name').getAttribute('data-task9-ref'), 'kept');
    await site('Task9-menu-trigger').click(); await site('Task9-menu-popup').waitFor(); await page.keyboard.press('Escape'); await site('Task9-menu-popup').waitFor({ state: 'hidden' }); assert.ok(await snapshot('profileDraft.editor')); assert.equal(await site('Task9-menu-trigger').evaluate(e => e === document.activeElement), true);
    await page.evaluate(() => window.suiteBuiltinsFixture.controller.actions.open());
    const editor = page.getByRole('dialog', { name: text('uiSuiteEditor.title'), exact: true }); await editor.waitFor();
    const editorSelect = editor.getByRole('combobox', { name: text('uiSuiteEditor.suite'), exact: true }); await editorSelect.click(); await page.getByRole('listbox').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('listbox').waitFor({ state: 'hidden' }); assert.ok(await snapshot('profileDraft.editor')); await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' }); assert.equal(await site('ProfileDialog-name').inputValue(), 'Ref and events');
    await site('ProfileDialog-cancel').click();
    const measureScale = () => site(p + 'InstanceSettings-template').evaluate(trigger => {
      const popup = trigger.closest('[role=dialog]'), list = document.querySelector('[role=listbox]'), f = window.suiteBuiltinsFixture;
      return { popup: parseFloat(getComputedStyle(popup).fontSize), trigger: parseFloat(getComputedStyle(trigger).fontSize), select: parseFloat(getComputedStyle(list).fontSize), samePortal: popup.closest('.ui-dialog-portal') === list.closest('.ui-dialog-portal'), committed: window.foundationDesktop.config.settings.appearance.ui_scale, resolved: f.snapshot.appearance.value.ui_scale, variable: f.snapshot.appearance.variables.fontSize, popupStyle: popup.style.fontSize, selectStyle: list.style.fontSize };
    });
    await commitAppearance('ui_scale', 100); await action('instanceDraft.open', [originalKey]); await site(p + 'InstanceSettings-template').click(); await page.getByRole('listbox').waitFor();
    const baseline = await measureScale();
    assert.ok(baseline.samePortal && Math.abs(baseline.popup - 16) < .2 && Math.abs(baseline.select - baseline.trigger) < .2, '100% baseline uses Dialog and trigger typography: ' + JSON.stringify(baseline));
    await page.keyboard.press('Escape'); assert.ok(await snapshot('instanceDraft.profile')); await site(p + 'InstanceSettings-cancel').click();
    await commitAppearance('ui_scale', 120); await action('instanceDraft.open', [originalKey]); await site(p + 'InstanceSettings-template').click(); await page.getByRole('listbox').waitFor();
    const scale = await measureScale();
    assert.ok(scale.samePortal, 'nested Select remains in Dialog Portal');
    assert.equal(scale.committed, 120); assert.equal(scale.resolved, 120); assert.equal(scale.variable, '120%');
    assert.ok(Math.abs(scale.popup - 19.2) < .2 && Math.abs(scale.popup / baseline.popup - 1.2) < .02 && Math.abs(scale.trigger / baseline.trigger - 1.2) < .02 && Math.abs(scale.select / baseline.select - 1.2) < .02 && Math.abs(scale.select - scale.trigger) < .2, '120% font scale applies once with trigger typography: ' + JSON.stringify({ baseline, scale }));
    report.scale.push({ suite, baseline, scale });
    await page.keyboard.press('Escape'); assert.ok(await snapshot('instanceDraft.profile')); await site(p + 'InstanceSettings-cancel').click(); await commitAppearance('ui_scale', 100);
    await action('profileDraft.openCreate', ['1.21.1']);
    const exactSave = await page.evaluate(async () => {
      const c = window.suiteBuiltinsFixture.controller;
      c.actions.selectTarget({ kind: 'type', target: 'component.launcher-dialog' }); await c.actions.createSelectionOverride('html');
      const htmlPath = c.getSnapshot().selectedFile, htmlSource = '<section data-ui-site="Task9-html-original"><ui-slot></ui-slot></section>';
      c.actions.patchFile(htmlPath, htmlSource);
      await c.actions.createSelectionOverride('css'); const cssPath = c.getSnapshot().selectedFile, cssSource = '.modal { outline: 3px solid rgb(19, 125, 91); }'; c.actions.patchFile(cssPath, cssSource);
      if (!(await c.actions.preview())) throw Error('HTML CSS Original preview failed');
      if (!(await c.actions.save())) throw Error('Exact source save failed');
      const library = window.foundationDesktop.suiteLibrary, record = library.suites.find(row => row.instance_id === library.active_suite_id);
      return { htmlPath, htmlSource, cssPath, cssSource, savedHtml: record.overlay[htmlPath], savedCss: record.overlay[cssPath], activeHtml: c.getActivation().primary.bundle.files[htmlPath], activeCss: c.getActivation().primary.bundle.files[cssPath] };
    });
    await site('Task9-html-original').waitFor({ state: 'attached' }); await page.getByRole('dialog', { name: text('profileDialog.createTitle'), exact: true }).waitFor(); await site('ProfileDialog-name').fill('HTML original events'); assert.equal(await snapshot('profileDraft.editor.name'), 'HTML original events');
    assert.deepEqual(exactSave.savedHtml, { encoding: 'utf8', text: exactSave.htmlSource }); assert.deepEqual(exactSave.activeHtml, exactSave.savedHtml); assert.deepEqual(exactSave.savedCss, { encoding: 'utf8', text: exactSave.cssSource }); assert.deepEqual(exactSave.activeCss, exactSave.savedCss);
    const outline = await page.getByRole('dialog', { name: text('profileDialog.createTitle'), exact: true }).evaluate(dialog => ({ color: getComputedStyle(dialog).outlineColor, width: getComputedStyle(dialog).outlineWidth, style: getComputedStyle(dialog).outlineStyle }));
    assert.deepEqual(outline, { color: 'rgb(19, 125, 91)', width: '3px', style: 'solid' }, 'actual CSS override styles the native portaled Original dialog'); report.savedOverrides.push({ suite, ...exactSave, outline });
    await shot('customized-original-css-html-tsx', suite, 'light', 'customized');
    await site('ProfileDialog-cancel').click();
    assert.equal(await count('get_config'), before); assert.equal(await count('account_state'), accountBefore); assert.equal(await count('plugin:event|listen'), listenerBefore);
    assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.actions === window.task9StableActions && window.suiteBuiltinsFixture.controller === window.task9StableController), true, 'permanent owners survive Preview Save Original and suite switch');
    await pass(suite + ': business replacement canonical Original real Input ref events Menu editor Select Portal once-only scale HTML CSS TSX exact save no bootstrap');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.cspErrors, []);
} catch (error) {
  report.failure = String(error); await page.screenshot({ path: resolve(artifacts, 'failure.png') }); throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await fixture.close();
}
