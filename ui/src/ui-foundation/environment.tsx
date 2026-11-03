import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { customComponent } from '../customization/Customizable';

export type UiViewRender = (
  id: string,
  props: Record<string, unknown>,
  Original: ComponentType<Record<string, unknown>>,
) => ReactNode;
export interface UiFoundationEnvironment {
  theme: 'light' | 'dark';
  variables: CSSProperties;
  portalContainer: HTMLElement | ShadowRoot | null;
  protectedMode: boolean;
  renderView?: UiViewRender;
}
const EnvironmentContext = createContext<UiFoundationEnvironment>({
  theme: 'dark',
  variables: {},
  portalContainer: null,
  protectedMode: false,
});

// Base UI sibling Dialog roots have independent dismissal listeners. Share only
// layer ordering across application/ShadowRoot portals; Base UI still owns focus.
type OverlayLayer = { id: symbol; kind: 'dialog' | 'select' };
const overlayLayers = new Map<Document, OverlayLayer[]>();
const overlayListeners = new Set<() => void>();
let overlayRevision = 0;
const dismissalOwners = new WeakMap<Event, symbol>();
const subscribeLayers = (listener: () => void) => {
  overlayListeners.add(listener);
  return () => {
    overlayListeners.delete(listener);
  };
};
const getLayerRevision = () => overlayRevision;
const serverLayerRevision = () => 0;
// eslint-disable-next-line react-refresh/only-export-components
export function useOverlayLayer(kind: OverlayLayer['kind'], open: boolean) {
  const { portalContainer } = useUiFoundation();
  const id = useRef(Symbol(kind));
  const owner =
    portalContainer?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  useSyncExternalStore(subscribeLayers, getLayerRevision, serverLayerRevision);
  useLayoutEffect(() => {
    if (!open || !owner) return;
    const layer = { id: id.current, kind };
    const layers = overlayLayers.get(owner) ?? [];
    layers.push(layer);
    overlayLayers.set(owner, layers);
    const notify = () => {
      ++overlayRevision;
      overlayListeners.forEach((listener) => listener());
    };
    notify();
    return () => {
      const remaining = (overlayLayers.get(owner) ?? []).filter((entry) => entry !== layer);
      if (remaining.length) overlayLayers.set(owner, remaining);
      else overlayLayers.delete(owner);
      notify();
    };
  }, [kind, open, owner]);
  const layers = owner ? (overlayLayers.get(owner) ?? []) : [];
  const dialogs = layers.filter((layer) => layer.kind === 'dialog');
  return {
    topmost: !layers.length || layers.at(-1)?.id === id.current,
    modalActive: !dialogs.length || dialogs.at(-1)?.id === id.current,
    ownsDismissal(event: Event) {
      const claimed = dismissalOwners.get(event);
      if (claimed) return claimed === id.current;
      const current = owner ? (overlayLayers.get(owner) ?? []) : [];
      if (current.length && current.at(-1)?.id !== id.current) return false;
      dismissalOwners.set(event, id.current);
      return true;
    },
  };
}
export function UiFoundationProvider({
  value,
  children,
}: {
  value: UiFoundationEnvironment;
  children: ReactNode;
}): React.JSX.Element {
  return createElement(EnvironmentContext.Provider, { value }, children);
}
// eslint-disable-next-line react-refresh/only-export-components
export function useUiFoundation(): UiFoundationEnvironment {
  return useContext(EnvironmentContext);
}

// Appearance percentages describe one UI scale. Reapplying them to a portal
// and its parts must not multiply the size at every inherited DOM boundary.
// eslint-disable-next-line react-refresh/only-export-components
export function foundationStyle(variables: CSSProperties, typography = true): CSSProperties {
  const { fontSize, ...rest } = variables;
  if (!typography) return rest;
  return {
    ...rest,
    fontSize:
      typeof fontSize === 'string' && /^\d+(?:\.\d+)?%$/.test(fontSize)
        ? `${Number.parseFloat(fontSize) / 100}rem`
        : fontSize,
  };
}

export type UiFoundationAppearance = Pick<UiFoundationEnvironment, 'theme' | 'variables'>;
const AppearanceBridge = createContext<((value: UiFoundationAppearance) => void) | null>(null);
export const UiFoundationAppearanceBridgeProvider = AppearanceBridge.Provider;
export function UiFoundationAppearanceBridge({ value }: { value: UiFoundationAppearance }) {
  const publish = useContext(AppearanceBridge);
  useEffect(() => publish?.(value), [publish, value]);
  return null;
}

// One renderer for ordinary controls; protected Recovery uses trusted base parts.
// eslint-disable-next-line react-refresh/only-export-components
export function foundationControl<P extends object>(id: string, Original: ComponentType<P>) {
  const RuntimeControl = customComponent(id, Original);
  return function FoundationControl(props: P): React.JSX.Element {
    const environment = useUiFoundation();
    if (environment.protectedMode) {
      return createElement(Original, props);
    }
    if (environment.renderView) {
      return createElement(
        EnvironmentContext.Provider,
        { value: environment },
        environment.renderView(
          id,
          props as Record<string, unknown>,
          Original as ComponentType<Record<string, unknown>>,
        ),
      );
    }
    return createElement(RuntimeControl, props);
  };
}
