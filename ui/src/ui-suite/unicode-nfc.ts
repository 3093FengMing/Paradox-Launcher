import data from './unicode-nfc-15.1.0.json';
import { wellFormed } from './canonical';
const decompositions = new Map<number, readonly number[]>(
  data.decompositions as [number, number[]][],
);
const combining = new Map<number, number>(data.combining_classes as [number, number][]);
const exclusions = new Set(data.composition_exclusions);
const compositions = new Map<string, number>();
for (const [scalar, parts] of decompositions)
  if (parts.length === 2 && !exclusions.has(scalar))
    compositions.set(`${parts[0]},${parts[1]}`, scalar);
const sBase = 0xac00,
  lBase = 0x1100,
  vBase = 0x1161,
  tBase = 0x11a7,
  tCount = 28,
  nCount = 21 * 28,
  sCount = 19 * 21 * 28;
function compose(a: number, b: number): number | undefined {
  if (a >= lBase && a < lBase + 19 && b >= vBase && b < vBase + 21)
    return sBase + (a - lBase) * nCount + (b - vBase) * tCount;
  if (
    a >= sBase &&
    a < sBase + sCount &&
    (a - sBase) % tCount === 0 &&
    b > tBase &&
    b < tBase + tCount
  )
    return a + b - tBase;
  return compositions.get(`${a},${b}`);
}
/** Unicode 15.1 canonical decomposition, stable CCC ordering and blocked composition. */
export function normalizeSuiteNfc(value: string): string {
  if (!wellFormed(value)) throw new Error('Invalid Unicode scalar sequence');
  const ordered: number[] = [],
    pending: number[] = [];
  const flush = () => {
    pending.sort((a, b) => (combining.get(a) ?? 0) - (combining.get(b) ?? 0));
    for (const cp of pending) ordered.push(cp);
    pending.length = 0;
  };
  for (const scalar of value) {
    const work = [scalar.codePointAt(0)!];
    while (work.length) {
      const cp = work.pop()!,
        s = cp - sBase;
      if (s >= 0 && s < sCount) {
        const trail = s % tCount;
        if (trail) work.push(tBase + trail);
        work.push(vBase + Math.floor((s % nCount) / tCount), lBase + Math.floor(s / nCount));
        continue;
      }
      const parts = decompositions.get(cp);
      if (parts) {
        for (let i = parts.length - 1; i >= 0; i--) work.push(parts[i]);
        continue;
      }
      if ((combining.get(cp) ?? 0) === 0) {
        flush();
        ordered.push(cp);
      } else pending.push(cp);
    }
  }
  flush();
  const result: number[] = [];
  let starter = -1,
    lastClass = 0;
  for (const cp of ordered) {
    const ccc = combining.get(cp) ?? 0,
      combined =
        starter >= 0 && (lastClass < ccc || lastClass === 0)
          ? compose(result[starter], cp)
          : undefined;
    if (combined !== undefined) result[starter] = combined;
    else {
      if (ccc === 0) starter = result.length;
      result.push(cp);
      lastClass = ccc;
    }
  }
  let output = '';
  for (let i = 0; i < result.length; i += 8192)
    output += String.fromCodePoint(...result.slice(i, i + 8192));
  return output;
}
