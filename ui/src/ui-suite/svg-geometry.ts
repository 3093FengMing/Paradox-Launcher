import { fail } from './svg-policy';
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const scalarNumber = new RegExp('^' + number + '$');
const numberOrPercentage = new RegExp('^' + number + '%?$');
const length = new RegExp('^' + number + '(?:px|em|ex|ch|rem|cm|mm|Q|in|pt|pc|%)?$');
/** Lists reject empty fields, overflow and nonnumeric tokens before Number conversion. */
function numbers(value: string): number[] {
  if (/^\s*,|,\s*,|,\s*$/.test(value)) fail();
  const tokens = value.trim().split(/[\s,]+/);
  if (tokens.some((t) => !new RegExp('^' + number + '$').test(t) || !Number.isFinite(Number(t))))
    fail();
  return tokens.map(Number);
}
/** Admit only complete transform functions with the SVG-defined parameter counts. */
export function transform(value: string): void {
  if (/^\s*,|,\s*,/.test(value)) fail();
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let end = 0;
  for (const m of value.matchAll(re)) {
    if (!/^[\s,]*$/.test(value.slice(end, m.index))) fail();
    const values = numbers(m[2]),
      count = (
        {
          matrix: [6],
          translate: [1, 2],
          scale: [1, 2],
          rotate: [1, 3],
          skewX: [1],
          skewY: [1],
        } as Record<string, number[]>
      )[m[1]];
    if (!count?.includes(values.length)) fail();
    end = m.index + m[0].length;
  }
  if (!end || !/^\s*$/.test(value.slice(end))) fail();
}
/** Cursor owns separators, numeric tokens and arc flags without recursive parsing. */
class SvgPathReader {
  position = 0;
  private readonly numeric = new RegExp(number, 'y');
  constructor(readonly value: string) {}
  whitespace(): void {
    while (this.position < this.value.length && /\s/.test(this.value[this.position])) this.position++;
  }
  parameter(command: string, index: number, explicit: boolean): void {
    this.whitespace();
    if (this.value[this.position] === ',') {
      if (explicit && index === 0) fail();
      this.position++; this.whitespace();
    }
    const value = command === 'A' && (index === 3 || index === 4) ? this.flag() : this.scalar();
    if (!Number.isFinite(value) || (command === 'A' && index < 2 && value < 0)) fail();
  }
  private flag(): number {
    if (this.value[this.position] !== '0' && this.value[this.position] !== '1') fail();
    return Number(this.value[this.position++]);
  }
  private scalar(): number {
    this.numeric.lastIndex = this.position;
    const match = this.numeric.exec(this.value);
    if (!match) return fail();
    this.position = this.numeric.lastIndex;
    return Number(match[0]);
  }
}
/** Implicit moveto pairs become lineto; closepath clears the command before the next pair. */
function pathData(value: string): void {
  const reader = new SvgPathReader(value), arities: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let command = '', first = true;
  reader.whitespace();
  while (reader.position < value.length) {
    const explicit = /[a-zA-Z]/.test(value[reader.position]);
    if (explicit) {
      command = value[reader.position++].toUpperCase();
      if (first && command !== 'M') fail();
      first = false;
    }
    const arity = arities[command];
    if (arity === undefined) fail();
    if (arity === 0) { command = ''; reader.whitespace(); continue; }
    for (let i = 0; i < arity; i++) reader.parameter(command, i, explicit);
    if (command === 'M') command = 'L';
    reader.whitespace();
  }
}
/** Text coordinate lists are the only length lists; size and radius fields cannot be negative. */
function validateLengthAttribute(tag: string, name: string, value: string): void {
  if (/^\s*,|,\s*,|,\s*$/.test(value)) fail();
  const list =
    ['text', 'tspan'].includes(tag) && ['x', 'y', 'dx', 'dy'].includes(name)
      ? value.trim().split(/[\s,]+/)
      : [value.trim()];
  if (list.some((v) => !length.test(v) || !Number.isFinite(parseFloat(v)))) fail();
  if (
    ['width', 'height', 'r', 'rx', 'ry', 'fr', 'textLength'].includes(name) &&
    list.some((v) => parseFloat(v) < 0)
  )
    fail();
}

const attributeKeywords: Readonly<Record<string, readonly string[]>> = {
  gradientUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  clipPathUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  maskContentUnits: ['userSpaceOnUse', 'objectBoundingBox'],
  spreadMethod: ['pad', 'reflect', 'repeat'],
  lengthAdjust: ['spacing', 'spacingAndGlyphs'],
  version: ['1.0', '1.1', '2.0'],
};

function validateViewBox(value: string): void {
  const values = numbers(value);
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) fail();
}
function validatePathLength(value: string): void {
  const scalar = value.trim();
  if (!scalarNumber.test(scalar) || !Number.isFinite(Number(scalar)) || Number(scalar) < 0) fail();
}
function validateOffset(value: string): void {
  const scalar = value.trim();
  if (!numberOrPercentage.test(scalar) || !Number.isFinite(parseFloat(scalar))) fail();
}
function validateAspectRatio(value: string): void {
  if (!/^(?:defer\s+)?(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/.test(value.trim())) fail();
}
const geometryValues: Readonly<Record<string, (value: string) => unknown>> = {
  d: pathData, viewBox: validateViewBox, pathLength: validatePathLength, offset: validateOffset,
  points: value => { if (numbers(value).length % 2) fail(); },
  rotate: numbers, preserveAspectRatio: validateAspectRatio,
};
/** Family admission precedes this dispatcher; each exceptional value has its own grammar. */
export function validateGeometryAttribute(tag: string, name: string, value: string): void {
  if (Object.hasOwn(attributeKeywords, name)) {
    if (!attributeKeywords[name].includes(value)) fail();
    return;
  }
  if (Object.hasOwn(geometryValues, name)) { geometryValues[name](value); return; }
  validateLengthAttribute(tag, name, value);
}
