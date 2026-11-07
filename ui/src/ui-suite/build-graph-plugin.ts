import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import * as ts from 'typescript';
import type { Plugin, ViteDevServer } from 'vite';
import { buildModuleGraph } from './module-graph';
import { serializeModuleGraph } from './module-graph-runtime';
import { graphPlanSignature } from './graph-plan';
import type { BuiltinGraphPlans } from './graph-plan';
import { suiteSiteTransform } from '../customization/site-transform';
import type { UiSiteDefinition } from '../customization/html-sites';
import type { UiFile, UiFileDescriptor, UiSuiteBundle, UiSuiteManifest } from './model';
import { canonicalSuiteJson, compareCodePoints } from './canonical';

const virtualId = 'virtual:ui-suite-graph-plans', resolvedId = `\0${virtualId}`;
// A runtime public-module change produces a signature miss and the normal compiler fallback.
const publicNames = ['react', 'react/jsx-runtime', 'lucide-react', '@paradox/ui', '@paradox/launcher', 'react-i18next'];
const compilerSources = [
  'ui-suite/module-graph.ts', 'ui-suite/module-graph-runtime.ts', 'ui-suite/graph-plan.ts',
  'ui-suite/build-graph-plugin.ts', 'ui-suite/paths.ts', 'ui-suite/canonical.ts',
  'host/suite-paths.ts', 'host/unicode/scalars.ts', 'host/unicode/unicode-nfc.ts',
  'host/unicode/unicode-nfc-15.1.0.json', 'host/unicode/unicode-simple-fold-15.1.0.json',
  'customization/site-transform.ts', 'customization/html-sites.ts',
];
async function tree(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => compareCodePoints(a.name, b.name))) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await tree(join(directory, entry.name), path + '/'));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
/** Build-only: exact canonical files and the same pure compiler/site transformer as edited suites. */
export async function createBuiltinGraphPlans(uiRoot: string): Promise<BuiltinGraphPlans> {
  const sourceRoot = resolve(uiRoot, 'src'), builtinRoot = resolve(sourceRoot, 'ui-suite/builtins');
  const compilerInputs = await Promise.all(compilerSources.map(async path => [path, await readFile(resolve(sourceRoot, path), 'utf8')]));
  const compilerSignature = createHash('sha256').update(canonicalSuiteJson([ts.version, compilerInputs])).digest('hex');
  const names = (await tree(builtinRoot)).filter(path => /\.(?:ts|tsx|css|json)$/.test(path) || /^common\/assets\/[^/]+\.(?:png|svg)$/.test(path));
  const contents = new Map(await Promise.all(names.map(async path => [path, await readFile(resolve(builtinRoot, path))] as const)));
  const plans = [];
  for (const id of ['modern', 'immersive']) {
    const files: Record<string, UiFile> = Object.create(null) as Record<string, UiFile>;
    const descriptors: UiFileDescriptor[] = [];
    for (const [path, bytes] of contents) {
      if (!(path.startsWith('common/') || path.startsWith(id + '/')) || path.endsWith('/suite.json')) continue;
      const asset = /\.(?:png|svg)$/.test(path), kind = asset ? 'asset' : path.split('.').at(-1);
      if (!kind || !['asset', 'ts', 'tsx', 'css'].includes(kind)) throw Error(`Unsupported builtin graph file: ${path}`);
      const media = path.endsWith('.png') ? 'image/png' : 'image/svg+xml';
      files[path] = asset ? { encoding: 'base64', media_type: media, data: bytes.toString('base64') } :
        { encoding: 'utf8', text: bytes.toString('utf8') };
      descriptors.push({ path, kind: kind as UiFileDescriptor['kind'], bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), ...(asset ? { media_type: media } : {}) });
    }
    // Runtime validation canonicalizes object keys before collecting module entries.
    // Keep that same initialization order, not the handwritten manifest key order.
    const manifest = JSON.parse(canonicalSuiteJson(JSON.parse(contents.get(`${id}/suite.json`)!.toString('utf8')))) as UiSuiteManifest;
    manifest.files = descriptors;
    const bundle: UiSuiteBundle = { manifest, files };
    const viewEntries = new Map(Object.entries(manifest.views));
    for (const route of manifest.routes) viewEntries.set(`page.${route.id}`, route.entry);
    const entries = [...new Set([...viewEntries.values(), ...manifest.overrides.filter(override => override.enabled).flatMap(override => override.entry ? [override.entry] : [])])];
    const sites: UiSiteDefinition[] = [];
    const graph = buildModuleGraph(bundle, entries, publicNames, suiteSiteTransform(rows => sites.push(...rows)));
    plans.push({ signature: graphPlanSignature(bundle, entries, publicNames, compilerSignature), graph: serializeModuleGraph(graph), sites });
  }
  return { compilerSignature, plans };
}
export function builtinGraphPlansPlugin(uiRoot: string): Plugin {
  const builtinRoot = resolve(uiRoot, 'src/ui-suite/builtins').replaceAll('\\', '/') + '/';
  const compilerPaths = new Set(compilerSources.map(path => resolve(uiRoot, 'src', path).replaceAll('\\', '/')));
  const changed = (server: ViteDevServer, path: string) => {
    const normalized = path.replaceAll('\\', '/');
    if (compilerPaths.has(normalized)) { void server.restart(); return; }
    if (!normalized.startsWith(builtinRoot)) return;
    const module = server.moduleGraph.getModuleById(resolvedId);
    if (module) server.moduleGraph.invalidateModule(module);
    server.ws.send({ type: 'full-reload' });
  };
  return {
    name: 'ui-builtin-graph-plans',
    resolveId(id) { if (id === virtualId) return resolvedId; },
    async load(id) {
      if (id !== resolvedId) return;
      const metadata = await createBuiltinGraphPlans(uiRoot);
      return `export const compilerSignature=${JSON.stringify(metadata.compilerSignature)};export const plans=${JSON.stringify(metadata.plans)};`;
    },
    configureServer(server) {
      const onTopology = (path: string) => changed(server, path);
      server.watcher.on('add', onTopology); server.watcher.on('unlink', onTopology);
      server.httpServer?.once('close', () => {
        server.watcher.off('add', onTopology); server.watcher.off('unlink', onTopology);
      });
    },
    handleHotUpdate(context) {
      changed(context.server, context.file);
      if (context.file.replaceAll('\\', '/').startsWith(builtinRoot)) return [];
    },
  };
}
