import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadApp } from './lib/hook-test-host.mjs';
assert.ok(
  existsSync(new URL('../src/ui-suite/unicode-nfc.ts', import.meta.url)),
  'Pinned Unicode NFC implementation must exist',
);
const { normalizeSuiteNfc } = loadApp(new Map(), { isolateCustomization: false })(
  'ui-suite/unicode-nfc.ts',
);
let count = 0;
for (const line of readFileSync(
  new URL('./fixtures/ui-suite/NormalizationTest-15.1.0.txt', import.meta.url),
  'utf8',
).split('\n')) {
  if (!/^[0-9A-F]/.test(line)) continue;
  const values = line
    .split(';')
    .slice(0, 5)
    .map((s) =>
      String.fromCodePoint(
        ...s
          .trim()
          .split(/\s+/)
          .map((c) => parseInt(c, 16)),
      ),
    );
  for (let i = 0; i < 5; i++)
    assert.equal(normalizeSuiteNfc(values[i]), values[i < 3 ? 1 : 3], line);
  count++;
}
assert.throws(() => normalizeSuiteNfc('\ud800'));
assert.throws(() => normalizeSuiteNfc('\udfff'));
assert.equal(normalizeSuiteNfc('각'), '각');
assert.equal(normalizeSuiteNfc('a\u0315\u0300'), 'à\u0315');
assert.equal(normalizeSuiteNfc('\u{1e5ee}\u{1e5ef}'), '\u{1e5ee}\u{1e5ef}');
assert.equal(normalizeSuiteNfc('ﬁ'), 'ﬁ');
console.log(
  `PASS Unicode 15.1 NFC: ${count} official rows × 5 conformance assertions, surrogate/Hangul/order/newer-unassigned/compatibility cases`,
);
