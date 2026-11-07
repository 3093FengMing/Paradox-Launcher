import type * as cssTree from 'css-tree';

export interface SuiteCssSource {
  readonly sourcePath: string;
  readonly ast: cssTree.StyleSheet;
}
export interface SuiteAssetSource {
  sourcePath: string;
  resolveAsset(reference: string): string;
}
export interface SuiteStyleRewriter {
  render(
    sources: readonly SuiteCssSource[],
    shadow: boolean,
    boundary?: string,
    subjectBoundary?: string,
  ): string;
  inline(style: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
