export async function checkCanonicalDeflate(context) {
  const {
    assert,
    test,
    readFileSync,
    createRequire,
    deflateRawSync,
    loadApp,
    descriptors,
    zip,
    fixed,
    dynamic,
    bundleDigest,
    canonicalSuiteJson,
    suitePathCollisionKey,
    inspectSuiteDeflate,
    scriptUrl,
  } = context;
  await test('shared literal canonical/framing/fold fixtures and digest distinction', async () => {
    const v = JSON.parse(
      readFileSync(new URL('./fixtures/ui-suite/format-vectors.json', scriptUrl)),
    );
    assert.equal(canonicalSuiteJson(v.canonical.input), v.canonical.expected);
    assert.equal(
      Buffer.from(canonicalSuiteJson(v.canonical.input)).toString('hex'),
      v.canonical.utf8_hex,
    );
    assert.equal(
      Buffer.from(canonicalSuiteJson(v.bundle.manifest)).toString('hex'),
      v.manifest_hex,
    );
    assert.equal(await bundleDigest(v.bundle), v.digest);
    for (const [s, want] of v.fold) assert.equal(suitePathCollisionKey(s), want);
    for (const change of [
      (b) => {
        b.files['Home.tsx'].text += '!';
        descriptors(b);
      },
      (b) => {
        b.files['other.ts'] = b.files['empty.ts'];
        delete b.files['empty.ts'];
        descriptors(b);
      },
      (b) => b.manifest.files.reverse(),
    ]) {
      const b = structuredClone(v.bundle);
      change(b);
      assert.notEqual(await bundleDigest(b), v.digest);
    }
    const framed = Buffer.from(v.framed_hex, 'hex');
    assert.equal(framed.subarray(0, 19).toString('hex'), '50415241444f582d55492d42554e444c450001');
    assert.equal(framed.readUInt32BE(19), Buffer.from(v.manifest_hex, 'hex').length);
  });
  await test('RFC illegal trees, repeats, emitted reserved codes, missing final/EOB and legal degenerate tree', () => {
    assert.equal(inspectSuiteDeflate(dynamic(), 0).outputBytes, 0);
    for (const kind of ['oversubscribed', 'incomplete', 'predecessor', 'overflow', 'missing-eob'])
      assert.throws(() => inspectSuiteDeflate(dynamic(kind), 100), kind);
    for (const raw of [
      fixed([286]),
      fixed([287]),
      fixed([257], [0]),
      fixed([65, 257], [30]),
      fixed([65, 257], [31]),
      Uint8Array.of(7),
      Uint8Array.of(2, 0),
      fixed([65]).subarray(0, 1),
    ])
      assert.throws(() => inspectSuiteDeflate(raw, 100));
    assert.equal(inspectSuiteDeflate(fixed([65, 257, 256], [0]), 4).outputBytes, 4);
  });
  await test('preflight rejects true expansion before invoking the real fflate Inflate constructor', async () => {
    const require = createRequire(new URL('../package.json', scriptUrl)),
      fflate = require('fflate/browser');
    let calls = 0;
    const observed = loadApp(
      new Map([
        [
          'fflate/browser',
          {
            ...fflate,
            Inflate: class extends fflate.Inflate {
              constructor(...args) {
                calls++;
                super(...args);
              }
            },
          },
        ],
      ]),
      { isolateCustomization: false },
    )('ui-suite/archive.ts');
    const compressed = deflateRawSync(Buffer.alloc(8388609));
    await assert.rejects(() =>
      observed.decodeSuiteArchive(
        zip([
          { path: 'suite.json', data: Buffer.from('{}') },
          { path: 'a.png', method: 8, compressed, size: 0 },
        ]),
      ),
    );
    assert.equal(calls, 0);
    const entries = [
      { path: 'suite.json', method: 8, data: Buffer.from('{}') },
      ...Array.from({ length: 4 }, (_, i) => ({
        path: `${i}.png`,
        method: 8,
        data: Buffer.alloc(8388608),
      })),
    ];
    await assert.rejects(() => observed.decodeSuiteArchive(zip(entries)));
    assert.equal(calls, 0);
    assert.equal(
      inspectSuiteDeflate(deflateRawSync(Buffer.alloc(33554432)), 33554432).outputBytes,
      33554432,
    );
    assert.throws(() => inspectSuiteDeflate(deflateRawSync(Buffer.alloc(33554433)), 33554432));
  });
}
