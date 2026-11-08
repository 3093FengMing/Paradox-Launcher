/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { useLauncherSnapshot } from './launcher/public/context';
import { UiFoundationProvider } from './ui-foundation/environment';
import { useUiEditorController } from './ui-editor/controller';
import { NormalEditorHost, RecoveryHost } from './ui-editor/host';
import { SuiteProvider } from './ui-suite/SuiteProvider';
import { UiView } from './ui-suite/View';
import { getPreparedBuiltin } from './ui-suite/builtins';
import type { PreparedUiSuite } from './ui-suite/prepared';

export default function App() {
  const snapshot = useLauncherSnapshot();
  const [fallback, setFallback] = useState<PreparedUiSuite | null>(null);
  const controller = useUiEditorController();
  useEffect(() => {
    let mounted = true;
    let owned: PreparedUiSuite | null = null;
    void getPreparedBuiltin('modern').then((prepared) => {
      if (!mounted) { prepared.dispose(); return; }
      owned = prepared;
      setFallback(prepared);
    }).catch((error: unknown) => { if (mounted) controller.reportPreparationFailure(error); });
    return () => {
      mounted = false;
      // Descendant style/registry effects detach synchronously before this owner releases.
      queueMicrotask(() => owned?.dispose());
    };
  }, [controller]);
  return <UiFoundationProvider value={{
    theme: snapshot.appearance.theme,
    variables: snapshot.appearance.variables,
    portalContainer: document.body,
    protectedMode: false,
  }}>
    {fallback ? <SuiteProvider fallback={fallback}>
      <UiView id="layout.shell" />
      <NormalEditorHost />
    </SuiteProvider> : null}
    <RecoveryHost />
  </UiFoundationProvider>;
}
