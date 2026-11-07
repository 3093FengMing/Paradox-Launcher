/* eslint-disable no-control-regex -- SVG fragment IDs cannot contain controls. */
import * as css from 'css-tree';
const ns = 'http://www.w3.org/2000/svg',
  xlink = 'http://www.w3.org/1999/xlink',
  xml = 'http://www.w3.org/XML/1998/namespace',
  xmlns = 'http://www.w3.org/2000/xmlns/';
const families: Record<string, string[]> = {
  svg: ['width', 'height', 'viewBox', 'preserveAspectRatio', 'version'],
  g: [],
  defs: [],
  title: [],
  desc: [],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'pathLength'],
  circle: ['cx', 'cy', 'r', 'pathLength'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'pathLength'],
  line: ['x1', 'y1', 'x2', 'y2', 'pathLength'],
  polyline: ['points', 'pathLength'],
  polygon: ['points', 'pathLength'],
  text: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  tspan: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  linearGradient: [
    'x1',
    'y1',
    'x2',
    'y2',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'href',
  ],
  radialGradient: [
    'cx',
    'cy',
    'r',
    'fx',
    'fy',
    'fr',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'href',
  ],
  stop: ['offset'],
  clipPath: ['clipPathUnits'],
  mask: ['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
};
const presentation = new Set(
  'color fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask display visibility font-family font-size font-style font-weight text-anchor dominant-baseline vector-effect paint-order shape-rendering text-rendering stop-color stop-opacity'.split(
    ' ',
  ),
);
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const scalarNumber = new RegExp('^' + number + '$');
const numberOrPercentage = new RegExp('^' + number + '%?$');
const length = new RegExp('^' + number + '(?:px|em|ex|ch|rem|cm|mm|Q|in|pt|pc|%)?$');
const fail = (): never => {
  throw new Error('Unsupported or invalid static SVG');
};
function numbers(value: string): number[] {
  if (/^\s*,|,\s*,|,\s*$/.test(value)) fail();
  const tokens = value.trim().split(/[\s,]+/);
  if (tokens.some((t) => !new RegExp('^' + number + '$').test(t) || !Number.isFinite(Number(t))))
    fail();
  return tokens.map(Number);
}
function transform(value: string): void {
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
function pathData(value: string): void {
  const numeric = new RegExp(number, 'y');
  let p = 0,
    command = '',
    first = true;
  const whitespace = () => {
    while (p < value.length && /\s/.test(value[p])) p++;
  };
  whitespace();
  while (p < value.length) {
    const explicit = /[a-zA-Z]/.test(value[p]);
    if (explicit) {
      command = value[p++].toUpperCase();
      if (first && command !== 'M') fail();
      first = false;
    }
    const arity = (
      { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 } as Record<string, number>
    )[command];
    if (arity === undefined) fail();
    if (arity === 0) {
      command = '';
      whitespace();
      continue;
    }
    for (let i = 0; i < arity; i++) {
      whitespace();
      if (value[p] === ',') {
        if (explicit && i === 0) fail();
        p++;
        whitespace();
      }
      let n: number;
      if (command === 'A' && (i === 3 || i === 4)) {
        if (value[p] !== '0' && value[p] !== '1') fail();
        n = Number(value[p++]);
      } else {
        numeric.lastIndex = p;
        const match = numeric.exec(value);
        if (!match) return fail();
        n = Number(match[0]);
        p = numeric.lastIndex;
      }
      if (!Number.isFinite(n) || (command === 'A' && i < 2 && n < 0)) fail();
    }
    if (command === 'M') command = 'L';
    whitespace();
  }
}
type SvgReferenceKind = 'gradient' | 'clipPath' | 'mask';
interface SvgReference {
  readonly from: Element;
  readonly id: string;
  readonly kind: SvgReferenceKind;
}
interface SvgAttributeIndex {
  readonly ids: ReadonlyMap<string, Element>;
  readonly references: readonly SvgReference[];
}
interface SvgAttributes extends SvgAttributeIndex {
  readonly ids: Map<string, Element>;
  readonly references: SvgReference[];
}

function parseSvgDocument(source: string): Document {
  if (typeof DOMParser !== 'function') throw new Error('XML parser unavailable');
  // Reject declarations before parsing so no external entity resolver is reached.
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(withoutComments) || /<\?(?!xml(?:\s|\?>))/i.test(withoutComments))
    fail();
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== ns ||
    root.localName !== 'svg' ||
    document.getElementsByTagName('parsererror').length ||
    document.doctype
  )
    fail();
  return document;
}

