import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/default-ui-task8-settings', process.env.PARADOX_TASK8_EVIDENCE || 'current-default');
await mkdir(artifacts, { recursive: true });
const locales = Object.fromEntries(await Promise.all(['en-US', 'zh-CN'].map(async language => [language, JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))])));
let language = 'en-US';
const text = (key, args = {}) => key.split('.').reduce((value, part) => value[part], locales[language]).replace(/{{(\w+)}}/g, (_, key) => String(args[key] ?? `{{${key}}}`));
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.settings.appearance.background_art = true;
config.settings.personalization.background_file = 'C:/old-player-background.png';
config.settings.argument_templates = [{ id: 'a72f88e2-a1ee-4a13-843c-49360b6e58a8', name: 'Referenced template', jvm: '', game: '', environment: {} }];
config.profiles[0].overrides.argument_template = 'a72f88e2-a1ee-4a13-843c-49360b6e58a8';
const fixture = await createBrowserFixture({ url: process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434', config, desktopBoundary: true });
const { page } = fixture;
const report = { startedAt: new Date().toISOString(), target: page.url(), checks: [], screenshots: [], reachability: [], provenance: {}, errors: fixture.observedPageErrors, cspErrors: fixture.observedCspViolations, contentSecurityPolicy: fixture.contentSecurityPolicy, sourceRequests: fixture.observedSourceModuleRequests };
const pass = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const settings = () => page.locator('.settings-page');
const save = () => settings().getByRole('button', { name: text('settings.save'), exact: true });
const reset = () => settings().getByRole('button', { name: text('settings.reset'), exact: true });
const input = key => settings().getByRole('spinbutton', { name: text(key), exact: true });
const field = key => settings().getByRole('textbox', { name: text(key), exact: true });
const tab = async value => { await settings().getByRole('tab', { name: text(value === 'game' ? 'settingsPages.gameTab' : `settings.tabs.${value}`), exact: true }).click(); await page.waitForFunction(value => window.suiteBuiltinsFixture.snapshot.settings.tab === value, value); };
const action = async (name, values = []) => page.evaluate(async ({ name, values }) => { let action = window.suiteBuiltinsFixture.actions; for (const key of name.split('.')) action = action[key]; return await action(...values); }, { name, values });
const snapshot = path => page.evaluate(path => { let value = window.suiteBuiltinsFixture.snapshot; for (const key of path.split('.')) value = value[key]; return structuredClone(value); }, path);
async function select(trigger, label) { await trigger.click(); const list = page.getByRole('listbox'); await list.waitFor(); await list.getByRole('option', { name: label, exact: true }).click(); await list.waitFor({ state: 'hidden' }); }
async function dismissNotices() {
  await page.evaluate(() => { const f = window.suiteBuiltinsFixture; for (const notice of f.snapshot.notifications.items) f.actions.notifications.dismiss(notice.id); });
  await page.waitForFunction(() => !document.querySelector('.ui-notice'));
}
async function screenshot(name, metadata) { await dismissNotices(); const path = `${metadata.sourceMode}/${name}.png`; await mkdir(resolve(artifacts, metadata.sourceMode), { recursive: true }); await page.screenshot({ path: resolve(artifacts, path) }); report.screenshots.push({ path, ...metadata }); }
async function setSuite(suite) { await page.evaluate(async suite => { const f = window.suiteBuiltinsFixture; if (!(await f.controller.actions.selectSuite(`builtin.${suite}`))) throw Error('Suite selection failed'); f.actions.settings.setTab('appearance'); f.actions.navigation.navigate('settings'); }, suite); await settings().waitFor(); await page.waitForFunction(suite => document.querySelector(`.${suite}-settings`), suite); }
async function chooseSuite(suite) {
  await settings().locator('.settings-style-option').filter({ hasText: text(`appearance.styles.${suite}.title`) }).click();
  await page.waitForFunction(suite => window.suiteBuiltinsFixture.controller.getSnapshot().selectedSuiteId === `builtin.${suite}` && document.querySelector(`.${suite}-settings`), suite);
}
async function reachableSave(suite, scale) {
  await dismissNotices();
  await save().evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  const geometry = await save().evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
    return { width: innerWidth, height: innerHeight, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, fullyInside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, centerInside: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight, hit: hit === element || element.contains(hit) };
  });
  assert.ok(geometry.fullyInside && geometry.centerInside && geometry.hit, `${suite}:320 Save at scale ${scale} must be visible and reachable: ${JSON.stringify(geometry)}`);
  report.reachability.push({ suite, scale, control: 'settings.save', ...geometry });
}
const editorBaseline = {};
for (const file of ['common/editor/Editor.tsx', 'common/editor/SourceEditor.tsx', 'common/editor/Files.tsx', 'common/editor/Assets.tsx', 'common/editor/style.css', 'common/editor/base.css']) {
  try { editorBaseline[file] = createHash('sha256').update(await readFile(new URL(`../src/ui-suite/builtins/${file}`, import.meta.url))).digest('hex'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

try {
  await page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    const installation = path => ({ executable: path, java_home: path.slice(0, path.lastIndexOf('/')), major_version: 21, version: '21.0.4', vendor: 'Task8 Fixture', architecture: 'x64', source: 'manual' });
    const boundary = window.task8Boundary = { saveMode: 'normal', saves: [], directories: [], inspections: [], holdInspection: false, downloads: [], holdDownload: false, supported: true, installation };
    window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (['save_config', 'choose_directory', 'discover_java', 'choose_java', 'inspect_java', 'enqueue_java'].includes(command)) {
        if (command !== 'save_config') window.foundationDesktop.calls.push({ command, args: structuredClone(args) });
        if (command === 'save_config') {
          if (boundary.saveMode === 'fail') { boundary.saveMode = 'normal'; throw Error('Task8 held save failure'); }
          if (boundary.saveMode === 'hold') { boundary.saveMode = 'normal'; return new Promise((resolve, reject) => boundary.saves.push({ args, resolve: async () => resolve(await original(command, args)), reject })); }
          return original(command, args);
        }
        if (command === 'choose_directory') return new Promise(resolve => boundary.directories.push(resolve));
        if (command === 'discover_java') return { installations: [installation('C:/task8-discovered/java.exe')], warnings: [{ path: 'C:/invalid-java', message: 'Task8 discovery warning' }], download_supported: boundary.supported };
        if (command === 'choose_java') return 'C:/task8-picked/java.exe';
        if (command === 'inspect_java') return boundary.holdInspection ? new Promise(resolve => boundary.inspections.push({ path: args.path, resolve })) : installation(args.path);
        const task = { id: `task8-java-${args.majorVersion}`, kind: 'java', name: `Java ${args.majorVersion}`, java_major: args.majorVersion, profile_key: null, status: 'completed', message: '', progress: null };
        return boundary.holdDownload ? new Promise(resolve => boundary.downloads.push({ task, resolve })) : task;
      }
      return original(command, args);
    };
  });
  for (const suite of ['modern', 'immersive']) {
    await setSuite(suite);
    const provenance = await page.evaluate(() => { const draft = window.suiteBuiltinsFixture.controller.getSnapshot().draft; return { views: draft.manifest.views, descriptors: draft.manifest.files }; });
    report.provenance[suite] = provenance;
    for (const id of ['page.settings', 'component.java-settings', 'component.argument-templates', 'component.appearance-settings', 'component.personalization-settings', 'component.appearance-presets']) assert.ok(provenance.views[id].startsWith(`${suite}/`), `${id} bound to own source`);
    assert.equal(await settings().locator('[type=color]').count(), 1);
    assert.equal(await settings().getByRole('slider', { name: text('appearance.sidebarOpacity'), exact: true }).count(), 1);
    assert.equal(await settings().locator('img, .background-preview').count(), 0);
    assert.equal(await settings().getByRole('switch', { name: text('appearance.background'), exact: true }).count(), 0);
    assert.equal(await settings().getByRole('combobox', { name: text('personalization.backgroundFit'), exact: true }).count(), 0);
    assert.deepEqual(await page.locator('.app-shell').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundImage)), ['none']);
    await save().isDisabled().then(value => assert.equal(value, true));
    await settings().getByRole('tab').first().focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await snapshot('settings.tab'), 'game');
    await page.keyboard.press('Home');
    assert.equal(await snapshot('settings.tab'), 'appearance');
    pass(`${suite}:independent_bindings_picture_free_opacity_and_keyboard_tabs`);

    await settings().getByRole('slider', { name: text('appearance.scale'), exact: true }).focus();
    await page.keyboard.press('Home');
    await select(settings().getByRole('combobox', { name: text('personalization.font'), exact: true }), text('personalization.fonts.serif'));
    await tab('game');
    await input('settings.minimumMemory').fill('768');
    await input('settings.maximumMemory').fill('6144');
    await input('settings.windowWidth').fill('1440');
    await input('settings.windowHeight').fill('900');
    await field('settings.javaExecutable').fill('C:/task8-manual/java.exe');
    await field('settings.gameDirectory').fill('C:/task8-game');
    await tab('advanced');
    const multiline = `-Dliteral= a=b\n-Dsecond=two words\n-Dsuite=${suite}\n`;
    await field('settings.jvmArguments').fill(multiline);
    await field('settings.gameArguments').fill('--literal= a=b\n--other value');
    await input('settings.timeout').fill('120'); await input('settings.concurrentDownloads').fill('4'); await input('settings.retries').fill('2');
    await field('settings.proxy').fill('http://localhost:8080'); await field('settings.mirror').fill('https://example.test/minecraft');
    const startup = settings().getByRole('combobox', { name: text('personalization.startupPage'), exact: true });
    await startup.click();
    await page.getByRole('listbox').waitFor();
    const registry = await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.navigation.routes.filter(route => route.startupSelectable).map(route => route.id));
    assert.equal(await page.getByRole('option').count(), registry.length);
    await page.keyboard.press('Escape');
    await select(startup, text('nav.home'));
    await select(settings().getByRole('combobox', { name: text('personalization.launchShortcut'), exact: true }), 'Alt+Enter');
    const draft = await snapshot('settings.draft');
    assert.equal(draft.extra_jvm_arguments, multiline);
    assert.equal(draft.offline_username, config.settings.offline_username);
    assert.equal(draft.appearance.background_art, true);
    assert.equal(draft.personalization.background_file, 'C:/old-player-background.png');
    assert.equal(draft.personalization.font, 'serif');
    assert.equal(draft.network.timeout_seconds, 120);
    assert.equal(await snapshot('settings.dirty'), true);
    pass(`${suite}:nested_scalar_personalization_and_exact_multiline_drafts`);

    const beforeSwitch = await snapshot('settings.draft');
    const callsBeforeSwitch = await page.evaluate(() => { window.task8StableActions = window.suiteBuiltinsFixture.actions; return window.foundationDesktop.calls.length; });
    await tab('appearance');
    await chooseSuite(suite === 'modern' ? 'immersive' : 'modern');
    assert.deepEqual(await snapshot('settings.draft'), beforeSwitch);
    assert.equal(await snapshot('settings.dirty'), true);
    await chooseSuite(suite);
    assert.deepEqual(await snapshot('settings.draft'), beforeSwitch);
    assert.equal(await page.evaluate(() => window.task8StableActions === window.suiteBuiltinsFixture.actions), true);
    assert.deepEqual(await page.evaluate(start => window.foundationDesktop.calls.slice(start).filter(call => ['save_config', 'get_config', 'plugin:event|listen'].includes(call.command)).map(call => call.command), callsBeforeSwitch), []);
    await tab('advanced');
    pass(`${suite}:visible_suite_switch_retains_complete_dirty_draft_and_owner`);

    await page.evaluate(() => { window.task8Boundary.saveMode = 'hold'; });
    await save().click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.settings.saving);
    assert.equal(await save().isDisabled(), true); assert.equal(await reset().isDisabled(), true);
    assert.ok((await settings().locator('.settings-save-status').innerText()).includes(text('settingsPages.saveBlocked.saving')));
    await field('settings.jvmArguments').fill(multiline + '-Dlater=true');
    await page.evaluate(async () => { await window.task8Boundary.saves.shift().resolve(); });
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.settings.saving);
    assert.equal((await snapshot('settings.draft')).extra_jvm_arguments, multiline + '-Dlater=true');
    assert.equal(await snapshot('settings.dirty'), true);
    await page.evaluate(() => { window.task8Boundary.saveMode = 'fail'; });
    await dismissNotices();
    await save().click(); await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.settings.saving);
    assert.equal((await snapshot('settings.draft')).extra_jvm_arguments, multiline + '-Dlater=true');
    await dismissNotices();
    await reset().click();
    assert.equal((await snapshot('settings.draft')).extra_jvm_arguments, multiline);
    await tab('game');
    await settings().getByRole('button', { name: text('settings.chooseGameDirectory'), exact: true }).click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.settings.choosingGameDirectory);
    assert.equal(await field('settings.gameDirectory').isDisabled(), true);
    assert.equal(await save().isDisabled(), true); assert.equal(await reset().isDisabled(), true);
    assert.equal(await settings().getByRole('tab', { name: text('settings.tabs.advanced'), exact: true }).isDisabled(), true);
    assert.ok((await settings().locator('.settings-save-status').innerText()).includes(text('settingsPages.saveBlocked.directory')));
    await page.evaluate(() => window.task8Boundary.directories.shift()('C:/task8-chosen-game'));
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.settings.choosingGameDirectory);
    assert.equal(await field('settings.gameDirectory').inputValue(), 'C:/task8-chosen-game');
    pass(`${suite}:save_failure_later_edits_reset_and_directory_guard`);

    await settings().getByRole('button', { name: text('java.discover'), exact: true }).click();
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.java.busy);
    assert.equal(await settings().locator('.java-runtime').count(), 1);
    assert.ok((await settings().locator('.java-warnings').innerText()).includes('Task8 discovery warning'));
    await settings().locator('.java-runtime button').click();
    assert.equal(await field('settings.javaExecutable').inputValue(), 'C:/task8-discovered/java.exe');
    await page.evaluate(() => { window.task8Boundary.holdInspection = true; });
    await settings().getByRole('button', { name: text('java.chooseFile'), exact: true }).click();
    await page.waitForFunction(() => window.task8Boundary.inspections.length > 0);
    await field('settings.javaExecutable').fill('C:/task8-newer-manual/java.exe');
    await page.evaluate(() => window.task8Boundary.inspections.shift().resolve(window.task8Boundary.installation('C:/task8-older-canonical/java.exe')));
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.java.busy);
    assert.equal(await field('settings.javaExecutable').inputValue(), 'C:/task8-newer-manual/java.exe');
    await settings().getByRole('button', { name: text('java.chooseFile'), exact: true }).click();
    await page.waitForFunction(() => window.task8Boundary.inspections.length > 0);
    await page.evaluate(() => window.task8Boundary.inspections.shift().resolve(window.task8Boundary.installation('C:/task8-canonical-success/java.exe')));
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.java.busy);
    assert.equal(await field('settings.javaExecutable').inputValue(), 'C:/task8-canonical-success/java.exe');
    await page.evaluate(() => { window.task8Boundary.holdInspection = false; });
    await settings().getByRole('button', { name: text('java.checkPath'), exact: true }).click();
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.java.busy);
    const entered = field('java.otherMajor'), enteredButton = settings().getByRole('button', { name: text('java.downloadVersion'), exact: true });
    for (const value of ['7', '100', '21.5', 'abc']) { await entered.fill(value); assert.equal(await enteredButton.isDisabled(), true); }
    for (const value of ['8', '99']) { await entered.fill(value); assert.equal(await enteredButton.isEnabled(), true); }
    await entered.fill('22');
    await page.evaluate(() => { window.task8Boundary.holdDownload = true; });
    await enteredButton.click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.downloads.pending.length > 0);
    assert.equal(await save().isDisabled(), true);
    assert.ok((await settings().locator('.settings-save-status').innerText()).includes(text('settingsPages.saveBlocked.downloads')));
    await page.evaluate(() => { const value = window.task8Boundary.downloads.shift(); value.resolve(value.task); window.task8Boundary.holdDownload = false; });
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.downloads.pending.length);
    for (const major of [8, 17, 21]) await settings().getByRole('button', { name: `Java ${major}`, exact: true }).click();
    await page.evaluate(() => { window.task8Boundary.supported = false; });
    await action('java.discover');
    assert.equal(await enteredButton.isDisabled(), true);
    assert.ok((await settings().innerText()).includes(text('java.downloadUnsupported')));
    await page.evaluate(() => { window.task8Boundary.supported = true; }); await action('java.discover');
    pass(`${suite}:java_discovery_choose_manual_guard_bounds_and_download_pending`);

    await tab('advanced');
    assert.equal(await settings().getByRole('button', { name: text('argumentTemplates.remove', { name: 'Referenced template' }), exact: true }).isDisabled(), true);
    await settings().getByRole('button', { name: text('argumentTemplates.add'), exact: true }).click();
    const templateDialog = page.getByRole('dialog', { name: text('argumentTemplates.editor'), exact: true });
    await templateDialog.waitFor();
    await templateDialog.locator('input').first().fill('Task8 literal template');
    await templateDialog.locator('textarea').nth(0).fill('-Dtemplate=one\n-Dtwo=2');
    await action('argumentTemplates.setEnvironment', [[{ key: 'TASK8_LITERAL', value: ' a=b\n second line ' }, { key: 'TASK8_EMPTY', value: '' }]]);
    await templateDialog.getByRole('button', { name: text('argumentTemplates.apply'), exact: true }).click();
    await templateDialog.waitFor({ state: 'hidden' });
    const template = (await snapshot('settings.draft')).argument_templates.find(value => value.name === 'Task8 literal template');
    assert.deepEqual(template.environment, { TASK8_LITERAL: ' a=b\n second line ', TASK8_EMPTY: '' });
    await action('argumentTemplates.openEdit', [template.id]);
    await action('argumentTemplates.setEnvironment', [[{ key: 'JAVA_TOOL_OPTIONS', value: '-Dblocked' }]]);
    await action('argumentTemplates.apply');
    assert.ok(await snapshot('drafts.argumentTemplateError'));
    assert.equal((await snapshot('drafts.environment'))[0].value, '-Dblocked');
    await action('argumentTemplates.cancel');
    await action('argumentTemplates.remove', [template.id]);
    pass(`${suite}:template_literal_environment_and_owner_validation`);

    await tab('appearance');
    await settings().getByRole('button', { name: text('presets.saveCurrent'), exact: true }).click();
    let presetDialog = page.getByRole('dialog', { name: text('presets.dialog.save.title'), exact: true });
    const presetName = `Task8 ${suite} preset`, beforePresetSave = await snapshot('settings.draft');
    await presetDialog.locator('input').fill(presetName);
    await page.evaluate(() => { window.task8Boundary.saveMode = 'hold'; });
    await presetDialog.getByRole('button', { name: text('presets.dialog.save.action'), exact: true }).click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.drafts.presetPending && window.task8Boundary.saves.length === 1);
    assert.equal((await snapshot('drafts.preset')).pending, true);
    assert.equal(await presetDialog.locator('input').isDisabled(), true);
    assert.equal(await presetDialog.getByRole('button', { name: text('presets.cancel'), exact: true }).isDisabled(), true);
    assert.equal(await presetDialog.getByRole('button', { name: text('presets.dialog.save.action'), exact: true }).isDisabled(), true);
    assert.equal(await settings().locator('.settings-preset-tools button:enabled').count(), 0);
    assert.equal(await page.evaluate(name => window.task8Boundary.saves[0].args.config.appearance_presets.some(preset => preset.name === name), presetName), true);
    await action('presets.patchDraft', [{ name: 'Ignored pending rename' }]);
    await action('presets.cancelDialog');
    await page.keyboard.press('Escape');
    assert.equal(await presetDialog.count(), 1);
    assert.equal(await presetDialog.locator('input').inputValue(), presetName);
    await page.evaluate(() => window.task8Boundary.saves.shift().reject(Error('Task8 held preset save failure')));
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.drafts.presetPending && !!window.suiteBuiltinsFixture.snapshot.drafts.preset?.error);
    assert.equal(await presetDialog.locator('input').inputValue(), presetName);
    assert.ok((await snapshot('drafts.preset')).error.includes('Task8 held preset save failure'));
    assert.deepEqual(await snapshot('settings.draft'), beforePresetSave);
    assert.equal(await presetDialog.locator('input').isEnabled(), true);
    await page.evaluate(() => { window.task8Boundary.saveMode = 'hold'; });
    await presetDialog.getByRole('button', { name: text('presets.dialog.save.action'), exact: true }).click();
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.drafts.presetPending && window.task8Boundary.saves.length === 1);
    await page.evaluate(async () => { await window.task8Boundary.saves.shift().resolve(); });
    await presetDialog.waitFor({ state: 'hidden' });
    assert.equal(await snapshot('drafts.presetPending'), false);
    assert.deepEqual(await snapshot('settings.draft'), beforePresetSave);
    pass(`${suite}:preset_real_save_pending_failure_keeps_dialog_and_settings_drafts_retry`);
    let preset = (await snapshot('config.value.appearance_presets')).find(value => value.name === `Task8 ${suite} preset`);
    await action('settings.patchAppearance', ['border_radius', 9]);
    await settings().getByRole('button', { name: text('presets.applyAria', { name: preset.name }), exact: true }).click();
    assert.equal((await snapshot('settings.draft')).appearance.border_radius, preset.appearance.border_radius);
    assert.equal((await snapshot('settings.draft')).appearance.background_art, true);
    await settings().getByRole('button', { name: text('presets.renameAria', { name: preset.name }), exact: true }).click();
    presetDialog = page.getByRole('dialog', { name: text('presets.dialog.rename.title'), exact: true });
    await presetDialog.locator('input').fill(`Renamed ${suite} preset`);
    await presetDialog.getByRole('button', { name: text('presets.dialog.rename.action'), exact: true }).click();
    await presetDialog.waitFor({ state: 'hidden' });
    preset = (await snapshot('config.value.appearance_presets')).find(value => value.id === preset.id);
    await settings().getByRole('button', { name: text('presets.exportAria', { name: preset.name }), exact: true }).click();
    presetDialog = page.getByRole('dialog', { name: text('presets.dialog.export.title'), exact: true });
    assert.ok((await presetDialog.locator('textarea').inputValue()).includes('background_art'));
    await action('presets.cancelDialog');
    await settings().getByRole('button', { name: text('presets.import'), exact: true }).click();
    presetDialog = page.getByRole('dialog', { name: text('presets.dialog.import.title'), exact: true });
    await presetDialog.locator('textarea').fill('{bad json');
    await presetDialog.getByRole('button', { name: text('presets.dialog.import.action'), exact: true }).click();
    await page.waitForFunction(() => !!window.suiteBuiltinsFixture.snapshot.drafts.preset?.error);
    assert.equal(await presetDialog.locator('textarea').inputValue(), '{bad json');
    await action('presets.cancelDialog');
    await settings().getByRole('button', { name: text('presets.removeAria', { name: preset.name }), exact: true }).click();
    presetDialog = page.getByRole('dialog', { name: text('presets.dialog.remove.title'), exact: true });
    await presetDialog.getByRole('button', { name: text('presets.dialog.remove.action'), exact: true }).click();
    await presetDialog.waitFor({ state: 'hidden' });
    pass(`${suite}:preset_save_apply_rename_export_import_error_remove`);
    await reset().click();
  }

  for (const suite of ['modern', 'immersive']) {
    await setSuite(suite);
    await action('settings.patchAppearance', ['ui_scale', 85]);
    for (const lang of ['en-US', 'zh-CN']) {
      await action('settings.patch', ['language', lang]); language = lang;
      for (const theme of ['dark', 'light']) {
        await action('settings.patchAppearance', ['theme', theme]);
        for (const value of ['appearance', 'game', 'advanced']) {
          await tab(value); await page.setViewportSize({ width: 1240, height: 780 });
          await settings().evaluate(element => element.scrollIntoView({ block: 'start' }));
          await screenshot(`${suite}-${lang}-${theme}-${value}-1240`, { suite, language: lang, theme, tab: value, scale: 85, viewport: '1240x780', sourceMode: 'current-default' });
        }
      }
    }
    await action('settings.patch', ['language', 'en-US']); language = 'en-US';
    await action('settings.patchAppearance', ['theme', 'dark']);
    for (const viewport of [{ width: 960, height: 640 }, { width: 800, height: 600 }, { width: 640, height: 480 }, { width: 320, height: 240 }]) {
      await page.setViewportSize(viewport);
      for (const value of ['appearance', 'game', 'advanced']) {
        await tab(value); await settings().evaluate(element => element.scrollIntoView({ block: 'start' }));
        assert.equal(await settings().evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `${suite}/${value}/${viewport.width} no horizontal content loss`);
        await screenshot(`${suite}-compact-${value}-${viewport.width}`, { suite, language, theme: 'dark', tab: value, scale: 85, viewport: `${viewport.width}x${viewport.height}`, sourceMode: 'current-default' });
      }
    }
    await page.setViewportSize({ width: 320, height: 240 });
    for (const scale of [85, 100, 120]) {
      await action('settings.patchAppearance', ['ui_scale', scale]); await tab('game');
      await input('settings.maximumMemory').fill(String(scale === 85 ? 8192 : scale === 100 ? 9216 : 10240));
      await reachableSave(suite, scale); await save().click();
      await page.waitForFunction(() => !window.suiteBuiltinsFixture.snapshot.settings.saving && !window.suiteBuiltinsFixture.snapshot.settings.dirty);
      await screenshot(`${suite}-save-320-scale-${scale}`, { suite, language, theme: 'dark', tab: 'game', scale, viewport: '320x240', sourceMode: 'current-default' });
    }
    pass(`${suite}:two_languages_two_themes_all_tabs_compact_and_320_save_scales`);
  }

  await page.setViewportSize({ width: 1240, height: 780 });
  for (const suite of ['modern', 'immersive']) {
    await setSuite(suite); await action('settings.patchAppearance', ['ui_scale', 100]);
    const font = settings().getByRole('combobox', { name: text('personalization.font'), exact: true });
    await font.click();
    assert.equal(await page.getByRole('listbox').evaluate(element => element.getRootNode() instanceof ShadowRoot), false);
    await page.keyboard.press('Escape');
    await settings().getByRole('button', { name: text('uiSuiteEditor.open'), exact: true }).click();
    const editor = page.locator('#paradox-suite-editor .suite-editor'); await editor.waitFor();
    const shape = () => editor.evaluate(element => { const style = getComputedStyle(element); return { fontSize: style.fontSize, color: style.color, background: style.backgroundColor, padding: style.padding, border: style.borderWidth }; });
    const before = await shape();
    await page.evaluate(async suite => {
      const c = window.suiteBuiltinsFixture.controller;
      const previousId = c.getSnapshot().selectedSuiteId, name = `Task8 ${suite} customization`;
      await c.actions.copyBuiltin(suite, name);
      const copied = c.getSnapshot();
      if (!copied.selectedSuiteId || copied.selectedSuiteId === previousId || copied.selectedSuiteId.startsWith('builtin.') || copied.draft?.manifest.name !== name || !copied.dirty) throw Error('Copied suite draft was not created');
      const path = `${suite}/styles/settings.css`, file = c.getSnapshot().draft.files[path];
      c.actions.patchFile(path, file.text + '\n.settings-save-bar{border-width:4px}\n');
      const pagePath = c.getSnapshot().draft.manifest.views['page.settings'];
      c.actions.patchFile(pagePath, c.getSnapshot().draft.files[pagePath].text.replace("{t('settings.save')}", '<span data-ui-site="task8-custom-save">Customized Save</span>'));
      if (!(await c.actions.preview())) throw Error('Player preview failed');
    }, suite);
    await page.locator('[data-ui-site$=":task8-custom-save"]').waitFor();
    assert.equal(await settings().locator('.settings-save-bar').evaluate(element => getComputedStyle(element).borderTopWidth), '4px');
    assert.deepEqual(await shape(), before);
    const editorSelect = editor.getByRole('combobox', { name: text('uiSuiteEditor.suite'), exact: true });
    await editorSelect.click();
    assert.equal(await page.getByRole('listbox').evaluate(element => element.getRootNode() instanceof ShadowRoot), true);
    await screenshot(`${suite}-player-and-editor-portal`, { suite, language, theme: 'dark', tab: 'appearance', scale: 100, viewport: '1240x780', sourceMode: 'customized' });
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { const c = window.suiteBuiltinsFixture.controller, path = 'common/editor/style.css'; c.actions.patchFile(path, c.getSnapshot().draft.files[path].text + '\n.suite-editor{outline:3px solid rgb(20,110,80)}\n'); if (!(await c.actions.preview())) throw Error('Editor self-customization failed'); });
    assert.equal(await editor.evaluate(element => getComputedStyle(element).outlineColor), 'rgb(20, 110, 80)');
    await screenshot(`${suite}-editor-self-customized`, { suite, language, theme: 'dark', tab: 'appearance', scale: 100, viewport: '1240x780', sourceMode: 'customized' });
    await page.evaluate(async suite => { const c = window.suiteBuiltinsFixture.controller; c.actions.close(); await c.actions.revert(); await c.actions.selectSuite(`builtin.${suite}`); }, suite);
    pass(`${suite}:player_css_source_edits_preserve_editor_and_editor_self_customizes`);
  }
  for (const [file, hash] of Object.entries(editorBaseline)) assert.equal(createHash('sha256').update(await readFile(new URL(`../src/ui-suite/builtins/${file}`, import.meta.url))).digest('hex'), hash, `${file} bytes unchanged`);
  report.editorBaseline = editorBaseline;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.cspErrors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') { assert.ok(report.contentSecurityPolicy); assert.deepEqual(report.sourceRequests, []); }
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  await writeFile(resolve(artifacts, 'failure-body.txt'), await page.locator('body').innerText());
  throw error;
} finally {
  report.endedAt = new Date().toISOString();
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
