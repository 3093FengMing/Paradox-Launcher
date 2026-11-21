export interface DeflateTree { zero: number[]; one: number[]; symbol: number[] }
type TreeKind = 'codes' | 'literal' | 'distance';
export const invalidDeflate = (): never => { throw new Error('Invalid or over-budget DEFLATE'); };

/** RFC 1951 fields are least-significant-bit first and bounded by the exact input. */
export class DeflateBits {
  position = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(count: number): number {
    if (this.position + count > this.bytes.length * 8) invalidDeflate();
    let value = 0;
    for (let i = 0; i < count; i++, this.position++)
      value += ((this.bytes[Math.floor(this.position / 8)] >>> (this.position % 8)) & 1) * 2 ** i;
    return value;
  }
  storedBytes(): number {
    this.position = Math.ceil(this.position / 8) * 8;
    const length = this.read(16), inverse = this.read(16);
    if ((length ^ 0xffff) !== inverse || this.position + length * 8 > this.bytes.length * 8)
      invalidDeflate();
    this.position += length * 8;
    return length;
  }
}

/** Incomplete trees are legal only for a single data symbol or an unused distance alphabet. */
function countLengths(lengths: number[], kind: TreeKind): number[] {
  const counts = new Array<number>(16).fill(0);
  for (const length of lengths) {
    if (length < 0 || length > 15) invalidDeflate();
    if (length) counts[length]++;
  }
  let left = 1;
  for (let length = 1; length <= 15; length++) {
    left = left * 2 - counts[length];
    if (left < 0) invalidDeflate();
  }
  const used = lengths.filter(Boolean).length;
  const single = kind !== 'codes' && used === 1 && counts[1] === 1;
  const unusedDistance = kind === 'distance' && used === 0;
  if (left !== 0 && !single && !unusedDistance) invalidDeflate();
  if (kind === 'literal' && !lengths[256]) invalidDeflate();
  return counts;
}

/** Canonical code assignment preserves RFC bit order; leaves reject duplicate symbols. */
function insertCode(tree: DeflateTree, code: number, entry: { length: number; symbol: number }): void {
  let node = 0;
  for (let bit = entry.length - 1; bit >= 0; bit--) {
    const branch = (code >>> bit) & 1 ? tree.one : tree.zero;
    if (branch[node] === -1) {
      branch[node] = tree.symbol.length;
      tree.symbol.push(-1); tree.zero.push(-1); tree.one.push(-1);
    }
    node = branch[node];
  }
  if (tree.symbol[node] !== -1) invalidDeflate();
  tree.symbol[node] = entry.symbol;
}

export function createDeflateTree(lengths: number[], kind: TreeKind): DeflateTree {
  const counts = countLengths(lengths, kind), next = new Array<number>(16).fill(0);
  let code = 0;
  for (let length = 1; length <= 15; length++) {
    code = (code + counts[length - 1]) * 2;
    next[length] = code;
  }
  const tree: DeflateTree = { zero: [-1], one: [-1], symbol: [-1] };
  lengths.forEach((length, symbol) => {
    if (length) insertCode(tree, next[length]++, { length, symbol });
  });
  return tree;
}

/** Decode at most fifteen edges; an empty/missing branch cannot consume unbounded input. */
export function readDeflateSymbol(bits: DeflateBits, tree: DeflateTree): number {
  let node = 0;
  for (let length = 0; length <= 15; length++) {
    if (tree.symbol[node] !== -1) return tree.symbol[node];
    if (length === 15) invalidDeflate();
    node = (bits.read(1) ? tree.one : tree.zero)[node];
    if (node === -1) invalidDeflate();
  }
  return invalidDeflate();
}
