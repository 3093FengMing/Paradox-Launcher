import type { UiPositionLocator, UiSelector } from '../ui-suite/model';

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
