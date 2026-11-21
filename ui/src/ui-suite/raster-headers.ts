interface Dimensions { width: number; height: number }
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const pngDepths: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
};
const jpegFrames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** PNG admission checks the fixed IHDR before any decoder sees compressed pixels. */
export function inspectPng(bytes: Uint8Array): Dimensions {
  const data = view(bytes);
  if (bytes.length < 33 || [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n))
    throw new Error('Invalid PNG header');
  if (data.getUint32(8) !== 13 || data.getUint32(12) !== 0x49484452)
    throw new Error('Invalid PNG header');
  if (!pngDepths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1)
    throw new Error('Invalid PNG IHDR fields');
  return { width: data.getUint32(16), height: data.getUint32(20) };
}

/** Walk bounded JPEG segments until the first supported frame; scan data is never parsed. */
export function inspectJpeg(bytes: Uint8Array): Dimensions {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216)
    throw new Error('Invalid JPEG header');
  const data = view(bytes);
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position++] !== 255) throw new Error('Invalid JPEG marker');
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (position + 2 > bytes.length) break;
    const size = data.getUint16(position);
    if (size < 2 || position + size > bytes.length) throw new Error('Truncated JPEG segment');
    if (jpegFrames.has(marker)) {
      if (size < 8) throw new Error('Invalid JPEG frame');
      return { height: data.getUint16(position + 3), width: data.getUint16(position + 5) };
    }
    position += size;
  }
  return { width: 0, height: 0 };
}

/** VP8X dimensions describe the canvas and take precedence over frame dimensions. */
function webpExtended(bytes: Uint8Array, start: number, size: number): Dimensions {
  if (size !== 10 || bytes[start] & 0xc1 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3])
    throw new Error('Invalid WebP extended header');
  const uint24 = (offset: number) => bytes[offset] + 256 * bytes[offset + 1] + 65536 * bytes[offset + 2];
  return { width: 1 + uint24(start + 4), height: 1 + uint24(start + 7) };
}

function webpFrame(bytes: Uint8Array, start: number, size: number): Dimensions {
  if (size < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a)
    throw new Error('Invalid WebP frame');
  const data = view(bytes);
  return { width: data.getUint16(start + 6, true) & 0x3fff, height: data.getUint16(start + 8, true) & 0x3fff };
}

function webpLossless(bytes: Uint8Array, start: number, size: number): Dimensions {
  if (size < 5 || bytes[start] !== 0x2f) throw new Error('Invalid WebP lossless');
  const bits = view(bytes).getUint32(start + 1, true);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** Validate RIFF size and every padded chunk boundary, including chunks after the frame. */
export function inspectWebp(bytes: Uint8Array): Dimensions {
  const data = view(bytes);
  if (bytes.length < 20 || data.getUint32(0) !== 0x52494646 || data.getUint32(8) !== 0x57454250)
    throw new Error('Invalid WebP container');
  if (data.getUint32(4, true) !== bytes.length - 8) throw new Error('Invalid WebP container');
  let position = 12, dimensions: Dimensions = { width: 0, height: 0 };
  while (position + 8 <= bytes.length) {
    const tag = data.getUint32(position), size = data.getUint32(position + 4, true), start = position + 8;
    if (start + size > bytes.length) throw new Error('Truncated WebP chunk');
    if (tag === 0x56503858) dimensions = webpExtended(bytes, start, size);
    else if (tag === 0x56503820 && !dimensions.width) dimensions = webpFrame(bytes, start, size);
    else if (tag === 0x5650384c && !dimensions.width) dimensions = webpLossless(bytes, start, size);
    position = start + size + (size % 2);
  }
  if (position !== bytes.length) throw new Error('Invalid WebP end');
  return dimensions;
}
