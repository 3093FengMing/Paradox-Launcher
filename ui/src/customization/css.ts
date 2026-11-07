import * as cssTree from 'css-tree';
import { cssKeyword, transformCustomTokens, validateTokens } from './css-syntax';
import { transformChildren, validateDeclaration } from './css-parser';
import type { SuiteAssetSource, SuiteCssSource, SuiteStyleRewriter } from './css-types';
import { collectStyleSymbols, descriptorUse } from './suite-style-symbols';
import { collectStyleVariables, createUseCheck } from './suite-style-variables';
import { collectAmbiguousAnimationNames } from './suite-style-grammar';
import { rewriteDeclaration } from './suite-style-declarations';
import { renderSuiteStyles, rewriteInlineStyle } from './suite-style-render';
import type { StyleRewriteContext } from './suite-style-types';

export { compileCss } from './css-parser';
export type { SuiteAssetSource, SuiteCssSource, SuiteStyleRewriter } from './css-types';

function suiteCssError(sourcePath: string, error: unknown): never {
  throw new Error(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
  });
}
/** Resolve resource ASTs and bounded opaque fragments before admitting a stylesheet. */
function rewriteSuiteUrls(ast: cssTree.CssNode, options: SuiteAssetSource): void {
  cssTree.walk(ast, function(node, item, list) {
    if (
      node.type === 'Declaration' &&
      node.property.startsWith('--') &&
      node.value.type === 'Raw'
    ) {
      try {
        const parsed = cssTree.parse(node.value.value, { context: 'value' });
        if (parsed.type === 'Value') node.value = parsed;
      } catch {
        /* Valid opaque custom tokens use the bounded fragment path below. */
      }
    }
    if (node.type === 'Raw') {
      if (
        !this.declaration?.property.startsWith('--') &&
        cssKeyword(this.function?.name ?? '') !== 'var'
      )
        throw new Error('CSS: unparsed resource token stream.');
      node.value = transformCustomTokens(node.value, (fragment) =>
        rewriteSuiteUrls(fragment, options),
      );
      return this.skip;
    }
    if (node.type === 'Url') node.value = options.resolveAsset(node.value);
    if (node.type === 'Function') {
      const name = cssTree.ident.decode(node.name).toLowerCase();
      if (name === 'url') {
        const value = cssTree.parse(
          `url(${cssTree.generate({ type: 'Value', children: node.children })})`,
          { context: 'value' },
        );
        const url = value.type === 'Value' ? value.children.first : null;
        if (url?.type !== 'Url') throw new Error('CSS: invalid escaped URL.');
        url.value = options.resolveAsset(url.value);
        list.replace(item, list.createItem(url));
        return this.skip;
      }
      if (name === 'image-set' || name === '-webkit-image-set')
        node.children.forEach((child) => {
          if (child.type === 'String') child.value = options.resolveAsset(child.value);
        });
    }
  });
}
/** Parse once, including custom-property token streams, before any view is published. */
export function prepareSuiteCss(source: string, options: SuiteAssetSource): SuiteCssSource {
  try {
    validateTokens(source);
    const ast = cssTree.parse(source, {
      positions: true,
      parseCustomProperty: false,
      onParseError(error) {
        throw error;
      },
    });
    if (ast.type !== 'StyleSheet') throw new Error('CSS: a stylesheet is required.');
    rewriteSuiteUrls(ast, options);
    transformChildren(ast.children, source, {});
    return { sourcePath: options.sourcePath, ast };
  } catch (error) {
    suiteCssError(options.sourcePath, error);
  }
}
/** Inline HTML styles use the same AST/resource resolver, not a semicolon split. */
export function prepareSuiteInlineStyle(
  source: string,
  options: SuiteAssetSource,
): Record<string, string> {
  try {
    validateTokens(source);
    const ast = cssTree.parse(source, {
      context: 'declarationList',
      positions: true,
      parseCustomProperty: false,
      onParseError(error) {
        throw error;
      },
    });
    if (ast.type !== 'DeclarationList') throw new Error('CSS: a declaration list is required.');
    rewriteSuiteUrls(ast, options);
    ast.children.forEach((node) => {
      if (node.type !== 'Declaration')
        throw new Error('CSS: inline styles accept declarations only.');
      validateDeclaration(node, source);
    });
    const out: Record<string, string> = {};
    ast.children.forEach((node) => {
      if (node.type === 'Declaration')
        out[
          node.property.startsWith('--')
            ? cssTree.ident.decode(node.property)
            : node.property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        ] = cssTree.generate(node.value);
    });
    return out;
  } catch (error) {
    suiteCssError(options.sourcePath, error);
  }
}

/** Collect a group once, then validate consumers before any stylesheet is published. */
export function createSuiteStyleRewriter(
  sources: readonly SuiteCssSource[],
  namespace: string,
): SuiteStyleRewriter {
  const symbols = collectStyleSymbols(sources, namespace);
  const context: StyleRewriteContext = {
    symbols,
    variables: collectStyleVariables(sources),
    ambiguousAnimationNames: collectAmbiguousAnimationNames(symbols),
  };
  // Fail ambiguous actual consumers during preparation, even in a target group.
  // A variable definition by itself never causes a speculative-use diagnostic.
  const preflight = createUseCheck(context.variables.definitions);
  for (const source of sources)
    cssTree.walk(source.ast, (node) => {
      if (node.type === 'Declaration' && descriptorUse(context.symbols, node.property))
        rewriteDeclaration(
          context,
          cssTree.clone(node) as cssTree.Declaration,
          source.sourcePath,
          preflight,
        );
    });

  return {
    render(inputs, shadow, boundary, subjectBoundary) {
      return renderSuiteStyles(context, inputs, { shadow, boundary, subjectBoundary });
    },
    inline(style) {
      return rewriteInlineStyle(context, style);
    },
  };
}
