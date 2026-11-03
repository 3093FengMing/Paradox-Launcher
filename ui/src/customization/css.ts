import * as cssTree from 'css-tree';

// css-tree 3 exposes tokenizer APIs that are missing from @types/css-tree 2.
const syntax = cssTree as typeof cssTree & {
  tokenize(source: string, onToken: (type: number, start: number, end: number) => void): void;
  tokenTypes: Record<
    | 'BadString'
    | 'BadUrl'
    | 'String'
    | 'Url'
    | 'Comment'
    | 'Function'
    | 'Ident'
    | 'LeftParenthesis'
    | 'RightParenthesis'
    | 'LeftSquareBracket'
    | 'RightSquareBracket'
    | 'LeftCurlyBracket'
    | 'RightCurlyBracket',
    number
  >;
};

const containers = new Set(['media', 'supports', 'layer', 'container', 'starting-style']);
const descriptors = new Set(['font-face', 'property']);
const prohibited = new Set(['import', 'charset', 'namespace']);
const keyframesName = /^(?:-(?:webkit|moz|o)-)?keyframes$/;
const cssKeyword = (name: string) => cssTree.ident.decode(name).toLowerCase();
const cssProperty = (name: string) => {
  const decoded = cssTree.ident.decode(name);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
};

function diagnostic(source: string, message: string, offset: number): Error {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return new Error(`CSS ${line}:${column}: ${message}`);
}

function isUnescapedEnd(source: string, start: number, end: number, expected: string): boolean {
  if (source[end - 1] !== expected || end <= start + 1) return false;
  let slashes = 0;
  for (let index = end - 2; index >= start && source[index] === '\\'; index--) slashes++;
  return slashes % 2 === 0;
}

// CSS parsers deliberately repair EOF. An editor needs to report an unfinished
// brace, string or function instead of silently saving that repaired stylesheet.
function validateTokens(source: string): void {
  const types = syntax.tokenTypes;
  const opened: { type: number; offset: number; closing: string }[] = [];
  syntax.tokenize(source, (type, start, end) => {
    if (type === types.BadString || type === types.BadUrl)
      throw diagnostic(source, 'Invalid string or URL.', start);
    if (type === types.String && !isUnescapedEnd(source, start, end, source[start]))
      throw diagnostic(source, 'Unclosed string.', start);
    if (type === types.Url && !isUnescapedEnd(source, start, end, ')'))
      throw diagnostic(source, 'Unclosed URL.', start);
    if (type === types.Comment && source.slice(end - 2, end) !== '*/')
      throw diagnostic(source, 'Unclosed comment.', start);
    if (type === types.Function || type === types.LeftParenthesis)
      opened.push({ type: types.RightParenthesis, offset: start, closing: ')' });
    if (type === types.LeftSquareBracket)
      opened.push({ type: types.RightSquareBracket, offset: start, closing: ']' });
    if (type === types.LeftCurlyBracket)
      opened.push({ type: types.RightCurlyBracket, offset: start, closing: '}' });
    if (
      type === types.RightParenthesis ||
      type === types.RightSquareBracket ||
      type === types.RightCurlyBracket
    ) {
      const previous = opened.pop();
      if (!previous || previous.type !== type)
        throw diagnostic(source, `Unexpected ${source.slice(start, end)}.`, start);
    }
  });
  const unfinished = opened.pop();
  if (unfinished)
    throw diagnostic(source, `Unclosed block; expected ${unfinished.closing}.`, unfinished.offset);
}

function parseSelector(source: string): cssTree.Selector {
  const parsed = cssTree.parse(source, { context: 'selector' });
  if (parsed.type !== 'Selector') throw new Error('CSS: invalid generated target selector.');
  return parsed;
}

