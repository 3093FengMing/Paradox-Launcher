import { createContext, createElement, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useLauncherSnapshot } from '../launcher/public/context';
export type { UiViewProps } from './prepared';

export interface UiViewOptions {
  id: string;
  props?: Record<string, unknown>;
  Original?: ComponentType<Record<string, unknown>>;
  children?: ReactNode;
  protectedMode?: boolean;
  /** Private automatic-subject aliases; absent from the public UiView props. */
  targets?: readonly string[];
}
/** Private injection seam. The public barrel exports only the view functions. */
// eslint-disable-next-line react-refresh/only-export-components
export const SuiteViewContext = createContext<ComponentType<UiViewOptions> | null>(null);

export function UiView({
  id,
  props,
  Original,
  children,
}: Omit<UiViewOptions, 'protectedMode' | 'targets'>): React.JSX.Element {
  const Renderer = useContext(SuiteViewContext);
  if (Renderer) return createElement(Renderer, { id, props, Original, children });
  return Original
    ? createElement(Original, { ...props, ...(children === undefined ? {} : { children }) })
    : createElement('span', { hidden: true });
}

export function UiRouteViewport(): React.JSX.Element {
  const { routeId } = useLauncherSnapshot().navigation;
  return createElement(UiView, { id: `page.${routeId}` });
}
