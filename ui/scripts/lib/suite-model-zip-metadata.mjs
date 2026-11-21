export async function checkZipMetadata(context) {
  const { assert, test, bundle, zip, zipBundle, crc, inspectSuiteZip, decodeSuiteArchive } =
    context;
  await test('ZIP UTF8/ASCII and Unicode Path extras confirm exact primary bytes', () => {
    const field = (raw, name, version = 1, sum = crc(raw)) => {
      const data = Buffer.from(name),
        x = Buffer.alloc(9 + data.length);
      x.writeUInt16LE(0x7075);
      x.writeUInt16LE(5 + data.length, 2);
      x[4] = version;
      x.writeUInt32LE(sum, 5);
      data.copy(x, 9);
      return x;
    };
    for (const name of ['ascii.ts', '世界.ts']) {
      const raw = Buffer.from(name),
        entry = { path: name, data: Buffer.alloc(0), extra: field(raw, name) };
      assert.equal(inspectSuiteZip(zip([{ path: 'suite.json' }, entry])).length, 2);
      if (name === 'ascii.ts')
        assert.equal(
          inspectSuiteZip(zip([{ path: 'suite.json' }, { ...entry, flags: 0 }])).length,
          2,
        );
      else
        assert.throws(() => inspectSuiteZip(zip([{ path: 'suite.json' }, { ...entry, flags: 0 }])));
      for (const extra of [
        field(raw, 'other.ts'),
        field(raw, name, 2),
        field(raw, name, 1, 0),
        Buffer.concat([field(raw, name), field(raw, name)]),
        Buffer.of(2, 0, 4, 0, 0),
      ])
        assert.throws(() => inspectSuiteZip(zip([{ path: 'suite.json' }, { ...entry, extra }])));
    }
    assert.throws(() =>
      inspectSuiteZip(
        zip([{ path: 'suite.json' }, { path: 'x', nameBytes: Buffer.of(0xc0, 0xaf) }]),
      ),
    );
  });
  await test('ZIP local/central layouts and descriptor CRC-signature ambiguity', async () => {
    for (const unsigned of [true, false])
      assert.equal(
        inspectSuiteZip(zip([{ path: 'suite.json', flags: 0x808, unsigned, crc: 0x08074b50 }]))
          .length,
        1,
      );
    for (const overrides of [
      { offset: 1 },
      { version: 45 },
      { centralFlags: 0 },
      { localCompressedSize: 9 },
      { localCrc: 9 },
      { attributes: 0x20000000 },
      { attributes: 0x60000000 },
      { attributes: 0xc0000000 },
      { attributes: 8 },
      { attributes: 16 },
      { extra: Buffer.of(0x17, 0, 0, 0) },
      { method: 99 },
      { flags: 4 },
      { flags: 0x20 },
    ])
      assert.throws(() => inspectSuiteZip(zip([{ path: 'suite.json', ...overrides }])));
    const base = zip([{ path: 'suite.json' }, { path: 'empty.ts' }], {
      reverse: true,
      comment: Buffer.from('PK\u0005\u0006 arbitrary comment'),
    });
    assert.equal(inspectSuiteZip(base).length, 2);
    for (const n of [1, 10, 21, 22, 30])
      assert.throws(() => inspectSuiteZip(base.subarray(0, base.length - n)));
    const mismatch = zipBundle(bundle(), { crc: 0 });
    await assert.rejects(() => decodeSuiteArchive(mismatch), /CRC mismatch/);
  });
}
