import * as cssTree from 'css-tree';
import { cssKeyword, cssProperty, diagnostic, keyframesName, validateTokens } from './css-syntax';

const containers = new Set(['media', 'supports', 'layer', 'container', 'starting-style']);
const descriptors = new Set(['font-face', 'property']);
const prohibited = new Set(['import', 'charset', 'namespace']);
export function parseSelector(source: string): cssTree.Selector {
  const parsed = cssTree.parse(source, { context: 'selector' });
  if (parsed.type !== 'Selector') throw new Error('CSS: invalid generated target selector.');
  return parsed;
}

function scopeSelector(selector: cssTree.Selector, root: string, nested: boolean): void {
  cssTree.walk(selector, function(node, item, list) {
    if (
      (node.type === 'PseudoClassSelector' && node.name.toLowerCase() === 'scope') ||
      (node.type === 'NestingSelector' && !nested)
    ) {
      list.replace(item, parseSelector(root).children);
      return this.skip;
    }
  });

  // Constrain the element matched by the rightmost compound. Prefixing a rule
  // would miss a button/root carrying the scope itself; a descendant alternative
  // also covers DOM produced inside Base UI, Sonner and custom TSX components.
  const boundary = parseSelector(`:is(${root},${root} *)`).children;
  let pseudoElement: cssTree.ListItem<cssTree.CssNode> | undefined;
  selector.children.forEach((part, item) => {
    if (part.type === 'Combinator') pseudoElement = undefined;
    else if (part.type === 'PseudoElementSelector' && !pseudoElement) pseudoElement = item;
  });
  if (pseudoElement) selector.children.insertList(boundary, pseudoElement);
  else selector.children.appendList(boundary);
}

