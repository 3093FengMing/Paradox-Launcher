/** @jsxImportSource react */
import type { ReactNode } from 'react';
import {
  useLauncherSnapshot,
  useLauncherActions,
} from '../launcher/public/context';
import { useUiEditorController } from '../ui-editor/controller';
import { UiFoundationProvider } from '../ui-foundation/environment';
export function BuiltinsCapture() {
  const s = useLauncherSnapshot(),
    a = useLauncherActions(),
    c = useUiEditorController();
  Object.assign(window.suiteBuiltinsFixture, {
    snapshot: s,
    actions: a,
    controller: c,
  });
  return null;
}
export function BuiltinsTheme({ children }: { children: ReactNode }) {
  const s = useLauncherSnapshot();
  return (
    <UiFoundationProvider
      value={{
        theme: s.appearance.theme,
        variables: s.appearance.variables,
        portalContainer: document.body,
        protectedMode: false,
      }}
    >
      {children}
    </UiFoundationProvider>
  );
}
