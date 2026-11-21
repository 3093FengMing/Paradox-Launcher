import { ns, families, fail } from './svg-policy';
import { validateSvgAttributes } from './svg-attributes';
import type { SvgAttributes, SvgAttributeIndex } from './svg-attributes';

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

/** Admit XML, values and fragment dependencies before the browser renders an SVG asset. */
export function validateStaticSvg(source: string): void {
  const document = parseSvgDocument(source);
  const elements = admitSvgElements(document);
  const attributes: SvgAttributes = { ids: new Map(), references: [] };
  for (const element of elements) validateSvgAttributes(element, attributes);
  rejectSvgCycles(createSvgReferenceGraph(elements, attributes));
}
