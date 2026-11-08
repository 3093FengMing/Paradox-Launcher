import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, openEditor } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/task-13/foundation', process.env.PARADOX_FINAL_EVIDENCE || 'manual-run');
await mkdir(artifacts, { recursive: true });
const config = structuredClone(initialConfig);
config.settings.argument_templates = [
  {
    id: 'foundation-template',
    name: 'Foundation template',
    jvm: '-Dfoundation=true',
    game: '',
    environment: {},
  },
];
config.profiles.push({
  ...config.profiles[0],
  instance_key: 'second-instance',
  name: 'Second world',
});
const fixture = await createBrowserFixture({ config, desktopBoundary: true });
const { page } = fixture;
const errors = fixture.observedPageErrors;
const report = {
  browserVersion: fixture.browser.version(),
  target: process.env.PARADOX_UI_URL || 'http://127.0.0.1:1420',
  startedAt: new Date().toISOString(),
  checks: [],
  screenshots: [],
  errors,
  contentSecurityPolicy: fixture.contentSecurityPolicy,
  compiledHarness: await page.evaluate(() => typeof window.mountFoundationFixture === 'function'),
  sourceModuleRequests: fixture.observedSourceModuleRequests,
};

async function mountControls(theme, shadow = false) {
  await page.evaluate(
    async ({ theme, shadow }) => {
      if (!window.mountFoundationFixture) await import('/src/ui-foundation/browser-fixture.tsx');
      window.mountFoundationFixture(theme, shadow);
    },
    { theme, shadow },
  );
  await page.locator('#choice').waitFor({ state: 'visible' });
}

