/** @jsxImportSource react */
/* eslint-disable react-refresh/only-export-components -- Mode-gated acceptance fixture installs into the existing root. */
import { Component, StrictMode, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { LauncherProvider } from '../launcher/LauncherProvider';
import { CompatibilityContext, useLauncherCompatibility } from '../launcher/compatibility';
import { useLauncherActions, useLauncherSnapshot } from '../launcher/public';
import { UiEditorProvider, UiEditorSourceContext, useUiEditorController, useSuiteActivation } from '../ui-editor/controller';
import type { UiEditorController } from '../ui-editor/controller';
import { useUiEditorSnapshot } from '../ui-editor/public';
import { NormalEditorHost, RecoveryHost, UiEditorRendererContext, useSuiteRootStyles } from '../ui-editor/host';
import { UiRuntimeRoot, UiRuntimeView } from '../customization/runtime';
import { SuiteInlineStyleContext, suiteInlineStyleResolver } from '../ui-suite/prepared';
import type { UiViewProps } from '../ui-suite/prepared';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSuiteBundle } from '../ui-suite/model';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
import i18n from '../i18n';
import { UiFoundationProvider } from '../ui-foundation/environment';

const editorSource = `import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';
import {Button,TextArea,UiCatalogPresentation} from '@paradox/ui';
export default function Editor(){const s=useUiEditorSnapshot(),a=useUiEditorActions();return <section role="dialog" aria-label="Fixture suite editor" style={{pointerEvents:'auto',position:'fixed',inset:8,padding:12,background:'#202431',color:'white',overflow:'auto'}}>
<h1>Trusted fixture editor</h1><p data-editor-dirty>{String(s.dirty)}</p><UiCatalogPresentation><nav>{s.files.map(f=><Button key={f.path} onClick={()=>a.selectFile(f.path)}>{f.path}</Button>)}</nav></UiCatalogPresentation>
<input aria-label="Local editor input" defaultValue="" />
<TextArea aria-label="Suite source" value={s.selectedFile&&s.draft?.files[s.selectedFile]?.encoding==='utf8'?s.draft.files[s.selectedFile].text:''} onChange={e=>s.selectedFile&&a.patchFile(s.selectedFile,e.currentTarget.value)} />
<Button onClick={()=>a.preview()}>Preview suite</Button><Button onClick={()=>a.save()}>Save suite</Button><Button onClick={()=>a.close()}>Close editor</Button></section>}`;
async function fixtureBundle(): Promise<UiSuiteBundle> {
  const bundle = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  bundle.files = {
    'Home.tsx': { encoding: 'utf8', text: 'export default () => null;' },
    'Editor.tsx': { encoding: 'utf8', text: editorSource },
    'a.tsx': { encoding: 'utf8', text: 'export default () => null; // a' },
    'b.tsx': { encoding: 'utf8', text: 'export default () => null; // b' },
    'style.css': { encoding: 'utf8', text: '.app-shell{color:rgb(120,150,200)}' },
  };
  bundle.manifest.views['tool.editor'] = 'Editor.tsx'; bundle.manifest.styles = ['style.css'];
  return normalizeDraftBundle(bundle);
}
declare global {
  interface Window {
    suiteEditorFixture: { controller: UiEditorController; renders: number; leases: number; normalControls: number;
      releaseReconnect(): void; reconnect(): void; setLanguage(language: string): Promise<unknown>; editorSource: string };
  }
}
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div data-editor-crash>Editor failed</div> : this.props.children; }
}
function CompiledEditor({ protectedMode }: { protectedMode: boolean }) {
  const snapshot = useLauncherSnapshot(), actions = useLauncherActions();
  const activation = useSuiteActivation();
  const layer = protectedMode ? activation?.trusted : activation?.primary;
  const View = layer?.prepared.views.get('tool.editor');
  const publication = layer?.prepared.viewMetadata.get('tool.editor');
  if (!View || !layer || !publication) return null;
  return <EditorBoundary key={layer.layerId + layer.prepared.codeGraphDigest}>
    <SuiteInlineStyleContext.Provider value={suiteInlineStyleResolver(layer.prepared)}>
      <UiRuntimeView publication={{ ...publication, layerId: layer.layerId }}>
        <View snapshot={snapshot as unknown as UiViewProps['snapshot']} actions={actions} props={{}} Original={() => null} />
      </UiRuntimeView>
    </SuiteInlineStyleContext.Provider>
  </EditorBoundary>;
}
function Capture() {
  const controller = useUiEditorController(); useUiEditorSnapshot();
  useSuiteRootStyles(document, 'launcher.main', controller.getActivation());
  const [connection] = useState(() => ({ cleanup: null as (() => void) | null }));
  window.suiteEditorFixture.controller = controller; window.suiteEditorFixture.renders++;
  window.suiteEditorFixture.releaseReconnect = () => { connection.cleanup?.(); connection.cleanup = null; };
  window.suiteEditorFixture.reconnect = () => { connection.cleanup?.(); connection.cleanup = controller.connect(); };
  useEffect(() => () => connection.cleanup?.(), [connection]);
  return <UiRuntimeRoot id="launcher.main"><div className="app-shell"><p>Editor acceptance main root</p></div></UiRuntimeRoot>;
}
function CountedProvider({ children }: { children: ReactNode }) {
  const { services } = useLauncherCompatibility();
  const [acquire] = useState(() => () => { window.suiteEditorFixture.leases++; return services.acquireInteractionPublisher(); });
  const value = useMemo(() => ({ services: { ...services, acquireInteractionPublisher: acquire } }), [services, acquire]);
  return <CompatibilityContext.Provider value={value}><UiEditorProvider>{children}</UiEditorProvider></CompatibilityContext.Provider>;
}
export async function installEditorFixture(root: Root) {
  const bundle = await fixtureBundle();
  window.suiteEditorFixture = { controller: null as unknown as UiEditorController, renders: 0, leases: 0, normalControls: 0,
    releaseReconnect() {}, reconnect() {}, setLanguage: (language) => i18n.changeLanguage(language), editorSource };
  const renderer = ({ protectedMode }: { protectedMode: boolean }) => <CompiledEditor protectedMode={protectedMode} />;
  root.render(<StrictMode><LauncherProvider><UiEditorSourceContext.Provider value={{ getBuiltinBundle: () => Promise.resolve(structuredClone(bundle)) }}>
    <CountedProvider><UiFoundationProvider value={{ theme: 'light', variables: {}, portalContainer: null, protectedMode: false,
      renderView: (_id, props, Original) => { window.suiteEditorFixture.normalControls++; return <Original {...props} />; } }}><UiEditorRendererContext.Provider value={renderer}>
      <Capture /><NormalEditorHost />
    </UiEditorRendererContext.Provider></UiFoundationProvider><RecoveryHost /></CountedProvider>
  </UiEditorSourceContext.Provider></LauncherProvider></StrictMode>);
}
