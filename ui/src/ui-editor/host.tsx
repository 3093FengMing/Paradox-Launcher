/** @jsxImportSource react */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { UiFoundationProvider, useUiFoundation } from '../ui-foundation/environment';
import foundationStyles from '../ui-foundation/foundation.css?inline';
import { UiRuntimeRoot } from '../customization/runtime';
import { getSuiteStyleRoot, subscribeOwners } from '../customization/ownership';
import { attachSuiteStyles } from '../ui-suite/prepared';
import type { SuiteActivation } from './controller';
import { useUiEditorController, useSuiteActivation } from './controller';
import { useUiEditorSnapshot } from './public';
import { RecoveryPanel } from './RecoveryPanel';

// The shared renderer resolves tool.editor; protectedMode selects the trusted editor.
// eslint-disable-next-line react-refresh/only-export-components
export const UiEditorRendererContext = createContext<
  ((options: { protectedMode: boolean }) => ReactNode) | null
>(null);
const fixedStyles =
  '.ui-fixed-recovery{font:14px system-ui;color:#eee;color-scheme:dark;box-sizing:border-box;position:fixed;inset:12px;max-width:620px;max-height:calc(100dvh - 24px);margin:auto;padding:16px;background:#171923;border:1px solid #8991a8;border-radius:12px;overflow:auto;pointer-events:auto}.ui-fixed-recovery :is(h1,h2){font:600 18px system-ui;margin:0 0 8px}.ui-recovery-actions{display:flex;flex-wrap:wrap;gap:8px}.ui-fixed-recovery [role=alertdialog]{margin-top:12px;border:1px solid #bba779;padding:8px}.ui-fixed-recovery button{box-sizing:border-box;font:inherit;color:inherit;background:#273044;border:1px solid #8991a8;border-radius:6px;padding:7px 10px;min-height:34px;max-width:100%;white-space:normal}.ui-fixed-recovery button:focus-visible{outline:2px solid #9dbaff;outline-offset:2px}.ui-fixed-recovery button:disabled{opacity:.55}.ui-fixed-recovery li{overflow-wrap:anywhere}';
function useShadowHost(id: string): ShadowRoot | null {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    const host = document.createElement('div');
    host.id = id;
    if (id === 'paradox-suite-recovery') host.setAttribute('data-ui-inspector-artifact', 'recovery');
    host.style.cssText =
      'all:initial!important;display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;visibility:visible!important;opacity:1!important;transform:none!important;';
    const root = host.attachShadow({ mode: 'open' });
    document.body.append(host);
    setShadow(root);
    return () => host.remove();
  }, [id]);
  return shadow;
}
// Each physical main/editor root owns its style and selector leases.
// eslint-disable-next-line react-refresh/only-export-components
export function useSuiteRootStyles(
  root: Document | ShadowRoot | null,
  id: 'launcher.main' | 'launcher.editor',
  activation: SuiteActivation | null,
  protectedMode = false,
) {
  useEffect(() => {
    if (!root || !activation || activation.retired) return;
    let signature: string | null = null;
    const cleanups: (() => void)[] = [];
    let retired = false;
    let unsubscribe = () => {};
    const release = () => {
      if (retired) return;
      retired = true;
      unsubscribe();
      cleanups.splice(0).forEach((dispose) => dispose());
    };
    const refresh = () => {
      if (retired || activation.retired) return;
      const layers = [
        ...new Set(
          protectedMode
            ? [activation.trusted]
            : [activation.trusted, activation.parent, activation.primary],
        ),
      ].filter((layer) => layer !== null);
      const snapshots = layers.map((layer) => getSuiteStyleRoot(id, layer.layerId)),
        next = JSON.stringify(
          snapshots.map((snapshot, index) => [layers[index].layerId, [...snapshot.viewIds].sort()]),
        );
      if (signature === next) {
        snapshots.forEach((snapshot) => snapshot.dispose());
        return;
      }
      signature = next;
      cleanups.splice(0).forEach((dispose) => dispose());
      try {
        for (const [index, layer] of layers.entries()) {
          const boundary = snapshots[index];
          const detach = attachSuiteStyles(root, layer.prepared, boundary);
          cleanups.push(() => {
            detach();
            boundary.dispose();
          });
        }
      } catch (error) {
        cleanups.splice(0).forEach((dispose) => dispose());
        snapshots.forEach((snapshot) => snapshot.dispose());
        throw error;
      }
    };
    const stopRetirement = activation.onRetire(release);
    refresh();
    unsubscribe = subscribeOwners(refresh);
    return () => {
      stopRetirement();
      release();
    };
  }, [root, id, activation, protectedMode]);
}
export function RecoveryHost(): React.ReactElement | null {
  const controller = useUiEditorController();
  useUiEditorSnapshot();
  const visible = useSyncExternalStore(
    controller.subscribe,
    controller.isRecoveryVisible,
    controller.isRecoveryVisible,
  );
  const shadow = useShadowHost('paradox-suite-recovery');
  if (!shadow || !visible) return null;
  return createPortal(
    <UiFoundationProvider
      value={{ theme: 'dark', variables: {}, portalContainer: shadow, protectedMode: true }}
    >
      <style>{foundationStyles + fixedStyles}</style>
      <RecoveryPanel />
    </UiFoundationProvider>,
    shadow,
  );
}
export function NormalEditorHost(): React.ReactElement | null {
  const snapshot = useUiEditorSnapshot();
  const environment = useUiFoundation();
  const renderer = useContext(UiEditorRendererContext),
    shadow = useShadowHost('paradox-suite-editor');
  const protectedMode = snapshot.mode === 'builtin';
  const activation = useSuiteActivation();
  const returnFocus = useRef<HTMLElement | null>(null),
    wasOpen = useRef(false);
  useEffect(() => {
    if (snapshot.open && !wasOpen.current) {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      returnFocus.current = active instanceof HTMLElement ? active : null;
    }
    if (!snapshot.open && wasOpen.current && returnFocus.current?.isConnected)
      returnFocus.current.focus();
    wasOpen.current = snapshot.open;
  }, [snapshot.open]);
  useSuiteRootStyles(shadow, 'launcher.editor', snapshot.open ? activation : null, protectedMode);
  if (!shadow || !snapshot.open) return null;
  return createPortal(
    <UiFoundationProvider value={{ ...environment, portalContainer: shadow, protectedMode }}>
      <style>{foundationStyles}</style>
      <UiRuntimeRoot id="launcher.editor">{renderer?.({ protectedMode }) ?? null}</UiRuntimeRoot>
    </UiFoundationProvider>,
    shadow,
  );
}
