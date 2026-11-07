import { canonicalSuiteJson, compareCodePoints } from './canonical';
import type { UiSiteDefinition } from '../customization/html-sites';
import type { UiSuiteBundle } from './model';
import type { SerializedSuiteModuleGraph, SuiteModuleGraph } from './module-graph-runtime';

export interface BuiltinGraphPlan {
  readonly signature: string;
  readonly graph: SerializedSuiteModuleGraph;
  readonly sites: readonly UiSiteDefinition[];
}
export interface CompiledGraphPlan {
  readonly graph: SuiteModuleGraph;
  readonly sites: readonly UiSiteDefinition[];
}
export interface BuiltinGraphPlans {
  readonly compilerSignature: string;
  readonly plans: readonly BuiltinGraphPlan[];
}
/** Call only after complete bundle validation. Full path topology guards import ambiguity. */
export function graphPlanSignature(
  bundle: UiSuiteBundle,
  entries: readonly string[],
  publicNames: readonly string[],
  compilerSignature: string,
  transformKey = '',
): string {
  return canonicalSuiteJson([
    'suite-graph-plan-v1', compilerSignature, transformKey, entries, publicNames,
    [...bundle.manifest.files].sort((a, b) => compareCodePoints(a.path, b.path)).map(file =>
      file.kind === 'asset' ? [file.path, file.kind, file.sha256, file.media_type] :
        file.kind === 'ts' || file.kind === 'tsx' ? [file.path, file.kind, file.sha256] :
          [file.path, file.kind]),
  ]);
}
