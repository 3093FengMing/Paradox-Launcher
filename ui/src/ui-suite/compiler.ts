import { useContext } from 'react';
import type { ComponentType } from 'react';
import { loadPublicModules } from './publicModules';
import { prepareSuiteCss } from '../customization/css';
import { parseSuiteHtml, renderSuiteHtml } from '../customization/html';
import { bundleDigest, suiteFileBytes, validateSuiteBundle, normalizeDraftBundle } from './bundle';
import { canonicalSuiteJson, sha256, utf8 } from './canonical';
import { resolveSuitePath } from './paths';
import { buildModuleGraph, moduleBlobSource } from './module-graph';
import type { SuiteSourceTransform } from './module-graph';
import { suiteSiteTransform } from '../customization/site-transform';
import type { UiSiteDefinition } from '../customization/site-transform';
import type { UiSourceDefinition } from '../customization/ownership';
import type { UiSuiteBundle } from './model';
import {
  acquireSuiteAsset,
  createPreparedSuite,
  createSuiteRuntimeScope,
  registerModuleLease,
  suiteScopeState,
  SuiteInlineStyleContext,
} from './prepared';
import type {
  ModuleLease,
  PreparedSuiteRuntime,
  PreparedUiSuite,
  ResourceLease,
  SuiteRuntimeScope,
  SuiteStyleUsage,
  UiViewProps,
} from './prepared';
export { loadPublicModules };
export type { PreparedUiSuite, UiViewProps } from './prepared';

