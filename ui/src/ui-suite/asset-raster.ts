import { suiteLimits as L } from './model';
export function checkRasterDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > L.dimension ||
    height > L.dimension ||
    width * height > L.pixels
  )
    throw new Error('Invalid suite raster dimensions');
}
export function inspectRaster(media: string, b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0,
    height = 0;
  if (media === 'image/png') {
    if (
      b.length < 33 ||
      [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => b[i] !== n) ||
      v.getUint32(8) !== 13 ||
      v.getUint32(12) !== 0x49484452
    )
      throw new Error('Invalid PNG header');
    const depths: Record<number, number[]> = {
      0: [1, 2, 4, 8, 16],
      2: [8, 16],
      3: [1, 2, 4, 8],
      4: [8, 16],
      6: [8, 16],
    };
    if (!depths[b[25]]?.includes(b[24]) || b[26] !== 0 || b[27] !== 0 || b[28] > 1)
      throw new Error('Invalid PNG IHDR fields');
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (media === 'image/jpeg') {
    if (b.length < 4 || b[0] !== 255 || b[1] !== 216) throw new Error('Invalid JPEG header');
    let p = 2;
    while (p < b.length) {
      if (b[p++] !== 255) throw new Error('Invalid JPEG marker');
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > b.length) break;
      const n = v.getUint16(p);
      if (n < 2 || p + n > b.length) throw new Error('Truncated JPEG segment');
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (n < 8) throw new Error('Invalid JPEG frame');
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        break;
      }
      p += n;
    }
  } else {
    if (
      b.length < 20 ||
      v.getUint32(0) !== 0x52494646 ||
      v.getUint32(8) !== 0x57454250 ||
      v.getUint32(4, true) !== b.length - 8
    )
      throw new Error('Invalid WebP container');
    let p = 12;
    while (p + 8 <= b.length) {
      const tag = v.getUint32(p),
        size = v.getUint32(p + 4, true),
        s = p + 8;
      if (s + size > b.length) throw new Error('Truncated WebP chunk');
      if (tag === 0x56503858) {
        if (size !== 10 || b[s] & 0xc1 || b[s + 1] || b[s + 2] || b[s + 3])
          throw new Error('Invalid WebP extended header');
        width = 1 + b[s + 4] + 256 * b[s + 5] + 65536 * b[s + 6];
        height = 1 + b[s + 7] + 256 * b[s + 8] + 65536 * b[s + 9];
      } else if (tag === 0x56503820 && !width) {
        if (size < 10 || b[s + 3] !== 0x9d || b[s + 4] !== 1 || b[s + 5] !== 0x2a)
          throw new Error('Invalid WebP frame');
        width = v.getUint16(s + 6, true) & 0x3fff;
        height = v.getUint16(s + 8, true) & 0x3fff;
      } else if (tag === 0x5650384c && !width) {
        if (size < 5 || b[s] !== 0x2f) throw new Error('Invalid WebP lossless');
        const bits = v.getUint32(s + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      p = s + size + (size % 2);
    }
    if (p !== b.length) throw new Error('Invalid WebP end');
  }
  checkRasterDimensions(width, height);
  return { width, height };
}
export async function validateRaster(media: string, bytes: Uint8Array): Promise<void> {
  inspectRaster(media, bytes);
  if (typeof createImageBitmap !== 'function') throw new Error('Raster decoder unavailable');
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: media }));
  try {
    checkRasterDimensions(bitmap.width, bitmap.height);
    // Header dimensions and displayed/default-frame dimensions have independent
    // limits. EXIF orientation may legitimately exchange the displayed axes.
  } finally {
    bitmap.close();
  }
}
