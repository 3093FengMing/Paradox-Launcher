export async function checkFramingLineage(context) {
  const {
    assert,
    test,
    readFileSync,
    createRequire,
    loadApp,
    bundle,
    record,
    library,
    zipBundle,
    bytes,
    sha,
    parseSuiteLibrary,
    materializeSuite,
    bundleDigest,
    validateSuiteLibrary,
    canonicalSuiteJson,
    inspectSuiteZip,
    decodeSuiteArchive,
    encodeSuiteArchive,
    plain,
    sharedVectors,
    scriptUrl,
  } = context;
  await test('fix1 literal non-BMP paths and independent file framing boundaries', async () => {
    const v = sharedVectors.fix1;
    assert.ok(v, 'Missing required shared framing vectors');
    for (const item of [v.non_bmp, ...v.boundary_pair]) {
      assert.equal(await bundleDigest(item.bundle), item.digest);
      assert.equal(
        Buffer.from(canonicalSuiteJson(item.bundle.manifest)).toString('hex'),
        item.manifest_hex,
      );
      const framed = Buffer.from(item.framed_hex, 'hex');
      let p = 19;
      const take = () => {
        const n = framed.readUInt32BE(p);
        p += 4;
        const value = framed.subarray(p, p + n);
        p += n;
        return value;
      };
      assert.equal(take().toString('hex'), item.manifest_hex);
      const count = framed.readUInt32BE(p);
      p += 4;
      const paths = [];
      for (let i = 0; i < count; i++) {
        const start = p,
          name = take().toString('utf8');
        paths.push(name);
        assert.deepEqual(take(), bytes(item.bundle.files[name]));
        if (name === item.boundary_path) {
          assert.equal(framed.subarray(start, p).toString('hex'), item.framed_file_hex);
          assert.equal(
            Buffer.concat([Buffer.from(name), bytes(item.bundle.files[name])]).toString('hex'),
            item.unframed_file_hex,
          );
        }
      }
      assert.equal(p, framed.length);
      assert.deepEqual(paths, item.ordered_paths);
    }
    assert.deepEqual(v.non_bmp.ordered_paths, ['Home.tsx', '.ts', '😀.ts']);
    const [a, b] = v.boundary_pair;
    assert.equal(a.unframed_file_hex, b.unframed_file_hex);
    assert.notEqual(a.framed_file_hex, b.framed_file_hex);
    assert.notEqual(a.digest, b.digest);
  });
  await test('fix1 actual ZIP entry ordering and mtime cannot change decoded bundle digest', async () => {
    const variants = sharedVectors.fix1?.zip_variants;
    assert.ok(variants, 'Missing fixed archive variants');
    const outputs = [];
    for (const v of variants) {
      const raw = Buffer.from(v.base64, 'base64'),
        entries = inspectSuiteZip(raw);
      assert.equal(sha(raw), v.sha256);
      assert.deepEqual(
        entries.map((e) => e.path),
        v.local_order,
      );
      assert.equal(
        new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint16(10, true),
        v.first_dos_time,
      );
      assert.equal(
        new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint16(12, true),
        v.dos_date,
      );
      const decoded = await decodeSuiteArchive(raw);
      assert.equal(await bundleDigest(decoded), v.digest);
      outputs.push(plain(decoded));
    }
    assert.deepEqual(outputs[0], outputs[1]);
    assert.notDeepEqual(variants[0].local_order, variants[1].local_order);
    assert.notEqual(variants[0].first_dos_time, variants[1].first_dos_time);
  });
  await test('fix1 corrupt UTF8 crosses real Inflate output chunks and rejects archive publication', async () => {
    const v = sharedVectors.fix1?.split_utf8;
    assert.ok(v, 'Missing fixed split UTF8 archive');
    const require = createRequire(new URL('../package.json', scriptUrl)),
      fflate = require('fflate/browser'),
      chunks = [];
    const observed = loadApp(
      new Map([
        [
          'fflate/browser',
          {
            ...fflate,
            Inflate: class extends fflate.Inflate {
              constructor(callback) {
                super((chunk, final) => {
                  chunks.push({ length: chunk.length, first: chunk[0], last: chunk.at(-1) });
                  callback(chunk, final);
                });
              }
            },
          },
        ],
      ]),
      { isolateCustomization: false },
    )('ui-suite/archive.ts');
    const raw = readFileSync(new URL('./fixtures/ui-suite/' + v.archive_file, scriptUrl));
    assert.equal(sha(raw), v.archive_sha256);
    let published = 'previous';
    await assert.rejects(async () => {
      await observed.decodeSuiteArchive(raw);
      published = 'bad';
    }, TypeError);
    assert.equal(published, 'previous');
    assert.deepEqual(chunks, v.output_chunks);
  });
  await test('archive_roundtrip_and_builtin_lineage', async () => {
    const b = bundle();
    assert.deepEqual(plain(await decodeSuiteArchive(await encodeSuiteArchive(b))), b);
    for (const method of [0, 8])
      for (const flags of [0x800, 0x808])
        assert.deepEqual(plain(await decodeSuiteArchive(zipBundle(b, { method, flags }))), b);
  });
  await test('parent_snapshot_independent_of_deleted_parent and independent same-content instance records', async () => {
    const p = bundle({ 'removed.ts': { encoding: 'utf8', text: 'old' } }),
      c = bundle();
    const child = record(c);
    child.parent_snapshot = { digest: await bundleDigest(p), bundle: p };
    child.deleted = ['removed.ts'];
    child.overlay = { 'Home.tsx': c.files['Home.tsx'] };
    const l = library([
      record(p),
      { ...child, instance_id: 'fd910be2-a6bc-4976-a397-137ace486aa9' },
    ]);
    l.active_suite_id = l.suites[1].instance_id;
    l.suites.shift();
    assert.equal(materializeSuite(l.suites[0]).files['removed.ts'], undefined);
    assert.deepEqual(plain(await validateSuiteLibrary(l)), l);
    assert.equal(
      parseSuiteLibrary(library([record(c), record(c, 'fd910be2-a6bc-4976-a397-137ace486aa9')]))
        .suites.length,
      2,
    );
  });
}
