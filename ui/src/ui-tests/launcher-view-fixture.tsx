/* eslint-disable react-refresh/only-export-components -- Explicit test harness exports an installer beside its consumer views. */
import { StrictMode, createElement, useEffect, useState } from 'react';
import type { Root } from 'react-dom/client';
import { LauncherProvider as BusinessHost } from '../launcher/LauncherProvider';
import { UiEditorProvider as FixtureProvider, usePreviewFixture } from './preview-fixture';
import { customComponent } from '../customization/Customizable';
import { targetRegistry } from '../customization/context';
import { jsx } from '../customization/jsx-runtime';
import { UiFoundationProvider as EnvironmentHost, Button } from '@paradox/ui';
import * as foundation from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { DeepReadonly, LauncherActions, LauncherSnapshot } from '@paradox/launcher';
import App from '../App';
import { useAccountAvatar } from '../hooks/useAccountAvatar';
import ContentPage from '../pages/ContentPage';
import AccountsPage from '../pages/AccountsPage';
import JavaSettings from '../components/JavaSettings';
import * as routeHost from '../launcher/routeRegistry';
import { builtinRoutes } from '../lib/navigation';
import type { UiRouteDescriptor } from '../ui-suite/routes';
import { installSuiteAssetsFixture } from './suite-assets-fixture';
import { installSuiteStorageFixture } from './suite-storage-fixture';
import { installSuiteCompilerFixture } from './suite-compiler-fixture';

const LocalBusinessHost = BusinessHost;
const ChainedBusinessHost = LocalBusinessHost;
const LocalCustomizationHost = FixtureProvider;
const LocalEnvironmentHost = foundation.UiFoundationProvider;
const ChainedEnvironmentHost = LocalEnvironmentHost;
const LocalFoundationNamespace = foundation;
const LocalNamespaceHost = LocalFoundationNamespace.UiFoundationProvider;
const LocalButton = Button;

