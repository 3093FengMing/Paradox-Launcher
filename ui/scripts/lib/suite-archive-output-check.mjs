import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadApp, uiRoot } from './hook-test-host.mjs';
import { bundle, sha } from './suite-test-fixtures.mjs';

// Real synchronous fflate encoding/counters. Only the platform decoder is omitted
// in this Node orchestration test; real asset acceptance is a separate browser test.
export async function checkArchiveOutputBoundary() {
  const require = createRequire(new URL('../../package.json', import.meta.url)),
    fflate = require('fflate/browser'),
    { Deflate } = fflate;
  const product = loadApp(new Map(), { isolateCustomization: false }),
    assets = product('ui-suite/assets.ts');
  const app = loadApp(
    new Map([
      [
        resolve(uiRoot, 'src/ui-suite/assets.ts'),
        { ...assets, validateSuiteAsset: async () => {} },
      ],
    ]),
    { isolateCustomization: false },
  );
  const { encodeSuiteArchive } = app('ui-suite/archive.ts'),
    { canonicalSuiteJson } = app('ui-suite/canonical.ts'),
    { inspectSuiteZip } = app('ui-suite/archive-structure.ts');
  const image = Buffer.alloc(8388608);
  let state = 0x6c8e9cf5;
  for (let i = 0; i < image.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    image[i] = state & 255;
  }
  readFileSync(new URL('../fixtures/ui-suite/pixel.png', import.meta.url)).copy(image);
  const data = image.toString('base64'),
    b = bundle(
      Object.fromEntries(
        Array.from({ length: 4 }, (_, i) => [
          `${i}.png`,
          { encoding: 'base64', media_type: 'image/png', data },
        ]),
      ),
    );
  const compressedSize = (bytes) => {
    let size = 0;
    const d = new Deflate({ level: 6 }, (chunk) => (size += chunk.length));
    for (let p = 0; p < bytes.length; p += 65536)
      d.push(bytes.subarray(p, Math.min(bytes.length, p + 65536)), p + 65536 >= bytes.length);
    if (!bytes.length) d.push(bytes, true);
    return size;
  };
  const originalSize = compressedSize(image),
    source = Buffer.from(b.files['Home.tsx'].text),
    sourceSize = compressedSize(source);
  const overhead =
    22 +
    Object.keys(b.files)
      .concat('suite.json')
      .reduce((n, p) => n + 92 + 2 * Buffer.byteLength(p), 0);
  // Frozen deterministic vector found independently: this last original-byte count
  // produces exactly the approved ZIP maximum with the pinned streaming encoder.
  const length = 8356534,
    tail = image.subarray(0, length),
    descriptor = b.manifest.files.find((d) => d.path === '3.png');
  descriptor.bytes = length;
  descriptor.sha256 = sha(tail);
  b.files['3.png'].data = tail.toString('base64');
  assert.equal(
    overhead +
      3 * originalSize +
      sourceSize +
      compressedSize(tail) +
      compressedSize(Buffer.from(canonicalSuiteJson(b.manifest))),
    33554432,
  );
  const encoded = await encodeSuiteArchive(b);
  assert.equal(encoded.length, 33554432);
  assert.equal(inspectSuiteZip(encoded).length, 6);
  // One ordinary central-directory comment adds exactly one real output byte.
  // Instrument only this public encoder metadata; all compression/chunks stay real.
  const withComment = loadApp(
    new Map([
      [
        resolve(uiRoot, 'src/ui-suite/assets.ts'),
        { ...assets, validateSuiteAsset: async () => {} },
      ],
      [
        'fflate/browser',
        {
          ...fflate,
          ZipDeflate: class extends fflate.ZipDeflate {
            constructor(name, options) {
              super(name, options);
              if (name === 'Home.tsx') this.comment = 'x';
            }
          },
        },
      ],
    ]),
    { isolateCustomization: false },
  )('ui-suite/archive.ts');
  await assert.rejects(() => withComment.encodeSuiteArchive(b), /ZIP output exceeds limit/);
}
