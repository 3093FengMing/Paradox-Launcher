import { loadPublicModules } from './publicModules';
import { prepareSuiteCss } from '../customization/css';
import { parseSuiteHtml } from '../customization/html';
import { canonicalSuiteJson, sha256, utf8 } from './canonical';
import { resolveSuitePath } from './paths';
import { getSuiteModuleGraph } from './graph-cache';
import type { UiSiteDefinition } from '../customization/html-sites';
import type { UiSuiteBundle } from './model';
import { assertCompileCurrent as current } from './compile-options';
import type { SuiteCompileOptions } from './compile-options';

/** Validated owned input only. Analysis never acquires runtime URLs or executes modules. */
export async function createCompilationPlan(owned: UiSuiteBundle, options: SuiteCompileOptions) {
  const files = new Map(Object.entries(owned.files)),
    descriptors = new Map(owned.manifest.files.map((f) => [f.path, f]));
  const viewEntries = new Map(Object.entries(owned.manifest.views));
  for (const route of owned.manifest.routes) viewEntries.set(`page.${route.id}`, route.entry);
  const overrides = owned.manifest.overrides.filter((o) => o.enabled);
  const entryPaths = [
    ...new Set([...viewEntries.values(), ...overrides.flatMap((o) => (o.entry ? [o.entry] : []))]),
  ];
  const htmlPaths = entryPaths.filter((p) => descriptors.get(p)!.kind === 'html');
  const plan = await getSuiteModuleGraph(
    owned,
    entryPaths.filter((p) => !htmlPaths.includes(p)),
    Object.keys(loadPublicModules()),
    options.transform,
  );
  current(options);
  const graph = plan.graph, sites: UiSiteDefinition[] = [...plan.sites];
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
  for (const path of new Set(rawUsages.map((usage) => usage.path)))
    prepareSuiteCss(source(path), {
      sourcePath: path,
      resolveAsset(reference) {
        const resolved = resolveResource(path, reference);
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
  return { files, descriptors, viewEntries, overrides, htmlPaths, graph, sites,
    source, resolveResource, staticAssets, cssAssets, rawUsages, codeGraphDigest };
}
export type SuiteCompilationPlan = Awaited<ReturnType<typeof createCompilationPlan>>;
