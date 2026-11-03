import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateRawSync, constants } from 'node:zlib';
import { loadApp } from './lib/hook-test-host.mjs';
import {
  bundle,
  descriptors,
  record,
  library,
  zip,
  zipBundle,
  bytes,
  crc,
  sha,
} from './lib/suite-test-fixtures.mjs';
import { fixed, dynamic } from './lib/suite-deflate-vectors.mjs';
import { checkArchiveOutputBoundary } from './lib/suite-archive-output-check.mjs';
assert.ok(
  existsSync(new URL('../src/ui-suite/bundle.ts', import.meta.url)),
  'Task 6 strict bundle model must exist',
);
const app = loadApp(new Map(), { isolateCustomization: false });
const {
  parseSuiteBundle,
  parseSuiteLibrary,
  materializeSuite,
  bundleDigest,
  validateSuiteBundle,
  validateSuiteLibrary,
  normalizeDraftBundle,
} = app('ui-suite/bundle.ts');
const { validateSuiteLibraryData } = app('ui-suite/bundle.ts');
const { canonicalSuiteJson } = app('ui-suite/canonical.ts');
const { resolveSuitePath, suitePathCollisionKey } = app('ui-suite/paths.ts');
const { inspectSuiteDeflate } = app('ui-suite/deflate-structure.ts');
const { inspectSuiteZip } = app('ui-suite/archive-structure.ts');
const { decodeSuiteArchive, encodeSuiteArchive } = app('ui-suite/archive.ts');
const { inspectSuiteAsset, validateSuiteAsset } = app('ui-suite/assets.ts');
const { checkRasterDimensions } = app('ui-suite/asset-raster.ts');
const plain = (x) => JSON.parse(JSON.stringify(x));
const sharedVectors = JSON.parse(
  readFileSync(new URL('./fixtures/ui-suite/format-vectors.json', import.meta.url)),
);
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
  const require = createRequire(new URL('../package.json', import.meta.url)),
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
  const raw = readFileSync(new URL('./fixtures/ui-suite/' + v.archive_file, import.meta.url));
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
  const l = library([record(p), { ...child, instance_id: 'fd910be2-a6bc-4976-a397-137ace486aa9' }]);
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
await test('paths_and_actual_inflate_budget: exact limits, Unicode and root containment', () => {
  const f = new Map([
    ['Home.tsx', {}],
    ['a/index.ts', {}],
    ['a.ts', {}],
    ['a.tsx', {}],
  ]);
  assert.equal(resolveSuitePath('x.ts', './Home', f), 'Home.tsx');
  assert.throws(() => resolveSuitePath('x.ts', './a', f));
  for (const p of [
    '../outside.ts',
    '/Home.tsx',
    'C:/Home.tsx',
    './CON.ts',
    './e\u0301.ts',
    './x?.ts',
  ])
    assert.throws(() => resolveSuitePath('x.ts', p, f), p);
  for (const [a, b] of [
    ['A', 'a'],
    ['Σ', 'ς'],
    ['ẞ', 'ß'],
    ['𐐀', '𐐨'],
  ])
    assert.equal(suitePathCollisionKey(a), suitePathCollisionKey(b));
  for (const [a, b] of [
    ['ß', 'ss'],
    ['İ', 'i'],
    ['ı', 'i'],
  ])
    assert.notEqual(suitePathCollisionKey(a), suitePathCollisionKey(b));
});
await test('canonical domain rejects accessors, sparse arrays, hostile extensions without invoking them', () => {
  let calls = 0;
  for (const value of [
    {
      get a() {
        calls++;
        return 1;
      },
    },
    Array(1),
    [undefined],
    { a: NaN },
    { a: 1.5 },
    { a: 9007199254740992 },
    { a: '\ud800' },
    new Date(),
    Object.assign([], { bad: 1 }),
  ])
    assert.throws(() => canonicalSuiteJson(value));
  assert.equal(calls, 0);
  const cycle = {};
  cycle.x = cycle;
  assert.throws(() => canonicalSuiteJson(cycle));
  assert.equal(canonicalSuiteJson(-0), '0');
  assert.equal(
    canonicalSuiteJson({ 2: 2, 10: 10, nested: { '😀': 2, '\ue000': 1 } }),
    '{"10":10,"2":2,"nested":{"":1,"😀":2}}',
  );
});
await test('strict schema, descriptors, hostile keys, references and original byte limits', () => {
  for (const mutate of [
    (b) => (b.bad = 1),
    (b) => (b.manifest.schema_version = 2),
    (b) => (b.manifest.id = 'X'),
    (b) => (b.manifest.id += '\n'),
    (b) => (b.manifest.files[0].sha256 += '\n'),
    (b) => (b.manifest.views['extra\n'] = 'Home.tsx'),
    (b) => (b.manifest.routes[0].order = 0.5),
    (b) => (b.manifest.routes[0].order = 1000001),
    (b) => (b.manifest.views['page.home'] = 'Other.tsx'),
    (b) => delete b.manifest.views['tool.editor'],
    (b) => b.manifest.files[0].bytes++,
    (b) => (b.files['home.tsx'] = b.files['Home.tsx']),
    (b) => (b.files['suite.json'] = { encoding: 'utf8', text: '' }),
    (b) => (b.files['CON.ts'] = { encoding: 'utf8', text: '' }),
    (b) =>
      (b.manifest.overrides = [
        {
          selector: { kind: 'type', target: 'x', owner: 1 },
          enabled: true,
          stylesheet: null,
          entry: null,
        },
      ]),
  ]) {
    const b = bundle();
    mutate(b);
    assert.throws(() => parseSuiteBundle(b));
  }
  const b = bundle({ 'a.ts': { encoding: 'utf8', text: 'é'.repeat(524288) } });
  assert.doesNotThrow(() => parseSuiteBundle(b));
  b.files['a.ts'].text += 'a';
  descriptors(b);
  assert.throws(() => parseSuiteBundle(b));
});
await test('sync parse is not SHA/decoder acceptance; async owns exact candidate', async () => {
  const b = bundle();
  b.manifest.files[0].sha256 = '0'.repeat(64);
  parseSuiteBundle(b);
  await assert.rejects(() => validateSuiteBundle(b));
  await assert.rejects(() => bundleDigest(b));
  const candidate = bundle(),
    expected = plain(candidate);
  const pending = validateSuiteBundle(candidate);
  candidate.files['Home.tsx'].text = 'changed';
  assert.deepEqual(plain(await pending), expected);
  const draft = bundle();
  draft.files['Home.tsx'].text = 'new';
  assert.equal((await normalizeDraftBundle(draft)).manifest.files[0].bytes, 3);
});
await test('DEFLATE proves stored/fixed/dynamic/legal-empty and rejects end/count corruption before inflate', () => {
  for (const data of [Buffer.alloc(0), Buffer.from('hello'), Buffer.from('abc'.repeat(10000))])
    for (const options of [{ level: 0 }, { strategy: constants.Z_FIXED }, { level: 9 }]) {
      const raw = deflateRawSync(data, options);
      assert.equal(inspectSuiteDeflate(raw, data.length).outputBytes, data.length);
      if (data.length) assert.throws(() => inspectSuiteDeflate(raw, data.length - 1));
      assert.throws(() => inspectSuiteDeflate(Buffer.concat([raw, Buffer.from([0])]), data.length));
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
    const b = bundle({ 'x.png': { encoding: 'base64', media_type: 'image/png', data: spelling } });
    assert.throws(() => parseSuiteBundle(b));
  }
});
await test('shared literal canonical/framing/fold fixtures and digest distinction', async () => {
  const v = JSON.parse(
    readFileSync(new URL('./fixtures/ui-suite/format-vectors.json', import.meta.url)),
  );
  assert.equal(canonicalSuiteJson(v.canonical.input), v.canonical.expected);
  assert.equal(
    Buffer.from(canonicalSuiteJson(v.canonical.input)).toString('hex'),
    v.canonical.utf8_hex,
  );
  assert.equal(Buffer.from(canonicalSuiteJson(v.bundle.manifest)).toString('hex'), v.manifest_hex);
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
  const require = createRequire(new URL('../package.json', import.meta.url)),
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
  const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url)),
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
  const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url));
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
    inspectSuiteZip(zip([{ path: 'suite.json' }, { path: 'x', nameBytes: Buffer.of(0xc0, 0xaf) }])),
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
  const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url)),
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
  const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url));
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
await test('checked-in raw ZIP/DEFLATE vectors and fflate completion characterization', () => {
  const v = JSON.parse(
    readFileSync(new URL('./fixtures/ui-suite/archive-vectors.json', import.meta.url)),
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
  const require = createRequire(new URL('../package.json', import.meta.url)),
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
