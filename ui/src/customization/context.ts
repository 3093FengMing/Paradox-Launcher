import { createContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { BusinessIdentity, UiPositionLocator } from '../ui-suite/model';
import type { UiStability, UiViewPublication } from './ownership';
import { listUiDefinitions, listOwners, publishUiDefinitions } from './ownership';
import { targetDetails } from './targets';

export interface UiInteractionContextValue {
  editing: boolean;
}
/** Props shared by the retained literal HTML runtime and Original composition. */
export type CustomProps = Record<string, unknown> & {
  Original: ComponentType<Record<string, unknown>>;
  children?: ReactNode;
};
export const UiInteractionContext = createContext<UiInteractionContextValue>({
  editing: false,
});
export const ScopeContext = createContext<string[]>([]);
export const DomScopeContext = createContext<string[]>([]);
export const IdentityContext = createContext<string | null>(null);
export const BypassContext = createContext<Set<string>>(new Set());
/** Transitional legacy directory adapter over the one ownership registry. */
export const targetRegistry = {
  has(target: string) {
    return [...this].includes(target);
  },
  add(target: string) {
    if (this.has(target)) return this;
    publishUiDefinitions({
      key: `legacy:${target}`,
      definitions: [
        {
          target,
          site: null,
          nameKey: null,
          type: 'component',
          sourcePath: targetDetails[target]?.source ?? null,
          routeId: null,
          viewId: null,
        },
      ],
    });
    return this;
  },
  *[Symbol.iterator]() {
    yield* new Set([
      ...listUiDefinitions().map((row) => row.target),
      ...listOwners().map((row) => row.target),
    ]);
  },
};

/** One logical ancestry channel shared by built-in, suite JSX and HTML runtimes. */
export interface UiOwnerFrame {
  readonly ownerId: string | null;
  readonly ownerIds: readonly string[];
  readonly locator: UiPositionLocator;
  readonly stability: UiStability;
}
export const UiOwnerContext = createContext<UiOwnerFrame>({
  ownerId: null,
  ownerIds: [],
  locator: { version: 1, renderRoot: 'launcher.main', calls: [], business: [] },
  stability: 'stable',
});
export const UiBusinessContext = createContext<readonly BusinessIdentity[]>([]);
export const UiCatalogPresentationContext = createContext(false);
export const UiViewContext = createContext<UiViewPublication | null>(null);
