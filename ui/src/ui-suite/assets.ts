import { suiteLimits } from './model';
import { decodeUtf8 } from './canonical';
import { inspectRaster, validateRaster } from './asset-raster';
import { inspectFont, validateFont } from './asset-font';
import { validateStaticSvg } from './asset-svg';
const raster = new Set(['image/png', 'image/jpeg', 'image/webp']);
const font = new Set(['font/woff', 'font/woff2']);
export function inspectSuiteAsset(
  _path: string,
  mediaType: string,
  originalBytes: Uint8Array,
): void {
  if (originalBytes.byteLength > suiteLimits.asset) throw new Error('Suite asset exceeds limit');
  if (raster.has(mediaType)) inspectRaster(mediaType, originalBytes);
  else if (font.has(mediaType)) inspectFont(mediaType, originalBytes);
  else if (mediaType === 'image/svg+xml') {
    const source = decodeUtf8(originalBytes);
    if (!source.trimStart().startsWith('<')) throw new Error('Invalid SVG header');
  } else throw new Error('Unsupported suite asset media type');
}
export async function validateSuiteAsset(
  path: string,
  mediaType: string,
  originalBytes: Uint8Array,
): Promise<void> {
  // Own the byte sequence across platform awaits, including direct internal callers.
  const bytes = originalBytes.slice();
  inspectSuiteAsset(path, mediaType, bytes);
  if (raster.has(mediaType)) await validateRaster(mediaType, bytes);
  else if (font.has(mediaType)) await validateFont(mediaType, bytes);
  else validateStaticSvg(decodeUtf8(bytes));
}