const messages = JSON.parse(
  await readFile(new URL('../src/locales/zh-CN.json', import.meta.url), 'utf8'),
);
const text = (key) => key.split('.').reduce((value, part) => value[part], messages);
const check = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
async function choose(trigger, option) {
  assert.equal(await trigger.locator('select').count(), 0);
  await trigger.click();
  const list = page.getByRole('listbox');
  await list.waitFor({ state: 'visible' });
  await list.getByRole('option', { name: option, exact: true }).click();
  await list.waitFor({ state: 'hidden' });
  assert.equal(await trigger.locator('.ui-select-value').innerText(), option);
}
async function navigate(key) {
  await page
    .locator('.sidebar')
    .getByRole('button', { name: new RegExp('^(?:' + text(`nav.${key}`) + ')(?:\\s|$)') })
    .click();
}
async function allBuiltinSelects() {
  await navigate('content');
  const instance = page.getByRole('combobox', { name: text('content.instance'), exact: true });
  await choose(instance, text('content.chooseInstance'));
  assert.equal(
    await instance.locator('.ui-select-value').innerText(),
    text('content.chooseInstance'),
  );
  await choose(instance, 'Second world · 1.21.1 · vanilla');
  const beforeSearch = await page.evaluate(
    () => window.foundationDesktop.calls.filter((call) => call.command === 'search_content').length,
  );
  const kind = page.getByRole('group', { name: text('content.projectType'), exact: true })
    .getByRole('button', { name: text('content.types.shader'), exact: true });
  await kind.focus(); await page.keyboard.press('Enter');
  assert.equal(await kind.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.suiteFinalFixture.snapshot.content.kind), 'shader');
  assert.equal(
    await page.evaluate(
      () =>
        window.foundationDesktop.calls.filter((call) => call.command === 'search_content').length,
    ),
    beforeSearch,
    'choosing kind only changes the search draft',
  );
  await page
    .locator('.discover-search form')
    .getByRole('button', { name: text('content.search'), exact: true })
    .click();
  await page.waitForFunction(() =>
    window.foundationDesktop.calls.some(
      (call) => call.command === 'search_content' && call.args.category === 'shader',
    ),
  );
  check('builtin_selects:content_instance_empty_and_kind_form_draft');

  await navigate('home');
  await page.locator('.immersive-launch-primary').click();
  const accountDialog = page.getByRole('dialog', { name: text('auth.launchTitle'), exact: true });
  const account = accountDialog.getByRole('combobox', { name: text('auth.select'), exact: true });
  await choose(account, 'Steve');
  await choose(account, '离线 · Player');
  await page.evaluate(() => {
    window.foundationDesktop.accountFailure = true;
  });
  await accountDialog.getByRole('button', { name: text('auth.launch'), exact: true }).click();
  await page.waitForFunction(() =>
    window.foundationDesktop.calls.some((call) => call.command === 'select_account'),
  );
  assert.equal(
    await accountDialog.isVisible(),
    true,
    'failed account submission retains the dialog draft',
  );
  assert.equal(await account.locator('.ui-select-value').innerText(), '离线 · Player');
  assert.equal(
    await page.evaluate(
      () =>
        window.foundationDesktop.calls.filter((call) => call.command === 'select_account').at(-1)
          .args.id,
    ),
    null,
  );
  await accountDialog.getByRole('button', { name: text('common.cancel'), exact: true }).click();
  await page.evaluate(() => {
    window.foundationDesktop.accountFailure = false;
  });
  check('builtin_selects:launch_account_empty_to_null_failed_draft');

  await navigate('instances');
  const profileName = config.profiles[0].name;
  const openInstanceSettings = async () => {
    await page.locator('.instance-row').filter({ hasText: profileName })
      .getByRole('button', { name: text('instancePages.toolsFor').replace('{{name}}', profileName), exact: true }).click();
    await page.getByRole('menuitem', { name: text('instances.settings'), exact: true }).click();
  };
  await openInstanceSettings();
  let instanceDialog = page.getByRole('dialog', { name: text('instances.settings'), exact: true });
  await choose(
    instanceDialog.getByRole('combobox', { name: text('argumentTemplates.select'), exact: true }),
    'Foundation template',
  );
  assert.ok((await instanceDialog.innerText()).includes('Foundation template'));
  const templateSelect = instanceDialog.getByRole('combobox', { name: text('argumentTemplates.select'), exact: true });
  await templateSelect.click();
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__, original = native.invoke;
    native.invoke = async (command, args) => {
      if (command === 'choose_directory') {
        await new Promise(resolve => window.foundationDesktop.releaseInstanceDirectory = resolve);
        native.invoke = original;
        return null;
      }
      return original(command, args);
    };
    void window.suiteFinalFixture.actions.instanceDraft.chooseDirectory();
  });
  await page.waitForFunction(() => window.suiteFinalFixture.snapshot.instanceDraft.picking);
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.equal(await templateSelect.isDisabled(), true, 'actual instance directory picking disables the template Select Root');
  assert.equal(await templateSelect.locator('.ui-select-value').innerText(), 'Foundation template');
  await page.evaluate(() => window.foundationDesktop.releaseInstanceDirectory());
  await page.waitForFunction(() => !window.suiteFinalFixture.snapshot.instanceDraft.picking);
  assert.equal(await templateSelect.isDisabled(), false);
  await instanceDialog
    .getByRole('button', { name: text('instanceDialog.save'), exact: true })
    .click();
  await instanceDialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.config.profiles[0].overrides.argument_template,
    ),
    'foundation-template',
  );
  await openInstanceSettings();
  instanceDialog = page.getByRole('dialog', { name: text('instances.settings'), exact: true });
  await choose(
    instanceDialog.getByRole('combobox', { name: text('argumentTemplates.select'), exact: true }),
    text('argumentTemplates.global'),
  );
  await instanceDialog
    .getByRole('button', { name: text('instanceDialog.save'), exact: true })
    .click();
  await instanceDialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.config.profiles[0].overrides.argument_template,
    ),
    null,
  );
  check('builtin_selects:instance_template_selection_and_empty_inheritance');

  await navigate('settings');
  await choose(
    page.getByRole('combobox', { name: text('personalization.font'), exact: true }),
    text('personalization.fonts.serif'),
  );
  await page.getByRole('tab', { name: text('settings.tabs.advanced'), exact: true }).click();
  await choose(
    page.getByRole('combobox', { name: text('personalization.startupPage'), exact: true }),
    text('nav.logs'),
  );
  const shortcut = page.getByRole('combobox', {
    name: text('personalization.launchShortcut'),
    exact: true,
  });
  await choose(shortcut, 'Alt+Enter');
  await page
    .getByRole('switch', { name: text('personalization.shortcuts.title'), exact: true })
    .click();
  assert.equal(await shortcut.isDisabled(), true);
  await page
    .getByRole('switch', { name: text('personalization.shortcuts.title'), exact: true })
    .click();
  assert.equal(await shortcut.isDisabled(), false);
  assert.equal(
    await page.evaluate(
      () => window.foundationDesktop.config.settings.personalization.background_fit,
    ),
    'cover',
    'choices remain drafts until the original settings save',
  );
  await page.getByRole('button', { name: text('settings.save'), exact: true }).click();
  await page.waitForFunction(
    () => window.foundationDesktop.config.settings.personalization.launch_shortcut === 'Alt+Enter',
  );
  assert.equal(
    await page.evaluate(() => window.foundationDesktop.config.settings.personalization.font),
    'serif',
  );
  check('builtin_selects:personalization_supported_choices_drafts_save_and_disabled');

  await navigate('instances');
  await page
    .locator('.instances-page')
    .getByRole('button', { name: text('app.createInstance'), exact: true })
    .click();
  await page.waitForFunction(() => window.suiteFinalFixture.snapshot.navigation.routeId === 'custom.versions');
  const version = page.locator('.versions-page article').filter({ hasText: '1.21.1' });
  await version.getByRole('button', { name: text('common.createInstance'), exact: true }).click();
  assert.equal(await page.evaluate(() => window.suiteFinalFixture.snapshot.profileDraft.editor?.version), '1.21.1');
  check('instances_create_registry_versions_row_profile_draft');
  const profile = page.getByRole('dialog', { name: text('profileDialog.createTitle'), exact: true, includeHidden: true });
  const name = profile.getByRole('textbox', { name: text('instances.name'), exact: true, includeHidden: true });
  await name.fill('Retained foundation draft');
  await choose(
    profile.getByRole('combobox', { name: text('loaders.type'), exact: true }),
    'NeoForge',
  );
  const loader = profile.getByRole('combobox', { name: text('loaders.version'), exact: true });
  await page.waitForFunction(() =>
    window.foundationDesktop.calls.some((call) => call.command === 'loader_versions'),
  );
  await page.waitForFunction(() => {
    const catalog = window.suiteFinalFixture.snapshot.profileDraft.loaderCatalog;
    return catalog.request?.loader === 'neoforge' && !catalog.pending;
  });
  assert.equal(await loader.isEnabled(), true, 'actual matching loader catalog re-enables its Select');
  const loaderSave = profile.getByRole('button', {
    name: text('common.createInstance'),
    exact: true,
  });
  assert.equal(await loaderSave.isEnabled(), false, 'loader required empty value cannot submit');
  assert.equal(await profile.locator('form').evaluate((form) => form.checkValidity()), false);
  await choose(loader, 'test-loader-2 · ' + text('loaders.experimental'));
  assert.equal(await loaderSave.isEnabled(), true);

  const originalProfile = await profile.elementHandle();
  const originalName = await name.elementHandle();
  assert.ok(originalProfile && originalName, 'capture the actual Profile Popup and forwarded native Input');
  const retainedProfileDraft = await page.evaluate(() => structuredClone(window.suiteFinalFixture.snapshot.profileDraft.editor));
  const assertRetainedProfile = async () => {
    assert.deepEqual(await page.evaluate(() => window.suiteFinalFixture.snapshot.profileDraft.editor), retainedProfileDraft, 'ordinary editor retains the real complete Profile draft');
    assert.equal(await profile.evaluate((element, original) => element === original && element.isConnected, originalProfile), true, 'ordinary editor retains the original connected Profile Popup');
    assert.equal(await name.evaluate((element, original) => element === original && element.isConnected, originalName), true, 'ordinary editor retains the original forwarded native Input');
    assert.equal(await name.inputValue(), 'Retained foundation draft');
  };
  await name.focus();
  let editor = await openEditor(page);
  // Base UI hides the lower modal from accessibility while the editor is
  // topmost. The retained Popup is still rendered and the original owner/DOM
  // handles below must survive; includeHidden observes that actual lower modal.
  assert.equal(await profile.isVisible(), true, 'opening editor keeps the original Profile Dialog');
  await assertRetainedProfile();
  await editor.getByRole('button', { name: new RegExp('^' + text('uiInspector.catalog')) }).click();
  const target = editor.getByRole('combobox', {
    name: text('uiInspector.group'),
    exact: true,
  });
  await target.click();
  const popup = page.getByRole('listbox');
  await popup.waitFor({ state: 'visible' });
  assert.equal(
    await popup.evaluate((element) => element.getRootNode() instanceof ShadowRoot),
    true,
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await popup.waitFor({ state: 'hidden' });
  await target.click();
  await popup.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await editor.isVisible(), true, 'Escape dismisses only the Select');
  assert.equal(
    await target.evaluate((element) => element.getRootNode().activeElement === element),
    true,
  );
  for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
    await page.keyboard.press(key);
    assert.equal(
      await editor.evaluate((element) => element.contains(element.getRootNode().activeElement)),
      true,
      'topmost editor owns Tab focus',
    );
  }
  await page.keyboard.press('Escape');
  await editor.waitFor({ state: 'hidden' });
  await assertRetainedProfile();
  assert.equal(
    await name.evaluate((element) => element.getRootNode().activeElement === element),
    true,
    'subsequent Escape dismisses only editor and returns the prior Profile focus',
  );
  editor = await openEditor(page);
  await editor.getByRole('button', { name: text('uiSuiteEditor.pick'), exact: true }).click();
  await page.locator('.ui-pick-hint').waitFor({ state: 'visible' });
  await name.click();
  editor = page.getByRole('dialog', { name: text('uiSuiteEditor.title'), exact: true });
  await editor.waitFor({ state: 'visible' });
  await assertRetainedProfile();
  await editor.locator('header button').click();
  await editor.waitFor({ state: 'hidden' });
  await assertRetainedProfile();
  assert.equal(
    await name.evaluate((element) => element.getRootNode().activeElement === element),
    true,
    'closing editor returns focus to the original modal input',
  );
  await page.evaluate(() => {
    window.foundationDesktop.loaderVersions = [];
  });
  await choose(
    profile.getByRole('combobox', { name: text('loaders.type'), exact: true }),
    'Fabric',
  );
  await loader.click();
  const emptyList = page.getByRole('listbox');
  await emptyList.waitFor({ state: 'visible' });
  assert.equal(await emptyList.getByRole('option').count(), 1);
  await page.keyboard.press('Escape');
  await emptyList.waitFor({ state: 'hidden' });
  assert.equal(
    await loaderSave.isEnabled(),
    false,
    'empty loader catalog cannot create an instance',
  );
  assert.equal(await loader.locator('.ui-select-value').innerText(), text('loaders.choose'));
  await profile.getByRole('button', { name: text('common.cancel'), exact: true }).click();
  check('builtin_selects:loader_type_version_required_empty_catalog_and_editor_catalog_group');
  check('dialog_editor_shadow_select_topmost_focus_picking_and_retained_draft');

  for (const theme of ['light', 'dark']) {
    await navigate('settings');
    await page.getByRole('tab', { name: text('settings.tabs.appearance'), exact: true }).click();
    await page
      .getByRole('button', { name: text(`appearance.themes.${theme}`), exact: true })
      .click();
    await page.getByRole('button', { name: text('settings.save'), exact: true }).click();
    await page.waitForFunction(
      (theme) => window.foundationDesktop.config.settings.appearance.theme === theme,
      theme,
    );
    await navigate('home');
    await page.getByRole('button', { name: text('immersive.selectInstance'), exact: true }).click();
    const menu = page.getByRole('menu');
    await menu.waitFor({ state: 'visible' });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="menu"]')].some(
        (element) => getComputedStyle(element).opacity === '1',
      ),
    );
    assert.equal(
      await menu.evaluate((element) => getComputedStyle(element).color),
      await page.locator('.app-shell').evaluate(element => getComputedStyle(element).color),
      'source menu Portal retains the active player theme ink',
    );
    assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), theme);
    assert.equal(await menu.evaluate((element) => element.getRootNode() === document), true);
    await page.screenshot({ path: resolve(artifacts, `${theme}-menu.png`) });
    report.screenshots.push(`${theme}-menu.png`);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 320, height: 240 });
    await page.getByRole('button', { name: text('immersive.selectInstance'), exact: true }).click();
    await menu.waitFor({ state: 'visible' });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="menu"]')].some(
        (element) => getComputedStyle(element).opacity === '1',
      ),
    );
    const menuBounds = await menu.boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 320);
    assert.ok(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= 240);
    await page.screenshot({ path: resolve(artifacts, `${theme}-menu-320.png`) });
    report.screenshots.push(`${theme}-menu-320.png`);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1240, height: 720 });
    editor = await openEditor(page);
    assert.equal(
      await editor.evaluate((element) => getComputedStyle(element).color),
      theme === 'light' ? 'rgb(32, 33, 43)' : 'rgb(237, 237, 241)',
    );
    await editor.locator('header button').click();
    check(`menu_and_editor_theme:${theme}`);
  }
  assert.equal(await page.locator('select:not([data-user-authored])').count(), 0);
  check('all_builtin_selects_use_foundation:11_positions');
}
async function smallWindowEditor() {
  await page.setViewportSize({ width: 320, height: 240 });
  const editor = await openEditor(page);
  const target = editor.getByRole('combobox', {
    name: text('uiSuiteEditor.suite'),
    exact: true,
  });
  await target.click();
  const popup = page.getByRole('listbox');
  await popup.waitFor({ state: 'visible' });
  const bounds = await popup.boundingBox();
  report.minimumWindowPopup = { initial: bounds };
  if (bounds.y < 0 || bounds.y + bounds.height > 240) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    report.minimumWindowPopup.afterFrames = await popup.boundingBox();
  }
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 240);
  await page.screenshot({ path: resolve(artifacts, 'editor-320-expanded.png') });
  report.screenshots.push('editor-320-expanded.png');
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  const save = editor.getByRole('button', { name: text('uiSuiteEditor.save'), exact: true });
  await save.scrollIntoViewIfNeeded();
  const saveBounds = await save.boundingBox();
  assert.ok(
    saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 240,
    'editor Save remains reachable at the minimum window size',
  );
  const before = await page.evaluate(
    () =>
      window.foundationDesktop.calls.filter((call) => call.command === 'save_ui_suite_library')
        .length,
  );
  await save.click();
  await page.waitForFunction(
    (before) =>
      window.foundationDesktop.calls.filter((call) => call.command === 'save_ui_suite_library')
        .length > before,
    before,
  );
  await editor.locator('header button').click();
  await editor.waitFor({ state: 'hidden' });
  check('minimum_window_editor_select_bounds_scroll_and_save:320x240');
  await page.setViewportSize({ width: 1240, height: 720 });
}
async function scaledPortals() {
  await navigate('settings');
  await page.getByRole('tab', { name: text('settings.tabs.appearance'), exact: true }).click();
  const slider = page.getByRole('slider', { name: text('appearance.scale'), exact: true });
  await slider.focus(); await page.keyboard.press('End');
  await page.getByRole('button', { name: text('settings.save'), exact: true }).click();
  await page.waitForFunction(
    () => window.foundationDesktop.config.settings.appearance.ui_scale === 120,
  );
  const shellFont = await page
    .locator('.app-shell')
    .evaluate((element) => getComputedStyle(element).fontSize);
  await navigate('content');
  const documentTrigger = page.getByRole('combobox', {
    name: text('content.instance'),
    exact: true,
  });
  const documentFont = await documentTrigger.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );
  const nativeFont = await page
    .locator('.discover-page')
    .getByRole('textbox', { name: text('content.search'), exact: true })
    .evaluate((element) => getComputedStyle(element).fontSize);
  assert.equal(
    documentFont,
    nativeFont,
    'Document Select Trigger follows the same Field typography as the native Input',
  );
  await documentTrigger.click();
  const documentPopup = page.getByRole('listbox');
  await documentPopup.waitFor({ state: 'visible' });
  assert.equal(
    await documentPopup.evaluate((element) => getComputedStyle(element).fontSize),
    documentFont,
  );
  await page.keyboard.press('Escape');
  await documentPopup.waitFor({ state: 'hidden' });
  await navigate('home');
  await page.getByRole('button', { name: text('immersive.selectInstance'), exact: true }).click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  assert.equal(
    await menu.evaluate((element) => getComputedStyle(element).fontSize),
    shellFont,
    'Portal and Popup apply the 120% UI scale once',
  );
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  const editor = await openEditor(page);
  assert.equal(await editor.evaluate((element) => getComputedStyle(element).fontSize), shellFont);
  const target = editor.getByRole('combobox', {
    name: text('uiSuiteEditor.suite'),
    exact: true,
  });
  await target.click();
  const popup = page.getByRole('listbox');
  await popup.waitFor({ state: 'visible' });
  const shadowFont = await target.evaluate((element) => getComputedStyle(element).fontSize);
  assert.equal(
    shadowFont,
    documentFont,
    'ShadowRoot Trigger uses the same scaled Field typography',
  );
  assert.equal(await popup.evaluate((element) => getComputedStyle(element).fontSize), shadowFont);
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  await editor.locator('header button').click();
  await navigate('settings');
  await slider.fill('100');
  await page.getByRole('button', { name: text('settings.save'), exact: true }).click();
  await page.waitForFunction(
    () => window.foundationDesktop.config.settings.appearance.ui_scale === 100,
  );
  await navigate('home');
  report.scale = {
    percent: 120,
    shellFont,
    documentTrigger: documentFont,
    nativeInput: nativeFont,
    shadowTrigger: shadowFont,
  };
  check('portal_and_control_scale_applied_once:120_percent');
}
async function editorHeaderDrag() {
  await page.setViewportSize({ width: 1240, height: 720 });
  let editor = await openEditor(page);
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.dragCalls = [];
    window.restoreDragSpy = () => {
      window.__TAURI_INTERNALS__.invoke = original;
      window.isTauri = true;
    };
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (
        command === 'plugin:window|start_dragging' ||
        command === 'plugin:window|toggle_maximize'
      ) {
        window.dragCalls.push({ command, args });
        return;
      }
      return original(command, args);
    };
  });
  const calls = () => page.evaluate(() => window.dragCalls.splice(0));
  const blankPress = async (button = 'left') => {
    const bounds = await editor.locator('header').boundingBox();
    await page.mouse.click(bounds.x + 8, bounds.y + 8, { button });
  };
  try {
    // Browser mode must take the adapter's no-op branch even when metadata exists.
    await page.evaluate(() => {
      window.isTauri = false;
    });
    await blankPress();
    assert.deepEqual(await calls(), [], 'true browser mode never invokes native drag');
    check('drag_region_browser_noop');
    await page.evaluate(() => {
      window.isTauri = true;
    });
    await blankPress();
    assert.deepEqual(
      await calls(),
      [
        {
          command: 'plugin:window|start_dragging',
          args: { label: 'main' },
        },
      ],
      'editor_header_drag_excludes_controls: blank left press invokes native drag exactly once',
    );

    await blankPress('right');
    assert.deepEqual(await calls(), [], 'right button never starts a drag');
    await editor.locator('header button').click();
    await editor.waitFor({ state: 'hidden' });
    assert.deepEqual(await calls(), [], 'Close remains a close action');
    editor = await openEditor(page);
    const target = editor.getByRole('combobox', {
      name: text('uiSuiteEditor.suite'),
      exact: true,
    });
    await target.click();
    await page.getByRole('listbox').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.deepEqual(await calls(), [], 'Select remains outside the drag boundary');
    const input = editor.locator('input[type=checkbox]').first();
    const checked = await input.isChecked();
    await input.click();
    assert.equal(await input.isChecked(), !checked);
    assert.deepEqual(await calls(), [], 'inputs remain outside the drag boundary');
    await input.click();
    assert.equal(await input.isChecked(), checked);
    const source = editor.locator('textarea').first();
    const originalSource = await source.inputValue();
    await source.fill('Selectable source text');
    await source.focus();
    await page.keyboard.press('Control+A');
    assert.equal(await source.evaluate((el) => el.selectionEnd - el.selectionStart), 22);
    assert.deepEqual(await calls(), [], 'source text remains selectable');
    await blankPress();
    assert.deepEqual(await calls(), [], 'selected source text also suppresses a header drag');
    assert.equal(await source.evaluate((el) => el.selectionEnd - el.selectionStart), 22);
    await editor.locator('h1').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = element.getRootNode().getSelection?.() ?? document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const selected = await page.evaluate(() => document.getSelection().toString());
    assert.ok(selected.length > 0);
    await blankPress();
    assert.deepEqual(await calls(), [], 'selected ShadowRoot text suppresses native drag');
    assert.equal(await page.evaluate(() => document.getSelection().toString()), selected);
    await page.evaluate(() => document.getSelection().removeAllRanges());
    const heading = await editor.locator('h1').boundingBox();
    await page.mouse.move(heading.x + 2, heading.y + heading.height / 2);
    await page.mouse.down();
    await page.mouse.move(heading.x + 90, heading.y + heading.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.ok(
      (await page.evaluate(() => document.getSelection().toString())).length > 0,
      'fresh header text selection remains possible',
    );
    assert.deepEqual(await calls(), [], 'fresh text selection does not drag the window');
    await page.evaluate(() => document.getSelection().removeAllRanges());
    await source.fill(originalSource);
    check('editor_header_drag_excludes_controls');
    await editor.locator('header button').click();
    const bar = page.locator('.window-bar');
    await bar.click({ position: { x: 400, y: 12 } });
    assert.deepEqual(await calls(), [
      { command: 'plugin:window|start_dragging', args: { label: 'main' } },
    ]);
    await bar.dblclick({ position: { x: 400, y: 12 } });
    const double = await calls();
    assert.equal(
      double.filter((call) => call.command === 'plugin:window|toggle_maximize').length,
      1,
    );
    assert.equal(
      double.filter((call) => call.command === 'plugin:window|start_dragging').length,
      1,
    );
    assert.equal(await page.locator('[data-tauri-drag-region]').count(), 0);
    check('window_bar_shared_drag_and_guarded_doubleclick');

    await page.evaluate(async () => {
      if (!window.mountDragFixture) await import('/src/ui-foundation/browser-fixture.tsx');
      window.mountDragFixture();
    });
    const guarded = page.locator('#drag-fixture').getByLabel('Guarded drag region');
    await guarded.waitFor({ state: 'visible' });
    const blank = guarded.locator('[data-drag-blank]');
    await blank.click();
    assert.deepEqual(
      await calls(),
      [{ command: 'plugin:window|start_dragging', args: { label: 'main' } }],
      'interactive ancestors outside the shared boundary do not suppress drag',
    );
    for (const control of [
      guarded.locator('button svg'),
      guarded.getByRole('switch'),
      guarded.getByText('Label text'),
      guarded.getByLabel('Nested input'),
      guarded.getByLabel('Nested select'),
      guarded.getByLabel('Nested textarea'),
      guarded.getByRole('link'),
      guarded.locator('summary'),
      guarded.locator('[contenteditable]'),
      guarded.locator('[tabindex]'),
    ]) {
      await control.dispatchEvent('mousedown', { button: 0, bubbles: true, composed: true });
      assert.deepEqual(await calls(), [], 'nested controls and SVG origins never start a drag');
      await control.dispatchEvent('dblclick', { button: 0, bubbles: true, composed: true });
      assert.deepEqual(await calls(), [], 'nested controls never maximize the window');
    }
    for (const role of ['grid', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid']) {
      const composite = guarded.getByText('Interactive role', { exact: true });
      await composite.evaluate((element, role) => element.setAttribute('role', role), role);
      await composite.dispatchEvent('mousedown', { button: 0, bubbles: true, composed: true });
      assert.deepEqual(await calls(), [], `interactive composite role ${role} never starts a drag`);
    }
    await guarded.locator('[data-drag-child-cancel]').click();
    assert.deepEqual(await calls(), [], 'child defaultPrevented is retained');
    await page.evaluate(() => {
      window.dragFixture.preventMouseDown = true;
      window.dragFixture.preventDoubleClick = true;
      window.dragFixture.events = [];
    });
    await blank.dblclick();
    assert.deepEqual(await calls(), [], 'supplied handlers can cancel drag and maximize');
    assert.deepEqual(await page.evaluate(() => window.dragFixture.events), [
      'mousedown',
      'mousedown',
      'doubleclick',
    ]);
    await page.evaluate(() => {
      window.dragFixture.preventMouseDown = false;
      window.dragFixture.preventDoubleClick = false;
      window.dragFixture.events = [];
    });
    await blank.click({ button: 'middle' });
    assert.deepEqual(await calls(), [], 'middle button never starts a drag');
    // Chromium's middle-button autoscroll consumes the next left press. End that
    // independent browser gesture before testing a fresh blank double-click.
    await page.keyboard.press('Escape');
    await blank.dblclick();
    assert.deepEqual(await calls(), [
      { command: 'plugin:window|start_dragging', args: { label: 'main' } },
      { command: 'plugin:window|toggle_maximize', args: { label: 'main' } },
    ]);
    assert.deepEqual(await page.evaluate(() => window.dragFixture.events), [
      'mousedown',
      'mousedown',
      'mousedown',
      'doubleclick',
    ]);
    check('drag_region_shadow_path_boundary_nested_controls_and_caller_handlers');
  } finally {
    await page.evaluate(() => {
      document.getSelection().removeAllRanges();
      window.dragFixture?.unmount();
      window.restoreDragSpy();
    });
  }
}
try {
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation());
  if (await page.evaluate(() => window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired)) {
    const choice = page.locator('[data-style-choice]');
    await choice.getByRole('radio', { name: /Immersive|沉浸式/ }).click();
    await choice.getByRole('button', { name: /Use this interface|使用此界面/ }).click();
    await page.waitForFunction(() => !window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired);
  }
  await editorHeaderDrag();
  if (process.env.PARADOX_FOUNDATION_DRAG_ONLY === '1') {
    // Narrow RED/GREEN run; normal runs retain every existing foundation scenario.
  } else if (process.env.PARADOX_FOUNDATION_LAYOUT_ONLY === '1') {
    // Preserve the original registration/page population before its minimum-window check.
    await allBuiltinSelects();
    await scaledPortals();
    await smallWindowEditor();
  } else {
    await allBuiltinSelects();
    await scaledPortals();
    await smallWindowEditor();
    const editor = await openEditor(page);
    assert.equal(await editor.evaluate((el) => el.getRootNode() instanceof ShadowRoot), true);
    assert.equal(
      await page.locator('select:not([data-user-authored])').count(),
      0,
      'all_builtin_selects_use_foundation: editor and application expose controlled foundation Selects',
    );
    await editor.locator('header button').click();
    for (const viewport of [
      { width: 1240, height: 720 },
      { width: 320, height: 240 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) {
        for (const shadow of [false, true]) {
          await mountControls(theme, shadow);
          const host = page.locator('#foundation-fixture');
          assert.ok(
            (await host.locator('.fixture-panel').getAttribute('data-ui-scope'))?.includes(
              'control.panel',
            ),
          );
          const form = host.locator('#foundation-form');
          assert.equal(
            await form.locator('.field').evaluate((el) => getComputedStyle(el).display),
            'flex',
          );
          const trigger = host.getByRole('combobox', { name: 'Choice' });
          const hiddenInput = host.locator('input[name=choice]');
          if (viewport.width === 1240 && theme === 'light' && !shadow) {
            const nativeForm = host.locator('#foundation-native-form');
            const input = nativeForm.getByRole('textbox', { name: 'Native input', exact: true });
            const textarea = nativeForm.getByRole('textbox', {
              name: 'Native text area',
              exact: true,
            });
            const submit = nativeForm.getByRole('button', { name: 'Native submit', exact: true });
            const icon = nativeForm.getByRole('button', { name: 'Native icon', exact: true });
            for (const [element, key] of [
              [input, 'input'],
              [textarea, 'textarea'],
              [submit, 'button'],
              [icon, 'icon'],
            ]) {
              assert.equal(
                await element.evaluate(
                  (element, key) => window.foundationRefs[key] === element,
                  key,
                ),
                true,
              );
            }
            assert.equal(await nativeForm.evaluate((element) => element.checkValidity()), false);
            await input.fill('Native value');
            await textarea.fill('Native multiline\nvalue');
            await icon.click();
            assert.equal(await page.evaluate(() => window.foundationNativeSubmitted), undefined);
            await submit.click();
            assert.deepEqual(await page.evaluate(() => window.foundationNativeSubmitted), {
              'native-input': 'Native value',
              'native-textarea': 'Native multiline\nvalue',
            });
            assert.deepEqual(await page.evaluate(() => window.foundationEvents), [
              'input',
              'textarea',
              'icon',
              'button',
            ]);
            const checkbox = host.getByRole('checkbox', { name: 'Check choice', exact: true });
            const toggle = host.getByRole('switch', { name: 'Toggle choice', exact: true });
            await checkbox.check();
            assert.equal(await toggle.getAttribute('aria-checked'), 'true');
            await toggle.click();
            assert.equal(await checkbox.isChecked(), false);
            const slider = host.getByRole('slider', { name: 'Range choice', exact: true });
            await slider.focus();
            await page.keyboard.press('ArrowRight');
            assert.equal(await slider.inputValue(), '30');
            assert.equal(
              await host
                .getByRole('progressbar', { name: 'Progress choice' })
                .getAttribute('value'),
              '30',
            );
            check('native_control_props_refs_events_form_and_selection');
          }
          const labelId = await host.getByText('Choice', { exact: true }).getAttribute('id');
          const descriptionId = await host.getByText('Pick a permitted option').getAttribute('id');
          assert.equal(await trigger.getAttribute('aria-labelledby'), labelId);
          assert.equal(await trigger.getAttribute('aria-describedby'), descriptionId);
          assert.equal(await trigger.locator('.ui-select-value').innerText(), 'Empty');
          assert.equal(await hiddenInput.inputValue(), '');
          assert.equal(await form.evaluate((el) => el.checkValidity()), false);
          assert.equal(await trigger.evaluate((el) => window.foundationTrigger === el), true);
          await host.getByRole('button', { name: 'Submit', exact: true }).click();
          assert.equal(await page.evaluate(() => window.foundationSubmitted), undefined);
          assert.equal(await trigger.evaluate((el) => el.getRootNode().activeElement === el), true);
          await trigger.focus();
          await page.keyboard.press('ArrowDown');
          const popup = host.getByRole('listbox');
          await popup.waitFor({ state: 'visible' });
          assert.equal(
            await popup.evaluate((el) => el.getRootNode() instanceof ShadowRoot),
            shadow,
          );
          assert.equal(
            await host
              .getByRole('option', { name: 'Alpha disabled' })
              .getAttribute('aria-disabled'),
            'true',
          );
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          assert.equal(await hiddenInput.inputValue(), '');
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          assert.equal(await hiddenInput.inputValue(), 'b');
          assert.equal(await trigger.locator('.ui-select-value').innerText(), 'Beta');
          assert.equal(await form.evaluate((el) => el.checkValidity()), true);
          await host.getByRole('button', { name: 'Submit', exact: true }).click();
          assert.deepEqual(await page.evaluate(() => window.foundationSubmitted), { choice: 'b' });
          await trigger.click();
          await popup.waitFor({ state: 'visible' });
          const disabledOption = host.getByRole('option', { name: 'Alpha disabled' });
          // Hover waits for the aligned/scrolled option's real hit target to settle.
          // force is still needed to exercise a click on the aria-disabled option.
          await disabledOption.hover();
          await disabledOption.click({ force: true });
          assert.equal(
            await popup.isVisible(),
            true,
            'clicking a disabled option keeps the popup open',
          );
          assert.equal(await hiddenInput.inputValue(), 'b');
          assert.equal(
            await host
              .locator('.ui-select-positioner')
              .evaluate((el) => getComputedStyle(el).getPropertyValue('--accent')),
            '#5b8f14',
          );
          const bounds = await popup.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
          const screenshot = `${theme}-${shadow ? 'shadow' : 'document'}-${viewport.width}-expanded.png`;
          await page.screenshot({ path: resolve(artifacts, screenshot) });
          report.screenshots.push(screenshot);
          await page.keyboard.press('Escape');
          await popup.waitFor({ state: 'hidden' });
          assert.equal(await trigger.evaluate((el) => el.getRootNode().activeElement === el), true);
          await host.getByRole('button', { name: 'Set missing' }).click();
          assert.equal(await trigger.locator('.ui-select-value').innerText(), 'Choose');
          assert.equal(await hiddenInput.inputValue(), 'missing');
          await host.getByRole('button', { name: 'Toggle disabled' }).click();
          assert.equal(await trigger.isDisabled(), true);
          assert.deepEqual(await form.evaluate((el) => Object.fromEntries(new FormData(el))), {});
          report.checks.push(
            `select_empty_required_keyboard_and_shadow:${theme}:${shadow}:${viewport.width}x${viewport.height}`,
          );
          console.log(`PASS ${report.checks.at(-1)}`);
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
    assert.ok(report.contentSecurityPolicy);
    assert.equal(
      report.compiledHarness,
      true,
      'production CSP validation uses the compiled test harness',
    );
    assert.deepEqual(report.sourceModuleRequests, []);
  }
} catch (error) {
  report.failure = error.stack;
  report.popupAncestors = await page.locator('.ui-select-popup').evaluateAll((elements) =>
    elements.map((element) => {
      const ancestors = [];
      for (let node = element; node; node = node.parentElement)
        ancestors.push({
          tag: node.tagName,
          class: node.className,
          role: node.getAttribute('role'),
          hidden: node.getAttribute('aria-hidden'),
          inert: node.inert,
        });
      return ancestors;
    }),
  );
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  await writeFile(resolve(artifacts, 'failure-body.txt'), await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}


