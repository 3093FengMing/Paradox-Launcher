import { createContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { LauncherActions, LauncherSnapshot } from '../launcher/public/types';
import type { UiRouteDescriptor, UiSelector } from './model';
import type { SuiteCssSource } from '../customization/css';
import { createSuiteStyleRewriter } from '../customization/css';
import type { SuiteStyleRewriter } from '../customization/css';
import type { UiSourceDefinition, UiViewPublication } from '../customization/ownership';

export interface UiViewProps {
  snapshot: Readonly<LauncherSnapshot>;
  actions: LauncherActions;
  props: Readonly<Record<string, unknown>>;
  children?: ReactNode;
  Original: ComponentType<Record<string, unknown>>;
}
export interface PreparedUiSuite {
  digest: string;
  views: ReadonlyMap<string, ComponentType<UiViewProps>>;
  routes: readonly UiRouteDescriptor[];
  /** Prepared global/debug CSS. Hosts install through attachSuiteStyles. */
  css: string;
  dispose(): void;
}
export interface PreparedTargetBinding {
  readonly selector: UiSelector;
  readonly Component?: ComponentType<UiViewProps>;
  readonly styleGroup: string;
}
export interface SuiteStyleUsage {
  readonly group: string;
  readonly source: SuiteCssSource;
  readonly viewId?: string;
  readonly selector?: UiSelector;
}
/** Private host metadata; each primary/parent/trusted layer retains its own instance. */
export interface PreparedSuiteRuntime extends PreparedUiSuite {
  readonly codeGraphDigest: string;
  readonly targetBindings: readonly PreparedTargetBinding[];
  readonly styleUsages: readonly SuiteStyleUsage[];
  readonly styleGroups: ReadonlyMap<string, SuiteStyleRewriter>;
  readonly sourceDefinitions: readonly UiSourceDefinition[];
  readonly viewMetadata: ReadonlyMap<string, Omit<UiViewPublication, 'layerId'>>;
}
export type SuiteInlineStyleResolver = (
  style: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;
/** The activated layer/view supplies this context; compilation never mutates it.
 * The shared JSX runtime consumes the same resolver for DOM style properties. */
export const SuiteInlineStyleContext = createContext<SuiteInlineStyleResolver | null>(null);
export function suiteInlineStyleResolver(
  prepared: PreparedSuiteRuntime,
  group = 'global',
): SuiteInlineStyleResolver {
  return (style) => prepared.styleGroups.get(group)?.inline(style) ?? { ...style };
}
const scopeBrand: unique symbol = Symbol('SuiteRuntimeScope');
export interface SuiteRuntimeScope {
  readonly [scopeBrand]: true;
}
interface AssetRecord {
  url: string;
  refs: number;
}
export interface ResourceLease {
  readonly url: string;
  release(): void;
}
export interface ModuleLease {
  readonly components: ReadonlyMap<string, ComponentType<UiViewProps>>;
  retain(): ModuleLease;
  release(): void;
}
interface ScopeState {
  readonly assets: Map<string, AssetRecord>;
  readonly modules: Map<string, ModuleLease>;
  readonly namespace: string;
}
const scopes = new WeakMap<SuiteRuntimeScope, ScopeState>();
/** Host creates one token per suite instance/lineage, never per CSS preview. */
export function createSuiteRuntimeScope(): SuiteRuntimeScope {
  const token: SuiteRuntimeScope = Object.freeze({ [scopeBrand]: true as const });
  scopes.set(token, {
    assets: new Map(),
    modules: new Map(),
    namespace: crypto.randomUUID().replaceAll('-', ''),
  });
  return token;
}
export function suiteScopeState(scope: SuiteRuntimeScope): ScopeState {
  const state = scopes.get(scope);
  if (!state) throw new Error('Unknown suite runtime scope.');
  return state;
}
export function acquireSuiteAsset(
  scope: SuiteRuntimeScope,
  key: string,
  bytes: Uint8Array,
  mediaType: string,
): ResourceLease {
  const pool = suiteScopeState(scope).assets;
  let record = pool.get(key);
  if (!record) {
    record = {
      url: URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mediaType })),
      refs: 0,
    };
    pool.set(key, record);
  }
  record.refs++;
  const owned = record;
  let live = true;
  return {
    url: record.url,
    release() {
      if (!live) return;
      live = false;
      if (--owned.refs === 0) {
        pool.delete(key);
        URL.revokeObjectURL(owned.url);
      }
    },
  };
}
export function registerModuleLease(
  scope: SuiteRuntimeScope,
  key: string,
  components: ReadonlyMap<string, ComponentType<UiViewProps>>,
  resources: readonly ResourceLease[],
): ModuleLease {
  const modules = suiteScopeState(scope).modules;
  let refs = 1;
  const lease: ModuleLease = {
    components,
    retain() {
      if (refs === 0) throw Error('Released module lease.');
      refs++;
      return lease;
    },
    release() {
      if (refs === 0) return;
      if (--refs === 0) {
        if (modules.get(key) === lease) modules.delete(key);
        for (const resource of resources) resource.release();
      }
    },
  };
  modules.set(key, lease);
  return lease;
}
export interface SuiteStyleRoot {
  /** Optional private owning-layer guard on each matched declaration subject. */
  readonly subjectBoundary?: string;
  readonly id: 'launcher.main' | 'launcher.editor';
  /** The shared registry supplies stable boundaries, including unmounted targets. */
  resolveTarget(selector: UiSelector): string | null;
  readonly viewIds: ReadonlySet<string>;
}
interface PreparedOwnership {
  disposed: boolean;
  namespace: string;
  detaches: Set<() => void>;
}
const ownership = new WeakMap<PreparedUiSuite, PreparedOwnership>();
export function createPreparedSuite(
  data: Omit<PreparedSuiteRuntime, 'dispose' | 'css' | 'styleGroups'>,
  namespace: string,
  module: ModuleLease,
  resources: readonly ResourceLease[],
): PreparedSuiteRuntime {
  const state: PreparedOwnership = { disposed: false, namespace, detaches: new Set() };
  const globals = data.styleUsages.filter((u) => !u.selector);
  const styleGroups = new Map<string, SuiteStyleRewriter>();
  for (const group of new Set(data.styleUsages.map((u) => u.group)))
    styleGroups.set(
      group,
      createSuiteStyleRewriter(
        [...new Set(data.styleUsages.filter((u) => u.group === group).map((u) => u.source))],
        `${namespace}-${group}`,
      ),
    );
  const prepared: PreparedSuiteRuntime = {
    ...data,
    styleGroups,
    css: renderStyleGroups(globals, styleGroups, false),
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      for (const detach of [...state.detaches]) detach();
      for (const resource of resources) resource.release();
      module.release();
    },
  };
  ownership.set(prepared, state);
  return prepared;
}
function renderStyleGroups(
  usages: readonly SuiteStyleUsage[],
  styleGroups: ReadonlyMap<string, SuiteStyleRewriter>,
  shadow: boolean,
  resolve?: (selector: UiSelector) => string | null,
  subjectBoundary?: string,
): string {
  const groups = new Map<string, SuiteStyleUsage[]>();
  for (const usage of usages) {
    const rows = groups.get(usage.group) ?? [];
    if (!rows.some((row) => row.source === usage.source)) rows.push(usage);
    groups.set(usage.group, rows);
  }
  const output: string[] = [];
  for (const [group, rows] of groups) {
    const selector = rows[0]?.selector;
    const boundary = selector ? resolve?.(selector) : undefined;
    if (selector && !boundary) continue;
    output.push(
      styleGroups.get(group)!.render(
        rows.map((r) => r.source),
        shadow,
        boundary ?? undefined,
        subjectBoundary,
      ),
    );
  }
  return output.join('\n');
}
/** Synchronous install/detach. No separate identity or style-state owner is created. */
export function attachSuiteStyles(
  root: Document | ShadowRoot,
  prepared: PreparedUiSuite,
  renderRoot: SuiteStyleRoot,
): () => void {
  const state = ownership.get(prepared);
  if (!state || state.disposed) throw Error('Cannot install a disposed or foreign prepared suite.');
  const runtime = prepared as PreparedSuiteRuntime;
  const usages = runtime.styleUsages.filter((usage) => {
    if (usage.selector?.kind === 'position' && usage.selector.locator.renderRoot !== renderRoot.id)
      return false;
    if (!usage.viewId) return true;
    return renderRoot.viewIds.has(usage.viewId);
  });
  const document = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument!;
  const style = document.createElement('style');
  style.dataset.uiSuite = prepared.digest;
  style.textContent = renderStyleGroups(
    usages,
    runtime.styleGroups,
    root.nodeType !== Node.DOCUMENT_NODE,
    (selector) => renderRoot.resolveTarget(selector),
    renderRoot.subjectBoundary,
  );
  if (root.nodeType === Node.DOCUMENT_NODE) (root as Document).head.append(style);
  else root.append(style);
  const detach = () => {
    style.remove();
    state.detaches.delete(detach);
  };
  state.detaches.add(detach);
  return detach;
}
