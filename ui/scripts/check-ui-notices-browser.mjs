import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture, openEditor } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/task-13/notices', process.env.PARADOX_FINAL_EVIDENCE || 'manual-run');
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const report = {
  target: process.env.PARADOX_UI_URL,
  checks: [],
  errors: fixture.observedPageErrors,
  sourceModuleRequests: fixture.observedSourceModuleRequests,
  contentSecurityPolicy: fixture.contentSecurityPolicy,
};
const settle = () =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const advance = async (ms) => {
  await page.evaluate((ms) => window.noticeFixture.advance(ms), ms);
  await settle();
};
const publish = async (kind, message) => {
  await page.evaluate(({ kind, message }) => window.noticeFixture.store.publish(kind, message), {
    kind,
    message,
  });
  await settle();
};
const check = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  if (!process.env.PARADOX_NOTICE_FIX_ONLY) {
    await page.evaluate(async () => {
      if (!window.mountFoundationFixture) await import('/src/ui-foundation/browser-fixture.tsx');
      window.mountNoticeFixture();
    });
    await settle();
    const host = page.locator('#notice-fixture');
    for (const kind of ['info', 'warning', 'success', 'error']) {
      await publish(kind, `notice-${kind}`);
      const role = host.getByRole(kind === 'error' ? 'alert' : 'status');
      assert.equal(await role.count(), 1);
      await advance((kind === 'error' ? 5000 : 3000) - 1);
      assert.equal(await role.count(), 1);
      await advance(1);
      assert.equal(await role.count(), 0);
    }
    check('actual status/alert expiry at 3000/5000ms');
    await publish('info', 'pointer-and-focus');
    const notice = host.getByRole('status');
    await advance(1000);
    await notice.hover();
    await notice.getByRole('button').focus();
    await advance(60000);
    await page.mouse.move(0, 0);
    await advance(60000);
    assert.equal(await notice.count(), 1);
    await host.getByRole('button', { name: 'Outside notice' }).focus();
    await advance(1999);
    assert.equal(await notice.count(), 1);
    await advance(1);
    assert.equal(await notice.count(), 0);
    check('hover plus keyboard focus resumes only the remaining duration');
    await publish('info', 'older');
    await advance(2000);
    await publish('error', 'newer');
    await advance(1000);
    assert.equal(await host.getByRole('status').count(), 0);
    assert.equal(await host.getByRole('alert').count(), 1);
    await advance(4000);
    assert.equal(await host.getByRole('alert').count(), 0);
    check('older expiry does not dismiss newer message');
    await publish('warning', 'closed viewport');
    await advance(1000);
    await host.getByRole('status').hover();
    await page.evaluate(() => window.noticeFixture.views(0));
    await settle();
    await advance(2000);
    await page.evaluate(() => window.noticeFixture.views(1));
    await settle();
    assert.equal(await host.getByRole('status').count(), 0);
    check('closing and reopening a hovered viewport does not revive expired notice');
    await page.mouse.move(0, 0);
    await publish('info', 'shared views');
    await advance(1000);
    await page.evaluate(() => window.noticeFixture.views(2));
    await settle();
    const views = host.locator('[data-notice-view]');
    await views.nth(0).getByRole('status').hover();
    await views.nth(1).getByRole('status').getByRole('button').focus();
    await page.evaluate(() => window.noticeFixture.views(1, true));
    await settle();
    await advance(60000);
    assert.equal(await host.getByRole('status').count(), 1);
    await host.getByRole('button', { name: 'Outside notice' }).focus();
    await page.mouse.move(0, 0);
    await advance(2000);
    assert.equal(await host.getByRole('status').count(), 0);
    check('a removed view releases only its own pause ownership');
    await page.evaluate(() => {
      window.noticeFixture.unmount();
    });
    await openEditor(page);
    await page.clock.install();
    const editor = page.getByRole('dialog', { name: 'UI 套件编辑器', exact: true });
    await editor
      .getByRole('textbox', { name: '新文件路径', exact: true })
      .fill('../invalid.tsx');
    await editor.getByRole('button', { name: '创建文件', exact: true }).click();
    const alert = page.locator('#paradox-suite-editor').getByRole('alert');
    await alert.waitFor();
    await page.mouse.move(0, 0);
    await page.clock.runFor(5000);
    assert.equal(await alert.count(), 0);
    await editor.getByRole('button', { name: /查看诊断/ }).click();
    assert.equal(await editor.locator('.ui-diagnostics li').count(), 1);
    await editor.getByRole('button', { name: '预览套件', exact: true }).click();
    await page.locator('#paradox-suite-editor').getByRole('status').waitFor();
    await page.clock.runFor(100);
    assert.equal(await editor.locator('.ui-diagnostics li').count(), 1);
    if ((await editor.getByRole('button', { name: /查看诊断/ }).getAttribute('aria-expanded')) !== 'true') await editor.getByRole('button', { name: /查看诊断/ }).click();
    await editor.getByRole('button', { name: '清除诊断', exact: true }).click();
    assert.equal(await editor.locator('.ui-diagnostics li').count(), 0);
    check('editor transient validation expires independently from explicit diagnostic history');
    await page.clock.runFor(3000);
    assert.equal(await page.locator('#paradox-suite-editor').getByRole('status').count(), 0);
    assert.match(await editor.locator('footer > span').innerText(), /正在预览/);
    check('editor success expiry retains persistent preview state');
    await editor.locator('input[type=file][accept=".paradox-ui"]').setInputFiles({
      name: 'invalid.paradox-ui',
      mimeType: 'application/json',
      buffer: Buffer.from('{invalid'),
    });
    await alert.waitFor();
    await alert.getByRole('button').focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(60000);
    assert.equal(await alert.count(), 1);
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'hidden' });
    await page.clock.runFor(5000);
    await openEditor(page);
    assert.equal(await alert.count(), 0);
    assert.equal(await editor.locator('.ui-diagnostics li').count(), 1);
    check('actual ShadowRoot editor closure releases keyboard pause without reviving its notice');
    const validArchive = await page.evaluate(() => window.suiteFinalFixture.validArchive());
    await editor.locator('input[type=file][accept=".paradox-ui"]').setInputFiles({name:'Imported.paradox-ui',mimeType:'application/octet-stream',buffer:Buffer.from(validArchive)});
    const status = page.locator('#paradox-suite-editor').getByRole('status');
    await status.waitFor();
    await page.clock.runFor(3000);
    assert.equal(await status.count(), 0);
    assert.equal(await editor.locator('.ui-diagnostics li').count(), 1);
    check(
      'file import error and valid suite ZIP import success use expiring notices and preserve diagnostics',
    );
  }
  report.layoutCases = [];
  async function layoutCase(name, action) {
    const result = { name };
    report.layoutCases.push(result);
    try {
      await action(result);
      result.passed = true;
      check(name);
    } catch (error) {
      result.passed = false;
      result.failure = error.stack;
      result.screenshot = `${(process.env.PARADOX_NOTICE_REPORT || 'report').replace(/\.json$/, '')}-${name.replace(/[^a-z0-9]+/gi, '-')}-failure.png`;
      await page.screenshot({ path: resolve(artifacts, result.screenshot) });
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  await page.setViewportSize({ width: 320, height: 240 });
  for (const portal of [false, true]) {
    await layoutCase(
      `default fixed long notice stack reachable at320x240:${portal ? 'independent ShadowRoot portal' : 'document'}`,
      async (result) => {
        await page.evaluate(async (portal) => {
          if (!window.mountFoundationFixture)
            await import('/src/ui-foundation/browser-fixture.tsx');
          window.mountNoticeFixture({ fixed: true, portal });
          for (let i = 0; i < 4; i++) {
            const id = window.noticeFixture.store.publish(
              'error',
              `Long retained notice ${i}\n` +
                'Long diagnostic text that wraps across the narrow viewport.\n'.repeat(40),
            );
            window.noticeFixture.store.pause(id, 'focus');
          }
        }, portal);
        await settle();
        const host = page.locator('#notice-fixture');
        const viewport = host.locator('.ui-notice-viewport');
        result.portal = await viewport.evaluate((element) => ({
          shadow: element.getRootNode() instanceof ShadowRoot,
          position: getComputedStyle(element).position,
          styles: element.getRootNode().querySelectorAll('style').length,
        }));
        assert.equal(result.portal.shadow, portal);
        assert.equal(result.portal.position, 'fixed');
        if (portal)
          assert.equal(
            result.portal.styles,
            1,
            'NoticeViewport supplies styles to the independently supplied ShadowRoot',
          );
        result.viewport = await viewport.evaluate((element) => {
          const r = element.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          };
        });
        assert.ok(
          result.viewport.y >= 0 && result.viewport.y + result.viewport.height <= 240,
          'default fixed stack stays inside the minimum window',
        );
        assert.ok(
          result.viewport.scrollHeight > result.viewport.clientHeight,
          'the retained notice stack has its own bounded scroll region',
        );
        await advance(60000);
        assert.equal(await host.getByRole('alert').count(), 4);
        result.closeBounds = [];
        const notices = host.getByRole('alert');
        for (let i = 0; i < 4; i++) {
          const notice = notices.nth(i);
          const close = notice.getByRole('button');
          await close.scrollIntoViewIfNeeded();
          await close.focus();
          const bounds = await close.boundingBox();
          result.closeBounds.push(bounds);
          assert.ok(
            bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= 320 &&
              bounds.y + bounds.height <= 240,
            `close ${i} can be reached without dismissing earlier notices`,
          );
        }
        const first = notices.first();
        await first.getByRole('button').scrollIntoViewIfNeeded();
        const message = first.locator('span');
        await message.hover();
        await page.mouse.wheel(0, 500);
        await settle();
        await page.waitForFunction(
          (element) => element.scrollTop > 0,
          await message.elementHandle(),
          { timeout: 1000 },
        );
        result.messageScroll = await message.evaluate((element) => ({
          top: element.scrollTop,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }));
        await host.getByRole('button', { name: 'Outside notice', exact: true }).click();
        assert.equal(
          await page.evaluate(() => window.noticeFixture.actions),
          1,
          'UI actions remain clickable while the stack is retained',
        );
        for (let i = 0; i < 4; i++)
          await host.getByRole('alert').first().getByRole('button').click();
        assert.equal(await host.getByRole('alert').count(), 0);
      },
    );
    await page.evaluate(() => window.noticeFixture?.unmount());
  }
  if (process.env.PARADOX_NOTICE_FIX_ONLY) await page.clock.install();
  for (const populated of [false, true]) {
    await layoutCase(
      `expanded diagnostics preserve source and footer at320x240:${populated ? 'populated' : 'empty'}`,
      async (result) => {
        const editor = await openEditor(page);
        await page.evaluate(() => {
          const controller = window.suiteFinalFixture.controller;
          const path = 'NoticeLayout.css';
          const draft = controller.getSnapshot().draft;
          if (!draft.files[path]) controller.actions.createFile(path, 'css');
          if (!draft.manifest.styles.includes(path))
            controller.actions.patchManifest({ styles: [...draft.manifest.styles, path] });
          controller.actions.selectFile(path);
        });
        const toggle = editor.getByRole('button', { name: /查看诊断/ });
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
        const clear = editor.getByRole('button', { name: '清除诊断', exact: true });
        if (await clear.isEnabled()) await clear.click();
        await toggle.click();
        if (populated) {
          await editor.locator('input[type=file][accept=".paradox-ui"]').setInputFiles({
            name: 'invalid.paradox-ui',
            mimeType: 'application/json',
            buffer: Buffer.from('{invalid'),
          });
          await page.locator('#paradox-suite-editor').getByRole('alert').waitFor();
          await page.mouse.move(0, 0);
          await page.clock.runFor(5000);
        }
        await toggle.click();
        await settle();
        const body = editor.locator('.ui-editor-body');
        const diagnostics = editor.locator('.ui-diagnostics');
        const save = editor.getByRole('button', { name: '保存套件', exact: true });
        result.geometry = await editor.evaluate((element) => {
          const box = (node) => {
            const r = node.getBoundingClientRect();
            return { y: r.y, height: r.height };
          };
          return {
            editor: box(element),
            body: box(element.querySelector('.ui-editor-body')),
            diagnostics: box(element.querySelector('.ui-diagnostics')),
            save: box(element.querySelector('footer button.primary')),
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
          };
        });
        assert.ok(
          result.geometry.body.height > 0,
          'expanded diagnostics retain a scrollable editing area',
        );
        assert.ok(
          result.geometry.save.y >= 0 &&
            result.geometry.save.y + result.geometry.save.height <= 240,
          'Save stays inside the window with diagnostics expanded',
        );
        assert.equal(await diagnostics.locator('li').count(), populated ? 1 : 0);
        await diagnostics.scrollIntoViewIfNeeded();
        if (populated) await diagnostics.locator('li').first().scrollIntoViewIfNeeded();
        result.readableDiagnostics = await diagnostics.evaluate((element) => {
          const r = element.getBoundingClientRect();
          const body = element
            .closest('.ui-editor')
            .querySelector('.ui-editor-body')
            .getBoundingClientRect();
          return {
            clientHeight: element.clientHeight,
            visibleHeight: Math.min(r.bottom, body.bottom) - Math.max(r.top, body.top),
          };
        });
        assert.ok(
          result.readableDiagnostics.clientHeight >= 18 &&
            result.readableDiagnostics.visibleHeight >= 18,
          'expanded diagnostic text remains readable in the shared scroll area',
        );
        result.screenshot = `${(process.env.PARADOX_NOTICE_REPORT || 'report').replace(/\.json$/, '')}-${populated ? 'populated' : 'empty'}-diagnostics.png`;
        await page.screenshot({ path: resolve(artifacts, result.screenshot) });
        const source = editor.locator('textarea.ui-code');
        await source.scrollIntoViewIfNeeded();
        await source.click();
        await source.fill(`.app-shell { --diagnostic-layout-check: ${populated ? 2 : 1}; }`);
        result.savedSource = await source.inputValue();
        assert.ok(
          await body.evaluate((element) => element.scrollHeight > element.clientHeight),
          'source and diagnostics share reachable scrolling at minimum height',
        );
        const before = await page.evaluate(
          () =>
            window.foundationDesktop.calls.filter(
              (call) => call.command === 'save_ui_suite_library',
            ).length,
        );
        await save.click();
        await page.waitForFunction(
          (before) =>
            window.foundationDesktop.calls.filter(
              (call) => call.command === 'save_ui_suite_library',
            ).length > before,
          before,
        );
        assert.equal(
          await page.evaluate(() => window.foundationDesktop.suiteLibrary.suites.find(
            (suite) => suite.instance_id === window.suiteFinalFixture.controller.getSnapshot().selectedSuiteId,
          ).overlay['NoticeLayout.css'].text),
          result.savedSource,
          'actual Save persists the independently selected source bytes',
        );
        await page.locator('#paradox-suite-editor').getByRole('status').waitFor();
        await page.clock.runFor(3000);
        await editor.locator('header button').click();
        await editor.waitFor({ state: 'hidden' });
      },
    );
  }
  await layoutCase(
    'retained default editor notice stack leaves footer Save clickable at320x240',
    async (result) => {
      const editor = await openEditor(page);
      await page.evaluate(() => {
        const editor = document
          .getElementById('paradox-suite-editor')
          .shadowRoot.querySelector('.ui-editor');
        window.mountNoticeFixture({ fixed: true, container: editor });
        for (let i = 0; i < 4; i++) {
          const id = window.noticeFixture.store.publish(
            'error',
            `Retained editor notice ${i}\n` + 'Long editor notice text.\n'.repeat(40),
          );
          window.noticeFixture.store.pause(id, 'focus');
        }
      });
      await settle();
      const viewport = editor.locator('.ui-notice-viewport').last();
      const save = editor.getByRole('button', { name: '保存套件', exact: true });
      result.viewport = await viewport.boundingBox();
      result.save = await save.boundingBox();
      assert.ok(
        result.viewport.y >= 0 && result.viewport.y + result.viewport.height <= result.save.y,
        'the retained stack does not cover footer actions',
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
      assert.equal(await viewport.getByRole('alert').count(), 4);
      for (let i = 0; i < 4; i++)
        await viewport.getByRole('alert').first().getByRole('button').click();
      assert.equal(await viewport.getByRole('alert').count(), 0);
      await page.evaluate(() => window.noticeFixture.unmount());
      await page.clock.runFor(3000);
      await editor.locator('header button').click();
    },
  );
  assert.equal(
    report.layoutCases.filter((result) => !result.passed).length,
    0,
    'all focused minimum-window layout cases pass',
  );
  assert.deepEqual(report.errors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
    assert.ok(report.contentSecurityPolicy);
    assert.deepEqual(report.sourceModuleRequests, []);
  }
} catch (error) {
  report.failure = error.stack;
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally {
  await writeFile(
    resolve(artifacts, process.env.PARADOX_NOTICE_REPORT || 'report.json'),
    JSON.stringify(report, null, 2),
  );
  await fixture.close();
}


