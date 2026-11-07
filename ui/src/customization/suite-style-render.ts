import * as cssTree from 'css-tree';
import { cssKeyword, cssProperty, keyframesName, parseValue } from './css-syntax';
import { parseSelector, transformChildren } from './css-parser';
import type { SuiteCssSource } from './css-types';
import { identifier, layerNode, layerParts, mirrorName, rename, variableName } from './suite-style-symbols';
import { mirrors, rewriteDeclaration, rewriteDescriptor } from './suite-style-declarations';
import { rewriteRegistrationSyntax } from './suite-style-registration';
import { createUseCheck } from './suite-style-variables';
import type { StyleRenderOptions, StyleRewriteContext, UseCheck } from './suite-style-types';

function rewriteStyleAst(
  context: StyleRewriteContext,
  ast: cssTree.CssNode,
  sourcePath: string,
  options: StyleRenderOptions,
): void {
  const { shadow, boundary, subjectBoundary } = options;
  const check = createUseCheck(context.variables.definitions);
  cssTree.walk(ast, function(node, item, list) {
    if (node.type === 'PseudoClassSelector' && ['root', 'host'].includes(cssKeyword(node.name))) {
      if (boundary || subjectBoundary) {
        list.replace(item, parseSelector(boundary ?? subjectBoundary!).children);
        return this.skip;
      }
      node.name = shadow ? 'host' : 'root';
    }
    if (node.type === 'Atrule') {
      node.name = cssKeyword(node.name);
      if (node.name === 'layer' && node.prelude)
        cssTree.walk(node.prelude, (part) => {
          const layer = layerNode(part);
          if (layer)
            layer.name = layerParts(layer.name)
              .map((segment) => context.symbols.layers.get(cssTree.ident.decode(segment)) ?? segment)
              .join('.');
        });
      if (node.prelude?.type === 'AtrulePrelude') {
        if (node.name === 'property') {
          const nameNode = node.prelude.children.first,
            name = nameNode ? identifier(nameNode) : null;
          if (name)
            for (const use of context.symbols.uses) {
              const copy = cssTree.clone(node) as cssTree.Atrule;
              const first =
                copy.prelude?.type === 'AtrulePrelude' ? copy.prelude.children.first : null;
              if (first?.type === 'Identifier') first.name = mirrorName(context.symbols, name, use);
              copy.block?.children.forEach((part) => {
                if (part.type !== 'Declaration') return;
                if (cssProperty(part.property) === 'syntax')
                  rewriteRegistrationSyntax(context.symbols, part.value, use);
                else if (cssProperty(part.property) === 'initial-value')
                  rewriteDescriptor(context, part.value, use, sourcePath, false);
              });
              list.insertData(copy, item);
            }
        }
        const names = keyframesName.test(node.name)
          ? context.symbols.animations
          : node.name === 'property'
            ? context.symbols.properties
            : null;
        if (names) node.prelude.children.forEach((part) => rename(part, names));
      }
    }
    if (node.type === 'Declaration') {
      for (const copy of mirrors(context, node, sourcePath)) list.insertData(copy, item);
      rewriteDeclaration(context, node, sourcePath, check);
      return this.skip;
    }
  });
  if ((boundary || subjectBoundary) && ast.type === 'StyleSheet')
    transformChildren(ast.children, '', { root: boundary, subjectBoundary });
}

/** Clone before rewriting so repeat renders and different boundaries cannot share mutations. */
export function renderSuiteStyles(
  context: StyleRewriteContext,
  inputs: readonly SuiteCssSource[],
  options: StyleRenderOptions,
): string {
  return inputs.map((source) => {
    const ast = cssTree.clone(source.ast);
    rewriteStyleAst(context, ast, source.sourcePath, options);
    return cssTree.generate(ast);
  }).join('\n');
}

export function rewriteInlineStyle(context: StyleRewriteContext, style: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const localDefinitions = new Map(context.variables.definitions);
  for (const [key, value] of Object.entries(style))
    if (key.startsWith('--'))
      localDefinitions.set(key, [
        { value: parseValue(String(value)), sourcePath: '<inline-style>' },
      ]);
  const check: UseCheck = {
    definitions: localDefinitions,
    visiting: new Set(),
    checked: new Set(),
  };
  for (const [key, value] of Object.entries(style)) {
    // Style-record keys are CSSOM names, already decoded; only CSS text/AST
    // identifiers use escapes. Decoding a literal backslash here loses identity.
    const property = key.startsWith('--')
      ? key
      : cssProperty(
        key.includes('-') || key === key.toUpperCase()
          ? key
          : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
      );
    const target = property.startsWith('--') ? variableName(context.symbols, property) : key;
    if (typeof value !== 'string') {
      out[target] = value;
      if (property.startsWith('--'))
        for (const use of context.symbols.uses) out[mirrorName(context.symbols, property, use)] = value;
      continue;
    }
    const node: cssTree.Declaration = {
      type: 'Declaration',
      property: cssTree.ident.encode(property),
      important: false,
      value: parseValue(value),
    };
    for (const copy of mirrors(context, node, '<inline-style>'))
      out[copy.property] = cssTree.generate(copy.value);
    rewriteDeclaration(context, node, '<inline-style>', check);
    out[target] = cssTree.generate(node.value);
  }
  return out;
}
