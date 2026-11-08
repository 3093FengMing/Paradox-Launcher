import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, openEditor } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const artifacts = resolve(
  import.meta.dirname,
  '../../.test-data/task-13/foundation-review',
  process.env.PARADOX_FINAL_EVIDENCE || 'manual-run',
);
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({
  config: structuredClone(initialConfig),
  desktopBoundary: true,
});
const { page } = fixture;
const report = {
  target: process.env.PARADOX_UI_URL || 'http://127.0.0.1:1420',
  startedAt: new Date().toISOString(),
  browserVersion: fixture.browser.version(),
  contentSecurityPolicy: fixture.contentSecurityPolicy,
  compiledHarness: await page.evaluate(() => typeof window.mountFoundationFixture === 'function'),
  observedPageErrors: fixture.observedPageErrors,
  observedCspViolations: fixture.observedCspViolations,
  observedSourceModuleRequests: fixture.observedSourceModuleRequests,
  cases: [],
};
const messages = JSON.parse(
  await readFile(new URL('../src/locales/zh-CN.json', import.meta.url), 'utf8'),
);
const text = (key) => key.split('.').reduce((value, part) => value[part], messages);
async function settled() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}
async function mount(shadow, dialog = false) {
  await page.evaluate(
    async ({ shadow, dialog, compiled }) => {
      if (!window.mountFoundationFixture) {
        if (compiled) throw Error('Compiled Foundation fixture installer is missing');
        await import('/src/ui-foundation/browser-fixture.tsx');
      }
      window.mountFoundationFixture('dark', shadow, dialog);
    },
    { shadow, dialog, compiled: process.env.PARADOX_TEST_NATIVE_CSP === '1' },
  );
  await page
    .getByRole(dialog ? 'dialog' : 'combobox', { name: dialog ? 'Action Dialog' : 'Choice' })
    .waitFor({ state: 'visible' });
}
async function run(name, action) {
  if (process.env.PARADOX_REVIEW_CASE && !name.startsWith(process.env.PARADOX_REVIEW_CASE)) return;
  const result = { name };
  report.cases.push(result);
  try {
    await action(result);
    result.passed = true;
    console.log(`PASS ${name}`);
  } catch (error) {
    result.passed = false;
    result.failure = error.stack;
    result.screenshot = `failure-${name.replace(/[^a-z0-9]+/gi, '-')}.png`;
    await page.screenshot({ path: resolve(artifacts, result.screenshot) });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    await page.evaluate(() => {
      window.foundationFixture?.unmount();
      document.getElementById('foundation-fixture')?.remove();
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
  for (const shadow of [false, true]) {
    const root = shadow ? 'shadow' : 'document';
    await run(`I1:disabled_restoration_stays_closed:${root}`, async (result) => {
      await mount(shadow);
      const host = page.locator('#foundation-fixture');
      const trigger = host.getByRole('combobox', { name: 'Choice', exact: true });
      const popup = host.getByRole('listbox');
      await trigger.click();
      await popup.getByRole('option', { name: 'Beta', exact: true }).click();
      await popup.waitFor({ state: 'hidden' });
      await trigger.click();
      await popup.waitFor({ state: 'visible' });
      const toggle = host.getByRole('button', { name: 'Toggle disabled', exact: true });
      await toggle.evaluate((element) => element.click());
      await popup.waitFor({ state: 'hidden' });
      assert.equal(await trigger.isDisabled(), true);
      await toggle.evaluate((element) => element.click());
      await page.waitForFunction(() => !window.foundationTrigger.disabled);
      await settled();
      result.observed = {
        disabled: await trigger.isDisabled(),
        reopened: await popup.isVisible(),
        value: await host.locator('input[name=choice]').inputValue(),
        callbacks: await page.evaluate(() => window.foundationValueChanges),
      };
      assert.equal(result.observed.reopened, false, 'reenabling must await a new Trigger action');
      assert.equal(result.observed.value, 'b');
      assert.deepEqual(result.observed.callbacks, ['b'], 'availability changes preserve the value');
      await trigger.click();
      await popup.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'hidden' });
      assert.equal(
        await trigger.evaluate((element) => element.getRootNode().activeElement === element),
        true,
      );
    });
    await run(`I3:imperative_close_and_caller_guard_with_child:${root}`, async (result) => {
      await mount(shadow, true);
      const dialog = page.getByRole('dialog', { name: 'Action Dialog', exact: true });
      await dialog.getByRole('button', { name: 'Expose Dialog actions', exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Action choice', exact: true }).click();
      const popup = page.getByRole('listbox');
      await popup.waitFor({ state: 'visible' });
      await page.evaluate(() => window.foundationDialogActions.close());
      await settled();
      result.observed = {
        dialogVisible: await dialog.isVisible(),
        selectVisible: await popup.isVisible(),
        changes: await page.evaluate(() => window.foundationDialogChanges),
      };
      assert.deepEqual(
        result.observed.changes,
        [{ open: false, reason: 'imperative-action', canceled: false }],
        'standard Base UI actionsRef.close must reach the caller',
      );
      await dialog.waitFor({ state: 'hidden' });
      await popup.waitFor({ state: 'hidden' });

      await mount(shadow, true);
      await dialog.getByRole('button', { name: 'Expose Dialog actions', exact: true }).click();
      const trigger = dialog.getByRole('combobox', { name: 'Action choice', exact: true });
      await trigger.click();
      await popup.waitFor({ state: 'visible' });
      await page.evaluate(() => {
        window.foundationDialogGuard = true;
        window.foundationDialogActions.close();
      });
      await settled();
      assert.equal(await dialog.isVisible(), true, 'caller cancellation retains its Dialog');
      assert.equal(await popup.isVisible(), true, 'caller cancellation retains the child');
      assert.deepEqual(await page.evaluate(() => window.foundationDialogChanges), [
        { open: false, reason: 'imperative-action', canceled: true },
      ]);
      await page.evaluate(() => {
        window.foundationDialogGuard = false;
      });
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'hidden' });
      assert.equal(await dialog.isVisible(), true, 'the child owns one native Escape');
      assert.equal(
        await trigger.evaluate((element) => element.getRootNode().activeElement === element),
        true,
      );
      assert.equal(await page.evaluate(() => window.foundationDialogChanges.length), 1);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.foundationDialogChanges), [
        { open: false, reason: 'imperative-action', canceled: true },
        { open: false, reason: 'escape-key', canceled: false },
      ]);

      await mount(shadow, true);
      await dialog.getByRole('combobox', { name: 'Action choice', exact: true }).click();
      await popup.waitFor({ state: 'visible' });
      await dialog
        .getByRole('button', { name: 'Close action Dialog', exact: true })
        .evaluate((element) => element.click());
      await dialog.waitFor({ state: 'hidden' });
      await popup.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.foundationDialogChanges), [
        { open: false, reason: 'close-press', canceled: false },
      ]);
    });
  }
  await run('I2:keyboard_picking_cancel_preserves_editor_focus_and_drafts', async (result) => {
    await page
      .locator('.sidebar')
      .getByRole('button', { name: text('nav.instances') })
      .click();
    await page
      .locator('.instances-page')
      .getByRole('button', { name: text('app.createInstance'), exact: true })
      .click();
    await page.waitForFunction(() => window.suiteFinalFixture.snapshot.navigation.routeId === 'custom.versions');
    const version = page.locator('.versions-page article').filter({ hasText: '1.21.1' });
    await version.getByRole('button', { name: text('common.createInstance'), exact: true }).click();
    const profile = page.getByRole('dialog', { name: text('profileDialog.createTitle'), exact: true, includeHidden: true });
    const name = profile.getByRole('textbox', { name: text('instances.name'), exact: true, includeHidden: true });
    await name.fill('Review retained draft');
    await name.focus();
    const editor = await openEditor(page);
    const source = editor.locator('textarea.ui-code');
    await source.fill('.app-shell { --accent: #ab1234; }');
    await editor.getByRole('button', { name: text('uiSuiteEditor.pick'), exact: true }).click();
    await page.locator('.ui-pick-hint').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('.ui-pick-hint').waitFor({ state: 'hidden' });
    await settled();
    result.observed = {
      editorVisible: await editor.isVisible(),
      profileVisible: await profile.isVisible(),
      profileDraft: await name.inputValue(),
    };
    assert.equal(
      result.observed.editorVisible,
      true,
      'one Escape cancels picking and restores the editor',
    );
    assert.equal(result.observed.profileVisible, true);
    assert.equal(result.observed.profileDraft, 'Review retained draft');
    assert.equal(await source.inputValue(), '.app-shell { --accent: #ab1234; }');
    for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      const focus = await editor.evaluate((element) => {
        const active = element.getRootNode().activeElement;
        return {
          inside: element.contains(active),
          tag: active?.tagName,
          id: active?.id,
          className: active?.className,
          focusGuard: active?.hasAttribute('data-base-ui-focus-guard'),
        };
      });
      (result.focusTransitions ??= []).push({ key, ...focus });
      if (!focus.inside) {
        // Base UI redirects its focus guard asynchronously when wrapping Tab.
        // A persistent focus escape still fails this bounded behavior check.
        await page.waitForFunction(
          (element) => element.contains(element.getRootNode().activeElement),
          await editor.elementHandle(),
          { timeout: 1000 },
        );
        result.focusAfterWait = await editor.evaluate((element) => {
          const active = element.getRootNode().activeElement;
          return {
            inside: element.contains(active),
            tag: active?.tagName,
            id: active?.id,
            className: active?.className,
          };
        });
      }
      assert.equal(
        await editor.evaluate((element) => element.contains(element.getRootNode().activeElement)),
        true,
        'Base UI traps focus in the restored editor',
      );
    }
    const target = editor.getByRole('combobox', {
      name: text('uiSuiteEditor.suite'),
      exact: true,
    });
    await target.click();
    const popup = page.getByRole('listbox');
    await popup.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    assert.equal(await editor.isVisible(), true, 'the next child Escape retains its editor');
    await page.waitForFunction((element) => element.getRootNode().activeElement === element, await target.elementHandle(), { timeout: 1000 });
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
    assert.equal(await name.inputValue(), 'Review retained draft');
    assert.equal(
      await name.evaluate((element) => element.getRootNode().activeElement === element),
      true,
      'a later Escape closes only the editor and restores Profile focus',
    );
    await profile.getByRole('button', { name: text('common.cancel'), exact: true }).click();
  });
  assert.deepEqual(report.observedPageErrors, []);
  assert.deepEqual(report.observedCspViolations, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
    assert.ok(report.contentSecurityPolicy);
    assert.equal(report.compiledHarness, true);
    assert.deepEqual(report.observedSourceModuleRequests, []);
  }
  assert.equal(
    report.cases.filter((result) => !result.passed).length,
    0,
    'all focused review cases pass',
  );
} finally {
  const label = process.env.PARADOX_REVIEW_REPORT || 'report';
  await writeFile(resolve(artifacts, `${label}.json`), JSON.stringify(report, null, 2));
  await fixture.close();
}
