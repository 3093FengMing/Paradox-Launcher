/** @jsxImportSource react */
/* eslint-disable react-refresh/only-export-components -- Explicit mode-only acceptance fixture. */
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { LauncherProvider } from '../launcher/LauncherProvider';
import { useLauncherActions, useLauncherSnapshot } from '../launcher/public/context';
import type { DeepReadonly, LauncherSnapshot, LauncherActions } from '../launcher/public/types';
import {
  UiEditorProvider,
  UiEditorSourceContext,
  useUiEditorController,
} from '../ui-editor/controller';
import type { UiEditorController } from '../ui-editor/controller';
import { NormalEditorHost, RecoveryHost } from '../ui-editor/host';
import { UiFoundationProvider } from '../ui-foundation/environment';
import { SuiteProvider } from '../ui-suite/SuiteProvider';
import { UiView } from '../ui-suite/View';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import { compileSuiteInScope } from '../ui-suite/compiler';
import { createSuiteRuntimeScope } from '../ui-suite/prepared';
import type { PreparedUiSuite } from '../ui-suite/prepared';
import type { UiSuiteBundle } from '../ui-suite/model';
import {
  listOwners,
  listUiDefinitions,
  getTargetMetadata,
  getSuiteStyleRoot,
} from '../customization/ownership';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
import i18n from '../i18n';

