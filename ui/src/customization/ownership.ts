import type { UiPositionLocator, UiSelector } from '../ui-suite/model';
import type { SuiteStyleRoot } from '../ui-suite/prepared';
import { canonicalSuiteJson } from '../ui-suite/canonical';
import {
  copyLocator,
  copySelector,
  selectorDigest,
  selectorMatches,
  SelectorIndex,
} from './selectors';

export type UiStability = 'stable' | 'automatic-site' | 'missing-repeat-key' | 'unsupported';
export interface UiTargetMetadata {
  readonly nameKey: string | null;
  readonly type: string;
  readonly sourcePath: string | null;
  readonly routeId: string | null;
}
export interface UiOwnerRecord {
  readonly ownerId: string;
  readonly parentOwnerId: string | null;
  readonly target: string;
  readonly site: string | null;
  readonly locator: UiPositionLocator;
  readonly stability: UiStability;
  readonly roots: ReadonlySet<Element>;
  readonly metadata: UiTargetMetadata;
  /** Transient inherited presentation provenance; never part of a selector. */
  readonly catalogPresentation: boolean;
  readonly viewId: string | null;
  readonly layerId: string | null;
}
export interface DomOwnership {
  readonly ownerIds: readonly string[];
  readonly rootOwnerIds: readonly string[];
  readonly leafOwnerId: string | null;
}
export interface UiResolution {
  readonly status: 'resolved' | 'unmounted' | 'hidden' | 'ambiguous' | 'unsupported';
  readonly owners: readonly UiOwnerRecord[];
  readonly reason: string | null;
}
export interface UiSourceDefinition extends UiTargetMetadata {
  readonly target: string;
  readonly site: string | null;
  readonly viewId: string | null;
  readonly selector?: UiSelector;
}
export interface UiDefinitionPublication {
  readonly key: string;
  readonly definitions: readonly UiSourceDefinition[];
}
export interface UiViewPublication {
  readonly viewId: string;
  readonly sourcePath: string | null;
  readonly routeId: string | null;
  readonly layerId: string;
  readonly nameKey?: string | null;
}
export function readonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const set = new Set(values);
  const result: ReadonlySet<T> = Object.freeze({
    get size() {
      return set.size;
    },
    has: (value: T) => set.has(value),
    entries: () => set.entries(),
    keys: () => set.keys(),
    values: () => set.values(),
    [Symbol.iterator]: () => set[Symbol.iterator](),
    forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) {
      set.forEach((value) => callback.call(thisArg, value, value, result));
    },
  });
  return result;
}
const owners = new Map<string, { token: object; record: UiOwnerRecord }>();
const dom = new Map<Element, Map<object, DomOwnership>>();
const definitions = new Map<
  string,
  { token: object; definitions: readonly UiSourceDefinition[] }
>();
const views = new Map<
  object,
  { root: UiPositionLocator['renderRoot']; publication: UiViewPublication }
>();
// Full selectors leased by registry adapters remain present while their CSS can
// match future mounts. This is identity verification, never pending style metadata.
const boundaries = new Map<object, UiSelector>();
// A detected unkeyed call remains unsafe for its logical parent's mount lifetime,
// including filtered/empty renders. It is transient registry provenance, never a
// locator field. Rootless manual registrations retain it only while that group lives.
const unkeyedCalls = new Map<string, string | null>();
const listeners = new Set<() => void>();
let snapshot: readonly UiOwnerRecord[] = Object.freeze([]),
  byId = new Map<string, UiOwnerRecord>();
let domSnapshot = new Map<Element, DomOwnership>(),
  index = new SelectorIndex<string | null>();
let dirty = false,
  scheduled = false;
let revision = 0,
  notified = 0,
  definitionSignature = '',
  viewSignature = '';
let definitionSnapshot: readonly UiSourceDefinition[] = Object.freeze([]);
const metadata = (value: UiTargetMetadata): UiTargetMetadata =>
  Object.freeze({
    nameKey: value.nameKey,
    type: value.type,
    sourcePath: value.sourcePath,
    routeId: value.routeId,
  });