/** Admit the complete XML tree before attribute and resource-reference validation. */
function admitSvgElements(document: Document): Element[] {
  const elements: Element[] = [], stack: Node[] = [document];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeType === 7) fail();
    if (node.nodeType === 3 || node.nodeType === 4) {
      if (
        node.textContent?.trim() &&
        !['text', 'tspan', 'title', 'desc'].includes(node.parentElement?.localName ?? '')
      )
        fail();
      continue;
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (
        element.namespaceURI !== ns ||
        !Object.hasOwn(families, element.localName) ||
        (element.localName === 'svg' && element !== document.documentElement)
      )
        fail();
      elements.push(element);
    }
    for (let child = node.lastChild; child; child = child.previousSibling) stack.push(child);
  }
  return elements;
}

function addSvgReference(
  references: SvgReference[],
  from: Element,
  value: string,
  kind: SvgReferenceKind,
): void {
  if (!/^#[^\s\u0000-\u001f\u007f-\u009f%?#]+$/u.test(value)) fail();
  references.push({ from, id: value.slice(1), kind });
}

function validatePresentation(
  element: Element,
  property: string,
  value: css.CssNode,
  references: SvgReference[],
): void {
  property = css.ident.decode(property).toLowerCase();
  if (!presentation.has(property)) fail();
  const matched = css.lexer.matchProperty(property, value);
  if (matched.error) fail();
  css.walk(value, (node) => {
    if (node.type === 'Raw' || node.type === 'Atrule') fail();
    if (
      (node.type === 'Number' || node.type === 'Dimension' || node.type === 'Percentage') &&
      !Number.isFinite(Number(node.value))
    )
      fail();
    if (
      node.type === 'Function' &&
      !['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'].includes(
        css.ident.decode(node.name).toLowerCase(),
      )
    )
      fail();
    if (node.type === 'Url') {
      if (!['fill', 'stroke', 'clip-path', 'mask'].includes(property)) fail();
      addSvgReference(
        references,
        element,
        node.value,
        property === 'clip-path' ? 'clipPath' : property === 'mask' ? 'mask' : 'gradient',
      );
    }
  });
}

function validatePresentationStyle(element: Element, value: string, references: SvgReference[]): void {
  const tree = css.parse(value, { context: 'declarationList', onParseError: fail });
  if (tree.type !== 'DeclarationList') return fail();
  tree.children.forEach((declaration) => {
    if (declaration.type !== 'Declaration' || declaration.important) return fail();
    validatePresentation(element, declaration.property, declaration.value, references);
  });
}

/** Return true only for namespace metadata whose complete value was checked. */
function validateNamespaceAttribute(attribute: Attr): boolean {
  if (attribute.namespaceURI === xmlns) {
    if (![ns, xlink].includes(attribute.value)) fail();
    return true;
  }
  if (attribute.namespaceURI === xml) {
    if (attribute.localName !== 'space' || !['default', 'preserve'].includes(attribute.value))
      fail();
    return true;
  }
  if (attribute.namespaceURI && !(attribute.namespaceURI === xlink && attribute.localName === 'href'))
    fail();
  return false;
}

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

/** The caller already checked that this attribute belongs to the element family. */
function validateGeometryAttribute(tag: string, name: string, value: string): void {
  if (Object.hasOwn(attributeKeywords, name)) {
    if (!attributeKeywords[name].includes(value)) fail();
  } else if (name === 'd') pathData(value);
  else if (name === 'viewBox') {
    const n = numbers(value);
    if (n.length !== 4 || n[2] <= 0 || n[3] <= 0) fail();
  } else if (name === 'pathLength') {
    const scalar = value.trim();
    if (!scalarNumber.test(scalar) || !Number.isFinite(Number(scalar)) || Number(scalar) < 0)
      fail();
  } else if (name === 'offset') {
    const scalar = value.trim();
    if (!numberOrPercentage.test(scalar) || !Number.isFinite(parseFloat(scalar))) fail();
  } else if (name === 'points') {
    if (numbers(value).length % 2) fail();
  } else if (name === 'rotate') numbers(value);
  else if (name === 'preserveAspectRatio') {
    if (
      !/^(?:defer\s+)?(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/.test(
        value.trim(),
      )
    )
      fail();
  } else validateLengthAttribute(tag, name, value);
}

function validateSvgAttributes(element: Element, state: SvgAttributes): void {
  const tag = element.localName;
  let href: string | undefined;
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.localName, value = attribute.value;
    if (validateNamespaceAttribute(attribute)) continue;
    if (name === 'id') {
      if (!value || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value) || state.ids.has(value)) fail();
      state.ids.set(value, element);
    } else if (name === 'class') continue;
    else if (name === 'style') validatePresentationStyle(element, value, state.references);
    else if (presentation.has(name))
      validatePresentation(
        element,
        name,
        css.parse(value, { context: 'value', onParseError: fail }),
        state.references,
      );
    else if (name === 'transform' || (name === 'gradientTransform' && families[tag].includes(name)))
      transform(value);
    else {
      if (!families[tag].includes(name)) fail();
      if (name === 'href') {
        if (!['linearGradient', 'radialGradient'].includes(tag) || (href !== undefined && href !== value))
          fail();
        href = value;
        addSvgReference(state.references, element, value, 'gradient');
      } else validateGeometryAttribute(tag, name, value);
    }
  }
}

