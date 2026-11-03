import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out = resolve(import.meta.dirname, '../../.test-data/task-13/storage', process.env.PARADOX_FINAL_EVIDENCE || 'manual-run');
await mkdir(out, { recursive: true });
const report = { url: process.env.PARADOX_UI_URL, runs: [] };
for (const desktopBoundary of [false, true]) {
  const fixture = await createBrowserFixture({
    desktopBoundary,
    nativeCsp: process.env.PARADOX_TEST_NATIVE_CSP === '1',
  });
  const run = {
    desktopBoundary,
    csp: fixture.contentSecurityPolicy,
    errors: fixture.observedPageErrors,
    sourceRequests: fixture.observedSourceModuleRequests,
    checks: [],
  };
  report.runs.push(run);
  const install = async () => {
    if (process.env.PARADOX_TEST_NATIVE_CSP === '1')
      await fixture.page.waitForFunction(() => window.suiteStorageFixture);
    else
      await fixture.page.evaluate(async () => {
        const { installLauncherFixture } = await import('/src/ui-tests/launcher-view-fixture.tsx');
        const { root } = await import('/src/main.tsx');
        installLauncherFixture(root);
      });
    // The storage fixture owns its database reset and revision assertions.
    // Finish and release the application's startup writer before those steps.
    await fixture.page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation());
    run.startupBoundary = await fixture.page.evaluate((desktop) => {
      const c = window.suiteFinalFixture.controller;
      const before = { active: !!c.getActivation(), revision: c.getLibrary()?.revision };
      c.connectionCleanup();
      if (desktop) {
        window.foundationDesktop.suiteLibrary = {
          kind: 'paradox-ui-suite-library', schema_version: 1,
          revision: 0, active_suite_id: null, suites: [],
        };
        window.foundationDesktop.suiteRaw = null;
      }
      return { before, after: { active: !!c.getActivation() }, desktopFixtureReset: desktop };
    }, desktopBoundary);
  };
  try {
    await install();
    run.checks.push(
      ...(await fixture.page.evaluate(
        (desktop) =>
          desktop ? window.suiteStorageFixture.desktop() : window.suiteStorageFixture.run(),
        desktopBoundary,
      )),
    );
    if (!desktopBoundary) {
      await fixture.page.reload();
      await install();
      run.checks.push(
        ...(await fixture.page.evaluate(() => window.suiteStorageFixture.reloadCheck())),
      );
    }
    assert.deepEqual(run.errors, []);
    if (process.env.PARADOX_TEST_NATIVE_CSP === '1') {
      assert.ok(run.csp);
      assert.deepEqual(run.sourceRequests, []);
    }
    console.log(
      `PASS ${desktopBoundary ? 'captured desktop IPC' : 'real IndexedDB persistence/reload/abort'}: ${run.checks.length} checks`,
    );
  } finally {
    await fixture.close();
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}