function schedule() {
  dirty = true;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    flush();
    if (revision === notified) return;
    notified = revision;
    for (const listener of [...listeners]) listener();
  });
}
function ownerSelectors(owner: UiOwnerRecord): UiSelector[] {
  return [
    { kind: 'type', target: owner.target },
    { kind: 'position', target: owner.target, locator: owner.locator },
    ...owner.locator.business.map((identity): UiSelector => ({
      kind: 'business',
      target: owner.target,
      identity,
    })),
  ];
}
function flush() {
  if (!dirty) return;
  dirty = false;
  // Parent mount leases bound descendants even when invalid duplicate React keys
  // strand a child without its own cleanup. Replacements register before this flush.
  let removed = true;
  while (removed) {
    removed = false;
    for (const [id, { record }] of owners)
      if (record.parentOwnerId && !owners.has(record.parentOwnerId)) {
        owners.delete(id);
        removed = true;
      }
  }
  const nodes = new Map<string, Set<Element>>(),
    merged = new Map<Element, string[]>();
  for (const [element, registrations] of dom) {
    for (const [token, registration] of registrations)
      if (registration.ownerIds.length && !registration.ownerIds.some((id) => owners.has(id)))
        registrations.delete(token);
    if (!registrations.size) {
      dom.delete(element);
      element.removeAttribute('data-ui-selector');
      element.removeAttribute('data-ui-render-root');
      element.removeAttribute('data-ui-render-layer');
      continue;
    }
    const ids = [...new Set([...registrations.values()].flatMap((row) => row.ownerIds))].filter(
      (id) => owners.has(id),
    );
    merged.set(element, ids);
    for (const id of ids) {
      const roots = nodes.get(id) ?? new Set<Element>();
      roots.add(element);
      nodes.set(id, roots);
    }
  }
  const repeats = new Map<string, UiOwnerRecord[]>();
  for (const { record } of owners.values()) {
    const key = canonicalSuiteJson([
      record.parentOwnerId,
      record.site,
      record.locator.business,
      record.locator.calls.at(-1)?.key ?? null,
    ]);
    const group = repeats.get(key) ?? [];
    group.push(record);
    repeats.set(key, group);
  }
  const missing = new Set<string>();
  for (const [key, parentOwnerId] of unkeyedCalls)
    if (parentOwnerId ? !owners.has(parentOwnerId) : !repeats.has(key)) unkeyedCalls.delete(key);
  for (const [key, group] of repeats)
    if (group.length > 1 && group[0].locator.calls.at(-1)?.key === null) {
      // Distinct accumulated business identities separate repeated rows. Equal identities do not.
      unkeyedCalls.set(key, group[0].parentOwnerId);
    }
  for (const [key, group] of repeats)
    if (unkeyedCalls.has(key)) for (const row of group) missing.add(row.ownerId);
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const { record } of owners.values())
      if (
        record.parentOwnerId &&
        missing.has(record.parentOwnerId) &&
        !missing.has(record.ownerId)
      ) {
        missing.add(record.ownerId);
        propagated = true;
      }
  }
  const next: UiOwnerRecord[] = [];
  for (const { record } of owners.values()) {
    const candidates = [...(nodes.get(record.ownerId) ?? record.roots)];
    const roots = readonlySet(
      candidates.filter(
        (element) => !candidates.some((other) => other !== element && other.contains(element)),
      ),
    );
    const old = byId.get(record.ownerId),
      stability = missing.has(record.ownerId) ? 'missing-repeat-key' : record.stability;
    const updated = { ...record, roots, stability };
    const equivalent =
      old &&
      old.stability === stability &&
      [...roots].every((root) => old.roots.has(root)) &&
      roots.size === old.roots.size &&
      canonicalSuiteJson({ ...old, roots: null }) ===
        canonicalSuiteJson({ ...updated, roots: null });
    next.push(equivalent ? old : Object.freeze(updated));
  }
  let changed = next.length !== snapshot.length || next.some((row, i) => row !== snapshot[i]);
  if (changed) snapshot = Object.freeze(next);
  byId = new Map(next.map((row) => [row.ownerId, row]));
  const nextDefinitions = [...definitions.values()].flatMap((row) => row.definitions),
    newDefinitionSignature = canonicalSuiteJson(nextDefinitions);
  if (newDefinitionSignature !== definitionSignature) {
    definitionSignature = newDefinitionSignature;
    definitionSnapshot = Object.freeze(nextDefinitions);
    changed = true;
  }
  const newViewSignature = canonicalSuiteJson(
    [
      ...new Set(
        [...views.values()].map((row) =>
          canonicalSuiteJson([row.root, row.publication.viewId, row.publication.layerId]),
        ),
      ),
    ].sort(),
  );
  if (newViewSignature !== viewSignature) {
    viewSignature = newViewSignature;
    changed = true;
  }
  if (changed) revision++;
  index = new SelectorIndex<string | null>();
  for (const selector of boundaries.values()) index.add(selector, null);
  for (const publication of definitions.values())
    for (const definition of publication.definitions)
      if (definition.selector) index.add(definition.selector, null);
  for (const owner of snapshot)
    for (const selector of ownerSelectors(owner)) index.add(selector, owner.ownerId);
  domSnapshot = new Map();
  for (const [element, ids] of merged) {
    const rootIds = ids.filter((id) => byId.get(id)!.roots.has(element));
    const marks = new Set<string>(),
      roots = new Set<string>();
    for (const id of rootIds) {
      const owner = byId.get(id)!;
      roots.add(owner.locator.renderRoot);
      for (const selector of ownerSelectors(owner)) {
        const lookup = index.get(selector);
        if (lookup.collision) continue;
        if (
          selector.kind === 'position' &&
          (new Set(lookup.values.filter((id) => id !== null)).size !== 1 ||
            owner.stability === 'missing-repeat-key' ||
            owner.stability === 'unsupported')
        )
          continue;
        marks.add(`s${selectorDigest(selector)}`);
      }
    }
    if (marks.size) element.setAttribute('data-ui-selector', [...marks].join(' '));
    else element.removeAttribute('data-ui-selector');
    if (roots.size) element.setAttribute('data-ui-render-root', [...roots].join(' '));
    else element.removeAttribute('data-ui-render-root');
    const layerId = byId.get(ids.at(-1) ?? '')?.layerId;
    if (layerId) element.setAttribute('data-ui-render-layer', layerBoundaryToken(layerId));
    else element.removeAttribute('data-ui-render-layer');
    domSnapshot.set(
      element,
      Object.freeze({
        ownerIds: Object.freeze(ids),
        rootOwnerIds: Object.freeze(rootIds),
        leafOwnerId: ids.at(-1) ?? null,
      }),
    );
  }
}
export function registerOwner(record: UiOwnerRecord): () => void {
  const token = {},
    value = Object.freeze({
      ...record,
      locator: copyLocator(record.locator),
      metadata: metadata(record.metadata),
      roots: readonlySet(record.roots),
    });
  owners.set(record.ownerId, { token, record: value });
  schedule();
  return () => {
    if (owners.get(record.ownerId)?.token !== token) return;
    owners.delete(record.ownerId);
    schedule();
  };
}
export function registerDom(element: Element, ownership: DomOwnership): () => void {
  const token = {},
    registrations = dom.get(element) ?? new Map<object, DomOwnership>();
  registrations.set(
    token,
    Object.freeze({
      ownerIds: Object.freeze([...ownership.ownerIds]),
      rootOwnerIds: Object.freeze([...ownership.rootOwnerIds]),
      leafOwnerId: ownership.leafOwnerId,
    }),
  );
  dom.set(element, registrations);
  schedule();
  return () => {
    if (!registrations.delete(token)) return;
    if (!registrations.size) {
      dom.delete(element);
      element.removeAttribute('data-ui-selector');
      element.removeAttribute('data-ui-render-root');
      element.removeAttribute('data-ui-render-layer');
    }
    schedule();
  };
}
export function listOwners(): readonly UiOwnerRecord[] {
  flush();
  return snapshot;
}
export function getOwner(ownerId: string): UiOwnerRecord | null {
  flush();
  return byId.get(ownerId) ?? null;
}
export function getDomOwnership(element: Element): DomOwnership | null {
  flush();
  return domSnapshot.get(element) ?? null;
}
export function subscribeOwners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function collectVisibleRects(ownerIds: readonly string[]): readonly DOMRectReadOnly[] {
  flush();
  const roots = new Set(ownerIds.flatMap((id) => [...(byId.get(id)?.roots ?? [])]));
  return Object.freeze(
    [...roots].flatMap((root) => {
      if (!root.isConnected) return [];
      const style = root.ownerDocument.defaultView?.getComputedStyle(root);
      if (
        style?.visibility === 'hidden' ||
        style?.visibility === 'collapse' ||
        style?.opacity === '0'
      )
        return [];
      return [...root.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    }),
  );
}
export function resolveSelector(selector: UiSelector): UiResolution {
  flush();
  const result = index.get(selector),
    matches = Object.freeze(
      [...new Set(result.values)]
        .filter((id): id is string => id !== null)
        .map((id) => byId.get(id)!)
        .filter((owner) => selectorMatches(selector, owner.target, owner.locator)),
    );
  const resolution = (status: UiResolution['status'], reason: string | null): UiResolution =>
    Object.freeze({ status, owners: matches, reason });
  if (result.collision)
    return resolution('ambiguous', 'Selector digest collision; full structures differ.');
  if (
    selector.kind === 'position' &&
    matches.some((owner) => owner.stability === 'missing-repeat-key')
  )
    return resolution(
      'unsupported',
      'missing-repeat-key: repeated calls require a stable key or distinct business identity.',
    );
  if (selector.kind === 'position' && matches.length > 1)
    return resolution(
      'ambiguous',
      'Several owners have the same complete position (duplicate key or identity).',
    );
  if (!matches.length) return resolution('unmounted', null);
  if (matches.every((owner) => owner.stability === 'unsupported' || !owner.roots.size))
    return resolution(
      'unsupported',
      'No instrumented DOM root is available (opaque component, text or unmarked createElement).',
    );
  if (!collectVisibleRects(matches.map((owner) => owner.ownerId)).length)
    return resolution('hidden', 'The registered roots have no visible rectangles.');
  return resolution('resolved', null);
}
export function publishUiDefinitions(publication: UiDefinitionPublication): () => void {
  const token = {},
    rows = Object.freeze(
      publication.definitions.map((row) =>
        Object.freeze({
          ...row,
          ...metadata(row),
          ...(row.selector ? { selector: copySelector(row.selector) } : {}),
        }),
      ),
    );
  definitions.set(publication.key, { token, definitions: rows });
  schedule();
  return () => {
    if (definitions.get(publication.key)?.token !== token) return;
    definitions.delete(publication.key);
    schedule();
  };
}
export function listUiDefinitions(): readonly UiSourceDefinition[] {
  flush();
  return definitionSnapshot;
}
export function getTargetMetadata(selector: UiSelector): readonly UiTargetMetadata[] {
  const rows: UiTargetMetadata[] = resolveSelector(selector).owners.map((owner) => owner.metadata);
  for (const definition of listUiDefinitions()) {
    if (definition.target !== selector.target) continue;
    if (
      selector.kind === 'position' &&
      definition.site &&
      !selector.locator.calls.some((call) => call.site === definition.site)
    )
      continue;
    if (
      definition.selector &&
      definition.selector.kind !== 'type' &&
      canonicalSuiteJson(definition.selector) !== canonicalSuiteJson(selector)
    )
      continue;
    rows.push(metadata(definition));
  }
  return Object.freeze([...new Map(rows.map((row) => [canonicalSuiteJson(row), row])).values()]);
}
export function publishUiView(
  root: UiPositionLocator['renderRoot'],
  publication: UiViewPublication,
): () => void {
  const token = {};
  views.set(token, { root, publication: Object.freeze({ ...publication }) });
  schedule();
  return () => {
    if (views.delete(token)) schedule();
  };
}
export interface UiStyleRootSnapshot extends SuiteStyleRoot {
  dispose(): void;
}
function layerBoundaryToken(layerId: string): string {
  return `l${selectorDigest({ kind: 'type', target: layerId })}`;
}
export function getSuiteStyleRoot(
  id: UiPositionLocator['renderRoot'],
  layerId?: string,
): UiStyleRootSnapshot {
  const viewIds = readonlySet(
    [...views.values()]
      .filter(
        (row) => row.root === id && (layerId === undefined || row.publication.layerId === layerId),
      )
      .map((row) => row.publication.viewId),
  );
  const leases = new Map<string, object>();
  let disposed = false;
  return Object.freeze({
    id,
    viewIds,
    subjectBoundary:
      layerId === undefined
        ? undefined
        : `[data-ui-render-layer="${layerBoundaryToken(layerId)}"][data-ui-render-root~="${id}"]`,
    resolveTarget(selector: UiSelector) {
      if (disposed) return null;
      if (selector.kind === 'position' && selector.locator.renderRoot !== id) return null;
      const key = canonicalSuiteJson(selector);
      if (!leases.has(key)) {
        const token = {};
        leases.set(key, token);
        boundaries.set(token, copySelector(selector));
        schedule();
      }
      const resolution = resolveSelector(selector);
      if (resolution.status === 'unsupported' || resolution.status === 'ambiguous') return null;
      return `[data-ui-selector~="s${selectorDigest(selector)}"][data-ui-render-root~="${id}"]`;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const token of leases.values()) boundaries.delete(token);
      leases.clear();
      schedule();
    },
  });
}
