
import type * as cssTree from 'css-tree';

export type DescriptorUse = 'animation-name' | 'animation' | 'font-family' | 'font';
export type CssValue = cssTree.Value | cssTree.Raw;
export interface StyleSymbols {
  readonly namespace: string;
  readonly animations: ReadonlyMap<string, string>;
  readonly fonts: ReadonlyMap<string, string>;
  readonly properties: ReadonlyMap<string, string>;
  readonly layers: ReadonlyMap<string, string>;
  readonly uses: readonly DescriptorUse[];
}
export interface VariableDefinition {
  readonly value: CssValue;
  readonly sourcePath: string;
}
export interface StyleVariables {
  readonly definitions: ReadonlyMap<string, readonly VariableDefinition[]>;
  readonly registrations: ReadonlyMap<string, readonly { syntax: string; initial?: CssValue }[]>;
}
// A check belongs to one consumer/preflight/render; prepared source ASTs stay read-only.
export interface UseCheck {
  readonly definitions: ReadonlyMap<string, readonly VariableDefinition[]>;
  readonly visiting: Set<string>;
  readonly checked: Set<string>;
}
export interface StyleRewriteContext {
  readonly symbols: StyleSymbols;
  readonly variables: StyleVariables;
  readonly ambiguousAnimationNames: ReadonlySet<string>;
}
export type RewriteDescriptor = (
  context: StyleRewriteContext,
  value: CssValue,
  use: DescriptorUse,
  sourcePath: string,
  actual: boolean | UseCheck,
) => void;
export interface RegistrationConsumer {
  readonly name: string;
  readonly use: DescriptorUse;
  readonly consumer: cssTree.CssNode;
  readonly sourcePath: string;
  readonly check: UseCheck;
}
export interface StyleRenderOptions {
  readonly shadow: boolean;
  readonly boundary?: string;
  readonly subjectBoundary?: string;
}
