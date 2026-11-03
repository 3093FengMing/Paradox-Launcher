import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const pages = ['home', 'instances', 'downloads', 'accounts', 'settings', 'logs', 'content'];
export const requiredViews = [
  'layout.shell',
  ...pages.map((p) => `page.${p}`),
  'tool.editor',
  'host.loading',
  'host.error',
  'host.notifications',
  ...[
    'profile',
    'instance-settings',
    'import-instances',
    'remove-profile',
    'close-request',
    'launch-account',
    'login',
    'preset',
    'argument-template',
  ].map((p) => `dialog.${p}`),
];
export function bundle(extraFiles = {}) {
  const files = {
    'Home.tsx': { encoding: 'utf8', text: 'export default () => null; // 世界' },
    ...extraFiles,
  };
  const manifest = {
    kind: 'paradox-ui-suite',
    schema_version: 1,
    api_version: 1,
    id: '9ce69202-3ce7-4be9-a13a-56d75b7100d1',
    version: '1',
    name: '测试',
    views: Object.fromEntries(requiredViews.map((p) => [p, 'Home.tsx'])),
    routes: pages.map((id, order) => ({
      id,
      entry: 'Home.tsx',
      title: id,
      description: '',
      navigation: true,
      startupSelectable: true,
      order,
      icon: null,
    })),
    styles: [],
    files: [],
    overrides: [],
  };
  const out = { manifest, files };
  descriptors(out);
  return out;
}
export function bytes(file) {
  return Buffer.from(
    file.encoding === 'utf8' ? file.text : file.data,
    file.encoding === 'utf8' ? 'utf8' : 'base64',
  );
}
export function descriptors(b) {
  b.manifest.files = Object.entries(b.files).map(([path, f]) => ({
    path,
    kind: f.encoding === 'base64' ? 'asset' : path.split('.').at(-1),
    bytes: bytes(f).length,
    sha256: sha(bytes(f)),
    ...(f.encoding === 'base64' ? { media_type: f.media_type } : {}),
  }));
  return b;
}
export function record(b = bundle(), instance_id = 'fd910be2-a6bc-4976-a397-137ace486aa8') {
  return {
    instance_id,
    manifest: b.manifest,
    parent_snapshot: null,
    overlay: b.files,
    deleted: [],
  };
}
export function library(suites = [record()]) {
  return {
    kind: 'paradox-ui-suite-library',
    schema_version: 1,
    revision: 7,
    active_suite_id: suites[0]?.instance_id ?? null,
    suites,
  };
}
export function crc(bytes) {
  let v = 0xffffffff;
  for (const b of bytes) {
    v ^= b;
    for (let k = 0; k < 8; k++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
  }
  return (v ^ 0xffffffff) >>> 0;
}
// An ordered raw encoder deliberately allows duplicates/contradictions. No keyed ZIP API.
export function zip(entries, options = {}) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.nameBytes ?? e.path),
      data = Buffer.from(e.data ?? []),
      method = e.method ?? 0,
      compressed = Buffer.from(e.compressed ?? (method === 8 ? deflateRawSync(data) : data));
    const flags = e.flags ?? 0x800,
      c = e.crc ?? crc(data),
      size = e.size ?? data.length,
      extra = Buffer.from(e.extra ?? []),
      le = Buffer.from(e.localExtra ?? extra);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(e.version ?? 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(e.localCrc ?? (flags & 8 ? 0 : c), 14);
    local.writeUInt32LE(e.localCompressedSize ?? (flags & 8 ? 0 : compressed.length), 18);
    local.writeUInt32LE(e.localSize ?? (flags & 8 ? 0 : size), 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(le.length, 28);
    const descriptor = flags & 8 ? Buffer.alloc(e.unsigned ? 12 : 16) : Buffer.alloc(0);
    if (descriptor.length) {
      const p = e.unsigned ? 0 : 4;
      if (p) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(c, p);
      descriptor.writeUInt32LE(compressed.length, p + 4);
      descriptor.writeUInt32LE(size, p + 8);
    }
    const cn = Buffer.from(e.centralNameBytes ?? name),
      cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50);
    cd.writeUInt16LE(e.creator ?? 0x314, 4);
    cd.writeUInt16LE(e.version ?? 20, 6);
    cd.writeUInt16LE(e.centralFlags ?? flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(c, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(cn.length, 28);
    cd.writeUInt16LE(extra.length, 30);
    cd.writeUInt32LE(e.attributes ?? 0, 38);
    cd.writeUInt32LE(e.offset ?? offset, 42);
    const chunk = Buffer.concat([local, name, le, compressed, descriptor]);
    locals.push(chunk);
    central.push(Buffer.concat([cd, cn, extra]));
    offset += chunk.length;
  }
  const directory = Buffer.concat(options.reverse ? central.reverse() : central),
    comment = Buffer.from(options.comment ?? []),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, end, comment]);
}
export function zipBundle(b = bundle(), overrides = {}) {
  return zip([
    { path: 'suite.json', data: Buffer.from(JSON.stringify(b.manifest)), ...overrides },
    ...Object.entries(b.files).map(([path, f]) => ({ path, data: bytes(f), ...overrides })),
  ]);
}
