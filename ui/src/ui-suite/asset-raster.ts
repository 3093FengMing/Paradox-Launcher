import { suiteLimits as L } from './model';
import { inspectPng, inspectJpeg, inspectWebp } from './raster-headers';

/** Apply the same inclusive dimension and pixel budgets to headers and decoded frames. */
export function checkRasterDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error('Invalid suite raster dimensions');
  if (width < 1 || height < 1 || width > L.dimension || height > L.dimension)
    throw new Error('Invalid suite raster dimensions');
  if (width * height > L.pixels) throw new Error('Invalid suite raster dimensions');
}

/** Inspect container dimensions without allocating a decoded image. */
export function inspectRaster(media: string, bytes: Uint8Array): { width: number; height: number } {
  const dimensions = media === 'image/png' ? inspectPng(bytes)
    : media === 'image/jpeg' ? inspectJpeg(bytes) : inspectWebp(bytes);
  checkRasterDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

/** Platform decoding is independent of header admission and owns its bitmap handle. */
export async function validateRaster(media: string, bytes: Uint8Array): Promise<void> {
  inspectRaster(media, bytes);
  if (typeof createImageBitmap !== 'function') throw new Error('Raster decoder unavailable');
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: media }));
  try {
    // EXIF orientation can exchange axes; decoded/default-frame bounds are checked separately.
    checkRasterDimensions(bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
