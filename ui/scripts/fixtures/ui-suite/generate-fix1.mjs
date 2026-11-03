// Explicit fixture authoring only. Tests consume checked-in literals and never run this file.
// This serializer/framer uses no product canonical, archive, or digest implementation.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { bundle, bytes, zip } from '../../lib/suite-test-fixtures.mjs';
const dir = new URL('./', import.meta.url);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const compare = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0)),
    y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
const canonical = (v) =>
  Array.isArray(v)
    ? '[' + v.map(canonical).join(',') + ']'
    : v !== null && typeof v === 'object'
      ? '{' +
        Object.keys(v)
          .sort(compare)
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}'
      : JSON.stringify(v);
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const framed = (b) => Buffer.concat([u32(b.length), b]);
function vector(b, boundaryPath) {
  const manifest = Buffer.from(canonical(b.manifest)),
    names = Object.keys(b.files).sort(compare);
  const stream = Buffer.concat([
    Buffer.from('50415241444f582d55492d42554e444c450001', 'hex'),
    framed(manifest),
    u32(names.length),
    ...names.flatMap((p) => [framed(Buffer.from(p)), framed(bytes(b.files[p]))]),
  ]);
  return {
    bundle: b,
    ordered_paths: names,
    manifest_hex: manifest.toString('hex'),
    framed_hex: stream.toString('hex'),
    digest: hash(stream),
    ...(boundaryPath
      ? {
          boundary_path: boundaryPath,
          unframed_file_hex: Buffer.concat([
            Buffer.from(boundaryPath),
            bytes(b.files[boundaryPath]),
          ]).toString('hex'),
          framed_file_hex: Buffer.concat([
            framed(Buffer.from(boundaryPath)),
            framed(bytes(b.files[boundaryPath])),
          ]).toString('hex'),
        }
      : {}),
  };
}
const nonBmp = vector(
  bundle({
    '😀.ts': { encoding: 'utf8', text: 'emoji' },
    '.ts': { encoding: 'utf8', text: 'private-use' },
  }),
);
const pair = [
  vector(bundle({ 'a.ts': { encoding: 'utf8', text: 'x.tsbc' } }), 'a.ts'),
  vector(bundle({ 'a.tsx.ts': { encoding: 'utf8', text: 'bc' } }), 'a.tsx.ts'),
];
function zipVariant(order, time, date) {
  const entries = order.map((p) => ({
    path: p,
    data:
      p === 'suite.json'
        ? Buffer.from(canonical(nonBmp.bundle.manifest))
        : bytes(nonBmp.bundle.files[p]),
    method: 8,
  }));
  const raw = zip(entries);
  let p = 0;
  for (let i = 0; i < entries.length; i++) {
    raw.writeUInt16LE(time, p + 10);
    raw.writeUInt16LE(date, p + 12);
    p += 30 + raw.readUInt16LE(p + 26) + raw.readUInt16LE(p + 28) + raw.readUInt32LE(p + 18);
  }
  for (let i = 0; i < entries.length; i++) {
    raw.writeUInt16LE(time, p + 12);
    raw.writeUInt16LE(date, p + 14);
    p += 46 + raw.readUInt16LE(p + 28) + raw.readUInt16LE(p + 30) + raw.readUInt16LE(p + 32);
  }
  return {
    base64: raw.toString('base64'),
    sha256: hash(raw),
    local_order: order,
    first_dos_time: time,
    dos_date: date,
    digest: nonBmp.digest,
  };
}
const prefix = Buffer.alloc(65531, 0x61);
prefix[prefix.length - 1] = 0xc3;
const suffix = Buffer.from([0x28, 0x20, 0x61]),
  original = Buffer.concat([prefix, suffix]);
const compressed = Buffer.concat([
  Buffer.from([0, 251, 255, 4, 0]),
  prefix,
  Buffer.from([1, 3, 0, 252, 255]),
  suffix,
]);
const invalid = bundle();
invalid.manifest.files.push({
  path: 'split.ts',
  kind: 'ts',
  bytes: original.length,
  sha256: hash(original),
});
const invalidZip = zip([
  { path: 'suite.json', data: Buffer.from(canonical(invalid.manifest)) },
  { path: 'Home.tsx', data: bytes(invalid.files['Home.tsx']) },
  { path: 'split.ts', data: original, method: 8, compressed },
]);
writeFileSync(new URL('split-invalid-utf8.paradox-ui', dir), invalidZip);
const shared = JSON.parse(readFileSync(new URL('format-vectors.json', dir)));
shared.fix1 = {
  non_bmp: nonBmp,
  boundary_pair: pair,
  zip_variants: [
    zipVariant(['suite.json', 'Home.tsx', '😀.ts', '.ts'], 0, 20513),
    zipVariant(['.ts', '😀.ts', 'Home.tsx', 'suite.json'], 25692, 23905),
  ],
  split_utf8: {
    archive_file: 'split-invalid-utf8.paradox-ui',
    archive_sha256: hash(invalidZip),
    source_path: 'split.ts',
    source_bytes: original.length,
    source_sha256: hash(original),
    source_recipe: { ascii_a_count: 65530, suffix_hex: 'c3282061' },
    output_chunks: [
      { length: 65531, first: 97, last: 195 },
      { length: 3, first: 40, last: 97 },
    ],
  },
};
writeFileSync(new URL('format-vectors.json', dir), JSON.stringify(shared, null, 2) + '\n');
// One IFD0 SHORT Orientation=6 entry; the JPEG SOF stays 3×2.
const jpeg = readFileSync(new URL('pixel.jpg', dir)),
  app1 = Buffer.from(
    'ffe1002245786966000049492a0008000000010012010300010000000600000000000000',
    'hex',
  );
const oriented = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
writeFileSync(new URL('oriented-6.jpg', dir), oriented);
const assets = JSON.parse(readFileSync(new URL('browser-assets.json', dir)));
const item = { name: 'oriented-6.jpg', media: 'image/jpeg', data: oriented.toString('base64') };
const prior = assets.findIndex((f) => f.name === item.name);
if (prior < 0) assets.push(item);
else assets[prior] = item;
writeFileSync(new URL('browser-assets.json', dir), JSON.stringify(assets, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      non_bmp_digest: nonBmp.digest,
      boundary_digests: pair.map((v) => v.digest),
      split_zip_bytes: invalidZip.length,
      split_zip_sha256: hash(invalidZip),
      oriented_jpeg_bytes: oriented.length,
      oriented_jpeg_sha256: hash(oriented),
    },
    null,
    2,
  ),
);
