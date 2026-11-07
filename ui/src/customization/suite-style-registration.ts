import * as cssTree from 'css-tree';
import { isVar, parseValue, syntax } from './css-syntax';
import { renameGrammar } from './suite-style-grammar';
import type {
  DescriptorUse,
  RegistrationConsumer,
  RewriteDescriptor,
  StyleRewriteContext,
  StyleSymbols,
} from './suite-style-types';

export const rewriteRegistrationSyntax = (symbols: StyleSymbols, value: cssTree.Value | cssTree.Raw, use: DescriptorUse) => {
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
        renameGrammar(symbols, literal, use);
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
export function checkRegistration(
  context: StyleRewriteContext,
  request: RegistrationConsumer,
  rewriteDescriptor: RewriteDescriptor,
): void {
  const { name, use, consumer, sourcePath, check } = request;
  for (const registration of context.variables.registrations.get(name) ?? []) {
    const syntaxValue: cssTree.Value = {
      type: 'Value',
      children: new cssTree.List<cssTree.CssNode>().fromArray([
        { type: 'String', value: registration.syntax },
      ]),
    };
    rewriteRegistrationSyntax(context.symbols, syntaxValue, use);
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
      rewriteDescriptor(context, rewritten, use, sourcePath, false);
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
