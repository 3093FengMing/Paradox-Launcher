import { suiteLimits } from './model';
import { DeflateBits, invalidDeflate, readDeflateSymbol } from './deflate-huffman';
import { readDeflateTrees, readDeflateMatch } from './deflate-blocks';
export interface SuiteDeflateProof {
  readonly outputBytes: number;
  readonly endBit: number;
}

/** RFC 1951 count/end proof. No output bytes, history window, or dependency internals. */
export function inspectSuiteDeflate(compressed: Uint8Array, maximumOutputBytes: number): SuiteDeflateProof {
  if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 0) invalidDeflate();
  if (maximumOutputBytes > suiteLimits.total || compressed.length > suiteLimits.total) invalidDeflate();
  const bits = new DeflateBits(compressed);
  let output = 0, final: number;
  const add = (count: number) => {
    if (count > maximumOutputBytes - output) invalidDeflate();
    output += count;
  };
  do {
    final = bits.read(1);
    const type = bits.read(2);
    if (type === 3) invalidDeflate();
    if (type === 0) {
      add(bits.storedBytes());
      continue;
    }
    const { literal, distance } = readDeflateTrees(bits, type);
    for (;;) {
      const code = readDeflateSymbol(bits, literal);
      if (code === 256) break;
      if (code < 256) add(1);
      else add(readDeflateMatch({ bits, distance, code, output }));
    }
  } while (!final);
  if (Math.ceil(bits.position / 8) !== compressed.length) invalidDeflate();
  return { outputBytes: output, endBit: bits.position };
}
