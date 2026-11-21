import { canonicalSuiteJson } from '../ui-suite/canonical';
import { readonlySet } from './ownership-types';
import type { DomOwnership, UiOwnerRecord } from './ownership-types';
export type OwnerLeases = Map<string, { token: object; record: UiOwnerRecord; signature: string }>;
function outerRoots(candidates: readonly Element[]): ReadonlySet<Element> {
  const all = new Set(candidates), ancestry = new Map<Element, boolean>();
  return readonlySet(candidates.filter((element) => {
    const path: Element[] = [];
    let parent = element.parentElement;
    while (parent && !all.has(parent) && !ancestry.has(parent)) {
      path.push(parent);
      parent = parent.parentElement;
    }
    // Element ancestry, like Node.contains, stops at a ShadowRoot/fragment.
    const contained = parent !== null && parent !== undefined &&
      (all.has(parent) || ancestry.get(parent) === true);
    for (const ancestor of path) ancestry.set(ancestor, contained);
    return !contained;
  }));
}
export function writeAttribute(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function pruneOwnerLeases(registeredOwners: OwnerLeases): void {
  // Parent mount leases bound descendants even when invalid duplicate React keys
  // strand a child without its own cleanup. Replacements register before this flush.
  let removed = true;
  while (removed) {
    removed = false;
    for (const [id, { record }] of registeredOwners)
      if (record.parentOwnerId && !registeredOwners.has(record.parentOwnerId)) {
        registeredOwners.delete(id);
        removed = true;
      }
  }
}
export function collectDomOwners(registeredOwners: OwnerLeases, registrationsByElement: Map<Element, Map<object, DomOwnership>>) {
  const nodes = new Map<string, Set<Element>>(),
    merged = new Map<Element, string[]>();
  for (const [element, registrations] of registrationsByElement) {
    for (const [token, registration] of registrations)
      if (registration.ownerIds.length && !registration.ownerIds.some((id) => registeredOwners.has(id)))
        registrations.delete(token);
    if (!registrations.size) {
      registrationsByElement.delete(element);
      writeAttribute(element, 'data-ui-selector', null);
      writeAttribute(element, 'data-ui-render-root', null);
      writeAttribute(element, 'data-ui-render-layer', null);
      continue;
    }
    const ids = [...new Set([...registrations.values()].flatMap((row) => row.ownerIds))].filter(
      (id) => registeredOwners.has(id),
    );
    merged.set(element, ids);
    for (const id of ids) {
      const roots = nodes.get(id) ?? new Set<Element>();
      roots.add(element);
      nodes.set(id, roots);
    }
  }
  return { nodes, merged };
}
/** Missing repetition keys remain unsafe for the entire logical parent lease. */
export function collectUnstableOwners(registeredOwners: OwnerLeases, unkeyed: Map<string, string | null>): Set<string> {
  const repeats = new Map<string, UiOwnerRecord[]>();
  for (const { record } of registeredOwners.values()) {
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
  for (const [key, parentOwnerId] of unkeyed)
    if (parentOwnerId ? !registeredOwners.has(parentOwnerId) : !repeats.has(key)) unkeyed.delete(key);
  for (const [key, group] of repeats)
    if (group.length > 1 && group[0].locator.calls.at(-1)?.key === null) {
      // Distinct accumulated business identities separate repeated rows. Equal identities do not.
      unkeyed.set(key, group[0].parentOwnerId);
    }
  for (const [key, group] of repeats)
    if (unkeyed.has(key)) for (const row of group) missing.add(row.ownerId);
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const { record } of registeredOwners.values())
      if (
        record.parentOwnerId &&
        missing.has(record.parentOwnerId) &&
        !missing.has(record.ownerId)
      ) {
        missing.add(record.ownerId);
        propagated = true;
      }
  }
  return missing;
}
/** Preserve frozen record identity when roots, stability and registration values agree. */
export function buildOwnerSnapshot(input: {
  registeredOwners: OwnerLeases;
  nodes: Map<string, Set<Element>>;
  missing: ReadonlySet<string>;
  previousById: ReadonlyMap<string, UiOwnerRecord>;
  previousSignatures: ReadonlyMap<string, string>;
}) {
  const { registeredOwners, nodes, missing, previousById, previousSignatures } = input;
  const next: UiOwnerRecord[] = [], nextSignatures = new Map<string, string>();
  for (const { record, signature } of registeredOwners.values()) {
    const candidates = [...(nodes.get(record.ownerId) ?? record.roots)];
    const roots = outerRoots(candidates);
    const old = previousById.get(record.ownerId),
      stability = missing.has(record.ownerId) ? 'missing-repeat-key' : record.stability;
    const updated = { ...record, roots, stability };
    const equivalent =
      old &&
      old.stability === stability &&
      [...roots].every((root) => old.roots.has(root)) &&
      roots.size === old.roots.size &&
      previousSignatures.get(record.ownerId) === signature;
    next.push(equivalent ? old : Object.freeze(updated));
    nextSignatures.set(record.ownerId, signature);
  }
  return { next, nextSignatures };
}
