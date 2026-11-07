/** Package-private exact JSON/byte primitives shared by format and storage consumers. */
export function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = value.charCodeAt(++i);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function compareCodePoints(a: string, b: string): number {
  const x = a[Symbol.iterator](),
    y = b[Symbol.iterator]();
  for (;;) {
    const p = x.next(),
      q = y.next();
    if (p.done || q.done) return p.done ? (q.done ? 0 : -1) : 1;
    const d = p.value.codePointAt(0)! - q.value.codePointAt(0)!;
    if (d) return d;
  }
}
export function canonicalSuiteJson(value: unknown): string {
  const active = new Set<object>();
  function emit(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) throw new Error('Invalid suite number');
      return String(v === 0 ? 0 : v);
    }
    if (typeof v === 'string') {
      if (!wellFormed(v)) throw new Error('Invalid Unicode');
      return JSON.stringify(v);
    }
    if (typeof v !== 'object' || active.has(v)) throw new Error('Invalid suite JSON');
    const array = Array.isArray(v);
    const prototype: unknown = Object.getPrototypeOf(v);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new Error('Invalid suite object');
    active.add(v);
    try {
      const keys = Reflect.ownKeys(v);
      if (keys.some((k) => typeof k !== 'string')) throw new Error('Symbol suite key');
      if (array) {
        if (keys.length !== v.length + 1) throw new Error('Sparse or extended array');
        const out: string[] = [];
        for (let i = 0; i < v.length; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d || !('value' in d) || !d.enumerable) throw new Error('Invalid suite array');
          out.push(emit(d.value));
        }
        return '[' + out.join(',') + ']';
      }
      const out: string[] = [];
      for (const k of (keys as string[]).sort(compareCodePoints)) {
        const d = Object.getOwnPropertyDescriptor(v, k)!;
        if (!('value' in d) || !d.enumerable) throw new Error('Invalid suite property');
        out.push(emit(k) + ':' + emit(d.value));
      }
      return '{' + out.join(',') + '}';
    } finally {
      active.delete(v);
    }
  }
  return emit(value);
}
export const utf8 = (value: string): Uint8Array => {
  if (!wellFormed(value)) throw new Error('Invalid Unicode');
  return new TextEncoder().encode(value);
};
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 32768)
    out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
const base64Values = new Int16Array(128).fill(-1);
for (const [index, char] of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].entries())
  base64Values[char.charCodeAt(0)] = index;
export function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0) throw new Error('Invalid base64');
  if (!value.length) return new Uint8Array();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const last = i === value.length - 4;
    const a = base64Values[value.charCodeAt(i)] ?? -1,
      b = base64Values[value.charCodeAt(i + 1)] ?? -1,
      c = last && padding === 2 ? 0 : (base64Values[value.charCodeAt(i + 2)] ?? -1),
      d = last && padding ? 0 : (base64Values[value.charCodeAt(i + 3)] ?? -1);
    if ((a | b | c | d) < 0) throw new Error('Invalid base64');
    // Unused low bits must be zero: exactly the condition enforced by re-encoding.
    if (last && ((padding === 2 && (b & 15)) || (padding === 1 && (c & 3))))
      throw new Error('Noncanonical base64');
    bytes[offset++] = (a << 2) | (b >> 4);
    if (!last || padding < 2) bytes[offset++] = (b << 4) | (c >> 2);
    if (!last || !padding) bytes[offset++] = (c << 6) | d;
  }
  return bytes;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
