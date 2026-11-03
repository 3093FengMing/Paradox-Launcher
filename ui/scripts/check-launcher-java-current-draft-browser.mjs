import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(
  import.meta.dirname,
  '../../.test-data/launcher-java-current-draft-browser/task-3-fix-1',
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
  await page.waitForFunction(() => typeof window.mountLauncherFixture === 'function');
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    window.javaDraftFix = { inspections: [], operations: [] };
    native.invoke = async (command, args = {}) => {
      if (command === 'choose_java') return 'C:/raw-java';
      if (command === 'inspect_java')
        return new Promise((resolve) =>
          window.javaDraftFix.inspections.push({ path: args.path, resolve }),
        );
      if (command === 'discover_java')
        return { installations: [], warnings: [], download_supported: true };
      return invoke(command, args);
    };
    window.mountLauncherFixture(false);
  });
  await page.waitForFunction(() => window.launcherFixture.views.a?.snapshot.config.ready);
  const begin = async (manualAtInvocation) => {
    await page.evaluate((manual) => {
      const actions = window.launcherFixture.views.a.actions;
      if (manual) actions.settings.patch('java_executable', manual);
      window.javaDraftFix.operations.push(actions.java.chooseForSettings());
    }, manualAtInvocation);
  };
  const finish = async (index, canonical, laterManual) => {
    await page.evaluate(
      async ({ index, canonical, laterManual }) => {
        const actions = window.launcherFixture.views.a.actions;
        // The newer manual edit and inspection completion occur in one JS turn.
        // There is deliberately no await or render between them.
        if (laterManual) actions.settings.patch('java_executable', laterManual);
        window.javaDraftFix.inspections[index].resolve({
          executable: canonical,
          java_home: '',
          major_version: 21,
          version: '21',
          vendor: 'Fixture',
          architecture: 'x64',
          source: 'manual',
        });
        await window.javaDraftFix.operations[index];
      },
      { index, canonical, laterManual },
    );
  };
  await begin();
  await page.waitForFunction(() => window.javaDraftFix.inspections.length === 1);
  await finish(0, 'C:/older-canonical/java.exe', 'C:/newer-manual/java.exe');
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.a.snapshot.settings.draft.java_executable ===
      'C:/newer-manual/java.exe',
  );
  pass('newer_manual_edit_before_render_survives_held_java_inspection');
  await begin();
  await page.waitForFunction(() => window.javaDraftFix.inspections.length === 2);
  await finish(1, 'C:/canonical-success/java.exe');
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.b.snapshot.settings.draft.java_executable ===
      'C:/canonical-success/java.exe',
  );
  pass('canonical_inspection_success_applies_without_a_later_edit');
  await begin('C:/manual-at-invocation/java.exe');
  await page.waitForFunction(() => window.javaDraftFix.inspections.length === 3);
  await finish(2, 'C:/canonical-current-invocation/java.exe');
  await page.waitForFunction(
    () =>
      window.launcherFixture.views.a.snapshot.settings.draft.java_executable ===
      'C:/canonical-current-invocation/java.exe',
  );
  pass('same_turn_existing_draft_at_invocation_allows_current_canonical_choice');
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
