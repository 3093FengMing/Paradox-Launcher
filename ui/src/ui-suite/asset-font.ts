/** Container bounds only. FontFace.load is the separate platform acceptance gate. */
export function inspectFont(media: string, b: Uint8Array): void {
  const knownTags =
    'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
      .split(' ')
      .map((tag) => tag.replace('_', ' '));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength),
    woff = media === 'font/woff',
    header = woff ? 44 : 48;
  const fail = () => {
    throw new Error('Invalid suite font container');
  };
  if (
    b.length < header ||
    v.getUint32(0) !== (woff ? 0x774f4646 : 0x774f4632) ||
    v.getUint32(8) !== b.length ||
    v.getUint16(14) !== 0
  )
    fail();
  const count = v.getUint16(12);
  if (!count) fail();
  const ranges: [number, number][] = [];
  const range = (start: number, size: number) => {
    if (!size || start < header || start > b.length - size) fail();
    ranges.push([start, start + size]);
  };
  const mo = v.getUint32(woff ? 24 : 28),
    ml = v.getUint32(woff ? 28 : 32),
    original = v.getUint32(woff ? 32 : 36),
    po = v.getUint32(woff ? 36 : 40),
    pl = v.getUint32(woff ? 40 : 44);
  if (mo) {
    if (!original) fail();
    range(mo, ml);
  } else if (ml || original) fail();
  if (po) range(po, pl);
  else if (pl) fail();
  if (woff) {
    const end = 44 + 20 * count;
    if (end > b.length) fail();
    ranges.push([0, end]);
    const tags = new Set<number>();
    let sfnt = 12 + 16 * count;
    for (let i = 0; i < count; i++) {
      const p = 44 + 20 * i,
        tag = v.getUint32(p),
        offset = v.getUint32(p + 4),
        compressed = v.getUint32(p + 8),
        length = v.getUint32(p + 12);
      if (tags.has(tag) || compressed > length || offset % 4) fail();
      tags.add(tag);
      if (length) {
        range(offset, compressed);
      } else if (compressed || (offset > end && offset > b.length)) fail();
      sfnt += Math.ceil(length / 4) * 4;
    }
    if (sfnt !== v.getUint32(16)) fail();
  } else {
    let p = 48;
    const read = () => {
      if (p >= b.length) fail();
      return b[p++];
    };
    const base128 = () => {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const c = read();
        if ((i === 0 && c === 0x80) || n > 0x1ffffff) fail();
        n = n * 128 + (c & 127);
        if (!(c & 128)) return n;
      }
      return fail();
    };
    const tags = new Set<string>();
    let sfnt = 12 + 16 * count;
    for (let i = 0; i < count; i++) {
      const flags = read(),
        index = flags & 63,
        transform = flags >>> 6;
      let tag = knownTags[index];
      if (index === 63) {
        const raw = [read(), read(), read(), read()];
        tag = String.fromCharCode(...raw);
      }
      if (tags.has(tag)) fail();
      tags.add(tag);
      const length = base128();
      sfnt += Math.ceil(length / 4) * 4;
      const glyf = index === 10 || tag === 'glyf',
        loca = index === 11 || tag === 'loca',
        transformed = glyf || loca ? transform !== 3 : transform !== 0;
      if ((glyf || loca) && transform !== 0 && transform !== 3) fail();
      if (!glyf && !loca && transform !== 0 && !(tag === 'hmtx' && transform === 1)) fail();
      if (transformed) {
        const transformedLength = base128();
        if (loca && transformedLength !== 0) fail();
      }
    }
    // WOFF2 collections have a separately bounded collection directory; FontFace decides support.
    if (v.getUint32(4) === 0x74746366) {
      const u255 = () => {
        const c = read();
        return c === 253
          ? read() * 256 + read()
          : c === 254
            ? read() + 506
            : c === 255
              ? read() + 253
              : c;
      };
      for (let i = 0; i < 4; i++) read();
      const fonts = u255();
      if (!fonts) fail();
      for (let i = 0; i < fonts; i++) {
        const n = u255();
        for (let k = 0; k < 4; k++) read();
        for (let j = 0; j < n; j++) if (u255() >= count) fail();
      }
    } else if (sfnt !== v.getUint32(16)) fail();
    ranges.push([0, p]);
    range(p, v.getUint32(20));
  }
  ranges.sort((a, c) => a[0] - c[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail();
}
export async function validateFont(media: string, bytes: Uint8Array): Promise<void> {
  inspectFont(media, bytes);
  if (typeof FontFace !== 'function') throw new Error('Font decoder unavailable');
  const face = new FontFace('paradox-suite-validation', bytes.slice().buffer);
  await face.load();
  if (face.status !== 'loaded')
    throw new Error(
      'Font decoder rejected asset',
    ); /* Detached FontFace is never registered; its only handle is released on return. */
}
