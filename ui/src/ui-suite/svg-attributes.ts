/* eslint-disable no-control-regex -- Local fragment references reject control characters. */
import * as css from 'css-tree';
import { families, presentation, xmlns, xml, xlink, ns, fail } from './svg-policy';
import { transform, validateGeometryAttribute } from './svg-geometry';
export type SvgReferenceKind = 'gradient' | 'clipPath' | 'mask';
interface SvgReference {
  readonly from: Element;
  readonly id: string;
  readonly kind: SvgReferenceKind;
}
export interface SvgAttributeIndex {
  readonly ids: ReadonlyMap<string, Element>;
  readonly references: readonly SvgReference[];
}
export interface SvgAttributes extends SvgAttributeIndex {
  readonly ids: Map<string, Element>;
  readonly references: SvgReference[];
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

/** CSS grammar matching admits only static presentation values and local resource references. */
function validatePresentation(element: Element, property: string, value: css.CssNode, references: SvgReference[]): void {
  property = css.ident.decode(property).toLowerCase();
  if (!presentation.has(property)) fail();
  const matched = css.lexer.matchProperty(property, value);
  if (matched.error) fail();
  css.walk(value, node => validatePresentationNode({ element, property, references }, node));
}
function validatePresentationNode(context: { element: Element; property: string; references: SvgReference[] }, node: css.CssNode): void {
  if (node.type === 'Raw' || node.type === 'Atrule') fail();
  if ((node.type === 'Number' || node.type === 'Dimension' || node.type === 'Percentage') && !Number.isFinite(Number(node.value))) fail();
  if (node.type === 'Function' && !['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'].includes(css.ident.decode(node.name).toLowerCase())) fail();
  if (node.type !== 'Url') return;
  const { element, property, references } = context;
  if (!['fill', 'stroke', 'clip-path', 'mask'].includes(property)) fail();
  addSvgReference(references, element, node.value, property === 'clip-path' ? 'clipPath' : property === 'mask' ? 'mask' : 'gradient');
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

/** One element owns its id and href consistency while values use shared grammar checks. */
export function validateSvgAttributes(element: Element, state: SvgAttributes): void {
  const seen = { href: undefined as string | undefined };
  for (const attribute of Array.from(element.attributes)) validateAttribute({ element, state, seen }, attribute);
}
function validateAttribute(context: { element: Element; state: SvgAttributes; seen: { href: string | undefined } }, attribute: Attr): void {
  const { element, state, seen } = context, tag = element.localName;
  const name = attribute.localName, value = attribute.value;
  if (validateNamespaceAttribute(attribute) || name === 'class') return;
  if (name === 'id') {
    if (!value || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value) || state.ids.has(value)) fail();
    state.ids.set(value, element); return;
  }
  if (name === 'style') { validatePresentationStyle(element, value, state.references); return; }
  if (presentation.has(name)) {
    const parsed = css.parse(value, { context: 'value', onParseError: fail });
    validatePresentation(element, name, parsed, state.references); return;
  }
  if (name === 'transform' || (name === 'gradientTransform' && families[tag].includes(name))) {
    transform(value); return;
  }
  if (!families[tag].includes(name)) fail();
  if (name !== 'href') { validateGeometryAttribute(tag, name, value); return; }
  if (!['linearGradient', 'radialGradient'].includes(tag) || (seen.href !== undefined && seen.href !== value)) fail();
  seen.href = value;
  addSvgReference(state.references, element, value, 'gradient');
}
