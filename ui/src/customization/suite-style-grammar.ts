import * as cssTree from 'css-tree';
import { cssKeyword, isVar, parseValue } from './css-syntax';
import { family, identifier, rename } from './suite-style-symbols';
import type { DescriptorUse, StyleSymbols } from './suite-style-types';

interface GrammarMatch {
  syntax?: { type: string; name?: string } | null;
  match?: GrammarMatch[];
  node?: cssTree.CssNode;
}
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
const fontFamilies = (items: cssTree.CssNode[]): cssTree.CssNode[][] | null => {
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

const fontGrammarGroups = (property: DescriptorUse, value: cssTree.Value): cssTree.CssNode[][] => {
  const parts = value.children.toArray();
  if (property === 'font-family') return fontFamilies(parts) ?? [];
  // The shorthand prefix has a bounded number of grammar fields. Match only
  // that prefix with one family placeholder, never all substrings of a family.
  for (let split = 1; split < Math.min(parts.length, 12); split++) {
    const groups = fontFamilies(parts.slice(split));
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
    return fontFamilies(parts.slice(start)) ?? [];
  }
  return [];
};

export const grammarGroups = (
  property: DescriptorUse,
  value: cssTree.Value,
  type: string,
): cssTree.CssNode[][] => {
  if (type === 'family-name') return fontGrammarGroups(property, value);
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
export const renameGrammar = (symbols: StyleSymbols, value: cssTree.Value, use: DescriptorUse) => {
  if (use.startsWith('animation'))
    for (const group of grammarGroups(use, value, 'keyframes-name'))
      for (const node of group) rename(node, symbols.animations);
  else {
    let possible = false;
    const firstNames = new Set([...symbols.fonts.keys()].map((name) => name.split(' ')[0]));
    cssTree.walk(value, (node) => {
      const name = identifier(node)?.toLowerCase();
      if (name && (node.type === 'String' ? symbols.fonts.has(name) : firstNames.has(name)))
        possible = true;
    });
    if (!possible) return;
    // One grammar-delimited family is joined/looked up once. Never scan substrings.
    const removed = new Set<cssTree.CssNode>();
    for (const group of grammarGroups(use, value, 'family-name')) {
      const replacement = symbols.fonts.get(family(group));
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

export const collectAmbiguousAnimationNames = (symbols: StyleSymbols) => new Set(
  [...symbols.animations.keys()].filter((name) => {
    const value = parseValue(cssTree.ident.encode(name));
    return value.type === 'Value' && !grammarGroups('animation', value, 'keyframes-name').length;
  }),
);
