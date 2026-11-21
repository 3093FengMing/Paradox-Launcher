export async function checkValuesAssets(context) {
  const {
    assert,
    test,
    readFileSync,
    bundle,
    descriptors,
    record,
    library,
    zip,
    parseSuiteBundle,
    parseSuiteLibrary,
    canonicalSuiteJson,
    inspectSuiteZip,
    inspectSuiteAsset,
    checkRasterDimensions,
    scriptUrl,
  } = context;
  await test('strict values do not evaluate hostile properties and support scalar-count boundaries', () => {
    let called = 0;
    const b = bundle();
    Object.defineProperty(b.files, 'evil.ts', {
      enumerable: true,
      get() {
        called++;
        return { encoding: 'utf8', text: 'x' };
      },
    });
    assert.throws(() => parseSuiteBundle(b));
    assert.equal(called, 0);
    for (const v of [
      undefined,
      1n,
      Symbol(),
      () => 0,
      Object.assign(Object.create({}), { x: 1 }),
      Object.defineProperty({}, 'x', { value: 1 }),
      {
        toJSON() {
          called++;
          return {};
        },
      },
    ])
      assert.throws(() => canonicalSuiteJson(v));
    assert.equal(called, 0);
    for (const n of [-9007199254740991, 9007199254740991])
      assert.equal(canonicalSuiteJson(n), String(n));
    assert.throws(() => canonicalSuiteJson(-9007199254740992));
    const good = bundle();
    good.manifest.name = '😀'.repeat(48);
    good.manifest.version = 'x'.repeat(64);
    good.manifest.routes[0].order = 1000000;
    parseSuiteBundle(good);
    good.manifest.name += '😀';
    assert.throws(() => parseSuiteBundle(good));
    for (const p of [
      '/x.ts',
      'C:x.ts',
      '\\\\host\\x.ts',
      'a//x.ts',
      'a/./x.ts',
      'a/../x.ts',
      'AUX.txt',
      'dir/COM9.ts',
      'NUL',
      'LPT1.x',
      'a.',
      'a ',
      'a\u0000.ts',
      'a\u007f.ts',
      'e\u0301.ts',
    ]) {
      const x = bundle({ [p]: { encoding: 'utf8', text: '' } });
      assert.throws(() => parseSuiteBundle(x), p);
    }
  });
  await test('canonical library JSON bytes include base64 and record overhead at exact maximum', () => {
    const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', scriptUrl)),
      asset = Buffer.alloc(8388608);
    png.copy(asset);
    const b = bundle({
      'x.png': { encoding: 'base64', media_type: 'image/png', data: asset.toString('base64') },
    });
    const l = library(
      Array.from({ length: 12 }, (_, i) =>
        record(b, `fd910be2-a6bc-4976-a397-${String(i).padStart(12, '0')}`),
      ),
    );
    const last = structuredClone(b);
    l.suites[11] = record(last, 'fd910be2-a6bc-4976-a397-000000000011');
    const excess = Buffer.byteLength(canonicalSuiteJson(l)) - 134217728,
      remove = Math.ceil(excess / 4) * 3;
    last.files['x.png'].data = asset.subarray(0, asset.length - remove).toString('base64');
    descriptors(last);
    l.suites[11].manifest = last.manifest;
    const spare = 134217728 - Buffer.byteLength(canonicalSuiteJson(l));
    assert.ok(spare >= 0 && spare <= 8);
    l.suites[11].manifest.name += 'x'.repeat(spare);
    assert.equal(Buffer.byteLength(canonicalSuiteJson(l)), 134217728);
    assert.equal(parseSuiteLibrary(l).suites.length, 12);
    l.suites[11].manifest.name += 'x';
    assert.throws(() => parseSuiteLibrary(l));
  });
  await test('ZIP input boundary uses the owned archive byte length independently of claims', () => {
    const overhead = zip([
      { path: 'suite.json', data: Buffer.of(123, 125) },
      { path: 'large.bin', data: Buffer.alloc(0) },
    ]).length;
    const z = zip([
      { path: 'suite.json', data: Buffer.of(123, 125) },
      { path: 'large.bin', data: Buffer.alloc(33554432 - overhead) },
    ]);
    assert.equal(z.length, 33554432);
    assert.equal(inspectSuiteZip(z).length, 2);
    assert.throws(() => inspectSuiteZip(Buffer.concat([z, Buffer.of(0)])));
  });
  await test('raster dimension/pixel inclusive boundaries and malformed PNG header fields', () => {
    checkRasterDimensions(8192, 4096);
    checkRasterDimensions(4096, 8192);
    for (const [w, h] of [
      [8193, 1],
      [1, 8193],
      [8192, 4097],
      [0, 1],
    ])
      assert.throws(() => checkRasterDimensions(w, h));
    const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', scriptUrl));
    for (const [offset, value] of [
      [24, 3],
      [25, 1],
      [26, 1],
      [27, 1],
      [28, 2],
    ]) {
      const bad = Buffer.from(png);
      bad[offset] = value;
      assert.throws(() => inspectSuiteAsset('x.png', 'image/png', bad));
    }
  });
}
