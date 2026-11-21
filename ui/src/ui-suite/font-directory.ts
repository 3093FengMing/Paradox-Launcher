const invalidFont = (): never => { throw new Error('Invalid suite font container'); };
const knownTags = 'cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
  .split(' ').map(tag => tag.replace('_', ' '));

/** Shared container ranges keep metadata, private data and compressed tables disjoint. */
export class FontContainer {
  readonly data: DataView;
  readonly count: number;
  private readonly ranges: [number, number][] = [];
  private readonly header: number;
  constructor(readonly bytes: Uint8Array, readonly woff: boolean) {
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.header = woff ? 44 : 48;
    if (bytes.length < this.header) invalidFont();
    if (this.data.getUint32(0) !== (woff ? 0x774f4646 : 0x774f4632)) invalidFont();
    if (this.data.getUint32(8) !== bytes.length || this.data.getUint16(14) !== 0) invalidFont();
    this.count = this.data.getUint16(12);
    if (!this.count) invalidFont();
  }
  range(start: number, size: number): void {
    if (!size || start < this.header || start > this.bytes.length - size) invalidFont();
    this.ranges.push([start, start + size]);
  }
  directory(end: number): void { this.ranges.push([0, end]); }
  admitOptionalBlocks(): void {
    const offset = this.woff ? 24 : 28;
    const metadata = this.data.getUint32(offset), size = this.data.getUint32(offset + 4);
    const original = this.data.getUint32(offset + 8);
    if (metadata) {
      if (!original) invalidFont();
      this.range(metadata, size);
    } else if (size || original) invalidFont();
    const privateOffset = this.data.getUint32(offset + 12), privateSize = this.data.getUint32(offset + 16);
    if (privateOffset) this.range(privateOffset, privateSize);
    else if (privateSize) invalidFont();
  }
  rejectOverlaps(): void {
    this.ranges.sort((left, right) => left[0] - right[0]);
    for (let i = 1; i < this.ranges.length; i++)
      if (this.ranges[i][0] < this.ranges[i - 1][1]) invalidFont();
  }
}

/** WOFF records preserve four-byte alignment and the declared expanded SFNT size. */
export function inspectWoffDirectory(font: FontContainer): void {
  const end = 44 + 20 * font.count;
  if (end > font.bytes.length) invalidFont();
  font.directory(end);
  const tags = new Set<number>();
  let sfnt = 12 + 16 * font.count;
  for (let i = 0; i < font.count; i++) {
    const position = 44 + 20 * i, data = font.data;
    const tag = data.getUint32(position), offset = data.getUint32(position + 4);
    const compressed = data.getUint32(position + 8), length = data.getUint32(position + 12);
    if (tags.has(tag) || compressed > length || offset % 4) invalidFont();
    tags.add(tag);
    if (length) font.range(offset, compressed);
    else if (compressed || (offset > end && offset > font.bytes.length)) invalidFont();
    sfnt += Math.ceil(length / 4) * 4;
  }
  if (sfnt !== font.data.getUint32(16)) invalidFont();
}

/** Variable-width directory values never read beyond the source buffer. */
class FontDirectoryReader {
  position = 48;
  constructor(private readonly bytes: Uint8Array) {}
  read(): number {
    if (this.position >= this.bytes.length) invalidFont();
    return this.bytes[this.position++];
  }
  base128(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.read();
      if ((i === 0 && byte === 0x80) || value > 0x1ffffff) invalidFont();
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    return invalidFont();
  }
  uint255(): number {
    const byte = this.read();
    if (byte === 253) return this.read() * 256 + this.read();
    if (byte === 254) return this.read() + 506;
    if (byte === 255) return this.read() + 253;
    return byte;
  }
  skipFour(): void { for (let i = 0; i < 4; i++) this.read(); }
}

/** WOFF2 has explicit transform versions; only glyf/loca and hmtx may transform. */
function inspectWoff2Table(reader: FontDirectoryReader, tags: Set<string>): number {
  const flags = reader.read(), index = flags & 63, transform = flags >>> 6;
  const tag = index === 63
    ? String.fromCharCode(reader.read(), reader.read(), reader.read(), reader.read()) : knownTags[index];
  if (tags.has(tag)) invalidFont();
  tags.add(tag);
  const length = reader.base128(), outlines = index === 10 || index === 11 || tag === 'glyf' || tag === 'loca';
  if (outlines && transform !== 0 && transform !== 3) invalidFont();
  if (!outlines && transform !== 0 && !(tag === 'hmtx' && transform === 1)) invalidFont();
  const transformed = outlines ? transform !== 3 : transform !== 0;
  if (transformed) {
    const transformedLength = reader.base128();
    if ((index === 11 || tag === 'loca') && transformedLength !== 0) invalidFont();
  }
  return Math.ceil(length / 4) * 4;
}

/** Collection indices are bounded against the global table directory. */
function inspectCollection(reader: FontDirectoryReader, tableCount: number): void {
  reader.skipFour();
  const fonts = reader.uint255();
  if (!fonts) invalidFont();
  for (let i = 0; i < fonts; i++) {
    const tables = reader.uint255();
    reader.skipFour();
    for (let j = 0; j < tables; j++) if (reader.uint255() >= tableCount) invalidFont();
  }
}

/** Table lengths establish the SFNT budget before compressed stream admission. */
export function inspectWoff2Directory(font: FontContainer): void {
  const reader = new FontDirectoryReader(font.bytes), tags = new Set<string>();
  let sfnt = 12 + 16 * font.count;
  for (let i = 0; i < font.count; i++) sfnt += inspectWoff2Table(reader, tags);
  if (font.data.getUint32(4) === 0x74746366) inspectCollection(reader, font.count);
  else if (sfnt !== font.data.getUint32(16)) invalidFont();
  font.directory(reader.position);
  font.range(reader.position, font.data.getUint32(20));
}
