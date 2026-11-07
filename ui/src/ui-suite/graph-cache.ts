import { graphPlanSignature } from './graph-plan';
import type { CompiledGraphPlan } from './graph-plan';
import { restoreModuleGraph } from './module-graph-runtime';
import type { UiSiteDefinition } from '../customization/html-sites';
import type { UiSuiteBundle } from './model';
import type { SuiteSourceTransform } from './module-graph';

const metadata = import('virtual:ui-suite-graph-plans');
const cache = new Map<string, { promise: Promise<CompiledGraphPlan>; bytes: number }>();
const maximumEntries = 8, maximumBytes = 16 * 1024 * 1024;
let retainedBytes = 0;
function trim() {
  while (cache.size > maximumEntries || retainedBytes > maximumBytes) {
    const key = cache.keys().next().value as string;
    retainedBytes -= cache.get(key)!.bytes;
    cache.delete(key);
  }
}
/** Pure graph/sites only; scope-owned prepared results, modules and asset leases stay separate. */
export async function getSuiteModuleGraph(
  bundle: UiSuiteBundle,
  entries: readonly string[],
  publicNames: readonly string[],
  transform?: SuiteSourceTransform,
): Promise<CompiledGraphPlan> {
  const builtins = await metadata;
  const signature = graphPlanSignature(bundle, entries, publicNames, builtins.compilerSignature, transform?.cacheKey);
  const build = async (): Promise<CompiledGraphPlan> => {
    if (!transform) {
      const prepared = builtins.plans.find(plan => plan.signature === signature);
      if (prepared) return { graph: restoreModuleGraph(prepared.graph), sites: prepared.sites };
    }
    const [{ buildModuleGraph }, { suiteSiteTransform }] = await Promise.all([
      import('./module-graph'), import('../customization/site-transform'),
    ]);
    const sites: UiSiteDefinition[] = [];
    const graph = buildModuleGraph(bundle, entries, publicNames, suiteSiteTransform(rows => sites.push(...rows), transform));
    return { graph, sites: Object.freeze(sites) };
  };
  // Caller transforms may close over mutable state; only the standard host transform is cached.
  if (transform) return build();
  const existing = cache.get(signature);
  if (existing) {
    cache.delete(signature); cache.set(signature, existing);
    return existing.promise;
  }
  const record = { promise: build(), bytes: signature.length * 2 };
  cache.set(signature, record); retainedBytes += record.bytes; trim();
  void record.promise.then(plan => {
    if (cache.get(signature) !== record) return;
    const bytes = record.bytes + plan.graph.identity.length * 2 +
      [...plan.graph.modules.values()].reduce((sum, module) => sum + (module.code.length + JSON.stringify(module.dependencies).length) * 2, 0) +
      JSON.stringify(plan.sites).length * 2;
    retainedBytes += bytes - record.bytes; record.bytes = bytes; trim();
  }, () => {
    if (cache.get(signature) !== record) return;
    retainedBytes -= record.bytes; cache.delete(signature);
  });
  return record.promise;
}
