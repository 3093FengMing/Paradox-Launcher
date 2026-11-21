import { createDeflateTree, invalidDeflate, readDeflateSymbol } from './deflate-huffman';
import type { DeflateBits, DeflateTree } from './deflate-huffman';
const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const codeOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function readRepeat(bits: DeflateBits, code: number, lengths: number[]): { count: number; value: number } {
  if (code === 16) {
    if (!lengths.length) invalidDeflate();
    return { count: bits.read(2) + 3, value: lengths[lengths.length - 1] };
  }
  if (code === 17) return { count: bits.read(3) + 3, value: 0 };
  if (code === 18) return { count: bits.read(7) + 11, value: 0 };
  return invalidDeflate();
}

/** Repeats may cross HLIT/HDIST; expansion is bounded by their combined alphabet length. */
function readDynamicLengths(bits: DeflateBits, total: number, codes: DeflateTree): number[] {
  const lengths: number[] = [];
  while (lengths.length < total) {
    const code = readDeflateSymbol(bits, codes);
    if (code <= 15) { lengths.push(code); continue; }
    const repeat = readRepeat(bits, code, lengths);
    if (repeat.count > total - lengths.length) invalidDeflate();
    for (let i = 0; i < repeat.count; i++) lengths.push(repeat.value);
  }
  return lengths;
}

function fixedLiteralLength(symbol: number): number {
  if (symbol <= 143) return 8;
  if (symbol <= 255) return 9;
  return symbol <= 279 ? 7 : 8;
}

/** Build fixed or dynamic alphabets; all structural tree checks share one constructor. */
export function readDeflateTrees(bits: DeflateBits, type: number): { literal: DeflateTree; distance: DeflateTree } {
  if (type === 1) return {
    literal: createDeflateTree(Array.from({ length: 288 }, (_, symbol) => fixedLiteralLength(symbol)), 'literal'),
    distance: createDeflateTree(new Array<number>(32).fill(5), 'distance'),
  };
  const literalCount = bits.read(5) + 257, distanceCount = bits.read(5) + 1, codeCount = bits.read(4) + 4;
  if (literalCount > 286) invalidDeflate();
  const codeLengths = new Array<number>(19).fill(0);
  for (let i = 0; i < codeCount; i++) codeLengths[codeOrder[i]] = bits.read(3);
  const codes = createDeflateTree(codeLengths, 'codes');
  const lengths = readDynamicLengths(bits, literalCount + distanceCount, codes);
  return {
    literal: createDeflateTree(lengths.slice(0, literalCount), 'literal'),
    distance: createDeflateTree(lengths.slice(literalCount), 'distance'),
  };
}

/** Validate backwards history availability without allocating or copying output bytes. */
export function readDeflateMatch(input: { bits: DeflateBits; distance: DeflateTree; code: number; output: number }): number {
  const { bits, distance, code, output } = input;
  if (code > 285) invalidDeflate();
  const index = code - 257, length = lengthBase[index] + bits.read(lengthExtra[index]);
  const distanceCode = readDeflateSymbol(bits, distance);
  if (distanceCode > 29) invalidDeflate();
  const back = distanceBase[distanceCode] + bits.read(distanceExtra[distanceCode]);
  if (back > 32768 || back > output) invalidDeflate();
  return length;
}
