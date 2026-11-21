import { FontContainer, inspectWoffDirectory, inspectWoff2Directory } from './font-directory';

/** Container bounds only. FontFace.load remains the separate platform acceptance gate. */
export function inspectFont(media: string, bytes: Uint8Array): void {
  const font = new FontContainer(bytes, media === 'font/woff');
  font.admitOptionalBlocks();
  if (font.woff) inspectWoffDirectory(font);
  else inspectWoff2Directory(font);
  font.rejectOverlaps();
}

/** Load a detached face; validation never registers font data with the document. */
export async function validateFont(media: string, bytes: Uint8Array): Promise<void> {
  inspectFont(media, bytes);
  if (typeof FontFace !== 'function') throw new Error('Font decoder unavailable');
  const face = new FontFace('paradox-suite-validation', bytes.slice().buffer);
  await face.load();
  if (face.status !== 'loaded') throw new Error('Font decoder rejected asset');
}
