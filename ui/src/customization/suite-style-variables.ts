import * as cssTree from 'css-tree';
import { cssKeyword, cssProperty } from './css-syntax';
import type { SuiteCssSource } from './css-types';
import { identifier } from './suite-style-symbols';
import type { StyleVariables, UseCheck, VariableDefinition } from './suite-style-types';

/** Index every cascade candidate and registered initial value without mutating sources. */
export function collectStyleVariables(sources: readonly SuiteCssSource[]): StyleVariables {
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
  return { definitions, registrations };
}

export function createUseCheck(definitions: UseCheck['definitions']): UseCheck {
  return { definitions, visiting: new Set(), checked: new Set() };
}
