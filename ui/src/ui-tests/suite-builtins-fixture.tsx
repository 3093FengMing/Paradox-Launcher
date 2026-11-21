/** @jsxImportSource react */
import type { Root } from 'react-dom/client';
import { LauncherProvider } from '../launcher/LauncherProvider';
import type {
  DeepReadonly,
  LauncherSnapshot,
  LauncherActions,
} from '../launcher/public/types';
import {
  UiEditorProvider,
  UiEditorSourceContext,
} from '../ui-editor/controller';
import type { UiEditorController } from '../ui-editor/controller';
import { NormalEditorHost, RecoveryHost } from '../ui-editor/host';
import { SuiteProvider } from '../ui-suite/SuiteProvider';
import { UiView } from '../ui-suite/View';
import { getBuiltinBundle, getPreparedBuiltin } from '../ui-suite/builtins';
import { bundleDigest } from '../ui-suite/bundle';

import { listOwners } from '../customization/ownership';
import type { UiSuiteBundle } from '../ui-suite/model';
import i18n from '../i18n';
import { desktop, turn, wait, assert, equal } from './suite-builtins-support';
import {
  checkBuiltinProtocol,
  checkSuiteSelectionOwners,
  checkReadonlyCatalog,
} from './suite-builtins-protocol-cases';
import {
  checkBuiltinCopyExport,
  checkCustomArtwork,
  checkCustomShellHome,
  checkCssOnlyIdentity,
} from './suite-builtins-source-cases';
import {
  checkCustomRouteRegistry,
  checkSinglePresetOwner,
  checkEditorSourcePorts,
  checkSourceProvenance,
} from './suite-builtins-registry-cases';
interface Fixture {
  controller: UiEditorController;
  snapshot: DeepReadonly<LauncherSnapshot>;
  actions: LauncherActions;
  ready: boolean;
  setLanguage(language: string): Promise<unknown>;
  resolveSource(target: string): string;
  exportedArchive(): Promise<number[]>;
  importArchive(bytes: number[]): Promise<boolean>;
  pristineStartup(
    order: 'library-first' | 'source-first',
    condition?: 'ordinary' | 'safe' | 'reset' | 'corrupt',
  ): Promise<{ before: unknown; after: unknown; failures: string[] }>;
  restart(): Promise<void>;
  initialCommit: { active: string | null; revision: number } | null;
  run(
    id: 'modern' | 'immersive',
    theme: 'dark' | 'light',
  ): Promise<{
    checks: string[];
    failures: string[];
    files: UiSuiteBundle['manifest']['files'];
    digest: string;
  }>;
  dispose(): Promise<{ styles: number; owners: number; liveUrls: number }>;
  coldStartup(
    order?: 'library-first' | 'source-first',
    safe?: boolean,
  ): Promise<{ before: unknown; after: unknown; failures: string[] }>;
}
declare global {
  interface Window {
    suiteBuiltinsFixture: Fixture;
  }
}
import { BuiltinsCapture, BuiltinsTheme } from './suite-builtins-components';
export async function installSuiteBuiltinsFixture(root: Root) {
  await i18n.changeLanguage('en-US');
  const live = new Map<string, Blob>(),
    exports: Blob[] = [];
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  const click = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'click')!
    .value as (this: HTMLAnchorElement) => void;
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    if (blob instanceof Blob) live.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    live.delete(url);
    revoke(url);
  };
  HTMLAnchorElement.prototype.click = function () {
    const blob = live.get(this.href);
    if (this.download && blob) {
      exports.push(blob);
      return;
    }
    click.call(this);
  };
  const fallbackStyle =
    new URLSearchParams(location.search).get('shellHome') === 'immersive'
      ? 'immersive'
      : 'modern';
  const fallback = await getPreparedBuiltin(fallbackStyle);
  let sourceGate: Promise<void> | null = null,
    mountId = 0;
  const mount = () =>
    root.render(
      <LauncherProvider key={++mountId} initialRouteRegistry="suite">
        <UiEditorSourceContext.Provider
          value={{
            getBuiltinBundle: async (id) => {
              if (sourceGate) await sourceGate;
              return getBuiltinBundle(id);
            },
          }}
        >
          <UiEditorProvider>
            <BuiltinsTheme>
              <SuiteProvider fallback={fallback}>
                <BuiltinsCapture />
                <UiView id="layout.shell" />
                <NormalEditorHost />
              </SuiteProvider>
            </BuiltinsTheme>
            <RecoveryHost />
          </UiEditorProvider>
        </UiEditorSourceContext.Provider>
      </LauncherProvider>,
    );
  window.suiteBuiltinsFixture = {
    controller: null as unknown as UiEditorController,
    snapshot: null as unknown as DeepReadonly<LauncherSnapshot>,
    actions: null as unknown as LauncherActions,
    ready: false,
    setLanguage: (language) => i18n.changeLanguage(language),
    resolveSource(target) {
      const draft = window.suiteBuiltinsFixture.controller.getSnapshot().draft;
      const path = draft?.manifest.views[target];
      if (!path || draft?.files[path]?.encoding !== 'utf8')
        throw Error('Editable view binding missing: ' + target);
      return path;
    },
    async exportedArchive() {
      const blob = exports.at(-1);
      if (!blob) throw Error('No actual editor export captured');
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    importArchive: (bytes) =>
      window.suiteBuiltinsFixture.controller.actions.importBundle(
        new File([new Uint8Array(bytes)], 'redesign-journey.zip', {
          type: 'application/zip',
        }),
      ),
    initialCommit: null,
    async run(id, theme) {
      const f = window.suiteBuiltinsFixture,
        checks: string[] = [],
        failures: string[] = [],
        c = f.controller,
        a = f.actions;
      const check = async (name: string, run: () => void | Promise<void>) => {
        try {
          await run();
          checks.push(name);
        } catch (error) {
          failures.push(`${name}: ${String(error)}`);
        }
      };
      const builtin = await getBuiltinBundle(id);
      await checkBuiltinProtocol({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkSuiteSelectionOwners({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkBuiltinCopyExport({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkCustomArtwork({ f, c, a, id, theme, builtin, exports, check });
      await checkReadonlyCatalog({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkCustomShellHome({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkCssOnlyIdentity({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkCustomRouteRegistry({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkSinglePresetOwner({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkEditorSourcePorts({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      await checkSourceProvenance({
        f,
        c,
        a,
        id,
        theme,
        builtin,
        exports,
        check,
      });
      return {
        checks,
        failures,
        files: builtin.manifest.files,
        digest: await bundleDigest(builtin),
      };
    },
    async restart() {
      const previous = window.suiteBuiltinsFixture.controller;
      mount();
      await wait(() => window.suiteBuiltinsFixture.controller !== previous);
      await window.suiteBuiltinsFixture.controller.whenInitialized();
      await turn();
    },
    async pristineStartup(order, condition = 'ordinary') {
      const f = window.suiteBuiltinsFixture,
        previous = f.controller,
        native = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__,
        original = native.invoke,
        originalUrl = location.href;
      desktop().suiteLibrary =
        condition === 'corrupt'
          ? null
          : {
              kind: 'paradox-ui-suite-library',
              schema_version: 1,
              revision: condition === 'reset' ? 1 : 0,
              active_suite_id: null,
              suites: [],
            };
      desktop().suiteRaw =
        condition === 'corrupt' ? new Uint8Array([255, 0, 65]) : null;
      desktop().config.settings.personalization.startup_page = 'home';
      const beforeWrites = desktop().calls.filter(
        (call) => call.command === 'save_ui_suite_library',
      ).length;
      const beforeConfigWrites = desktop().calls.filter(
        (call) => call.command === 'save_config',
      ).length;
      let releaseLibrary!: () => void, releaseSource!: () => void;
      const libraryGate = new Promise<void>((resolve) => {
        releaseLibrary = resolve;
      });
      sourceGate = new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
      native.invoke = async (command, args) => {
        if (command === 'get_ui_suite_library') await libraryGate;
        return original(command, args);
      };
      if (condition === 'safe')
        history.replaceState(null, '', location.pathname + '?ui-safe=1');
      if (order === 'library-first') releaseLibrary();
      else releaseSource();
      mount();
      await wait(() => f.controller !== previous && f.snapshot.config.ready);
      await turn();
      const before = {
        choice: f.controller.getSnapshot().initialSelectionRequired,
        writes:
          desktop().calls.filter(
            (call) => call.command === 'save_ui_suite_library',
          ).length - beforeWrites,
        workspace: !!document.querySelector('.workspace'),
      };
      const failures: string[] = [];
      if (before.choice || before.writes || before.workspace)
        failures.push(
          'unready startup published choice, ordinary workspace or saved',
        );
      releaseLibrary();
      releaseSource();
      sourceGate = null;
      await f.controller.whenInitialized();
      await turn();
      native.invoke = original;
      history.replaceState(null, '', originalUrl);
      const after = {
        choice: f.controller.getSnapshot().initialSelectionRequired,
        writes:
          desktop().calls.filter(
            (call) => call.command === 'save_ui_suite_library',
          ).length - beforeWrites,
        suspended: f.controller.getSnapshot().suspended,
        revision: f.controller.getLibrary()?.revision ?? null,
        choices: document.querySelectorAll(
          '[data-style-choice] input[type=radio]',
        ).length,
      };
      if (after.choice !== (condition === 'ordinary'))
        failures.push('incorrect first-choice eligibility');
      if (after.writes !== (condition === 'reset' ? 1 : 0))
        failures.push('incorrect startup save count');
      if (condition === 'ordinary' && after.choices !== 2)
        failures.push('two static source previews are required');
      if (
        (condition === 'safe' || condition === 'corrupt') &&
        (!after.suspended || after.choices)
      )
        failures.push('Recovery must own safe/corrupt startup');
      if (
        desktop().calls.filter((call) => call.command === 'save_config')
          .length !== beforeConfigWrites
      )
        failures.push('startup wrote configuration');
      return { before, after, failures };
    },
    async coldStartup(order = 'library-first', safe = false) {
      const f = window.suiteBuiltinsFixture,
        previous = f.controller;
      if (!previous.getSnapshot().suspended)
        assert(
          await previous.actions.save(),
          'persist complete active custom.help user',
        );
      desktop().config.settings.personalization.startup_page = 'custom.help';
      const native = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args?: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__,
        original = native.invoke;
      let releaseLibrary!: () => void, releaseSource!: () => void;
      const libraryGate = new Promise<void>((resolve) => {
        releaseLibrary = resolve;
      });
      sourceGate = new Promise<void>((resolve) => {
        releaseSource = resolve;
      });
      native.invoke = async (command, args) => {
        if (command === 'get_ui_suite_library') await libraryGate;
        return original(command, args);
      };
      const writes = desktop().calls.filter(
        (c) => c.command === 'save_config',
      ).length;
      const url = location.href;
      if (safe)
        history.replaceState(null, '', location.pathname + '?ui-safe=1');
      if (order === 'library-first') releaseLibrary();
      else releaseSource();
      mount();
      await wait(() => f.controller !== previous && f.snapshot.config.ready);
      await turn();
      const before = {
          route: f.snapshot.navigation.routeId,
          ready: f.snapshot.navigation.routesReady,
          requested: f.snapshot.navigation.requestedStartupRouteId,
        },
        failures: string[] = [];
      if (before.ready)
        failures.push(
          'trusted bootstrap prematurely made active suite routes ready',
        );
      releaseLibrary();
      releaseSource();
      sourceGate = null;
      await wait(() => !!f.controller.getActivation());
      await turn();
      native.invoke = original;
      const after = {
        route: f.snapshot.navigation.routeId,
        ready: f.snapshot.navigation.routesReady,
        requested: f.snapshot.navigation.requestedStartupRouteId,
        suspended: f.controller.getSnapshot().suspended,
      };
      if (after.route !== (safe ? 'home' : 'custom.help'))
        failures.push(
          'saved custom.help was consumed before complete active source readiness',
        );
      if (
        safe &&
        (!after.suspended ||
          f.controller.getActivation()!.primary !==
            f.controller.getActivation()!.trusted)
      )
        failures.push('safe startup must publish accepted trusted only');
      history.replaceState(null, '', url);
      equal(
        desktop().config.settings.personalization.startup_page,
        'custom.help',
        'saved preference retained',
      );
      equal(
        desktop().calls.filter((c) => c.command === 'save_config').length,
        writes,
        'no startup settings write',
      );
      return { before, after, failures };
    },
    async dispose() {
      root.unmount();
      await turn();
      fallback.dispose();
      await turn();
      HTMLAnchorElement.prototype.click = click;
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
      return {
        styles: document.querySelectorAll('style[data-ui-suite]').length,
        owners: listOwners().length,
        liveUrls: live.size,
      };
    },
  };
  mount();
  await wait(
    () =>
      !!window.suiteBuiltinsFixture.controller?.getActivation() &&
      !!window.suiteBuiltinsFixture.snapshot?.accounts.ready,
  );
  window.suiteBuiltinsFixture.initialCommit = {
    active:
      window.suiteBuiltinsFixture.controller.getLibrary()!.active_suite_id,
    revision: window.suiteBuiltinsFixture.controller.getLibrary()!.revision,
  };
  window.suiteBuiltinsFixture.ready = true;
}
