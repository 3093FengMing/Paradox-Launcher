import { createElement, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import {
  UiBusinessContext,
  UiCatalogPresentationContext,
  UiOwnerContext,
  UiViewContext,
} from './context';
import { normalizeUiKey, copyLocator } from './selectors';
import { publishUiView, registerDom, registerOwner, readonlySet } from './ownership';
import type { UiViewPublication } from './ownership';
import type { UiPositionLocator } from '../ui-suite/model';

let nextOwner = 0;
/** Mount-only owner tokens are deliberately unrelated to React useId and persistent selectors. */
export function UiOwnerBoundary({
  target,
  site,
  sourcePath,
  callKey,
  children,
}: {
  target: string;
  site: string | null;
  sourcePath?: string | null;
  callKey?: unknown;
  children: ReactNode;
}): React.JSX.Element {
  const parent = useContext(UiOwnerContext),
    business = useContext(UiBusinessContext),
    presentation = useContext(UiCatalogPresentationContext),
    view = useContext(UiViewContext);
  const [ownerId] = useState(() => `owner-${++nextOwner}`);
  const frame = useMemo(
    () => ({
      ownerId,
      ownerIds: Object.freeze([...parent.ownerIds, ownerId]),
      locator: copyLocator({
        version: 1,
        renderRoot: parent.locator.renderRoot,
        calls: [...parent.locator.calls, ...(site ? [{ site, key: normalizeUiKey(callKey) }] : [])],
        business,
      }),
      stability:
        !site || parent.stability === 'unsupported'
          ? ('unsupported' as const)
          : site.startsWith('auto:') || parent.stability === 'automatic-site'
            ? ('automatic-site' as const)
            : ('stable' as const),
    }),
    [ownerId, parent, business, site, callKey],
  );
  const record = useMemo(
    () => ({
      ownerId,
      parentOwnerId: parent.ownerId,
      target,
      site,
      locator: frame.locator,
      stability: frame.stability,
      roots: readonlySet<Element>([]),
      metadata: {
        nameKey: view?.nameKey ?? null,
        type: target.startsWith('element.')
          ? 'element'
          : target.startsWith('control.')
            ? 'control'
            : 'component',
        sourcePath: sourcePath ?? view?.sourcePath ?? null,
        routeId: view?.routeId ?? null,
      },
      catalogPresentation: presentation,
      viewId: view?.viewId ?? null,
      layerId: view?.layerId ?? null,
    }),
    [ownerId, parent.ownerId, target, site, frame, sourcePath, view, presentation],
  );
  useLayoutEffect(() => registerOwner(record), [record]);
  return createElement(UiOwnerContext.Provider, { value: frame }, children);
}
/** Hosts use this at actual main/editor render roots; it adds no DOM. */
export function UiRuntimeRoot({
  id,
  children,
}: {
  id: UiPositionLocator['renderRoot'];
  children: ReactNode;
}): React.JSX.Element {
  const frame = useMemo(
    () => ({
      ownerId: null,
      ownerIds: [],
      locator: copyLocator({ version: 1, renderRoot: id, calls: [], business: [] }),
      stability: 'stable' as const,
    }),
    [id],
  );
  const business = useMemo(() => [], []);
  return createElement(
    UiOwnerContext.Provider,
    { value: frame },
    createElement(UiBusinessContext.Provider, { value: business }, children),
  );
}
/** Metadata belongs to the consuming view/layer, never to a cached Component. */
export function UiRuntimeView({
  publication,
  children,
  ownsBoundary = true,
}: {
  publication: UiViewPublication;
  children: ReactNode;
  /** An Original continuation shares its calling view's logical ownership. */
  ownsBoundary?: boolean;
}): React.JSX.Element {
  const { locator } = useContext(UiOwnerContext);
  const { viewId, sourcePath, routeId, layerId, nameKey } = publication;
  const value = useMemo(
    () => Object.freeze({ viewId, sourcePath, routeId, layerId, nameKey }),
    [viewId, sourcePath, routeId, layerId, nameKey],
  );
  useLayoutEffect(() => publishUiView(locator.renderRoot, value), [locator.renderRoot, value]);
  return createElement(
    UiViewContext.Provider,
    { value },
    ownsBoundary ? createElement(UiOwnerBoundary, {
      target: viewId,
      site: `view:${viewId}`,
      sourcePath,
      children,
    }) : children,
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useRegisteredRef(caller: unknown): Ref<Element> {
  const frame = useContext(UiOwnerContext);
  return useMemo(
    () => (value: Element | null) => {
      if (!value) return;
      // nodeType/method checks work across Portal/iframe realms without private Fiber access.
      const release =
        value.nodeType === 1 && typeof value.getClientRects === 'function'
          ? registerDom(value, {
              ownerIds: frame.ownerIds,
              rootOwnerIds: [],
              leafOwnerId: frame.ownerId,
            })
          : () => {};
      const ref = caller as Ref<Element> | undefined;
      let cleanup: ReturnType<React.RefCallback<Element>>;
      try {
        cleanup = typeof ref === 'function' ? ref(value) : undefined;
      } catch (error) {
        release();
        throw error;
      }
      if (ref && typeof ref === 'object') ref.current = value;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        if (typeof cleanup === 'function') cleanup();
        else if (typeof ref === 'function') ref(null);
        else if (ref && ref.current === value) ref.current = null;
      };
    },
    [caller, frame.ownerIds, frame.ownerId],
  );
}
