import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out = resolve('.test-data/task-6-assets', process.env.PARADOX_SUITE_EVIDENCE || 'dev');
await mkdir(out, { recursive: true });
const fixture = await createBrowserFixture({
  desktopBoundary: true,
  nativeCsp: process.env.PARADOX_TEST_NATIVE_CSP === '1',
});
const report = {
  url: process.env.PARADOX_UI_URL,
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
  checks: [],
};
try {
  const { page } = fixture;
  if (!process.env.PARADOX_TEST_NATIVE_CSP)
    await page.evaluate(async () => {
      const { installLauncherFixture } = await import('/src/ui-tests/launcher-view-fixture.tsx');
      const { root } = await import('/src/main.tsx');
      installLauncherFixture(root);
    });
  else await page.waitForFunction(() => window.mountLauncherFixture);
  assert.equal(
    await page.evaluate(() => typeof window.suiteAssetFixture),
    'object',
    'Explicit suite asset fixture must be installed',
  );
  for (const language of ['zh-CN', 'en'])
    for (const viewport of [
      { width: 1240, height: 720 },
      { width: 320, height: 240 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(async (language) => {
        await window.suiteAssetFixture.language(language);
      }, language);
      const result = await page.evaluate(() => window.suiteAssetFixture.run());
      assert.deepEqual(result.failures, []);
      assert.ok(result.checks.length >= 20);
      report.checks.push({ language, viewport, ...result });
      await page.screenshot({ path: resolve(out, `${language}-${viewport.width}.png`) });
      console.log(
        `PASS suite assets ${language} ${viewport.width}x${viewport.height}: ${result.checks.length} checks`,
      );
    }
  assert.deepEqual(report.errors, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
    assert.ok(report.csp);
    assert.deepEqual(report.sourceRequests, []);
  }
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
