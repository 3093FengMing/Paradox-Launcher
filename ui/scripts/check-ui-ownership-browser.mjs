import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out = resolve('.test-data/task-9-ownership', process.env.PARADOX_OWNERSHIP_EVIDENCE || 'dev');
await mkdir(out, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const report = {
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
  cspViolations: fixture.observedCspViolations,
  consoleErrors: [],
  rows: [],
};
try {
  const { page } = fixture;
  page.on('console', (m) => {
    if (m.type() === 'error') report.consoleErrors.push(m.text());
  });
  await page.waitForFunction(() => window.ownershipFixture);
  for (const { width, height } of [
    { width: 1240, height: 720 },
    { width: 320, height: 240 },
  ]) {
    await page.setViewportSize({ width, height });
    const consoleStart = report.consoleErrors.length;
    await page.evaluate(() => {
      window.ownershipFixture.captureReady = false;
    });
    const running = page.evaluate(() => window.ownershipFixture.run());
    const result = await Promise.race([
      running.then((value) => ({ done: true, value })),
      page
        .waitForFunction(() => window.ownershipFixture.captureReady, {}, { timeout: 25000 })
        .then(() => ({ done: false })),
    ]);
    assert.equal(result.done, false, 'matrix reaches screenshot checkpoint');
    await page.screenshot({ path: resolve(out, `ownership-${width}.png`) });
    await page.evaluate(() => window.ownershipFixture.resume());
    const row = await running;
    const diagnostics = report.consoleErrors.slice(consoleStart);
    const expected = [
      /Encountered two children with the same key/,
      /Each child in a list should have a unique "key" prop/,
    ];
    assert.deepEqual(
      diagnostics.filter((text) => !expected.some((pattern) => pattern.test(text))),
      [],
      'unexpected browser console errors',
    );
    const expectedCount = process.env.PARADOX_TEST_NATIVE_CSP === '1' ? 0 : 1;
    assert.deepEqual(
      expected.map((pattern) => diagnostics.filter((text) => pattern.test(text)).length),
      [expectedCount, expectedCount],
      'only one duplicate/missing-key diagnostic per negative dev row',
    );
    assert.equal(row.checks.length, 11);
    report.rows.push({ width, height, ...row, consoleErrors: diagnostics });
    console.log(`PASS ownership ${width}: ${row.checks.length} groups`);
    if (width === 1240) {
      await page.reload();
      await page.waitForFunction(() => window.ownershipFixture);
    }
  }
  assert.deepEqual(
    report.rows[0].evidence.fieldLocators,
    report.rows[1].evidence.fieldLocators,
    'actual page reload preserves complete locators',
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.cspViolations, []);
  assert.equal(
    report.consoleErrors.length,
    process.env.PARADOX_TEST_NATIVE_CSP === '1' ? 0 : 4,
    'no console errors outside the bounded negative key cases',
  );
  if (process.env.PARADOX_TEST_NATIVE_CSP) assert.deepEqual(report.sourceRequests, []);
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
