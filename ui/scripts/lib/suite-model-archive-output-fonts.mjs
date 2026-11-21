export async function checkArchiveOutputFonts(context) {
  const {
    assert,
    test,
    readFileSync,
    createRequire,
    bundle,
    record,
    checkArchiveOutputBoundary,
    materializeSuite,
    bundleDigest,
    inspectSuiteDeflate,
    inspectSuiteZip,
    inspectSuiteAsset,
    scriptUrl,
  } = context;
  await test('checked-in raw ZIP/DEFLATE vectors and fflate completion characterization', () => {
    const v = JSON.parse(
      readFileSync(new URL('./fixtures/ui-suite/archive-vectors.json', scriptUrl)),
    );
    for (const f of v.deflate) {
      const raw = Buffer.from(f.hex, 'hex');
      if (f.output === null) assert.throws(() => inspectSuiteDeflate(raw, 100), f.name);
      else assert.equal(inspectSuiteDeflate(raw, 100).outputBytes, f.output, f.name);
    }
    for (const f of v.zip) {
      const raw = Buffer.from(f.hex, 'hex');
      if (f.valid) inspectSuiteZip(raw);
      else assert.throws(() => inspectSuiteZip(raw), f.name);
    }
    const require = createRequire(new URL('../package.json', scriptUrl)),
      { Inflate } = require('fflate/browser');
    const final = [];
    const stream = new Inflate((data, done) => final.push({ bytes: data.length, done }));
    stream.push(Uint8Array.of(0, 0, 0, 255, 255), false);
    stream.push(new Uint8Array(), true);
    assert.equal(final.at(-1).done, true);
    assert.throws(() => inspectSuiteDeflate(Uint8Array.of(0, 0, 0, 255, 255), 0));
    let count = 0;
    new Inflate((data) => (count += data.length)).push(Uint8Array.of(3, 0, 0), true);
    assert.equal(count, 0);
    assert.throws(() => inspectSuiteDeflate(Uint8Array.of(3, 0, 0), 0));
  });
  await test('D26 case-only rename deletes exact parent spelling before overlay insertion', async () => {
    const parent = bundle({ 'lower.ts': { encoding: 'utf8', text: 'old' } }),
      child = bundle({ 'LOWER.ts': { encoding: 'utf8', text: 'new' } }),
      r = record(child);
    r.parent_snapshot = { digest: await bundleDigest(parent), bundle: parent };
    r.deleted = ['lower.ts'];
    assert.equal(materializeSuite(r).files['LOWER.ts'].text, 'new');
    assert.throws(() => materializeSuite({ ...r, deleted: [] }));
  });
  await test(
    'real streaming ZIP output exact maximum / plus one independently of materialized limit',
    checkArchiveOutputBoundary,
  );
  await test('WOFF2 table-tag aliases and reserved transform versions are container failures', () => {
    function font(directory, count) {
      const bytes = Buffer.alloc(48 + directory.length + 1);
      bytes.write('wOF2');
      bytes.writeUInt32BE(0x10000, 4);
      bytes.writeUInt32BE(bytes.length, 8);
      bytes.writeUInt16BE(count, 12);
      bytes.writeUInt32BE(12 + 16 * count, 16);
      bytes.writeUInt32BE(1, 20);
      Buffer.from(directory).copy(bytes, 48);
      return bytes;
    }
    assert.throws(() =>
      inspectSuiteAsset('bad.woff2', 'font/woff2', font([0, 0, 63, 99, 109, 97, 112, 0], 2)),
    );
    assert.throws(() => inspectSuiteAsset('bad.woff2', 'font/woff2', font([64, 0, 0], 1)));
  });
}
