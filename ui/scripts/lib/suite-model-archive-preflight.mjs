export async function checkArchivePreflight(context) {
  const {
    assert,
    test,
    deflateRawSync,
    constants,
    bundle,
    zip,
    zipBundle,
    parseSuiteBundle,
    inspectSuiteDeflate,
    inspectSuiteZip,
    decodeSuiteArchive,
    inspectSuiteAsset,
    validateSuiteAsset,
  } = context;
  await test('DEFLATE proves stored/fixed/dynamic/legal-empty and rejects end/count corruption before inflate', () => {
    for (const data of [Buffer.alloc(0), Buffer.from('hello'), Buffer.from('abc'.repeat(10000))])
      for (const options of [{ level: 0 }, { strategy: constants.Z_FIXED }, { level: 9 }]) {
        const raw = deflateRawSync(data, options);
        assert.equal(inspectSuiteDeflate(raw, data.length).outputBytes, data.length);
        if (data.length) assert.throws(() => inspectSuiteDeflate(raw, data.length - 1));
        assert.throws(() =>
          inspectSuiteDeflate(Buffer.concat([raw, Buffer.from([0])]), data.length),
        );
        for (let end = 0; end < Math.min(raw.length, 20); end++)
          assert.throws(() => inspectSuiteDeflate(raw.subarray(0, end), data.length));
      }
    assert.throws(() => inspectSuiteDeflate(Uint8Array.from([1, 0, 0, 0, 0]), 0));
    assert.equal(inspectSuiteDeflate(Uint8Array.from([3, 252]), 0).outputBytes, 0);
  });
  await test('raw ZIP ordered metadata rejects duplicate associations, unsafe flags, extra semantics, gaps and specials', async () => {
    for (const entries of [
      [{ path: 'suite.json' }, { path: 'suite.json' }],
      [{ path: 'suite.json' }, { path: 'SUITE.JSON' }],
      [{ path: 'suite.json', centralNameBytes: Buffer.from('other.json') }],
      [{ path: 'suite.json', flags: 1 }],
      [{ path: 'suite.json', attributes: 0xa0000000 }],
      [{ path: 'suite.json', creator: 20, attributes: 0x40000000 }],
      [{ path: 'suite.json', extra: [1, 0, 0, 0] }],
      [{ path: 'suite.json', nameBytes: [255], flags: 0 }],
      [{ path: 'suite.json', localSize: 1 }],
    ])
      assert.throws(() => inspectSuiteZip(zip(entries)));
    const z = zipBundle();
    assert.throws(() => inspectSuiteZip(Buffer.concat([z, Buffer.from([0])])));
    await assert.rejects(() =>
      decodeSuiteArchive(
        zip([
          { path: 'suite.json', data: Buffer.from('{}') },
          { path: 'extra.ts', data: Buffer.from('x') },
        ]),
      ),
    );
  });
  await test('asset headers do not bypass missing real platform decoders', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/M1sAAAAASUVORK5CYII=',
      'base64',
    );
    inspectSuiteAsset('a.png', 'image/png', png);
    await assert.rejects(() => validateSuiteAsset('a.png', 'image/png', png));
    for (const media of ['image/png', 'image/jpeg', 'image/webp', 'font/woff', 'font/woff2'])
      assert.throws(() => inspectSuiteAsset('x', media, new Uint8Array(1)));
    for (const spelling of ['AB==', 'AA=', 'AAAA\n', '====']) {
      const b = bundle({
        'x.png': { encoding: 'base64', media_type: 'image/png', data: spelling },
      });
      assert.throws(() => parseSuiteBundle(b));
    }
  });
}
