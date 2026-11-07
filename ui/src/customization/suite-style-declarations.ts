import * as cssTree from 'css-tree';
import { cssProperty, isVar, parseValue, transformCustomTokens } from './css-syntax';
import { descriptorUse, mirrorName, rename, variableName } from './suite-style-symbols';
import { grammarGroups, renameGrammar } from './suite-style-grammar';
import { checkRegistration } from './suite-style-registration';
import { createUseCheck } from './suite-style-variables';
import type { DescriptorUse, StyleRewriteContext, UseCheck } from './suite-style-types';

const failUse = (node: cssTree.CssNode, sourcePath: string, use: DescriptorUse): never => {
  const location = node.loc?.start;
  throw new Error(
    `${sourcePath}:${location?.line ?? 1}:${location?.column ?? 1}: Cannot safely namespace this ${use} var() template because cascading values can change descriptor-name roles. Use animation-name/font-family longhands or a single var() containing the complete shorthand.`,
  );
};
function rewriteVariables(
  context: StyleRewriteContext,
  value: cssTree.Value | cssTree.Raw,
  use: DescriptorUse | undefined,
  sourcePath: string,
  actual: boolean | UseCheck,
): void {
  if (value.type === 'Raw') {
    // Only var() references change in opaque streams, never ordinary identifiers/strings.
    value.value = transformCustomTokens(value.value, (fragment) =>
      cssTree.walk(fragment, (node) => {
        if (isVar(node)) rewriteVar(context, node, use, sourcePath, actual);
      }),
    );
    return;
  }
  cssTree.walk(value, function(node) {
    if (isVar(node)) {
      rewriteVar(context, node, use, sourcePath, actual);
      return this.skip;
    }
  });
}
function rewriteVar(
  context: StyleRewriteContext,
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
        ? createUseCheck(context.variables.definitions)
        : actual;
    const key = `${use}:${name}`;
    if (!check.visiting.has(key) && !check.checked.has(key)) {
      check.visiting.add(key);
      try {
        for (const definition of check.definitions.get(name) ?? [])
          rewriteDescriptor(context,
            cssTree.clone(definition.value) as cssTree.Value | cssTree.Raw,
            use,
            definition.sourcePath,
            check,
          );
        checkRegistration(context, { name, use, consumer: node, sourcePath, check }, rewriteDescriptor);
        check.checked.add(key);
      } finally {
        check.visiting.delete(key);
      }
    }
    actual = check;
  }
  first.name = cssTree.ident.encode(use ? mirrorName(context.symbols, name, use) : variableName(context.symbols, name));
  const comma = parts.findIndex((part) => part.type === 'Operator' && part.value === ',');
  if (comma < 0) return;
  const fallback = parseValue(
    parts
      .slice(comma + 1)
      .map((part) => cssTree.generate(part))
      .join(''),
  );
  if (use) rewriteDescriptor(context, fallback, use, sourcePath, actual);
  else rewriteVariables(context, fallback, undefined, sourcePath, actual);
  node.children = new cssTree.List<cssTree.CssNode>().fromArray([
    first,
    { type: 'Operator', value: ',' },
    { type: 'Raw', value: cssTree.generate(fallback) },
  ]);
}
interface DescriptorTemplate {
  readonly value: cssTree.Value;
  readonly use: DescriptorUse;
  readonly sourcePath: string;
  readonly actual: boolean | UseCheck;
  readonly parts: readonly cssTree.CssNode[];
  readonly vars: readonly cssTree.FunctionNode[];
}

/** Caller owns the AST. Actual consumers check all cascade candidates; mirrors are speculative. */
export function rewriteDescriptor(
  context: StyleRewriteContext,
  value: cssTree.Value | cssTree.Raw,
  use: DescriptorUse,
  sourcePath: string,
  actual: boolean | UseCheck,
): void {
  if (value.type === 'Raw') {
    rewriteVariables(context, value, use, sourcePath, actual);
    return;
  }
  const parts = value.children.toArray(),
    vars = parts.filter(isVar);
  if (parts.length === 1 && vars.length === 1) {
    rewriteVar(context, vars[0], use, sourcePath, actual);
    return;
  }
  if (!vars.length) {
    renameGrammar(context.symbols, value, use);
    rewriteVariables(context, value, undefined, sourcePath, actual);
    return;
  }
  const template: DescriptorTemplate = { value, use, sourcePath, actual, parts, vars };
  if (use === 'animation') {
    rewriteAnimationTemplate(context, template);
    return;
  }
  if (use === 'animation-name') {
    for (const part of parts)
      if (!isVar(part))
        renameGrammar(context.symbols,
          { type: 'Value', children: new cssTree.List<cssTree.CssNode>().fromArray([part]) },
          use,
        );
    for (const variable of vars) rewriteVar(context, variable, use, sourcePath, actual);
    return;
  }
  rewriteFontTemplate(context, template);
}

function rewriteAnimationTemplate(context: StyleRewriteContext, template: DescriptorTemplate): void {
  const { value, use, sourcePath, actual, parts, vars } = template;
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
      rewriteDescriptor(context,
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
  if (context.ambiguousAnimationNames.size) {
    rewriteAmbiguousAnimationTemplate(context, template);
    return;
  }
  // With no owned keyword-looking names, these identities can only name frames.
  for (const part of parts) if (!isVar(part)) rename(part, context.symbols.animations);
  for (const variable of vars) rewriteVar(context, variable, 'animation', sourcePath, actual);
  return;
}

function rewriteAmbiguousAnimationTemplate(context: StyleRewriteContext, template: DescriptorTemplate): void {
  const { sourcePath, actual, parts, vars, value, use } = template;
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
  renameGrammar(context.symbols, fixed, 'animation');
  rewriteVar(context, vars[0], 'animation', sourcePath, actual);
  return;
}

function rewriteFontTemplate(context: StyleRewriteContext, template: DescriptorTemplate): void {
  const { sourcePath, actual, parts, vars, value, use } = template;
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
  renameGrammar(context.symbols, probe, use);
  const retained = new Set(probe.children.toArray());
  value.children.forEach((part, item) => {
    if (!isVar(part) && !retained.has(part)) value.children.remove(item);
  });
  for (const variable of vars) rewriteVar(context, variable, 'font-family', sourcePath, actual);
}

export const rewriteDeclaration = (
  context: StyleRewriteContext,
  node: cssTree.Declaration,
  sourcePath: string,
  actual: boolean | UseCheck = true,
) => {
  const property = cssProperty(node.property);
  node.property = cssTree.ident.encode(variableName(context.symbols, property));
  const use = descriptorUse(context.symbols, property);
  if (use) rewriteDescriptor(context, node.value, use, sourcePath, actual);
  else rewriteVariables(context, node.value, undefined, sourcePath, actual);
};
export const mirrors = (context: StyleRewriteContext, node: cssTree.Declaration, sourcePath: string): cssTree.Declaration[] => {
  const property = cssProperty(node.property);
  if (!property.startsWith('--')) return [];
  return context.symbols.uses.map((use) => {
    const copy = cssTree.clone(node) as cssTree.Declaration;
    copy.property = mirrorName(context.symbols, property, use);
    rewriteDescriptor(context, copy.value, use, sourcePath, false);
    return copy;
  });
};
