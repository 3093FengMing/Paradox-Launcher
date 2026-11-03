// Independent RFC bit writer for narrow malformed trees; never used by product code.
export function bits() {
  const out = [];
  let position = 0;
  return {
    write(value, count) {
      for (let i = 0; i < count; i++, position++) {
        const index = Math.floor(position / 8);
        out[index] = (out[index] ?? 0) | (((value >>> i) & 1) << (position % 8));
      }
    },
    bytes() {
      return Uint8Array.from(out);
    },
  };
}
export function codes(lengths) {
  const count = Array(16).fill(0),
    next = Array(16).fill(0);
  for (const n of lengths) if (n) count[n]++;
  let c = 0;
  for (let n = 1; n < 16; n++) {
    c = (c + count[n - 1]) * 2;
    next[n] = c;
  }
  return lengths.map((n) => {
    let value = next[n]++,
      reversed = 0;
    for (let k = 0; k < n; k++) {
      reversed = reversed * 2 + (value & 1);
      value >>>= 1;
    }
    return [reversed, n];
  });
}
export function fixed(symbols, distances = []) {
  const w = bits();
  w.write(3, 3);
  const lit = codes(
    Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
  );
  const dist = codes(Array(32).fill(5));
  let d = 0;
  for (const s of symbols) {
    w.write(...lit[s]);
    if (s >= 257 && s <= 264) w.write(...dist[distances[d++] ?? 0]);
  }
  return w.bytes();
}
export function dynamic(kind = 'empty') {
  const w = bits();
  w.write(5, 3);
  w.write(0, 5);
  w.write(0, 5);
  w.write(14, 4);
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15],
    lengths = Array(19).fill(0);
  if (kind === 'oversubscribed') {
    lengths[0] = lengths[1] = lengths[16] = 1;
  } else if (kind === 'incomplete') {
    lengths[0] = 1;
  } else if (kind === 'predecessor') {
    lengths[0] = lengths[16] = 1;
  } else if (kind === 'overflow') {
    lengths[0] = lengths[18] = 1;
  } else lengths[0] = lengths[1] = 1;
  for (let i = 0; i < 18; i++) w.write(lengths[order[i]], 3);
  const c = codes(lengths);
  if (kind === 'predecessor') {
    w.write(...c[16]);
    w.write(0, 2);
  } else if (kind === 'overflow') {
    w.write(...c[18]);
    w.write(127, 7);
    w.write(...c[18]);
    w.write(127, 7);
  } else if (!['oversubscribed', 'incomplete'].includes(kind)) {
    for (let i = 0; i < 258; i++) w.write(...c[kind !== 'missing-eob' && i === 256 ? 1 : 0]);
    w.write(0, 1);
  }
  return w.bytes();
}