export function validateDeclaration(node: cssTree.Declaration, source: string, descriptor?: string): void {
  node.property = cssTree.ident.encode(cssProperty(node.property));
  const offset = node.loc?.start.offset ?? 0;
  if (node.property.startsWith('--')) {
    if (node.property.length === 2)
      throw diagnostic(source, 'A custom property needs a name after --.', offset);
    // Custom properties deliberately contain arbitrary CSS token streams.
    return;
  }
  if (node.value.type === 'Raw')
    throw diagnostic(source, `Invalid value for ${node.property}.`, offset);
  const value = cssTree.generate(node.value);
  if (!value.trim()) throw diagnostic(source, `${node.property} needs a value.`, offset);
  const match = descriptor
    ? cssTree.lexer.matchAtruleDescriptor(descriptor, node.property, node.value)
    : cssTree.lexer.matchProperty(node.property, node.value);
  if (!match.error) return;
  // The bundled grammar can lag behind the WebView. Prefer its actual support
  // for newer properties/values rather than rejecting otherwise valid CSS.
  if (!descriptor && typeof CSS !== 'undefined' && CSS.supports(node.property, value)) return;
  const unknown = match.error.message.includes('Unknown property');
  const variableValue = /\b(?:var|env|attr)\(/i.test(value);
  if (!descriptor && typeof CSS === 'undefined' && (unknown || variableValue)) return;
  throw diagnostic(source, `${node.property}: ${match.error.message}`, offset);
}

function validateKeyframe(rule: cssTree.Rule, source: string): void {
  if (rule.prelude.type !== 'SelectorList' || rule.prelude.children.isEmpty)
    throw diagnostic(
      source,
      'A keyframe needs from, to, or a percentage.',
      rule.loc?.start.offset ?? 0,
    );
  rule.prelude.children.forEach((selector) => {
    if (selector.type !== 'Selector')
      throw diagnostic(source, 'Invalid keyframe selector.', selector.loc?.start.offset ?? 0);
    const parts = selector.children.toArray();
    const part = parts[0];
    if (
      parts.length !== 1 ||
      !part ||
      !(
        (part.type === 'TypeSelector' && ['from', 'to'].includes(part.name.toLowerCase())) ||
        (part.type === 'Percentage' && Number(part.value) >= 0 && Number(part.value) <= 100)
      )
    )
      throw diagnostic(
        source,
        'A keyframe needs from, to, or a percentage between 0% and 100%.',
        selector.loc?.start.offset ?? 0,
      );
  });
}

interface BlockContext {
  root?: string;
  subjectBoundary?: string;
  nested?: boolean;
  keyframes?: boolean;
  descriptor?: string;
  declarations?: boolean;
}

export function transformChildren(
  children: cssTree.List<cssTree.CssNode>,
  source: string,
  context: BlockContext,
): void {
  children.forEach((node) => {
    const offset = node.loc?.start.offset ?? 0;
    if (node.type === 'Declaration') {
      if (!context.declarations)
        throw diagnostic(source, 'Declarations must be inside a selector rule.', offset);
      validateDeclaration(node, source, context.descriptor);
      return;
    }
    if (node.type === 'Rule') {
      if (context.descriptor)
        throw diagnostic(
          source,
          `Selector rules are not supported inside @${context.descriptor}.`,
          offset,
        );
      if (node.prelude.type !== 'SelectorList')
        throw diagnostic(source, 'Invalid selector.', offset);
      if (context.keyframes) validateKeyframe(node, source);
      else
        node.prelude.children.forEach((selector) => {
          if (selector.type !== 'Selector')
            throw diagnostic(source, 'Invalid selector.', selector.loc?.start.offset ?? offset);
          const parts = selector.children.toArray();
          if (
            parts.some((part) => part.type === 'Percentage') ||
            parts.at(-1)?.type === 'Combinator'
          )
            throw diagnostic(source, 'Invalid selector.', selector.loc?.start.offset ?? offset);
          if (context.root) scopeSelector(selector, context.root, context.nested ?? false);
          if (context.subjectBoundary) {
            const guard = parseSelector(`:where(${context.subjectBoundary})`).children;
            let pseudo: cssTree.ListItem<cssTree.CssNode> | undefined;
            selector.children.forEach((part, item) => {
              if (part.type === 'Combinator') pseudo = undefined;
              else if (part.type === 'PseudoElementSelector' && !pseudo) pseudo = item;
            });
            if (pseudo) selector.children.insertList(guard, pseudo);
            else selector.children.appendList(guard);
          }
        });
      transformChildren(node.block.children, source, {
        root: context.root,
        subjectBoundary: context.subjectBoundary,
        nested: true,
        declarations: true,
      });
      return;
    }
    if (node.type === 'Atrule') {
      const name = cssKeyword(node.name);
      node.name = name;
      if (prohibited.has(name))
        throw diagnostic(
          source,
          `@${node.name} is not supported. Load CSS through the editor.`,
          offset,
        );
      const keyframes = keyframesName.test(name);
      if (!containers.has(name) && !descriptors.has(name) && !keyframes)
        throw diagnostic(source, `@${node.name} is not supported.`, offset);
      if (context.keyframes || context.descriptor)
        throw diagnostic(source, `@${node.name} cannot be nested here.`, offset);
      if (!node.block && name !== 'layer')
        throw diagnostic(source, `@${node.name} needs a block.`, offset);
      if (
        (keyframes || ['media', 'supports', 'container', 'property'].includes(name)) &&
        !node.prelude
      )
        throw diagnostic(source, `@${node.name} needs a prelude.`, offset);
      if (name === 'property' && node.prelude) {
        const match = cssTree.lexer.matchAtrulePrelude(name, node.prelude);
        if (match.error)
          throw diagnostic(source, '@property needs a valid custom property name.', offset);
      }
      if (keyframes && node.prelude?.type === 'AtrulePrelude') {
        const parts = node.prelude.children.toArray();
        const nameNode = parts[0];
        if (
          parts.length !== 1 ||
          !nameNode ||
          !['Identifier', 'String'].includes(nameNode.type) ||
          (nameNode.type === 'Identifier' &&
            ['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'].includes(
              nameNode.name.toLowerCase(),
            ))
        )
          throw diagnostic(source, 'A keyframes rule needs a valid animation name.', offset);
      }
      if (node.prelude)
        cssTree.walk(node.prelude, (part) => {
          if (part.type === 'Raw')
            throw diagnostic(
              source,
              `Invalid @${node.name} prelude.`,
              part.loc?.start.offset ?? offset,
            );
        });
      if (node.block)
        transformChildren(node.block.children, source, {
          root: context.root,
          subjectBoundary: context.subjectBoundary,
          nested: context.nested,
          keyframes,
          descriptor: descriptors.has(name) ? name : undefined,
          declarations: descriptors.has(name) || (context.declarations && !keyframes),
        });
      return;
    }
    if (node.type !== 'Comment')
      throw diagnostic(source, 'Invalid or unsupported CSS syntax.', offset);
  });
}

/** Compile document CSS, or constrain a target stylesheet to its roots/descendants. */
export function compileCss(source: string, target?: string): string {
  if (!source.trim()) return '';
  if (target && !/^[a-z][a-zA-Z0-9.-]{0,95}$/.test(target))
    throw new Error('CSS: invalid customization target.');
  validateTokens(source);
  const parseErrors: cssTree.SyntaxParseError[] = [];
  const ast = cssTree.parse(source, {
    positions: true,
    onParseError(error) {
      parseErrors.push(error);
    },
  });
  if (ast.type !== 'StyleSheet') throw new Error('CSS: a stylesheet is required.');
  const root = target
    ? `:where([data-ui-root-target~="${target}"],[data-ui-node="${target}"])`
    : undefined;
  transformChildren(ast.children, source, { root });
  const parseError = parseErrors[0];
  if (parseError) throw diagnostic(source, parseError.message, parseError.offset);
  return cssTree.generate(ast);
}
