import { createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { UiBusinessContext, UiCatalogPresentationContext } from '../customization/context';

export function UiIdentity({
  namespace,
  value,
  children,
}: {
  namespace: string;
  value: string;
  children: ReactNode;
}): React.JSX.Element {
  const parent = useContext(UiBusinessContext);
  const identities = useMemo(
    () => Object.freeze([...parent, Object.freeze({ namespace, value })]),
    [parent, namespace, value],
  );
  return createElement(UiBusinessContext.Provider, { value: identities }, children);
}
export function UiCatalogPresentation({ children }: { children: ReactNode }): React.JSX.Element {
  return createElement(UiCatalogPresentationContext.Provider, { value: true }, children);
}