interface Fixture {
  views: Record<string, { snapshot: DeepReadonly<LauncherSnapshot>; actions: LauncherActions }>;
  replace(): Promise<void>;
  restore(): Promise<void>;
  replaceApp(): Promise<void>;
  replaceInstance(): Promise<void>;
  copyDomains?(): void;
  replaceDomains?(fault?: boolean): Promise<void>;
  replaceAppearance?(): Promise<void>;
  targets(): string[];
  unmarkedProvider: boolean;
  aliasRuntime: Record<string, boolean>;
  setRoutes?(custom: readonly UiRouteDescriptor[]): void;
  navigationHistory?: DeepReadonly<LauncherSnapshot['navigation']>[];
}
declare global {
  interface Window {
    mountLauncherFixture?: (strict?: boolean) => void;
    mountLauncherAppFixture?: () => void;
    mountLauncherRouteFixture?: (strict?: boolean) => void;
    launcherFixture?: Fixture;
  }
}
function Consumer({ id }: { id: string }) {
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions();
  const avatar = useAccountAvatar(snapshot.accounts.state.accounts[0]);
  useEffect(() => {
    window.launcherFixture!.views[id] = { snapshot, actions };
    if (id === 'a') window.launcherFixture!.navigationHistory?.push(snapshot.navigation);
  }, [id, snapshot, actions]);
  return (
    <div data-consumer={id}>
      <span>{snapshot.settings.draft?.memory_mb}</span>
      {avatar && <img data-shared-avatar={id} src={avatar} alt="Shared avatar" />}
      <LocalButton onClick={() => actions.settings.patch('memory_mb', 6144)}>
        Edit memory {id}
      </LocalButton>
    </div>
  );
}
function BuiltinView() {
  return (
    <section data-view="builtin">
      <Consumer id="a" />
      <Consumer id="b" />
    </section>
  );
}
const View = customComponent('test.launcher.view', BuiltinView);
const AppView = customComponent('test.launcher.app', App);
function RouteHost() {
  const registry = routeHost.useActiveRouteRegistry();
  useEffect(() => {
    window.launcherFixture!.setRoutes = (custom) =>
      registry.setActiveRouteRegistry([...builtinRoutes, ...custom]);
    return () => {
      delete window.launcherFixture!.setRoutes;
    };
  }, [registry]);
  return <AppHost />;
}
function AppHost() {
  const manager = usePreviewFixture();
  const [copies, setCopies] = useState(false);
  useEffect(() => {
    window.launcherFixture!.copyDomains = () => setCopies(true);
    window.launcherFixture!.replaceAppearance = () =>
      manager.preview({
        views: {
          'component.argument-templates': {
                source: `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';
export default function Templates() {const s=useLauncherSnapshot().drafts;const a=useLauncherActions().argumentTemplates;return <section data-appearance-replacement="templates"><input aria-label="Replacement template name" value={s.argumentTemplate?.name??''} onChange={e=>a.patch({name:e.target.value})}/><textarea aria-label="Replacement raw environment" readOnly value={s.environment[0]?.value??''}/><span role="status">{s.argumentTemplateError}</span><button onClick={a.apply}>Apply replacement template</button></section>;}`,
          },
          'component.appearance-presets': {
                source: `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';
export default function Presets() {const drafts=useLauncherSnapshot().drafts;const s=drafts.preset;const a=useLauncherActions().presets;return <section data-appearance-replacement="presets"><textarea aria-label="Replacement preset JSON" value={s?.json??''} disabled={drafts.presetPending||s?.pending} onChange={e=>a.patchDraft({json:e.target.value})}/><span role="status">{s?.error}</span><button disabled={drafts.presetPending||s?.pending} onClick={()=>a.import(s.json).catch(()=>{})}>Import replacement preset</button></section>;}`,
          },
        },
      });
    window.launcherFixture!.replaceDomains = (fault = false) =>
      manager.preview({
        views: {
          'page.content': {
                source: fault
              ? `export default function Fault() { throw new Error('Task3 controlled view fault'); }`
              : `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher'; export default function Content() {const s=useLauncherSnapshot().content;const a=useLauncherActions().content;return <section data-domain-replacement="content"><input aria-label="Replacement content query" value={s.query} onChange={e=>a.patchSearch({query:e.target.value})}/><button onClick={()=>a.search()}>Replacement search</button><button onClick={()=>a.refresh()}>Replacement refresh</button><span>{s.list?.entries[0]?.name}</span></section>;}`,
          },
          'page.accounts': {
                source: `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher'; export default function Accounts() {const s=useLauncherSnapshot();const a=useLauncherActions().accounts;return <section data-domain-replacement="accounts"><input aria-label="Replacement client ID" value={s.accounts.clientIdDraft} onChange={e=>a.patchClientId(e.target.value)}/>{s.avatars[s.accounts.state.active]&&<img data-replacement-avatar src={s.avatars[s.accounts.state.active]}/>}</section>;}`,
          },
          'component.java-settings': {
                source: `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher'; export default function Java() {const s=useLauncherSnapshot().java;const a=useLauncherActions().java;return <section data-domain-replacement="java"><input aria-label="Replacement Java major" value={s.downloadMajorDraft} onChange={e=>a.patchDownloadMajor(e.target.value)}/></section>;}`,
          },
        },
      });
    window.launcherFixture!.replaceInstance = () =>
      manager.preview({
        views: {
          'component.instance-settings-dialog.original-instance': {
                source: `import { useLauncherSnapshot,useLauncherActions } from '@paradox/launcher';
export default function ReplacementInstance() { const draft=useLauncherSnapshot().instanceDraft; const actions=useLauncherActions().instanceDraft; return <section data-instance-replacement><input aria-label="Replacement environment key" value={draft.environment[0]?.key ?? ''} onChange={e=>actions.setEnvironment([{...draft.environment[0],key:e.target.value}])}/><textarea aria-label="Replacement environment value" value={draft.environment[0]?.value ?? ''} onChange={e=>actions.setEnvironment([{...draft.environment[0],value:e.target.value}])}/></section>; }`,
          },
        },
      });
    window.launcherFixture!.replaceApp = () =>
      manager.preview({
        views: {
          'test.launcher.app': {
                source: `import { useLauncherSnapshot } from '@paradox/launcher';
export default function ReplacementApp() { const snapshot=useLauncherSnapshot(); return <main data-app-replacement><input aria-label="Replacement typing"/><span>{snapshot.config.ready ? 'Ready' : 'Loading'}</span></main>; }`,
          },
        },
      });
    window.launcherFixture!.restore = () => manager.revert();
  }, [manager]);
  return (
    <>
      <Consumer id="a" />
      <Consumer id="b" />
      <AppView />
      {copies && (
        <section data-domain-copies>
          <ContentPage />
          <AccountsPage />
          <JavaSettings />
        </section>
      )}
    </>
  );
}
function ViewHost() {
  const manager = usePreviewFixture();
  useEffect(() => {
    window.launcherFixture!.replace = () =>
      manager.preview({
        views: {
          'test.launcher.view': {
                source: `import { useEffect } from 'react'; import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
function Consumer({id}) { const snapshot=useLauncherSnapshot(); const actions=useLauncherActions(); useEffect(()=>{window.launcherFixture.views[id]={snapshot,actions};},[snapshot,actions]); return <div data-consumer={id}>{snapshot.settings.draft.memory_mb}</div>; }
export default function Replacement() { return <section data-view="replacement"><Consumer id="a"/><Consumer id="b"/></section>; }`,
          },
        },
      });
    window.launcherFixture!.restore = () => manager.revert();
  }, [manager]);
  const named = (
    <EnvironmentHost
      value={{ theme: 'dark', variables: {}, portalContainer: null, protectedMode: false }}
    >
      <View />
    </EnvironmentHost>
  );
  const directNamespace = (
    <foundation.UiFoundationProvider
      value={{ theme: 'dark', variables: {}, portalContainer: null, protectedMode: false }}
    >
      {named}
    </foundation.UiFoundationProvider>
  );
  const local = (
    <LocalEnvironmentHost
      value={{ theme: 'dark', variables: {}, portalContainer: null, protectedMode: false }}
    >
      {directNamespace}
    </LocalEnvironmentHost>
  );
  const chained = (
    <ChainedEnvironmentHost
      value={{ theme: 'dark', variables: {}, portalContainer: null, protectedMode: false }}
    >
      {local}
    </ChainedEnvironmentHost>
  );
  const localNamespace = (
    <LocalNamespaceHost
      value={{ theme: 'dark', variables: {}, portalContainer: null, protectedMode: false }}
    >
      {chained}
    </LocalNamespaceHost>
  );
  window.launcherFixture!.aliasRuntime.namedEnvironment = named.type === EnvironmentHost;
  window.launcherFixture!.aliasRuntime.directNamespace =
    directNamespace.type === foundation.UiFoundationProvider;
  window.launcherFixture!.aliasRuntime.localEnvironment =
    local.type === foundation.UiFoundationProvider;
  window.launcherFixture!.aliasRuntime.chainedEnvironment =
    chained.type === foundation.UiFoundationProvider;
  window.launcherFixture!.aliasRuntime.localNamespace =
    localNamespace.type === foundation.UiFoundationProvider;
  return localNamespace;
}
// Test-only caller supplied by the explicit foundation-test entry. Reusing the
// root replaces and cleans up the ordinary app before mounting a new owner.
export function installLauncherFixture(root: Root) {
  installSuiteAssetsFixture();
  installSuiteStorageFixture();
  installSuiteCompilerFixture();
  let ownerSequence = 0;
  window.mountLauncherRouteFixture = (strict = false) => {
    const LocalRouteContext = routeHost.ActiveRouteRegistryContext;
    const ChainedRouteContext = LocalRouteContext;
    const contextProbe = (
      <ChainedRouteContext.Provider value={null}>{null}</ChainedRouteContext.Provider>
    );
    window.launcherFixture = {
      views: {},
      navigationHistory: [],
      replace: async () => {},
      restore: async () => {},
      replaceApp: async () => {},
      replaceInstance: async () => {},
      targets: () => [...targetRegistry],
      unmarkedProvider: true,
      aliasRuntime: {
        privateRouteContext: contextProbe.type === routeHost.ActiveRouteRegistryContext.Provider,
      },
    };
    const content = (
      <FixtureProvider>
        <BusinessHost key={`route-fixture-${++ownerSequence}`} initialRouteRegistry="suite">
          {createElement(RouteHost)}
        </BusinessHost>
      </FixtureProvider>
    );
    root.render(strict ? <StrictMode>{content}</StrictMode> : content);
  };
  window.mountLauncherFixture = (strict = false) => {
    window.launcherFixture = {
      views: {},
      replace: async () => {},
      restore: async () => {},
      replaceApp: async () => {},
      replaceInstance: async () => {},
      targets: () => [...targetRegistry],
      unmarkedProvider: jsx(BusinessHost, { children: null }).type === BusinessHost,
      aliasRuntime: {},
    };
    const business = (
      <LocalBusinessHost key={`fixture-${++ownerSequence}`}>
        <ViewHost />
      </LocalBusinessHost>
    );
    const chainedProbe = <ChainedBusinessHost>{null}</ChainedBusinessHost>;
    const namedProbe = <BusinessHost>{null}</BusinessHost>;
    const content = <LocalCustomizationHost>{business}</LocalCustomizationHost>;
    Object.assign(window.launcherFixture.aliasRuntime, {
      namedBusiness: namedProbe.type === BusinessHost,
      localBusiness: business.type === BusinessHost,
      chainedBusiness: chainedProbe.type === BusinessHost,
      localCustomization: content.type === FixtureProvider,
    });
    root.render(strict ? <StrictMode>{content}</StrictMode> : content);
  };
  window.mountLauncherAppFixture = () => {
    window.launcherFixture = {
      views: {},
      replace: async () => {},
      replaceApp: async () => {},
      replaceInstance: async () => {},
      restore: async () => {},
      targets: () => [...targetRegistry],
      unmarkedProvider: true,
      aliasRuntime: {},
    };
    root.render(
      <FixtureProvider>
        <BusinessHost key={`app-fixture-${++ownerSequence}`}>
          <AppHost />
        </BusinessHost>
      </FixtureProvider>,
    );
  };
}
