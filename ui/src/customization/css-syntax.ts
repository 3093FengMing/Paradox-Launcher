import * as cssTree from 'css-tree';

// css-tree 3 exposes tokenizer APIs that are missing from @types/css-tree 2.
export const syntax = cssTree as typeof cssTree & {
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

export const cssKeyword = (name: string) => cssTree.ident.decode(name).toLowerCase();
export const cssProperty = (name: string) => {
  const decoded = cssTree.ident.decode(name);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
};

export function diagnostic(source: string, message: string, offset: number): Error {
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
export function validateTokens(source: string): void {
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

/** Preserve arbitrary balanced custom tokens; transform only complete resource or identifier fragments. */
export function transformCustomTokens(source: string, transform: (ast: cssTree.CssNode) => void): string {
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
export const parseValue = (text: string): cssTree.Value | cssTree.Raw => {
  try {
    const node = cssTree.parse(text, { context: 'value' });
    if (node.type === 'Value') return node;
  } catch {
    /* Opaque custom tokens remain opaque. */
  }
  return { type: 'Raw', value: text };
};
export const isVar = (node: cssTree.CssNode): node is cssTree.FunctionNode =>
  node.type === 'Function' && cssKeyword(node.name) === 'var';

export const keyframesName = /^(?:-(?:webkit|moz|o)-)?keyframes$/;