function addGraphEdge(edges: Map<Element, Element[]>, from: Element, target: Element): void {
  const next = edges.get(from) ?? [];
  next.push(target);
  edges.set(from, next);
}

/** Resolve only local fragments of the expected resource type; containment participates in cycles. */
function createSvgReferenceGraph(
  elements: readonly Element[],
  state: SvgAttributeIndex,
): Map<Element, Element[]> {
  const edges = new Map<Element, Element[]>();
  for (const { from, id, kind } of state.references) {
    const target = state.ids.get(id);
    if (
      !target ||
      (kind === 'gradient'
        ? !['linearGradient', 'radialGradient'].includes(target.localName)
        : target.localName !== kind)
    )
      return fail();
    addGraphEdge(edges, from, target);
  }
  for (const element of elements)
    for (const child of element.children) addGraphEdge(edges, element, child);
  return edges;
}

function rejectSvgCycles(edges: ReadonlyMap<Element, readonly Element[]>): void {
  const done = new Set<Element>(), active = new Set<Element>();
  for (const start of edges.keys()) {
    const work: { node: Element; exit: boolean }[] = [{ node: start, exit: false }];
    while (work.length) {
      const item = work.pop()!;
      if (item.exit) {
        active.delete(item.node);
        done.add(item.node);
        continue;
      }
      if (active.has(item.node)) fail();
      if (done.has(item.node)) continue;
      active.add(item.node);
      work.push({ node: item.node, exit: true });
      for (const next of edges.get(item.node) ?? []) work.push({ node: next, exit: false });
    }
  }
}

export function validateStaticSvg(source: string): void {
  const document = parseSvgDocument(source);
  const elements = admitSvgElements(document);
  const attributes: SvgAttributes = { ids: new Map(), references: [] };
  for (const element of elements) validateSvgAttributes(element, attributes);
  rejectSvgCycles(createSvgReferenceGraph(elements, attributes));
}