export interface SuiteCompileOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  transform?: SuiteSourceTransform;
}
function current(options: SuiteCompileOptions): void {
  if (options.signal?.aborted || (options.isCurrent && !options.isCurrent()))
    throw new DOMException('Suite compilation was cancelled or superseded.', 'AbortError');
}
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
  const owned = await validateSuiteBundle(bundle);
  current(options);
  const digest = await bundleDigest(owned);
  current(options);
  const files = new Map(Object.entries(owned.files)),
    descriptors = new Map(owned.manifest.files.map((f) => [f.path, f]));
  const viewEntries = new Map(Object.entries(owned.manifest.views));
  for (const route of owned.manifest.routes) viewEntries.set(`page.${route.id}`, route.entry);
  const overrides = owned.manifest.overrides.filter((o) => o.enabled);
  const entryPaths = [
    ...new Set([...viewEntries.values(), ...overrides.flatMap((o) => (o.entry ? [o.entry] : []))]),
  ];
  const htmlPaths = entryPaths.filter((p) => descriptors.get(p)!.kind === 'html');
  const sites: UiSiteDefinition[] = [];
  const graph = buildModuleGraph(
    owned,
    entryPaths.filter((p) => !htmlPaths.includes(p)),
    Object.keys(loadPublicModules()),
    suiteSiteTransform((rows) => sites.push(...rows), options.transform),
  );
  const source = (path: string) => {
    const f = files.get(path);
    if (!f || f.encoding !== 'utf8') throw Error(`${path}:1:1: Expected UTF-8 source.`);
    return f.text;
  };
  const resolveResource = (
    from: string,
    reference: string,
  ): { path: string; fragment: string } | null => {
    if (reference.startsWith('#')) {
      if (reference.length === 1 || reference.includes('?'))
        throw Error(`${from}:1:1: Invalid resource fragment.`);
      return null;
    }
    const hash = reference.indexOf('#'),
      path = hash < 0 ? reference : reference.slice(0, hash),
      fragment = hash < 0 ? '' : reference.slice(hash);
    if (reference.includes('?')) throw Error(`${from}:1:1: Resource queries are not supported.`);
    let resolved: string;
    try {
      if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path))
        throw new Error('Resources must use a relative suite path.');
      resolved = resolveSuitePath(
        from,
        path.startsWith('./') || path.startsWith('../') ? path : `./${path}`,
        files,
      );
    } catch (error) {
      throw Error(`${from}:1:1: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    if (descriptors.get(resolved)?.kind !== 'asset')
      throw Error(`${from}:1:1: ${reference} is not an asset.`);
    return { path: resolved, fragment };
  };
  const staticAssets = new Set(
    [...graph.modules.values()].filter((m) => m.kind === 'asset').map((m) => m.path),
  );
  for (const path of htmlPaths) {
    const nodes = parseSuiteHtml(source(path), {
      sourcePath: path,
      resolveAsset(reference) {
        const resolved = resolveResource(path, reference);
        if (resolved) staticAssets.add(resolved.path);
        return reference;
      },
    });
    const visit = (node: (typeof nodes)[number]) => {
      if ('text' in node) return;
      const site = node.attributes['data-ui-site'];
      if (site)
        sites.push({
          site,
          target: node.attributes['data-ui-target'] ?? `element.${node.tag}`,
          sourcePath: path,
          automatic: site.startsWith('auto:'),
        });
      node.children.forEach(visit);
    };
    nodes.forEach(visit);
  }
  const rawUsages: {
    group: string;
    path: string;
    viewId?: string;
    selector?: (typeof overrides)[number]['selector'];
  }[] = [];
  for (const path of owned.manifest.styles) rawUsages.push({ group: 'global', path });
  for (const [viewId, entry] of viewEntries)
    for (const path of graph.stylesFor(entry)) rawUsages.push({ group: 'global', path, viewId });
  overrides.forEach((override, index) => {
    const group = `target-${index}`;
    if (override.stylesheet)
      rawUsages.push({ group, path: override.stylesheet, selector: override.selector });
    if (override.entry)
      for (const path of graph.stylesFor(override.entry))
        rawUsages.push({ group, path, selector: override.selector });
  });
  const cssAssets = new Set<string>();
  for (const usage of rawUsages)
    prepareSuiteCss(source(usage.path), {
      sourcePath: usage.path,
      resolveAsset(reference) {
        const resolved = resolveResource(usage.path, reference);
        if (resolved) cssAssets.add(resolved.path);
        return reference;
      },
    });
  const codeGraphDigest = await sha256(
    utf8(
      canonicalSuiteJson([
        graph.identity,
        htmlPaths.map((p) => [p, source(p)]),
        [...staticAssets].sort().map((p) => [p, descriptors.get(p)!.sha256]),
      ]),
    ),
  );
  current(options);
  const state = suiteScopeState(scope);
  const staticLeases: ResourceLease[] = [],
    cssLeases: ResourceLease[] = [];
  let module: ModuleLease | undefined;
  try {
    const acquire = (paths: ReadonlySet<string>, leases: ResourceLease[]) => {
      const urls = Object.create(null) as Record<string, string>;
      for (const path of paths) {
        current(options);
        const d = descriptors.get(path)!;
        const lease = acquireSuiteAsset(
          scope,
          `${d.media_type}:${d.sha256}`,
          suiteFileBytes(files.get(path)!),
          d.media_type!,
        );
        leases.push(lease);
        urls[path] = lease.url;
      }
      return urls;
    };
    const cssUrls = acquire(cssAssets, cssLeases);
    const resourceResolver =
      (path: string, urls: Record<string, string>) => (reference: string) => {
        const resolved = resolveResource(path, reference);
        return resolved ? urls[resolved.path] + resolved.fragment : reference;
      };
    const styleCache = new Map<string, ReturnType<typeof prepareSuiteCss>>();
    const styleUsages: SuiteStyleUsage[] = rawUsages.map((usage) => {
      let css = styleCache.get(usage.path);
      if (!css) {
        css = prepareSuiteCss(source(usage.path), {
          sourcePath: usage.path,
          resolveAsset: resourceResolver(usage.path, cssUrls),
        });
        styleCache.set(usage.path, css);
      }
      return { ...usage, source: css };
    });
    module = state.modules.get(codeGraphDigest)?.retain();
    if (!module) {
      const staticUrls = acquire(staticAssets, staticLeases);
      const url = URL.createObjectURL(
        new Blob([moduleBlobSource(graph)], { type: 'text/javascript' }),
      );
      let loaded: {
        initialize(
          publicModules: Readonly<Record<string, unknown>>,
          assets: Record<string, string>,
        ): Record<string, { default?: unknown }>;
      };
      try {
        loaded = (await import(/* @vite-ignore */ url)) as typeof loaded;
        current(options);
      } finally {
        URL.revokeObjectURL(url);
      }
      // A concurrent compile may have installed the same graph while this import yielded.
      module = state.modules.get(codeGraphDigest)?.retain();
      if (module) {
        for (const lease of staticLeases) lease.release();
        staticLeases.length = 0;
      } else {
        current(options);
        const exports = loaded.initialize(loadPublicModules(), staticUrls);
        current(options);
        const components = new Map<string, ComponentType<UiViewProps>>();
        for (const path of graph.entries) {
          const Component = exports[path].default;
          if (typeof Component !== 'function')
            throw Error(`${path}:1:1: Export default a React component function.`);
          components.set(path, Component as ComponentType<UiViewProps>);
        }
        for (const path of htmlPaths) {
          const nodes = parseSuiteHtml(source(path), {
            sourcePath: path,
            resolveAsset: resourceResolver(path, staticUrls),
          });
          function HtmlView(props: UiViewProps) {
            const resolveStyle = useContext(SuiteInlineStyleContext);
            return renderSuiteHtml(nodes, props, resolveStyle);
          }
          components.set(path, HtmlView);
        }
        module = registerModuleLease(scope, codeGraphDigest, components, staticLeases.splice(0));
      }
    }
    current(options);
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
    return createPreparedSuite(
      {
        digest,
        codeGraphDigest,
        views: new Map([...viewEntries].map(([id, path]) => [id, module!.components.get(path)!])),
        routes: owned.manifest.routes,
        targetBindings: overrides.map((o, index) => ({
          selector: o.selector,
          Component: o.entry ? module!.components.get(o.entry) : undefined,
          styleGroup: `target-${index}`,
        })),
        styleUsages,
        sourceDefinitions: Object.freeze(sourceDefinitions),
        viewMetadata,
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
