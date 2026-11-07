import { loadPublicModules } from './publicModules';
import { validateSuiteBundleAndDigest, normalizeDraftBundle } from './bundle';
import type { UiSuiteBundle } from './model';
import { createPreparedSuite, createSuiteRuntimeScope, suiteScopeState } from './prepared';
import type { ModuleLease, PreparedSuiteRuntime, PreparedUiSuite, ResourceLease, SuiteRuntimeScope } from './prepared';
import { assertCompileCurrent as current } from './compile-options';
import type { SuiteCompileOptions } from './compile-options';
import { createCompilationPlan } from './compiler-plan';
import { acquireCompilationAssets, prepareCompilationStyles, prepareCompilationModule } from './compiler-resources';
import { createCompilationMetadata } from './compiler-metadata';
export { loadPublicModules };
export type { PreparedUiSuite, UiViewProps } from './prepared';
export type { SuiteCompileOptions } from './compile-options';

export function compileSuite(
  bundle: UiSuiteBundle,
  signal?: AbortSignal,
): Promise<PreparedUiSuite> {
  return compileSuiteInScope(bundle, createSuiteRuntimeScope(), { signal });
}
/** Only explicitly host-owned drafts may have descriptors rebuilt. Imported bundles use compileSuiteInScope. */
export async function compileSuiteDraftInScope(
  draft: UiSuiteBundle,
  scope: SuiteRuntimeScope,
  options: SuiteCompileOptions = {},
): Promise<PreparedSuiteRuntime> {
  current(options);
  const owned = await normalizeDraftBundle(draft);
  current(options);
  return compileSuiteInScope(owned, scope, options);
}
export async function compileSuiteInScope(
  bundle: UiSuiteBundle,
  scope: SuiteRuntimeScope,
  options: SuiteCompileOptions = {},
): Promise<PreparedSuiteRuntime> {
  current(options);
  const { bundle: owned, digest } = await validateSuiteBundleAndDigest(bundle);
  current(options);
  const plan = await createCompilationPlan(owned, options);
  current(options);
  const state = suiteScopeState(scope);
  const staticLeases: ResourceLease[] = [], cssLeases: ResourceLease[] = [];
  let module: ModuleLease | undefined;
  try {
    const cssUrls = acquireCompilationAssets({ plan, scope, options }, plan.cssAssets, cssLeases);
    const styleUsages = prepareCompilationStyles(plan, cssUrls);
    module = await prepareCompilationModule(plan, scope, options, staticLeases);
    current(options);
    return createPreparedSuite(
      {
        digest,
        codeGraphDigest: plan.codeGraphDigest,
        views: new Map([...plan.viewEntries].map(([id, path]) => [id, module!.components.get(path)!])),
        routes: owned.manifest.routes,
        targetBindings: plan.overrides.map((o, index) => ({
          selector: o.selector,
          Component: o.entry ? module!.components.get(o.entry) : undefined,
          styleGroup: `target-${index}`,
        })),
        styleUsages,
        ...createCompilationMetadata(owned, plan),
      },
      state.namespace,
      module,
      cssLeases,
    );
  } catch (error) {
    module?.release();
    for (const lease of staticLeases) lease.release();
    for (const lease of cssLeases) lease.release();
    throw error;
  }
}