const raw = import.meta.glob('../ui-suite/builtins/common/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const commonFiles = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [
    'common/' + path.split('/common/')[1],
    { encoding: 'utf8' as const, text: text as string },
  ]),
);
const pages = {
  instances: 'InstancesPage',
  downloads: 'DownloadsPage',
  accounts: 'AccountsPage',
  content: 'ContentPage',
  logs: 'LogsPage',
  settings: 'SettingsPage',
};
const components = {
  'app-sidebar': 'AppSidebar',
  'activity-bar': 'ActivityBar',
  'profile-card': 'ProfileCard',
  'download-queue': 'DownloadQueue',
  'account-avatar': 'AccountAvatar',
  'java-settings': 'JavaSettings',
  'argument-templates': 'ArgumentTemplates',
  'appearance-settings': 'AppearanceSettings',
  'personalization-settings': 'PersonalizationSettings',
  'appearance-presets': 'AppearancePresets',
  'window-bar': 'WindowBar',
  'launcher-dialog': 'LauncherDialog',
};
const dialogs = {
  profile: 'ProfileDialog',
  'instance-settings': 'InstanceSettingsDialog',
  'import-instances': 'ImportInstancesDialog',
  'remove-profile': 'RemoveProfileDialog',
  'close-request': 'CloseRequestDialog',
  'launch-account': 'LaunchAccountDialog',
  login: 'AccountLoginDialog',
  preset: 'AppearancePresetDialog',
  'argument-template': 'ArgumentTemplateDialog',
};
const editorSource = `import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';import {Button,TextArea,UiCatalogPresentation} from '@paradox/ui';
export default function Editor(){const s=useUiEditorSnapshot(),a=useUiEditorActions();return <section data-ui-site="editor" role="dialog" aria-label="Public suite editor" className="suite-editor-fixture" style={{pointerEvents:'auto',position:'fixed',inset:8,padding:12,overflow:'auto',background:'#202431',color:'white'}}><h1 data-ui-site="title">Trusted fixture editor</h1><input data-ui-site="local" aria-label="Local editor input" defaultValue=""/><UiCatalogPresentation><nav data-ui-site="catalog">{s.files.map(f=><Button data-ui-site="file" key={f.path} onClick={()=>a.selectFile(f.path)}>{f.path}</Button>)}</nav></UiCatalogPresentation><TextArea data-ui-site="source" aria-label="Suite source" value={s.selectedFile&&s.draft?.files[s.selectedFile]?.encoding==='utf8'?s.draft.files[s.selectedFile].text:''} onChange={e=>s.selectedFile&&a.patchFile(s.selectedFile,e.currentTarget.value)}/><Button data-ui-site="preview" onClick={()=>a.preview()}>Preview suite</Button><Button data-ui-site="close" onClick={()=>a.close()}>Close editor</Button></section>}`;
const shell = `import {UiView,UiRouteViewport} from '@paradox/ui';import {useLauncherSnapshot} from '@paradox/launcher';export default function Shell(){const s=useLauncherSnapshot();return <div data-ui-site="shell" className="app-shell" data-theme={s.appearance.theme} style={s.appearance.variables}><UiView data-ui-site="window" id="component.window-bar"/><UiView data-ui-site="sidebar" id="component.app-sidebar"/><main data-ui-site="main" style={{overflow:'auto',padding:12,minWidth:0}}><UiView data-ui-site="activity" id="component.activity-bar"/><UiRouteViewport data-ui-site="route"/></main><UiView data-ui-site="profile" id="dialog.profile"/><UiView data-ui-site="instance" id="dialog.instance-settings"/><UiView data-ui-site="import" id="dialog.import-instances"/><UiView data-ui-site="remove" id="dialog.remove-profile"/><UiView data-ui-site="close" id="dialog.close-request"/><UiView data-ui-site="launch-account" id="dialog.launch-account"/></div>}`;
async function fixtureBundle(): Promise<UiSuiteBundle> {
  const bundle = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  bundle.files = {
    ...commonFiles,
    'Shell.tsx': { encoding: 'utf8', text: shell },
    'Home.tsx': {
      encoding: 'utf8',
      text: 'export default()=> <section data-ui-site="home" data-fixture-home>Common business suite fixture</section>;',
    },
    'Editor.tsx': { encoding: 'utf8', text: editorSource },
    'Host.tsx': { encoding: 'utf8', text: 'export default()=>null;' },
  };
  bundle.files['Layer.css'] = {
    encoding: 'utf8',
    text: ':root{--task11-token:trusted}:host{--task11-host:trusted}.layer-probe{color:rgb(0,120,0)}.layer-probe::before{content:"trusted"}.layer-probe::after{content:"after"}',
  };
  bundle.files['Probe.tsx'] = {
    encoding: 'utf8',
    text: 'export default()=> <p data-ui-site="trusted" data-layer-trusted className="layer-probe">Trusted probe</p>',
  };
  bundle.manifest.views['component.probe'] = 'Probe.tsx';
  bundle.manifest.views['layout.shell'] = 'Shell.tsx';
  bundle.manifest.views['tool.editor'] = 'Editor.tsx';
  for (const [id, name] of Object.entries(pages))
    bundle.manifest.views['page.' + id] = 'common/pages/' + name + '.tsx';
  for (const [id, name] of Object.entries(components))
    bundle.manifest.views['component.' + id] =
      'common/' + (name === 'LauncherDialog' ? 'dialogs' : 'components') + '/' + name + '.tsx';
  for (const [id, name] of Object.entries(dialogs))
    bundle.manifest.views['dialog.' + id] = 'common/dialogs/' + name + '.tsx';
  for (const id of ['loading', 'error', 'notifications'])
    bundle.manifest.views['host.' + id] = 'Host.tsx';
  bundle.manifest.routes = bundle.manifest.routes.map((route) => ({
    ...route,
    entry: bundle.manifest.views['page.' + route.id],
    title: route.id === 'content' ? 'content.title' : `pages.${route.id}.title`,
  }));
  bundle.manifest.styles = ['Layer.css'];
  return normalizeDraftBundle(bundle);
}
interface Fixture {
  bundle: UiSuiteBundle;
  controller: UiEditorController;
  snapshot: DeepReadonly<LauncherSnapshot>;
  actions: LauncherActions;
  sourceCount: number;
  disposals: number;
  ready: boolean;
  releaseSource(): void;
  theme(theme: 'light' | 'dark'): void;
  disposalObservations: { styles: number; owners: number }[];
  replacement(path: string, source: string): Promise<boolean>;
  restore(): Promise<boolean>;
  parent(source: string): Promise<boolean>;
  parentFiles(files: Record<string, string>): Promise<boolean>;
  genericBootstrap(failing?: boolean): Promise<void>;
  destroy(): Promise<void>;
  metadata(): ReturnType<typeof getTargetMetadata>;
  owners(): ReturnType<typeof listOwners>;
  definitions(): ReturnType<typeof listUiDefinitions>;
  leases(): boolean;
}
declare global {
  interface Window {
    suiteViewsFixture: Fixture;
  }
}
function Capture() {
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    controller = useUiEditorController();
  window.suiteViewsFixture.snapshot = snapshot;
  window.suiteViewsFixture.actions = actions;
  window.suiteViewsFixture.controller = controller;
  return null;
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
function BusinessTheme({ children }: { children: ReactNode }) {
  const snapshot = useLauncherSnapshot();
  return (
    <UiFoundationProvider
      value={{
        theme: snapshot.appearance.theme,
        variables: snapshot.appearance.variables,
        portalContainer: document.body,
        protectedMode: false,
      }}
    >
      {children}
    </UiFoundationProvider>
  );
}
export async function installSuiteViewsFixture(root: Root) {
  await i18n.changeLanguage('en-US');
  const bundle = await fixtureBundle(),
    prepared = await compileSuiteInScope(bundle, createSuiteRuntimeScope());
  let releaseSource: () => void = () => {},
    sourceReady = false,
    sourceGate: Promise<void>;
  const resetGate = () => {
    sourceReady = false;
    sourceGate = new Promise<void>((resolve) => {
      releaseSource = () => {
        sourceReady = true;
        resolve();
      };
    });
  };
  resetGate();
  const supplied: PreparedUiSuite[] = [];
  const retain = (fallback: PreparedUiSuite) => {
    const originalDispose = fallback.dispose.bind(fallback);
    let disposed = false;
    fallback.dispose = () => {
      if (disposed) return;
      disposed = true;
      const f = window.suiteViewsFixture;
      f.disposalObservations.push({
        styles:
          document.querySelectorAll('style[data-ui-suite]').length +
          [...document.querySelectorAll('*')].reduce(
            (count, node) =>
              count + (node.shadowRoot?.querySelectorAll('style[data-ui-suite]').length ?? 0),
            0,
          ),
        owners: listOwners().length,
      });
      f.disposals++;
      originalDispose();
    };
    supplied.push(fallback);
    return fallback;
  };
  retain(prepared);
  const mount = (fallback: PreparedUiSuite) =>
    root.render(
      
        <LauncherProvider>
          <UiEditorSourceContext.Provider
            value={{
              getBuiltinBundle: async () => {
                if (!sourceReady) await sourceGate;
                return structuredClone(bundle);
              },
            }}
          >
            <UiEditorProvider>
              <BusinessTheme>
                <SuiteProvider fallback={fallback}>
                  <Capture />
                  <UiView id="layout.shell" />
                  <NormalEditorHost />
                </SuiteProvider>
              </BusinessTheme>
              <RecoveryHost />
            </UiEditorProvider>
          </UiEditorSourceContext.Provider>
        </LauncherProvider>
      ,
    );
  window.suiteViewsFixture = {
    bundle,
    controller: null as unknown as UiEditorController,
    snapshot: null as unknown as DeepReadonly<LauncherSnapshot>,
    actions: null as unknown as LauncherActions,
    sourceCount: Object.keys(commonFiles).length,
    disposals: 0,
    disposalObservations: [],
    ready: true,
    releaseSource: () => releaseSource(),
    theme: (theme) => window.suiteViewsFixture.actions.settings.patchAppearance('theme', theme),
    async replacement(path, source) {
      const f = window.suiteViewsFixture;
      if (f.controller.getSnapshot().selectedSuiteId?.startsWith('builtin.'))
        await f.controller.actions.copyBuiltin('modern', 'Public business replacement');
      f.controller.actions.patchFile(path, source);
      return f.controller.actions.preview();
    },
    restore: () => window.suiteViewsFixture.controller.actions.selectSuite('builtin.modern'),
    async parent(source) {
      const f = window.suiteViewsFixture,
        parent = structuredClone(bundle);
      parent.files['common/pages/ContentPage.tsx'] = { encoding: 'utf8', text: source };
      if (!(await f.controller.replaceParent(await normalizeDraftBundle(parent)))) return false;
      return f.controller.actions.preview();
    },
    async parentFiles(files) {
      const f = window.suiteViewsFixture,
        parent = structuredClone(bundle);
      for (const [path, text] of Object.entries(files))
        parent.files[path] = { encoding: 'utf8', text };
      if (!(await f.controller.replaceParent(await normalizeDraftBundle(parent)))) return false;
      return f.controller.actions.preview();
    },
    async genericBootstrap(failing = false) {
      root.render(<div className="app-shell">Bootstrap transition</div>);
      await turn();
      const source = structuredClone(bundle);
      if (failing)
        source.files['Shell.tsx'] = {
          encoding: 'utf8',
          text: 'export default function Fail(){throw new Error("Expected trusted bootstrap failure")}',
        };
      const generic = retain(
        await compileSuiteInScope(await normalizeDraftBundle(source), createSuiteRuntimeScope()),
      );
      Reflect.deleteProperty(generic, 'viewMetadata');
      Reflect.deleteProperty(generic, 'sourceDefinitions');
      resetGate();
      mount(generic);
      await turn();
    },
    async destroy() {
      root.render(<div className="app-shell">Detached source fixture</div>);
      await turn();
      supplied.forEach((fallback) => fallback.dispose());
    },
    leases() {
      const selector = {
          kind: 'business' as const,
          target: 'page.content',
          identity: { namespace: 'fixture', value: 'lease-unmounted' },
        },
        a = getSuiteStyleRoot('launcher.main'),
        b = getSuiteStyleRoot('launcher.main');
      const first = a.resolveTarget(selector),
        second = b.resolveTarget(selector);
      a.dispose();
      const retained = b.resolveTarget(selector);
      b.dispose();
      return (
        first !== null &&
        first === second &&
        second === retained &&
        a.resolveTarget(selector) === null &&
        b.resolveTarget(selector) === null
      );
    },
    metadata: () => getTargetMetadata({ kind: 'type', target: 'page.content' }),
    owners: listOwners,
    definitions: listUiDefinitions,
  };
  mount(prepared);
}
