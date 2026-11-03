/** @jsxImportSource react */
import { useEffect, useState } from 'react';
import { useLauncherSnapshot } from './launcher/public/context';
import { UiFoundationProvider } from './ui-foundation/environment';
import { NormalEditorHost, RecoveryHost } from './ui-editor/host';
import { SuiteProvider } from './ui-suite/SuiteProvider';
import { UiView } from './ui-suite/View';
import { getPreparedBuiltin } from './ui-suite/builtins';
import type { PreparedUiSuite } from './ui-suite/prepared';

export default function App() {
  const snapshot = useLauncherSnapshot();
  const [fallback, setFallback] = useState<PreparedUiSuite | null>(null);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let mounted = true;
    let owned: PreparedUiSuite | null = null;
    void getPreparedBuiltin('modern').then((prepared) => {
      if (!mounted) { prepared.dispose(); return; }
      owned = prepared;
      setFallback(prepared);
    }).catch((error: unknown) => { if (mounted) setFailure(String(error)); });
    return () => {
      mounted = false;
      // Descendant style/registry effects detach synchronously before this owner releases.
      queueMicrotask(() => owned?.dispose());
    };
  }, []);
  return <UiFoundationProvider value={{
    theme: snapshot.appearance.theme,
    variables: snapshot.appearance.variables,
    portalContainer: document.body,
    protectedMode: false,
  }}>
    {fallback ? <SuiteProvider fallback={fallback}>
      <UiView id="layout.shell" />
      <NormalEditorHost />
    </SuiteProvider> : <div className="suite-loading" role="status">{failure || 'Loading UI suite…'}</div>}
    <RecoveryHost />
  </UiFoundationProvider>;
}
