import * as cssTree from 'css-tree';
import { cssKeyword, cssProperty, keyframesName } from './css-syntax';
import type { SuiteCssSource } from './css-types';
import type { DescriptorUse, StyleSymbols } from './suite-style-types';

export const identifier = (node: cssTree.CssNode): string | null =>
  node.type === 'Identifier'
    ? cssTree.ident.decode(node.name)
    : node.type === 'String'
      ? node.value
      : null;
const register = (names: Map<string, string>, name: string, kind: string, namespace: string) => {
  if (!names.has(name))
    names.set(
      name,
      `${name.startsWith('--') ? '--' : ''}suite-${namespace}-${kind}-${names.size}`,
    );
};
export const family = (parts: readonly cssTree.CssNode[]) =>
  parts
    .map((part) => identifier(part) ?? cssTree.generate(part))
    .join(' ')
    .toLowerCase();
export const layerNode = (node: cssTree.CssNode) =>
  (node as { type: string }).type === 'Layer' ? (node as unknown as { name: string }) : null;
export const layerParts = (name: string) => name.match(/(?:\\.|[^.])+/g) ?? [];

/** Symbol assignment follows source traversal order, preserving emitted namespace bytes. */
export function collectStyleSymbols(sources: readonly SuiteCssSource[], namespace: string): StyleSymbols {
  const animations = new Map<string, string>(),
    fonts = new Map<string, string>(),
    properties = new Map<string, string>(),
    layers = new Map<string, string>();
  for (const source of sources)
    cssTree.walk(source.ast, (node) => {
      if (node.type !== 'Atrule') return;
      const name = cssKeyword(node.name);
      if (name === 'layer' && node.prelude)
        cssTree.walk(node.prelude, (part) => {
          const layer = layerNode(part);
          if (layer)
            for (const segment of layerParts(layer.name))
              register(layers, cssTree.ident.decode(segment), 'layer', namespace);
        });
      if (node.prelude?.type === 'AtrulePrelude')
        node.prelude.children.forEach((part) => {
          const value = identifier(part);
          if (!value) return;
          if (keyframesName.test(name)) register(animations, value, 'animation', namespace);
          else if (name === 'property') register(properties, value, 'property', namespace);
        });
      if (name === 'font-face')
        node.block?.children.forEach((part) => {
          if (
            part.type === 'Declaration' &&
            cssProperty(part.property) === 'font-family' &&
            part.value.type === 'Value'
          )
            register(fonts, family(part.value.children.toArray()), 'font', namespace);
        });
    });
  const uses: DescriptorUse[] = [
    ...(animations.size ? (['animation-name', 'animation'] as const) : []),
    ...(fonts.size ? (['font-family', 'font'] as const) : []),
  ];
  return { namespace, animations, fonts, properties, layers, uses };
}

export const descriptorUse = (symbols: StyleSymbols, property: string): DescriptorUse | undefined => {
  const name = cssProperty(property).replace(/^-webkit-/, '');
  return symbols.uses.includes(name as DescriptorUse) ? (name as DescriptorUse) : undefined;
};
export const variableName = (symbols: StyleSymbols, name: string) => symbols.properties.get(name) ?? name;
// Finite per-use mirrors preserve the original value for content and other uses.
// Their names depend only on this prepared/group and original variable spelling.
export const mirrorName = (symbols: StyleSymbols, name: string, use: DescriptorUse) =>
  `--suite-${symbols.namespace}-var-${use}-${Array.from(name)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('-')}`;
export const rename = (node: cssTree.CssNode, names: ReadonlyMap<string, string>) => {
  const name = identifier(node),
    replacement = name === null ? undefined : names.get(name);
  if (replacement) {
    if (node.type === 'Identifier') node.name = replacement;
    else if (node.type === 'String') node.value = replacement;
  }
};
