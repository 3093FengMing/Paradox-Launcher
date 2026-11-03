import i18n from '../i18n';
import type { BusinessIdentity, UiSelector } from '../ui-suite/model';
import type { UiRouteId, UiTargetDescriptor } from '../launcher/public/index';
import { builtinRouteIds, validateRouteId } from '../ui-suite/routes';
import { canonicalSuiteJson } from '../ui-suite/canonical';
import { copySelector } from './selectors';
import { collectVisibleRects, getOwner, getTargetMetadata, listOwners, listUiDefinitions, resolveSelector } from './ownership';
import type { UiOwnerRecord } from './ownership';
import { targetNameKeys } from './targets';

export interface TargetCatalogContext {
  readonly routes?: readonly UiRouteId[];
  readonly businessNames?: readonly (BusinessIdentity & { readonly name: string })[];
}
const descriptorCache = new Map<string, UiTargetDescriptor>();
const listCache = new Map<string, readonly UiTargetDescriptor[]>();
const short = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
function domName(root: Element): string {
  const labelled = root.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => root.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
  const labels = 'labels' in root ? Array.from((root as HTMLInputElement).labels ?? []).map((label) => label.textContent).join(' ') : '';
  return short(root.getAttribute('aria-label')) || short(labelled) || short(labels) || short(root.getAttribute('title')) || short(root.textContent);
}
function unique<T>(values: readonly T[]): T | null { return values.length === 1 ? values[0] : null; }
function position(owner: UiOwnerRecord): UiSelector { return { kind: 'position', target: owner.target, locator: owner.locator }; }
function cachedList(values: UiTargetDescriptor[]): readonly UiTargetDescriptor[] {
  const key = canonicalSuiteJson(values), cached = listCache.get(key);
  if (cached) return cached;
  const result = Object.freeze(values);
  listCache.set(key, result);
  if (listCache.size > 8) listCache.delete(listCache.keys().next().value!);
  return result;
}
function businessNames(selector: UiSelector, owners: readonly UiOwnerRecord[], context: TargetCatalogContext): string[] {
  const identities = selector.kind === 'business' ? [selector.identity] : selector.kind === 'position' ? selector.locator.business : owners.length === 1 ? owners[0].locator.business : [];
  return [...new Set(identities.map((identity) => context.businessNames?.find((value) => value.namespace === identity.namespace && value.value === identity.value)?.name ?? identity.value).filter(Boolean))];
}
/** Values come only from canonical definitions, current owners and the resolver. */
export function describeTarget(selector: UiSelector, context: TargetCatalogContext = {}): UiTargetDescriptor {
  const resolution = resolveSelector(selector), metadata = getTargetMetadata(selector);
  const owners = resolution.owners, roots = [...new Set(owners.flatMap((owner) => [...owner.roots]))];
  const semanticKey = targetNameKeys[selector.target];
  const names = [...new Set(roots.map(domName).filter(Boolean))];
  const explicitKeys = [...new Set(metadata.map((row) => row.nameKey).filter((key): key is string => !!key && i18n.exists(key)))];
  let name = semanticKey && i18n.exists(semanticKey) ? String(i18n.t(semanticKey)) : unique(names) ?? (unique(explicitKeys) ? String(i18n.t(explicitKeys[0])) : null) ?? (roots[0]?.tagName?.toLowerCase() || selector.target);
  for (const business of businessNames(selector, owners, context)) if (!name.includes(business)) name += ` ${business}`;
  const sourcePaths = [...new Set(metadata.map((row) => row.sourcePath).filter((value): value is string => value !== null))];
  const routeIds = [...new Set(metadata.map((row) => row.routeId).filter((value): value is string => value !== null))];
  const sourcePath = unique(sourcePaths), rawRoute = unique(routeIds);
  let routeId: UiRouteId | null = null;
  if (rawRoute) {
    try { const id = validateRouteId(rawRoute); if ((context.routes ?? builtinRouteIds).includes(id)) routeId = id; } catch { /* Invalid metadata never becomes a public navigation action. */ }
  }
  const rects = collectVisibleRects(owners.map((owner) => owner.ownerId));
  const viewport = roots[0]?.ownerDocument.defaultView;
  const on = rects.filter((rect) => rect.right > 0 && rect.bottom > 0 && rect.left < (viewport?.innerWidth ?? Infinity) && rect.top < (viewport?.innerHeight ?? Infinity)).length;
  const visibility = !rects.length ? 'none' : !on ? 'offscreen' : on === rects.length ? 'onscreen' : 'mixed';
  const reasons: string[] = [];
  if (resolution.status === 'unmounted') reasons.push(String(i18n.t(metadata.length ? 'uiInspector.knownUnmounted' : 'uiInspector.unknownTarget')));
  else if (resolution.reason) reasons.push(resolution.reason);
  if (sourcePaths.length > 1 || routeIds.length > 1) reasons.push(String(i18n.t('uiInspector.multipleSources')));
  if (rawRoute && !routeId) reasons.push(String(i18n.t('uiInspector.routeUnavailable')));
  const stability = [...new Set(owners.map((owner) => owner.stability))].sort().join(', ') || (selector.kind === 'position' ? 'unmounted-position' : 'definition');
  const value: UiTargetDescriptor = { selector: copySelector(selector), name, type: unique([...new Set(metadata.map((row) => row.type))]) ?? 'unknown', sourcePath, routeId, status: resolution.status, stability, matchCount: owners.length, reason: reasons.join(' ') || null, ownerId: owners.length === 1 ? owners[0].ownerId : null, visibility };
  const key = canonicalSuiteJson(value), cached = descriptorCache.get(key);
  if (cached) return cached;
  const result = Object.freeze(value); descriptorCache.set(key, result);
  if (descriptorCache.size > 2048) descriptorCache.delete(descriptorCache.keys().next().value!);
  return result;
}
export function listCurrentTargets(overrides: readonly UiSelector[] = [], context: TargetCatalogContext = {}): readonly UiTargetDescriptor[] {
  const selectors = new Map<string, UiSelector>();
  const add = (selector: UiSelector) => selectors.set(canonicalSuiteJson(selector), selector);
  for (const row of listUiDefinitions()) add(row.selector ?? { kind: 'type', target: row.target });
  for (const owner of listOwners()) if (!owner.catalogPresentation) {
    add(position(owner));
    for (const identity of owner.locator.business) add({ kind: 'business', target: owner.target, identity });
    add({ kind: 'type', target: owner.target });
  }
  overrides.forEach(add);
  return cachedList([...selectors.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, selector]) => describeTarget(selector, context)));
}
export function getTargetAncestors(ownerId: string, context: TargetCatalogContext = {}): readonly UiTargetDescriptor[] {
  const values: UiTargetDescriptor[] = [], seen = new Set([ownerId]);
  let owner = getOwner(ownerId);
  while (owner?.parentOwnerId && !seen.has(owner.parentOwnerId)) {
    seen.add(owner.parentOwnerId); owner = getOwner(owner.parentOwnerId);
    if (owner) values.unshift(describeTarget(position(owner), context));
  }
  return cachedList(values);
}
export function getScopeChoices(ownerId: string, context: TargetCatalogContext = {}): readonly UiTargetDescriptor[] {
  const owner = getOwner(ownerId);
  if (!owner) return cachedList([]);
  const selectors: UiSelector[] = [position(owner), ...owner.locator.business.map((identity): UiSelector => ({ kind: 'business', target: owner.target, identity })), { kind: 'type', target: owner.target }];
  return cachedList([...new Map(selectors.map((selector) => [canonicalSuiteJson(selector), selector])).values()].map((selector) => describeTarget(selector, context)));
}