function scopeSelector(selector: cssTree.Selector, root: string, nested: boolean): void {
  cssTree.walk(selector, function (node, item, list) {
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

function validateDeclaration(node: cssTree.Declaration, source: string, descriptor?: string): void {
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

function transformChildren(
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

export interface SuiteCssSource {
  readonly sourcePath: string;
  readonly ast: cssTree.StyleSheet;
}
export interface SuiteAssetSource {
  sourcePath: string;
  resolveAsset(reference: string): string;
}
function suiteCssError(sourcePath: string, error: unknown): never {
  throw new Error(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
  });
}
/** Custom properties accept arbitrary balanced tokens. Only complete resource or
 * identifier tokens are parsed as small ASTs when the entire value is opaque. */
function transformCustomTokens(source: string, transform: (ast: cssTree.CssNode) => void): string {
  const tokens: { type: number; start: number; end: number }[] = [];
  syntax.tokenize(source, (type, start, end) => tokens.push({ type, start, end }));
  const changes: { start: number; end: number; text: string }[] = [];
  const types = syntax.tokenTypes;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    let end = token.end;
    if (token.type === types.Function) {
      const name = cssTree.ident.decode(source.slice(token.start, token.end - 1)).toLowerCase();
      if (!['url', 'image-set', '-webkit-image-set', 'var'].includes(name)) continue;
      let depth = 1;
      while (++index < tokens.length) {
        const next = tokens[index];
        if (next.type === types.Function || next.type === types.LeftParenthesis) depth++;
        if (next.type === types.RightParenthesis && --depth === 0) {
          end = next.end;
          break;
        }
      }
      if (depth !== 0) throw diagnostic(source, 'Unclosed resource function.', token.start);
    } else if (![types.Url, types.Ident, types.String].includes(token.type)) continue;
    const ast = cssTree.parse(source.slice(token.start, end), { context: 'value' });
    transform(ast);
    changes.push({ start: token.start, end, text: cssTree.generate(ast) });
  }
  let result = source;
  for (const change of changes.reverse())
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
  return result;
}
function rewriteSuiteUrls(ast: cssTree.CssNode, options: SuiteAssetSource): void {
  cssTree.walk(ast, function (node, item, list) {
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

/** Name-bearing at-rules cannot be scoped with selectors. Give each usage group its
 * own names and rewrite its references together, including var() token streams. */
export interface SuiteStyleRewriter {
  render(
    sources: readonly SuiteCssSource[],
    shadow: boolean,
    boundary?: string,
    subjectBoundary?: string,
  ): string;
  inline(style: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
export function createSuiteStyleRewriter(
  sources: readonly SuiteCssSource[],
  namespace: string,
): SuiteStyleRewriter {
  type DescriptorUse = 'animation-name' | 'animation' | 'font-family' | 'font';
  interface GrammarMatch {
    syntax?: { type: string; name?: string } | null;
    match?: GrammarMatch[];
    node?: cssTree.CssNode;
  }
  const animations = new Map<string, string>(),
    fonts = new Map<string, string>(),
    properties = new Map<string, string>(),
    layers = new Map<string, string>();
  const identifier = (node: cssTree.CssNode): string | null =>
    node.type === 'Identifier'
      ? cssTree.ident.decode(node.name)
      : node.type === 'String'
        ? node.value
        : null;
  const register = (names: Map<string, string>, name: string, kind: string) => {
    if (!names.has(name))
      names.set(
        name,
        `${name.startsWith('--') ? '--' : ''}suite-${namespace}-${kind}-${names.size}`,
      );
  };
  const family = (parts: readonly cssTree.CssNode[]) =>
    parts
      .map((part) => identifier(part) ?? cssTree.generate(part))
      .join(' ')
      .toLowerCase();
  const layerNode = (node: cssTree.CssNode) =>
    (node as { type: string }).type === 'Layer' ? (node as unknown as { name: string }) : null;
  const layerParts = (name: string) => name.match(/(?:\\.|[^.])+/g) ?? [];
  for (const source of sources)
    cssTree.walk(source.ast, (node) => {
      if (node.type !== 'Atrule') return;
      const name = cssKeyword(node.name);
      if (name === 'layer' && node.prelude)
        cssTree.walk(node.prelude, (part) => {
          const layer = layerNode(part);
          if (layer)
            for (const segment of layerParts(layer.name))
              register(layers, cssTree.ident.decode(segment), 'layer');
        });
      if (node.prelude?.type === 'AtrulePrelude')
        node.prelude.children.forEach((part) => {
          const value = identifier(part);
          if (!value) return;
          if (keyframesName.test(name)) register(animations, value, 'animation');
          else if (name === 'property') register(properties, value, 'property');
        });
      if (name === 'font-face')
        node.block?.children.forEach((part) => {
          if (
            part.type === 'Declaration' &&
            cssProperty(part.property) === 'font-family' &&
            part.value.type === 'Value'
          )
            register(fonts, family(part.value.children.toArray()), 'font');
        });
    });
  const uses: DescriptorUse[] = [
    ...(animations.size ? (['animation-name', 'animation'] as const) : []),
    ...(fonts.size ? (['font-family', 'font'] as const) : []),
  ];
  const descriptorUse = (property: string): DescriptorUse | undefined => {
    const name = cssProperty(property).replace(/^-webkit-/, '');
    return uses.includes(name as DescriptorUse) ? (name as DescriptorUse) : undefined;
  };
  const variableName = (name: string) => properties.get(name) ?? name;
  // Finite per-use mirrors preserve the original value for content and other uses.
  // Their names depend only on this prepared/group and original variable spelling.
  const mirrorName = (name: string, use: DescriptorUse) =>
    `--suite-${namespace}-var-${use}-${Array.from(name)
      .map((c) => c.codePointAt(0)!.toString(16))
      .join('-')}`;
  interface VariableDefinition {
    value: cssTree.Value | cssTree.Raw;
    sourcePath: string;
  }
  interface UseCheck {
    definitions: ReadonlyMap<string, readonly VariableDefinition[]>;
    visiting: Set<string>;
    checked: Set<string>;
  }
  const definitions = new Map<string, VariableDefinition[]>();
  const registrations = new Map<
    string,
    { syntax: string; initial?: cssTree.Value | cssTree.Raw }[]
  >();
  const addDefinition = (name: string, value: cssTree.Value | cssTree.Raw, sourcePath: string) => {
    const rows = definitions.get(name) ?? [];
    rows.push({ value, sourcePath });
    definitions.set(name, rows);
  };
  for (const source of sources)
    cssTree.walk(source.ast, (node) => {
      if (node.type === 'Declaration' && cssProperty(node.property).startsWith('--'))
        addDefinition(cssProperty(node.property), node.value, source.sourcePath);
      if (
        node.type === 'Atrule' &&
        cssKeyword(node.name) === 'property' &&
        node.prelude?.type === 'AtrulePrelude'
      ) {
        const first = node.prelude.children.first,
          name = first ? identifier(first) : null;
        if (name) {
          let registrationSyntax: string | undefined,
            initial: cssTree.Value | cssTree.Raw | undefined;
          node.block?.children.forEach((part) => {
            if (part.type !== 'Declaration') return;
            if (cssProperty(part.property) === 'initial-value') {
              addDefinition(name, part.value, source.sourcePath);
              initial = part.value;
            } else if (
              cssProperty(part.property) === 'syntax' &&
              part.value.type === 'Value' &&
              part.value.children.first?.type === 'String'
            )
              registrationSyntax = part.value.children.first.value;
          });
          if (registrationSyntax !== undefined) {
            const rows = registrations.get(name) ?? [];
            rows.push({ syntax: registrationSyntax, initial });
            registrations.set(name, rows);
          }
        }
      }
    });
  const parseValue = (text: string): cssTree.Value | cssTree.Raw => {
    try {
      const node = cssTree.parse(text, { context: 'value' });
      if (node.type === 'Value') return node;
    } catch {
      /* Opaque custom tokens remain opaque. */
    }
    return { type: 'Raw', value: text };
  };
  const isVar = (node: cssTree.CssNode): node is cssTree.FunctionNode =>
    node.type === 'Function' && cssKeyword(node.name) === 'var';
  const leaves = (match: GrammarMatch): cssTree.CssNode[] => {
    const out: cssTree.CssNode[] = [],
      pending = [match];
    while (pending.length) {
      const next = pending.pop()!;
      if (next.node) out.push(next.node);
      if (next.match)
        for (let index = next.match.length - 1; index >= 0; index--)
          pending.push(next.match[index]);
    }
    return out;
  };
  const grammarGroups = (
    property: DescriptorUse,
    value: cssTree.Value,
    type: string,
  ): cssTree.CssNode[][] => {
    if (type === 'family-name') {
      const parts = value.children.toArray();
      const families = (items: cssTree.CssNode[]): cssTree.CssNode[][] | null => {
        const groups: cssTree.CssNode[][] = [[]];
        for (const part of items) {
          if (part.type === 'Operator' && part.value === ',') {
            if (!groups.at(-1)!.length) return null;
            groups.push([]);
          } else if (identifier(part) !== null) groups.at(-1)!.push(part);
          else return null;
        }
        if (
          !groups.at(-1)!.length ||
          groups.some((group) => group.length > 1 && group.some((part) => part.type === 'String'))
        )
          return null;
        return groups.filter(
          (group) =>
            !(
              group.length === 1 &&
              group[0].type === 'Identifier' &&
              (!cssTree.lexer.matchType('generic-family', group[0]).error ||
                ['initial', 'inherit', 'unset', 'revert', 'revert-layer'].includes(
                  cssKeyword(group[0].name),
                ))
            ),
        );
      };
      if (property === 'font-family') return families(parts) ?? [];
      // The shorthand prefix has a bounded number of grammar fields. Match only
      // that prefix with one family placeholder, never all substrings of a family.
      for (let split = 1; split < Math.min(parts.length, 12); split++) {
        const groups = families(parts.slice(split));
        if (!groups) continue;
        const prefix: cssTree.Value = {
          type: 'Value',
          children: new cssTree.List<cssTree.CssNode>().fromArray([
            ...parts.slice(0, split),
            { type: 'String', value: 'suite-family-probe' },
          ]),
        };
        if (!cssTree.lexer.matchProperty('font', prefix).error) return groups;
      }
      // Numeric math functions cannot supply or concatenate a family token.
      if (
        parts.some(
          (part) =>
            part.type === 'Function' &&
            ['calc', 'min', 'max', 'clamp'].includes(cssKeyword(part.name)),
        ) &&
        !parts.some(isVar)
      ) {
        let start = parts.length;
        while (
          start > 0 &&
          (identifier(parts[start - 1]) !== null ||
            (parts[start - 1].type === 'Operator' &&
              (parts[start - 1] as cssTree.Operator).value === ','))
        )
          start--;
        return families(parts.slice(start)) ?? [];
      }
      return [];
    }
    const entries: cssTree.CssNode[][] = [[]];
    value.children.forEach((part) => {
      if (part.type === 'Operator' && part.value === ',') entries.push([]);
      else entries.at(-1)!.push(part);
    });
    if (entries.length > 1)
      return entries.flatMap((parts) =>
        grammarGroups(
          property,
          { type: 'Value', children: new cssTree.List<cssTree.CssNode>().fromArray(parts) },
          type,
        ),
      );
    // Easing functions have a fixed grammar role even when their arguments use var().
    // Match valid representatives without changing the emitted function AST.
    const easing: Record<string, string> = {
      steps: 'steps(1)',
      'cubic-bezier': 'cubic-bezier(0,0,1,1)',
      linear: 'linear',
    };
    const probe: cssTree.Value = {
      type: 'Value',
      children: new cssTree.List<cssTree.CssNode>().fromArray(
        value.children.toArray().map((part) => {
          if (
            property === 'animation' &&
            part.type === 'Function' &&
            easing[cssKeyword(part.name)]
          ) {
            const representative = parseValue(easing[cssKeyword(part.name)]);
            if (representative.type === 'Value') return representative.children.first!;
          }
          return part;
        }),
      ),
    };
    const result = cssTree.lexer.matchProperty(property, probe) as cssTree.LexerMatchResult & {
      matched: GrammarMatch | null;
    };
    if (result.error || !result.matched) return [];
    const groups: cssTree.CssNode[][] = [],
      pending = [result.matched];
    while (pending.length) {
      const next = pending.pop()!;
      if (next.syntax?.type === 'Type' && next.syntax.name === type) {
        groups.push(leaves(next));
        continue;
      }
      if (next.match)
        for (let index = next.match.length - 1; index >= 0; index--)
          pending.push(next.match[index]);
    }
    return groups;
  };
  const rename = (node: cssTree.CssNode, names: ReadonlyMap<string, string>) => {
    const name = identifier(node),
      replacement = name === null ? undefined : names.get(name);
    if (replacement) {
      if (node.type === 'Identifier') node.name = replacement;
      else if (node.type === 'String') node.value = replacement;
    }
  };
  const renameGrammar = (value: cssTree.Value, use: DescriptorUse) => {
    if (use.startsWith('animation'))
      for (const group of grammarGroups(use, value, 'keyframes-name'))
        for (const node of group) rename(node, animations);
    else {
      let possible = false;
      const firstNames = new Set([...fonts.keys()].map((name) => name.split(' ')[0]));
      cssTree.walk(value, (node) => {
        const name = identifier(node)?.toLowerCase();
        if (name && (node.type === 'String' ? fonts.has(name) : firstNames.has(name)))
          possible = true;
      });
      if (!possible) return;
      // One grammar-delimited family is joined/looked up once. Never scan substrings.
      const removed = new Set<cssTree.CssNode>();
      for (const group of grammarGroups(use, value, 'family-name')) {
        const replacement = fonts.get(family(group));
        if (!replacement) continue;
        const first = group[0];
        if (first?.type === 'Identifier') first.name = replacement;
        else if (first?.type === 'String') first.value = replacement;
        for (let index = 1; index < group.length; index++) removed.add(group[index]);
      }
      if (removed.size)
        value.children.forEach((node, item) => {
          if (removed.has(node)) value.children.remove(item);
        });
    }
  };
  const ambiguousAnimationNames = new Set(
    [...animations.keys()].filter((name) => {
      const value = parseValue(cssTree.ident.encode(name));
      return value.type === 'Value' && !grammarGroups('animation', value, 'keyframes-name').length;
    }),
  );
  const failUse = (node: cssTree.CssNode, sourcePath: string, use: DescriptorUse): never => {
    const location = node.loc?.start;
    throw new Error(
      `${sourcePath}:${location?.line ?? 1}:${location?.column ?? 1}: Cannot safely namespace this ${use} var() template because cascading values can change descriptor-name roles. Use animation-name/font-family longhands or a single var() containing the complete shorthand.`,
    );
  };
  function rewriteVariables(
    value: cssTree.Value | cssTree.Raw,
    use: DescriptorUse | undefined,
    sourcePath: string,
    actual: boolean | UseCheck,
  ): void {
    if (value.type === 'Raw') {
      // Only var() references change in opaque streams, never ordinary identifiers/strings.
      value.value = transformCustomTokens(value.value, (fragment) =>
        cssTree.walk(fragment, (node) => {
          if (isVar(node)) rewriteVar(node, use, sourcePath, actual);
        }),
      );
      return;
    }
    cssTree.walk(value, function (node) {
      if (isVar(node)) {
        rewriteVar(node, use, sourcePath, actual);
        return this.skip;
      }
    });
  }
  function rewriteVar(
    node: cssTree.FunctionNode,
    use: DescriptorUse | undefined,
    sourcePath: string,
    actual: boolean | UseCheck,
  ): void {
    const parts = node.children.toArray(),
      first = parts[0];
    if (first?.type !== 'Identifier') return;
    const name = cssTree.ident.decode(first.name);
    if (actual && use) {
      const check =
        typeof actual === 'boolean'
          ? { definitions, visiting: new Set<string>(), checked: new Set<string>() }
          : actual;
      const key = `${use}:${name}`;
      if (!check.visiting.has(key) && !check.checked.has(key)) {
        check.visiting.add(key);
        try {
          for (const definition of check.definitions.get(name) ?? [])
            rewriteDescriptor(
              cssTree.clone(definition.value) as cssTree.Value | cssTree.Raw,
              use,
              definition.sourcePath,
              check,
            );
          checkRegistration(name, use, node, sourcePath, check);
          check.checked.add(key);
        } finally {
          check.visiting.delete(key);
        }
      }
      actual = check;
    }
    first.name = cssTree.ident.encode(use ? mirrorName(name, use) : variableName(name));
    const comma = parts.findIndex((part) => part.type === 'Operator' && part.value === ',');
    if (comma < 0) return;
    const fallback = parseValue(
      parts
        .slice(comma + 1)
        .map((part) => cssTree.generate(part))
        .join(''),
    );
    if (use) rewriteDescriptor(fallback, use, sourcePath, actual);
    else rewriteVariables(fallback, undefined, sourcePath, actual);
    node.children = new cssTree.List<cssTree.CssNode>().fromArray([
      first,
      { type: 'Operator', value: ',' },
      { type: 'Raw', value: cssTree.generate(fallback) },
    ]);
  }
  function rewriteDescriptor(
    value: cssTree.Value | cssTree.Raw,
    use: DescriptorUse,
    sourcePath: string,
    actual: boolean | UseCheck,
  ): void {
    if (value.type === 'Raw') {
      rewriteVariables(value, use, sourcePath, actual);
      return;
    }
    const parts = value.children.toArray(),
      vars = parts.filter(isVar);
    if (parts.length === 1 && vars.length === 1) {
      rewriteVar(vars[0], use, sourcePath, actual);
      return;
    }
    if (!vars.length) {
      renameGrammar(value, use);
      rewriteVariables(value, undefined, sourcePath, actual);
      return;
    }
    if (
      use === 'animation' &&
      parts.some((part) => part.type === 'Operator' && part.value === ',')
    ) {
      const entries: cssTree.CssNode[][] = [[]];
      for (const part of parts) {
        if (part.type === 'Operator' && part.value === ',') entries.push([]);
        else entries.at(-1)!.push(part);
      }
      for (const entry of entries)
        rewriteDescriptor(
          {
            type: 'Value',
            loc: value.loc,
            children: new cssTree.List<cssTree.CssNode>().fromArray(entry),
          },
          use,
          sourcePath,
          actual,
        );
      return;
    }
    if (use === 'animation' && ambiguousAnimationNames.size) {
      const last = parts.at(-1),
        fixed: cssTree.Value = {
          type: 'Value',
          children: new cssTree.List<cssTree.CssNode>().fromArray(
            parts.filter((part) => !isVar(part)),
          ),
        };
      const names = grammarGroups('animation', fixed, 'keyframes-name');
      // A nonkeyword name fixes that field regardless of the variable's position.
      // Keyword-looking names retain the established trailing-variable boundary:
      // a leading expansion could change which earlier keyword fills the name slot.
      const fixedName = names.some((group) =>
        group.some(
          (part) =>
            grammarGroups(
              'animation',
              {
                type: 'Value',
                children: new cssTree.List<cssTree.CssNode>().fromArray([part]),
              },
              'keyframes-name',
            ).length > 0,
        ),
      );
      const safe = vars.length === 1 && names.length > 0 && (last === vars[0] || fixedName);
      if (!safe) {
        if (actual) failUse(value, sourcePath, use);
        return;
      }
      renameGrammar(fixed, 'animation');
      rewriteVar(vars[0], 'animation', sourcePath, actual);
      return;
    }
    if (use === 'animation') {
      // With no owned keyword-looking names, these identities can only name frames.
      for (const part of parts) if (!isVar(part)) rename(part, animations);
      for (const variable of vars) rewriteVar(variable, 'animation', sourcePath, actual);
      return;
    }
    if (use === 'animation-name') {
      for (const part of parts)
        if (!isVar(part))
          renameGrammar(
            { type: 'Value', children: new cssTree.List<cssTree.CssNode>().fromArray([part]) },
            use,
          );
      for (const variable of vars) rewriteVar(variable, use, sourcePath, actual);
      return;
    }
    // A var occupying a complete grammar-delimited family is safe, including
    // font:12px var(--family). Concatenating fragments into a family is ambiguous.
    const markers = new Map<cssTree.CssNode, cssTree.FunctionNode>();
    const probe: cssTree.Value = {
      type: 'Value',
      children: new cssTree.List<cssTree.CssNode>().fromArray(
        parts.map((part) => {
          if (!isVar(part)) return part;
          const marker: cssTree.StringNode = { type: 'String', value: 'suite-variable-family' };
          markers.set(marker, part);
          return marker;
        }),
      ),
    };
    const groups = grammarGroups(use, probe, 'family-name');
    const safe = vars.every((variable) =>
      groups.some((group) => group.length === 1 && markers.get(group[0]) === variable),
    );
    if (!safe) {
      if (actual) failUse(value, sourcePath, use);
      return;
    }
    renameGrammar(probe, use);
    const retained = new Set(probe.children.toArray());
    value.children.forEach((part, item) => {
      if (!isVar(part) && !retained.has(part)) value.children.remove(item);
    });
    for (const variable of vars) rewriteVar(variable, 'font-family', sourcePath, actual);
  }
  const rewriteDeclaration = (
    node: cssTree.Declaration,
    sourcePath: string,
    actual: boolean | UseCheck = true,
  ) => {
    const property = cssProperty(node.property);
    node.property = cssTree.ident.encode(variableName(property));
    const use = descriptorUse(property);
    if (use) rewriteDescriptor(node.value, use, sourcePath, actual);
    else rewriteVariables(node.value, undefined, sourcePath, actual);
  };
  const mirrors = (node: cssTree.Declaration, sourcePath: string): cssTree.Declaration[] => {
    const property = cssProperty(node.property);
    if (!property.startsWith('--')) return [];
    return uses.map((use) => {
      const copy = cssTree.clone(node) as cssTree.Declaration;
      copy.property = mirrorName(property, use);
      rewriteDescriptor(copy.value, use, sourcePath, false);
      return copy;
    });
  };
  const rewriteRegistrationSyntax = (value: cssTree.Value | cssTree.Raw, use: DescriptorUse) => {
    cssTree.walk(value, (part) => {
      if (part.type !== 'String') return;
      const source = part.value;
      let withinType = false,
        end = 0,
        output = '';
      // @property syntax has literal identifiers, type names, alternatives and
      // multipliers. Only literals change; type constraints and repetition remain.
      syntax.tokenize(source, (type, start, stop) => {
        const token = source.slice(start, stop);
        if (token === '<') withinType = true;
        else if (token === '>') withinType = false;
        else if (type === syntax.tokenTypes.Ident && !withinType) {
          const literal = parseValue(token);
          if (literal.type !== 'Value') return;
          renameGrammar(literal, use);
          output += source.slice(end, start) + cssTree.generate(literal);
          end = stop;
        }
      });
      part.value = output + source.slice(end);
    });
  };
  // @property literal alternatives are case-sensitive, unlike ordinary CSS
  // grammar keywords. Keep that distinction when comparing validation domains.
  type RegistrationMatch = 'plain' | 'computed' | false | undefined;
  const registrationMatches = (
    text: string,
    value: cssTree.Value | cssTree.Raw,
  ): RegistrationMatch => {
    if (text.trim() === '*') return 'plain';
    if (value.type === 'Raw') return false;
    let grammar: cssTree.DSNode;
    try {
      grammar = cssTree.definitionSyntax.parse(text);
    } catch {
      return undefined;
    }
    const match = (rule: cssTree.DSNode, parts: cssTree.CssNode[]): RegistrationMatch => {
      if (rule.type === 'Group') {
        if (rule.terms.length === 1) return match(rule.terms[0], parts);
        if (rule.combinator !== '|') return undefined;
        for (const term of rule.terms) {
          const result = match(term, parts);
          if (result !== false) return result;
        }
        return false;
      }
      if (rule.type === 'Keyword')
        return parts.length === 1 &&
          parts[0].type === 'Identifier' &&
          cssTree.ident.decode(parts[0].name) === cssTree.ident.decode(rule.name)
          ? 'plain'
          : false;
      if (rule.type === 'Type') {
        const result = cssTree.lexer.matchType(rule.name, {
          type: 'Value',
          children: new cssTree.List<cssTree.CssNode>().fromArray(parts),
        });
        if (result.error) return result.error.message.includes('Unknown') ? undefined : false;
        return ['custom-ident', 'string'].includes(rule.name) ? 'plain' : 'computed';
      }
      if (rule.type === 'Multiplier' && rule.min === 1 && rule.max === 0) {
        const groups: cssTree.CssNode[][] = [[]];
        for (const part of parts) {
          if (rule.comma) {
            if (part.type === 'Operator' && part.value === ',') groups.push([]);
            else groups.at(-1)!.push(part);
          } else groups.push([part]);
        }
        if (!rule.comma) groups.shift();
        if (!groups.length || groups.some((group) => !group.length)) return false;
        const results = groups.map((group) => match(rule.term, group));
        return results.includes(false)
          ? false
          : results.includes(undefined)
            ? undefined
            : results.includes('computed')
              ? 'computed'
              : 'plain';
      }
      return undefined;
    };
    return match(grammar, value.children.toArray());
  };
  function checkRegistration(
    name: string,
    use: DescriptorUse,
    consumer: cssTree.CssNode,
    sourcePath: string,
    check: UseCheck,
  ): void {
    for (const registration of registrations.get(name) ?? []) {
      const syntaxValue: cssTree.Value = {
        type: 'Value',
        children: new cssTree.List<cssTree.CssNode>().fromArray([
          { type: 'String', value: registration.syntax },
        ]),
      };
      rewriteRegistrationSyntax(syntaxValue, use);
      const transformedSyntax = (syntaxValue.children.first as cssTree.StringNode).value;
      const visiting = new Set<string>();
      const checked = new Set<cssTree.Value | cssTree.Raw>();
      const fail = (): never => {
        const location = consumer.loc?.start;
        throw new Error(
          `${sourcePath}:${location?.line ?? 1}:${location?.column ?? 1}: Cannot preserve @property ${cssTree.ident.encode(name)} validation and computed semantics for this ${use} consumer. Separate descriptor names from other fields, use an unregistered variable, or write the longhand value directly.`,
        );
      };
      const verify = (original: cssTree.Value | cssTree.Raw): void => {
        if (checked.has(original)) return;
        checked.add(original);
        const rewritten = cssTree.clone(original) as cssTree.Value | cssTree.Raw;
        rewriteDescriptor(rewritten, use, sourcePath, false);
        const valueChanged = cssTree.generate(original) !== cssTree.generate(rewritten);
        if (registration.syntax === transformedSyntax && !valueChanged) return;
        let variable = false;
        cssTree.walk(original, (part) => {
          if (isVar(part)) variable = true;
        });
        if (variable) {
          // Whole-value chains preserve the same registration constraint. Do not
          // enumerate a Cartesian product of arbitrary nested token templates.
          if (
            original.type !== 'Value' ||
            original.children.size !== 1 ||
            !isVar(original.children.first!)
          )
            return fail();
          const parts = original.children.first.children.toArray();
          const first = parts[0];
          if (first?.type !== 'Identifier') return fail();
          const referenced = cssTree.ident.decode(first.name);
          if (!visiting.has(referenced)) {
            visiting.add(referenced);
            for (const definition of check.definitions.get(referenced) ?? [])
              verify(definition.value);
            visiting.delete(referenced);
          }
          const comma = parts.findIndex((part) => part.type === 'Operator' && part.value === ',');
          if (comma >= 0)
            verify(
              parseValue(
                parts
                  .slice(comma + 1)
                  .map((part) => cssTree.generate(part))
                  .join(''),
              ),
            );
          return;
        }
        const before = registrationMatches(registration.syntax, original),
          after = registrationMatches(transformedSyntax, rewritten);
        // Typed branches may canonicalize tokens (for example red -> rgb(...)).
        // A changed typed value cannot assume that serialization. An unchanged
        // typed value retains its meaning when only another literal branch changes,
        // provided both registrations still select the same matching category.
        if (
          before === undefined ||
          after === undefined ||
          before !== after ||
          (valueChanged && (before === 'computed' || after === 'computed'))
        )
          fail();
      };
      if (registration.initial) verify(registration.initial);
      for (const definition of check.definitions.get(name) ?? []) verify(definition.value);
    }
  }
  // Fail ambiguous actual consumers during preparation, even in a target group.
  // A variable definition by itself never causes a speculative-use diagnostic.
  const preflight: UseCheck = { definitions, visiting: new Set(), checked: new Set() };
  for (const source of sources)
    cssTree.walk(source.ast, (node) => {
      if (node.type === 'Declaration' && descriptorUse(node.property))
        rewriteDeclaration(
          cssTree.clone(node) as cssTree.Declaration,
          source.sourcePath,
          preflight,
        );
    });
  const rewrite = (
    ast: cssTree.CssNode,
    sourcePath: string,
    shadow = false,
    boundary?: string,
    subjectBoundary?: string,
  ) => {
    const check: UseCheck = { definitions, visiting: new Set(), checked: new Set() };
    cssTree.walk(ast, function (node, item, list) {
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
                .map((segment) => layers.get(cssTree.ident.decode(segment)) ?? segment)
                .join('.');
          });
        if (node.prelude?.type === 'AtrulePrelude') {
          if (node.name === 'property') {
            const nameNode = node.prelude.children.first,
              name = nameNode ? identifier(nameNode) : null;
            if (name)
              for (const use of uses) {
                const copy = cssTree.clone(node) as cssTree.Atrule;
                const first =
                  copy.prelude?.type === 'AtrulePrelude' ? copy.prelude.children.first : null;
                if (first?.type === 'Identifier') first.name = mirrorName(name, use);
                copy.block?.children.forEach((part) => {
                  if (part.type !== 'Declaration') return;
                  if (cssProperty(part.property) === 'syntax')
                    rewriteRegistrationSyntax(part.value, use);
                  else if (cssProperty(part.property) === 'initial-value')
                    rewriteDescriptor(part.value, use, sourcePath, false);
                });
                list.insertData(copy, item);
              }
          }
          const names = keyframesName.test(node.name)
            ? animations
            : node.name === 'property'
              ? properties
              : null;
          if (names) node.prelude.children.forEach((part) => rename(part, names));
        }
      }
      if (node.type === 'Declaration') {
        for (const copy of mirrors(node, sourcePath)) list.insertData(copy, item);
        rewriteDeclaration(node, sourcePath, check);
        return this.skip;
      }
    });
    if ((boundary || subjectBoundary) && ast.type === 'StyleSheet')
      transformChildren(ast.children, '', { root: boundary, subjectBoundary });
  };
  return {
    render(inputs, shadow, boundary, subjectBoundary) {
      return inputs
        .map((source) => {
          const ast = cssTree.clone(source.ast);
          rewrite(ast, source.sourcePath, shadow, boundary, subjectBoundary);
          return cssTree.generate(ast);
        })
        .join('\n');
    },
    inline(style) {
      const out: Record<string, unknown> = {};
      const localDefinitions = new Map(definitions);
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
        const target = property.startsWith('--') ? variableName(property) : key;
        if (typeof value !== 'string') {
          out[target] = value;
          if (property.startsWith('--'))
            for (const use of uses) out[mirrorName(property, use)] = value;
          continue;
        }
        const node: cssTree.Declaration = {
          type: 'Declaration',
          property: cssTree.ident.encode(property),
          important: false,
          value: parseValue(value),
        };
        for (const copy of mirrors(node, '<inline-style>'))
          out[copy.property] = cssTree.generate(copy.value);
        rewriteDeclaration(node, '<inline-style>', check);
        out[target] = cssTree.generate(node.value);
      }
      return out;
    },
  };
}
