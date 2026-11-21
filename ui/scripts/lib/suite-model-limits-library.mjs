export async function checkLimitsLibrary(context) {
  const {
    assert,
    test,
    readFileSync,
    bundle,
    descriptors,
    record,
    library,
    zipBundle,
    bytes,
    parseSuiteBundle,
    parseSuiteLibrary,
    materializeSuite,
    bundleDigest,
    validateSuiteLibrary,
    validateSuiteLibraryData,
    canonicalSuiteJson,
    decodeSuiteArchive,
    inspectSuiteAsset,
    scriptUrl,
  } = context;
  await test('file count, manifest bytes, asset bytes and record inclusive boundaries', () => {
    const b = bundle(
      Object.fromEntries(
        Array.from({ length: 511 }, (_, i) => [`${i}.ts`, { encoding: 'utf8', text: '' }]),
      ),
    );
    assert.equal(parseSuiteBundle(b).manifest.files.length, 512);
    b.files['last.ts'] = { encoding: 'utf8', text: '' };
    descriptors(b);
    assert.throws(() => parseSuiteBundle(b));
    const m = bundle();
    m.manifest.overrides = [
      { selector: { kind: 'type', target: 'x' }, enabled: true, entry: null, stylesheet: null },
    ];
    m.manifest.overrides[0].selector.target = 'x'.repeat(
      65536 - Buffer.byteLength(canonicalSuiteJson(m.manifest)) + 1,
    );
    assert.equal(Buffer.byteLength(canonicalSuiteJson(m.manifest)), 65536);
    parseSuiteBundle(m);
    m.manifest.overrides[0].selector.target += 'x';
    assert.throws(() => parseSuiteBundle(m));
    const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', scriptUrl)),
      large = Buffer.alloc(8388609);
    png.copy(large);
    inspectSuiteAsset('x.png', 'image/png', large.subarray(0, 8388608));
    assert.throws(() => inspectSuiteAsset('x.png', 'image/png', large));
    const l = library(
      Array.from({ length: 16 }, (_, i) =>
        record(bundle(), `fd910be2-a6bc-4976-a397-${String(i).padStart(12, '0')}`),
      ),
    );
    assert.equal(parseSuiteLibrary(l).suites.length, 16);
    l.suites.push(record());
    assert.throws(() => parseSuiteLibrary(l));
  });
  await test('materialized and inflated totals exact maximum / plus one independently', async () => {
    const b = bundle(
      Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [
          `${i}.ts`,
          { encoding: 'utf8', text: 'a'.repeat(1048576) },
        ]),
      ),
    );
    b.files['tail.ts'] = { encoding: 'utf8', text: '' };
    for (let i = 0; i < 3; i++) {
      descriptors(b);
      const other = Object.entries(b.files)
        .filter(([p]) => p !== 'tail.ts')
        .reduce((n, [, f]) => n + bytes(f).length, 0);
      b.files['tail.ts'].text = 'b'.repeat(
        33554432 - Buffer.byteLength(canonicalSuiteJson(b.manifest)) - other,
      );
    }
    descriptors(b);
    assert.equal(
      Buffer.byteLength(canonicalSuiteJson(b.manifest)) +
        Object.values(b.files).reduce((n, f) => n + bytes(f).length, 0),
      33554432,
    );
    parseSuiteBundle(b);
    const zipped = zipBundle(b, { method: 8 });
    assert.equal(
      (await decodeSuiteArchive(zipped)).files['tail.ts'].text.length,
      b.files['tail.ts'].text.length,
    );
    b.files['tail.ts'].text += 'b';
    descriptors(b);
    assert.throws(() => parseSuiteBundle(b));
    await assert.rejects(() => decodeSuiteArchive(zipBundle(b, { method: 8 })));
  });
  await test('D25 data validation retains revision without platform capabilities and detaches before awaits', async () => {
    assert.equal(typeof validateSuiteLibraryData, 'function');
    const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', scriptUrl));
    const l = library([
      record(
        bundle({
          'x.png': { encoding: 'base64', media_type: 'image/png', data: png.toString('base64') },
        }),
      ),
    ]);
    const accepted = await validateSuiteLibraryData(l);
    assert.equal(accepted.revision, 7);
    await assert.rejects(() => validateSuiteLibrary(l));
    l.suites[0].manifest.files[0].sha256 = '0'.repeat(64);
    await assert.rejects(() => validateSuiteLibraryData(l));
    assert.notEqual(
      accepted.suites[0].manifest.files[0].sha256,
      l.suites[0].manifest.files[0].sha256,
    );
  });
  await test('D26 immediate-parent deletion constraints reject stale and overlapping records', async () => {
    const p = bundle({ 'removed.ts': { encoding: 'utf8', text: 'old' } }),
      r = record();
    r.parent_snapshot = { digest: await bundleDigest(p), bundle: p };
    r.deleted = ['removed.ts'];
    materializeSuite(r);
    for (const deleted of [['missing.ts'], ['removed.ts', 'removed.ts'], ['Home.tsx']])
      assert.throws(() => materializeSuite({ ...r, deleted }));
    assert.throws(() => materializeSuite({ ...r, parent_snapshot: null }));
    const broken = library([r]);
    broken.suites[0].parent_snapshot.digest = '0'.repeat(64);
    parseSuiteLibrary(broken);
    await assert.rejects(() => validateSuiteLibraryData(broken));
  });
}
