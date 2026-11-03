import { decodeUtf8 } from './canonical';
import { uniqueSuitePaths } from './paths';
import { suiteLimits as L } from './model';
export { inspectSuiteDeflate } from './deflate-structure';
export type { SuiteDeflateProof } from './deflate-structure';
export interface SuiteZipEntry {
  readonly path: string;
  readonly method: 0 | 8;
  readonly dataStart: number;
  readonly dataEnd: number;
  readonly claimedBytes: number;
  readonly crc32: number;
}
export function suiteCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const fail = (): never => {
  throw new Error('Invalid suite ZIP metadata');
};
export function inspectSuiteZip(bytes: Uint8Array): readonly SuiteZipEntry[] {
  if (bytes.length > L.total || bytes.length < 22) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (p: number, n: number) => {
    if (
      !Number.isSafeInteger(p) ||
      !Number.isSafeInteger(n) ||
      p < 0 ||
      n < 0 ||
      p > bytes.length - n
    )
      fail();
  };
  const u16 = (p: number) => {
    range(p, 2);
    return view.getUint16(p, true);
  };
  const u32 = (p: number) => {
    range(p, 4);
    return view.getUint32(p, true);
  };
  const same = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => b[i] === v);
  function filename(raw: Uint8Array, flags: number): string {
    if (!(flags & 0x800) && raw.some((v) => v > 127)) fail();
    return decodeUtf8(raw);
  }
  function extras(p: number, n: number, raw: Uint8Array, name: string): void {
    range(p, n);
    const end = p + n,
      seen = new Set<number>();
    while (p < end) {
      if (p + 4 > end) fail();
      const id = u16(p),
        length = u16(p + 2);
      p += 4;
      if (p + length > end || seen.has(id)) fail();
      seen.add(id);
      if (id === 1 || (id >= 0x14 && id <= 0x19) || id === 0x9901) fail();
      if (id === 0x7075) {
        if (
          length < 5 ||
          bytes[p] !== 1 ||
          u32(p + 1) !== suiteCrc32(raw) ||
          decodeUtf8(bytes.subarray(p + 5, p + length)) !== name
        )
          fail();
      }
      p += length;
    }
  }
  function layout(end: number): SuiteZipEntry[] {
    if (
      u16(end + 4) ||
      u16(end + 6) ||
      u16(end + 8) !== u16(end + 10) ||
      u16(end + 10) > L.files + 1 ||
      end + 22 + u16(end + 20) !== bytes.length
    )
      fail();
    const count = u16(end + 10),
      size = u32(end + 12),
      start = u32(end + 16);
    if (size === 0xffffffff || start === 0xffffffff || start + size !== end) fail();
    range(start, size);
    let p = start;
    const entries: {
      entry: SuiteZipEntry;
      offset: number;
      name: Uint8Array;
      flags: number;
      version: number;
      compressed: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
      if (p + 46 > end || u32(p) !== 0x02014b50) fail();
      const version = u16(p + 6),
        flags = u16(p + 8),
        method = u16(p + 10),
        crc = u32(p + 16),
        compressed = u32(p + 20),
        claimed = u32(p + 24),
        nameLength = u16(p + 28),
        extraLength = u16(p + 30),
        commentLength = u16(p + 32),
        disk = u16(p + 34),
        attributes = u32(p + 38),
        offset = u32(p + 42);
      const next = p + 46 + nameLength + extraLength + commentLength;
      if (
        next > end ||
        disk ||
        [compressed, claimed, offset].includes(0xffffffff) ||
        (method !== 0 && method !== 8) ||
        flags & ~0x80e ||
        (method === 0 && flags & 6) ||
        ![10, 20].includes(version) ||
        ((method === 8 || flags & 8) && version < 20)
      )
        fail();
      const type = (attributes >>> 16) & 0xf000;
      if (attributes & 0x18 || (type !== 0 && type !== 0x8000)) fail();
      const raw = bytes.subarray(p + 46, p + 46 + nameLength),
        name = filename(raw, flags);
      extras(p + 46 + nameLength, extraLength, raw, name);
      entries.push({
        entry: {
          path: name,
          method: method as 0 | 8,
          dataStart: 0,
          dataEnd: 0,
          claimedBytes: claimed,
          crc32: crc,
        },
        offset,
        name: raw,
        flags,
        version,
        compressed,
      });
      p = next;
    }
    if (p !== end) fail();
    uniqueSuitePaths(
      entries.map((e) => e.entry.path),
      true,
    );
    if (entries.filter((e) => e.entry.path === 'suite.json').length !== 1) fail();
    entries.sort((a, b) => a.offset - b.offset);
    let local = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i],
        s = e.offset,
        boundary = entries[i + 1]?.offset ?? start;
      if (
        s !== local ||
        s + 30 > boundary ||
        u32(s) !== 0x04034b50 ||
        u16(s + 4) !== e.version ||
        u16(s + 6) !== e.flags ||
        u16(s + 8) !== e.entry.method
      )
        fail();
      const nameLength = u16(s + 26),
        extraLength = u16(s + 28),
        dataStart = s + 30 + nameLength + extraLength,
        dataEnd = dataStart + e.compressed;
      if (dataStart > boundary || dataEnd > boundary) fail();
      const raw = bytes.subarray(s + 30, s + 30 + nameLength);
      if (!same(raw, e.name)) fail();
      extras(s + 30 + nameLength, extraLength, raw, e.entry.path);
      const actual = [e.entry.crc32, e.compressed, e.entry.claimedBytes],
        localValues = [u32(s + 14), u32(s + 18), u32(s + 22)];
      if (e.flags & 8) {
        if (localValues.some((v, k) => v !== 0 && v !== actual[k])) fail();
        const length = boundary - dataEnd;
        if (length !== 12 && length !== 16) fail();
        let d = dataEnd;
        if (length === 16) {
          if (u32(d) !== 0x08074b50) fail();
          d += 4;
        }
        if ([u32(d), u32(d + 4), u32(d + 8)].some((v, k) => v !== actual[k])) fail();
      } else if (localValues.some((v, k) => v !== actual[k]) || dataEnd !== boundary) fail();
      if (e.entry.method === 0 && e.compressed !== e.entry.claimedBytes) fail();
      e.entry = { ...e.entry, dataStart, dataEnd };
      local = boundary;
    }
    if (local !== start) fail();
    return entries.map((e) => e.entry);
  }
  let result: SuiteZipEntry[] | undefined;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (u32(p) !== 0x06054b50) continue;
    let candidate: SuiteZipEntry[];
    try {
      candidate = layout(p);
    } catch {
      continue;
    }
    if (result) fail();
    result = candidate;
  }
  return result ?? fail();
}
