import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(
  import.meta.dirname,
  '../../.test-data/launcher-appearance-drafts-browser/task-4-fix-1',
);
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const report = {
  checks: [],
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  if (!process.env.PARADOX_TEST_NATIVE_CSP)
    await page.evaluate(async () => {
      if (!window.mountLauncherFixture) {
        const entry = document.querySelector('script[type="module"][src*="/src/main.tsx"]');
        const { root } = await import(entry.src);
        const { installLauncherFixture } = await import('/src/ui-tests/launcher-view-fixture.tsx');
        installLauncherFixture(root);
      }
    });
  await page.waitForFunction(() => typeof window.mountLauncherAppFixture === 'function');
  await page.evaluate(() => window.mountLauncherAppFixture());
  await page.waitForFunction(() => window.launcherFixture.views.a?.snapshot.config.ready);
  await page.evaluate(() => {
    const a = window.launcherFixture.views.a.actions;
    window.appearanceTask4 = { actions: a, held: [], hold: false };
    a.navigation.navigate('settings');
    a.settings.setTab('advanced');
    a.argumentTemplates.openNew();
  });
  const name = page.getByRole('textbox', { name: '模板名称（1–48 个字符）', exact: true });
  await name.fill('Unfinished shared template');
  await page.evaluate(() => {
    const a = window.appearanceTask4.actions;
    a.argumentTemplates.setEnvironment([{ key: '', value: ' raw=\nsecond line ' }]);
    a.argumentTemplates.apply();
  });
  await page.waitForFunction(
    () => window.launcherFixture.views.b.snapshot.drafts.argumentTemplateError,
  );
  assert.equal(await name.inputValue(), 'Unfinished shared template');
  await page.evaluate(() => window.appearanceTask4.actions.settings.setTab('appearance'));
  await page.evaluate(() => {
    const a = window.appearanceTask4.actions;
    a.presets.openDialog({ kind: 'import' });
  });
  const json = page.getByRole('textbox', { name: '预设 JSON', exact: true });
  await json.fill('{invalid shared JSON');
  await page.evaluate(async () => {
    try {
      await window.appearanceTask4.actions.presets.import('{invalid shared JSON');
    } catch {
      /* expected */
    }
  });
  await page.waitForFunction(() => window.launcherFixture.views.b.snapshot.drafts.preset?.error);
  assert.equal(await json.inputValue(), '{invalid shared JSON');
  const before = await page.evaluate(() => ({
    drafts: window.launcherFixture.views.a.snapshot.drafts,
    other: window.launcherFixture.views.b.snapshot.drafts,
    calls: window.foundationDesktop.calls.filter((x) =>
      ['get_config', 'plugin:event|listen', 'save_config'].includes(x.command),
    ).length,
  }));
  assert.deepEqual(before.drafts, before.other);
  await page.evaluate(() => window.launcherFixture.replaceAppearance());
  await page.locator('[data-appearance-replacement="presets"]').waitFor();
  assert.equal(
    await page.getByLabel('Replacement preset JSON').inputValue(),
    '{invalid shared JSON',
  );
  assert.equal(
    await page.locator('[data-appearance-replacement="presets"] [role="status"]').textContent(),
    'presets.errors.invalidJson',
  );
  assert.equal(
    await page.evaluate(
      () => window.appearanceTask4.actions === window.launcherFixture.views.b.actions,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.foundationDesktop.calls.filter((x) =>
          ['get_config', 'plugin:event|listen', 'save_config'].includes(x.command),
        ).length,
    ),
    before.calls,
  );
  pass('invalid_preset_input_error_and_actions_survive_real_component_replacement');
  await page.evaluate(() => window.appearanceTask4.actions.settings.setTab('advanced'));
  await page.locator('[data-appearance-replacement="templates"]').waitFor();
  assert.equal(
    await page.getByLabel('Replacement template name').inputValue(),
    'Unfinished shared template',
  );
  assert.equal(
    await page.getByLabel('Replacement raw environment').inputValue(),
    ' raw=\nsecond line ',
  );
  assert.equal(
    await page.locator('[data-appearance-replacement="templates"] [role="status"]').textContent(),
    '环境变量无效，或包含不允许覆盖的 Java 选项。',
  );
  pass('unfinished_template_and_literal_rows_error_survive_tab_unmount_and_replacement');
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    native.invoke = async (command, args = {}) => {
      if (command === 'save_config' && window.appearanceTask4.hold) {
        window.appearanceTask4.hold = false;
        return new Promise((resolve, reject) =>
          window.appearanceTask4.held.push({
            config: structuredClone(args.config),
            resolve: () => invoke(command, args).then(resolve, reject),
          }),
        );
      }
      return invoke(command, args);
    };
    const a = window.appearanceTask4.actions;
    a.settings.patch('extra_game_arguments', '--unfinished-library-write');
    a.settings.setTab('appearance');
  });
  const imported = await page.evaluate(() =>
    JSON.stringify({
      kind: 'paradox-appearance-preset',
      schema_version: 1,
      name: 'Corrected import',
      appearance: window.launcherFixture.views.a.snapshot.settings.draft.appearance,
    }),
  );
  await page.getByLabel('Replacement preset JSON').fill(imported);
  await page.evaluate(() => {
    window.appearanceTask4.hold = true;
  });
  await page.getByRole('button', { name: 'Import replacement preset' }).click();
  await page.waitForFunction(
    () =>
      window.appearanceTask4.held.length === 1 &&
      window.launcherFixture.views.b.snapshot.drafts.preset.pending,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Import replacement preset' }).isDisabled(),
    true,
  );
  await page.evaluate(() => window.launcherFixture.restore());
  const pendingBuiltin = page.getByRole('textbox', { name: '预设 JSON', exact: true });
  await pendingBuiltin.waitFor();
  assert.equal(await pendingBuiltin.inputValue(), imported);
  assert.equal(await pendingBuiltin.isDisabled(), true);
  await page.evaluate(() => window.launcherFixture.replaceAppearance());
  await page.locator('[data-appearance-replacement="presets"]').waitFor();
  assert.equal(await page.getByLabel('Replacement preset JSON').inputValue(), imported);
  assert.equal(await page.getByLabel('Replacement preset JSON').isDisabled(), true);
  await page.evaluate(() => {
    const a = window.appearanceTask4.actions;
    a.presets.cancelDialog();
    a.presets.patchDraft({ json: 'pending patch must be ignored' });
    a.settings.patchPersonalization('font', 'serif');
    window.appearanceTask4.held[0].resolve();
  });
  await page.waitForFunction(() => window.launcherFixture.views.b.snapshot.drafts.preset === null);
  const corrected = await page.evaluate(() => ({
    snapshot: window.launcherFixture.views.b.snapshot,
    submission: window.appearanceTask4.held[0].config,
    committed: window.foundationDesktop.config,
  }));
  assert.equal(
    corrected.snapshot.settings.draft.extra_game_arguments,
    '--unfinished-library-write',
  );
  assert.equal(corrected.snapshot.settings.draft.personalization.font, 'serif');
  assert.equal(corrected.committed.settings.extra_game_arguments, '');
  assert.equal(corrected.committed.settings.personalization.font, 'system');
  assert.equal(corrected.committed.appearance_presets[0].name, 'Corrected import');
  pass('corrected_import_pending_is_shared_and_only_library_write_preserves_unfinished_settings');
  await page.evaluate(() => {
    const a = window.appearanceTask4.actions;
    a.settings.reset();
    a.argumentTemplates.openNew();
    a.argumentTemplates.patch({ name: 'First sequential' });
    a.argumentTemplates.apply();
    a.settings.patchAppearance('accent_color', '#123456');
    a.argumentTemplates.openNew();
    a.argumentTemplates.patch({ name: 'Second sequential' });
    a.argumentTemplates.apply();
    window.appearanceTask4.currentSave = a.presets.save('Same turn current');
    a.settings.patchAppearance('accent_color', '#abcdef');
  });
  await page.evaluate(() => window.appearanceTask4.currentSave);
  await page.waitForFunction(
    () => window.launcherFixture.views.a.snapshot.config.value.appearance_presets.length === 2,
  );
  const sequential = await page.evaluate(() => window.launcherFixture.views.b.snapshot);
  assert.deepEqual(
    sequential.settings.draft.argument_templates.map((x) => x.name),
    ['First sequential', 'Second sequential'],
  );
  assert.equal(sequential.config.value.appearance_presets[1].appearance.accent_color, '#123456');
  assert.equal(sequential.settings.draft.appearance.accent_color, '#abcdef');
  assert.equal(sequential.config.value.settings.argument_templates.length, 0);
  pass('same_turn_templates_and_field_to_preset_save_use_current_single_owner');
  for (const size of [
    { width: 320, height: 240 },
    { width: 1240, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => {
      const a = window.appearanceTask4.actions;
      a.settings.reset();
      a.argumentTemplates.openNew();
      a.argumentTemplates.patch({ name: 'Reset without changes' });
      a.settings.reset();
    });
    await page.waitForFunction(
      () => window.launcherFixture.views.a.snapshot.drafts.argumentTemplate === null,
    );
    await page.screenshot({
      path: resolve(
        artifacts,
        `${process.env.PARADOX_TEST_NATIVE_CSP ? 'production' : 'dev'}-${size.width}.png`,
      ),
    });
  }
  pass('unchanged_settings_reset_cancels_editor_in_small_and_regular_browser_windows');
  // D17: a no-dialog clipboard operation reserves only preset actions. These
  // checks invoke actual enabled template controls, and inspect the disabled
  // default/replacement toolbar and an unmatched existing dialog.
  report.reachability = [];
  const reachable = async (control, label) => {
    // Remove earlier transient fixture success notices through the public API
    // so they do not obscure this focused small-window control geometry check.
    await page.evaluate(() => {
      const current = window.launcherFixture.views.a;
      for (const notice of current.snapshot.notifications.items)
        current.actions.notifications.dismiss(notice.id);
    });
    await control.waitFor({ state: 'visible' });
    await control.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
    );
    const geometry = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2,
        y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        width: innerWidth,
        height: innerHeight,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        centerInside: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
        hit: hit === element || element.contains(hit),
      };
    });
    assert.ok(
      geometry.centerInside && geometry.hit,
      `${label} must be visible and reachable: ${JSON.stringify(geometry)}`,
    );
    report.reachability.push({ label, ...geometry });
  };
  await page.evaluate(() => {
    window.appearanceTask4.clipboard = { held: [], operations: [] };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text) {
          return new Promise((resolve, reject) =>
            window.appearanceTask4.clipboard.held.push({ text, resolve, reject }),
          );
        },
      },
    });
  });
  await page.evaluate(() => window.launcherFixture.restore());
  const beginCopy = async () => {
    await page.evaluate(() => {
      const a = window.appearanceTask4.actions;
      const id = window.launcherFixture.views.a.snapshot.config.value.appearance_presets[0].id;
      window.appearanceTask4.clipboard.operations.push(
        a.presets.copyExport(id).catch((error) => error.message),
      );
    });
    await page.waitForFunction(() => window.launcherFixture.views.b.snapshot.drafts.presetPending);
  };
  const finishCopy = async (outcome) => {
    await page.evaluate(async (outcome) => {
      const state = window.appearanceTask4.clipboard;
      if (outcome === 'failure') state.held.at(-1).reject(new Error('Controlled clipboard denial'));
      else state.held.at(-1).resolve();
      await state.operations.at(-1);
    }, outcome);
    await page.waitForFunction(() => !window.launcherFixture.views.b.snapshot.drafts.presetPending);
  };
  for (const size of [
    { width: 1240, height: 720 },
    { width: 320, height: 240 },
  ]) {
    await page.setViewportSize(size);
    for (const outcome of ['success', 'failure']) {
      await page.evaluate(() => {
        const a = window.appearanceTask4.actions;
        a.presets.cancelDialog();
        a.settings.reset();
        a.settings.setTab('advanced');
        a.argumentTemplates.openNew();
        a.argumentTemplates.patch({ name: 'Before direct clipboard' });
      });
      const writesBefore = await page.evaluate(
        () => window.foundationDesktop.calls.filter((x) => x.command === 'save_config').length,
      );
      await beginCopy();
      const projection = await page.evaluate(() => {
        const s = window.launcherFixture.views.a.snapshot;
        let readonly = false;
        try {
          Object.defineProperty(s.drafts, 'presetPending', { value: false });
        } catch {
          readonly = true;
        }
        return {
          pending: s.drafts.presetPending,
          preset: s.drafts.preset,
          saving: s.settings.saving,
          readonly,
        };
      });
      assert.deepEqual(projection, { pending: true, preset: null, saving: false, readonly: true });
      const input = page.getByRole('textbox', { name: '模板名称（1–48 个字符）', exact: true });
      const apply = page.getByRole('button', { name: '应用到设置草稿', exact: true });
      assert.equal(await input.isDisabled(), false);
      assert.equal(await apply.isDisabled(), false);
      await reachable(input, `template-name-${size.width}-${outcome}`);
      const nextName = `Typed ${size.width} ${outcome}`;
      await input.fill(nextName);
      await reachable(apply, `template-apply-${size.width}-${outcome}`);
      await apply.click();
      await page.waitForFunction(
        (name) =>
          window.launcherFixture.views.b.snapshot.settings.draft.argument_templates[0]?.name ===
          name,
        nextName,
      );
      await page.evaluate(() => window.appearanceTask4.actions.settings.setTab('appearance'));
      const importButton = page
        .locator('.appearance-presets')
        .getByRole('button', { name: '导入预设', exact: true });
      const saveButton = page.getByRole('button', { name: '保存当前外观', exact: true });
      assert.equal(await importButton.isDisabled(), true);
      assert.equal(await saveButton.isDisabled(), true);
      await reachable(importButton, `preset-import-pending-${size.width}-${outcome}`);
      await reachable(saveButton, `preset-save-pending-${size.width}-${outcome}`);
      assert.equal(await page.locator('.appearance-presets button:enabled').count(), 0);
      await page.evaluate(() => window.launcherFixture.replaceAppearance());
      const replacement = page.getByRole('button', {
        name: 'Import replacement preset',
        exact: true,
      });
      await replacement.waitFor();
      assert.equal(await replacement.isDisabled(), true);
      assert.equal(
        await page.evaluate(() => window.launcherFixture.views.b.snapshot.drafts.presetPending),
        true,
      );
      await page.evaluate(() => window.launcherFixture.restore());
      await importButton.waitFor();
      assert.equal(await importButton.isDisabled(), true);
      await finishCopy(outcome);
      assert.equal(await importButton.isDisabled(), false);
      assert.equal(await saveButton.isDisabled(), false);
      await importButton.click();
      const dialog = page.getByRole('dialog', { name: '导入界面预设', exact: true });
      await dialog.waitFor();
      const dialogInput = dialog.getByRole('textbox', { name: '预设 JSON', exact: true });
      await dialogInput.fill('{unfinished dialog');
      // An unrelated direct copy must also disable dialog cancel/escape/input.
      await beginCopy();
      assert.equal(
        await page.evaluate(() => window.launcherFixture.views.a.snapshot.drafts.preset.pending),
        false,
      );
      const cancel = dialog.getByRole('button', { name: '取消', exact: true });
      assert.equal(await dialogInput.isDisabled(), true);
      assert.equal(await cancel.isDisabled(), true);
      await reachable(dialogInput, `preset-dialog-input-${size.width}-${outcome}`);
      await reachable(cancel, `preset-dialog-cancel-${size.width}-${outcome}`);
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 1);
      await finishCopy(outcome);
      assert.equal(await dialogInput.inputValue(), '{unfinished dialog');
      assert.equal(await cancel.isDisabled(), false);
      await cancel.click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(
        await page.evaluate(
          () => window.appearanceTask4.actions === window.launcherFixture.views.b.actions,
        ),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => window.foundationDesktop.calls.filter((x) => x.command === 'save_config').length,
        ),
        writesBefore,
      );
      await page.screenshot({
        path: resolve(
          artifacts,
          `${process.env.PARADOX_TEST_NATIVE_CSP ? 'production' : 'dev'}-direct-copy-${size.width}-${outcome}.png`,
        ),
      });
    }
    pass(`direct_clipboard_templates_toolbar_dialog_replacement_and_reachability_${size.width}`);
  }
  report.snapshots = { before, corrected, sequential };
  assert.deepEqual(report.errors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP) {
    assert.ok(report.csp);
    assert.deepEqual(report.sourceRequests, []);
  }
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(
    resolve(
      artifacts,
      process.env.PARADOX_TEST_NATIVE_CSP ? 'report-production-csp.json' : 'report-dev.json',
    ),
    JSON.stringify(report, null, 2),
  );
  await fixture.close();
}
