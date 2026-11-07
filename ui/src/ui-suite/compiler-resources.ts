import { useContext } from 'react';
import type { ComponentType } from 'react';
import { loadPublicModules } from './publicModules';
import { prepareSuiteCss } from '../customization/css';
import { parseSuiteHtml, renderSuiteHtml } from '../customization/html';
import { suiteFileBytes } from './bundle';
import { moduleBlobSource } from './module-graph-runtime';
import { acquireSuiteAsset, registerModuleLease, suiteScopeState, SuiteInlineStyleContext } from './prepared';
import type { ModuleLease, ResourceLease, SuiteRuntimeScope, SuiteStyleUsage, UiViewProps } from './prepared';
import type { SuiteCompilationPlan } from './compiler-plan';
import { assertCompileCurrent as current } from './compile-options';
import type { SuiteCompileOptions } from './compile-options';

export function acquireCompilationAssets(
  input: { plan: SuiteCompilationPlan; scope: SuiteRuntimeScope; options: SuiteCompileOptions },
  paths: ReadonlySet<string>, leases: ResourceLease[],
): Record<string, string> {
  const { plan: { descriptors, files }, scope, options } = input;
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
}
function compilationResourceResolver(plan: SuiteCompilationPlan) {
  const { resolveResource } = plan;
  return (path: string, urls: Record<string, string>) => (reference: string) => {
      const resolved = resolveResource(path, reference);
      return resolved ? urls[resolved.path] + resolved.fragment : reference;
    };
}
export function prepareCompilationStyles(plan: SuiteCompilationPlan, cssUrls: Record<string, string>): SuiteStyleUsage[] {
  const { source, rawUsages } = plan;
  const resourceResolver = compilationResourceResolver(plan);
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
  return styleUsages;
}
/** Own the module lease until it can be handed to the caller; its error path releases it. */
export async function prepareCompilationModule(
  plan: SuiteCompilationPlan, scope: SuiteRuntimeScope, options: SuiteCompileOptions,
  staticLeases: ResourceLease[],
): Promise<ModuleLease> {
  const state = suiteScopeState(scope);
  const { codeGraphDigest, graph, htmlPaths, source, staticAssets } = plan;
  const resourceResolver = compilationResourceResolver(plan);
  const acquire = (paths: ReadonlySet<string>, leases: ResourceLease[]) =>
    acquireCompilationAssets({ plan, scope, options }, paths, leases);
  let module: ModuleLease | undefined;
  try {
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
    return module;
  } catch (error) {
    module?.release();
    throw error;
  }
}
