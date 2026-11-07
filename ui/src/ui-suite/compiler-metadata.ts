import type { UiSourceDefinition } from '../customization/ownership';
import type { UiSuiteBundle } from './model';
import type { SuiteCompilationPlan } from './compiler-plan';

/** Publish provenance after resource preparation, using the same graph as execution. */
export function createCompilationMetadata(owned: UiSuiteBundle, plan: SuiteCompilationPlan) {
  const { viewEntries, sites, graph, overrides } = plan;
  const viewMetadata = new Map(
    [...viewEntries].map(([viewId, sourcePath]) => [
      viewId,
      Object.freeze({
        viewId,
        sourcePath,
        routeId: owned.manifest.routes.find((route) => `page.${route.id}` === viewId)?.id ?? null,
      }),
    ]),
  );
  const sourceDefinitions: UiSourceDefinition[] = [];
  const publishEntrySites = (entry: string, viewId: string | null, routeId: string | null) => {
    const paths = new Set<string>();
    const visit = (path: string) => {
      if (paths.has(path)) return;
      paths.add(path);
      for (const dependency of graph.modules.get(path)?.runtimeDependencies ?? [])
        visit(dependency);
    };
    visit(entry);
    for (const definition of sites)
      if (paths.has(definition.sourcePath))
        sourceDefinitions.push(
          Object.freeze({
            target: definition.target,
            site: definition.site,
            sourcePath: definition.sourcePath,
            nameKey: null,
            type: definition.target.startsWith('element.') ? 'element' : 'component',
            routeId,
            viewId,
          }),
        );
  };
  for (const [viewId, entry] of viewEntries) {
    const metadata = viewMetadata.get(viewId)!;
    sourceDefinitions.push(
      Object.freeze({
        target: viewId,
        site: `view:${viewId}`,
        sourcePath: entry,
        nameKey: null,
        type: 'view',
        routeId: metadata.routeId,
        viewId,
      }),
    );
    publishEntrySites(entry, viewId, metadata.routeId);
  }
  for (const override of overrides)
    if (override.entry) publishEntrySites(override.entry, null, null);
  for (const override of owned.manifest.overrides)
    sourceDefinitions.push(
      Object.freeze({
        target: override.selector.target,
        site: null,
        sourcePath: override.entry ?? override.stylesheet,
        nameKey: null,
        type: 'override',
        routeId: null,
        viewId: null,
        selector: override.selector,
      }),
    );
  return { viewMetadata, sourceDefinitions: Object.freeze(sourceDefinitions) };
}
