import { suiteLimits } from './model';
export interface SuiteDeflateProof {
  readonly outputBytes: number;
  readonly endBit: number;
}
interface Tree {
  zero: number[];
  one: number[];
  symbol: number[];
}
const fail = (): never => {
  throw new Error('Invalid or over-budget DEFLATE');
};
/** RFC 1951 count/end proof. No output bytes, history window, or dependency internals. */
export function inspectSuiteDeflate(
  compressed: Uint8Array,
  maximumOutputBytes: number,
): SuiteDeflateProof {
  if (
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes < 0 ||
    maximumOutputBytes > suiteLimits.total ||
    compressed.length > suiteLimits.total
  )
    fail();
  let bit = 0,
    output = 0;
  const read = (n: number) => {
    if (bit + n > compressed.length * 8) fail();
    let v = 0;
    for (let i = 0; i < n; i++, bit++)
      v += ((compressed[Math.floor(bit / 8)] >>> (bit % 8)) & 1) * 2 ** i;
    return v;
  };
  const add = (n: number) => {
    if (n > maximumOutputBytes - output) fail();
    output += n;
  };
  const tree = (lengths: number[], kind: 'codes' | 'literal' | 'distance'): Tree => {
    const counts = new Array<number>(16).fill(0);
    for (const n of lengths) {
      if (n < 0 || n > 15) fail();
      if (n) counts[n]++;
    }
    let left = 1;
    for (let n = 1; n <= 15; n++) {
      left = left * 2 - counts[n];
      if (left < 0) fail();
    }
    const used = lengths.filter(Boolean).length;
    if (
      left !== 0 &&
      !(kind !== 'codes' && used === 1 && counts[1] === 1) &&
      !(kind === 'distance' && used === 0)
    )
      fail();
    if (kind === 'literal' && !lengths[256]) fail();
    const next = new Array<number>(16).fill(0);
    let code = 0;
    for (let n = 1; n <= 15; n++) {
      code = (code + counts[n - 1]) * 2;
      next[n] = code;
    }
    const t: Tree = { zero: [-1], one: [-1], symbol: [-1] };
    lengths.forEach((length, symbol) => {
      if (!length) return;
      const c = next[length]++;
      let node = 0;
      for (let k = length - 1; k >= 0; k--) {
        const branch = (c >>> k) & 1 ? t.one : t.zero;
        if (branch[node] === -1) {
          branch[node] = t.symbol.length;
          t.symbol.push(-1);
          t.zero.push(-1);
          t.one.push(-1);
        }
        node = branch[node];
      }
      if (t.symbol[node] !== -1) fail();
      t.symbol[node] = symbol;
    });
    return t;
  };
  const symbol = (t: Tree) => {
    let n = 0;
    for (let length = 0; length <= 15; length++) {
      if (t.symbol[n] !== -1) return t.symbol[n];
      if (length === 15) fail();
      n = (read(1) ? t.one : t.zero)[n];
      if (n === -1) fail();
    }
    return fail();
  };
  const lengthBase = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
  ];
  const lengthExtra = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
  ];
  const distanceBase = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
    3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const distanceExtra = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
  ];
  let final: number;
  do {
    final = read(1);
    const type = read(2);
    if (type === 3) fail();
    if (type === 0) {
      bit = Math.ceil(bit / 8) * 8;
      const len = read(16),
        inverse = read(16);
      if ((len ^ 0xffff) !== inverse || bit + len * 8 > compressed.length * 8) fail();
      add(len);
      bit += len * 8;
      continue;
    }
    let literal: Tree, distance: Tree;
    if (type === 1) {
      literal = tree(
        Array.from({ length: 288 }, (_, s) => (s <= 143 ? 8 : s <= 255 ? 9 : s <= 279 ? 7 : 8)),
        'literal',
      );
      distance = tree(new Array<number>(32).fill(5), 'distance');
    } else {
      const hlit = read(5) + 257,
        hdist = read(5) + 1,
        hclen = read(4) + 4;
      if (hlit > 286) fail();
      // RFC order is explicit; repeats may legally cross the HLIT/HDIST boundary.
      const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const lengths = new Array<number>(19).fill(0);
      for (let i = 0; i < hclen; i++) lengths[codeOrder[i]] = read(3);
      const codes = tree(lengths, 'codes'),
        all: number[] = [];
      while (all.length < hlit + hdist) {
        const c = symbol(codes);
        if (c <= 15) all.push(c);
        else {
          let count = 0,
            value = 0;
          if (c === 16) {
            if (!all.length) fail();
            count = read(2) + 3;
            value = all[all.length - 1];
          } else if (c === 17) {
            count = read(3) + 3;
            value = 0;
          } else if (c === 18) {
            count = read(7) + 11;
            value = 0;
          } else fail();
          if (count > hlit + hdist - all.length) fail();
          for (let i = 0; i < count; i++) all.push(value);
        }
      }
      literal = tree(all.slice(0, hlit), 'literal');
      distance = tree(all.slice(hlit), 'distance');
    }
    for (;;) {
      const c = symbol(literal);
      if (c < 256) {
        add(1);
        continue;
      }
      if (c === 256) break;
      if (c > 285) fail();
      const index = c - 257,
        length = lengthBase[index] + read(lengthExtra[index]),
        d = symbol(distance);
      if (d > 29) fail();
      const back = distanceBase[d] + read(distanceExtra[d]);
      if (back > 32768 || back > output) fail();
      add(length);
    }
  } while (!final);
  if (Math.ceil(bit / 8) !== compressed.length) fail();
  return { outputBytes: output, endBit: bit };
}
