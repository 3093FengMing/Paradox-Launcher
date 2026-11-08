/** @jsxImportSource react */
/* eslint-disable react-refresh/only-export-components -- Mode-only acceptance fixture. */
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { LauncherProvider } from '../launcher/LauncherProvider';
import { useLauncherSnapshot, useLauncherActions } from '../launcher/public/context';
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
import { getBuiltinBundle, getPreparedBuiltin } from '../ui-suite/builtins';
import { normalizeDraftBundle, materializeSuite, bundleDigest } from '../ui-suite/bundle';
import { encodeSuiteArchive, decodeSuiteArchive } from '../ui-suite/archive';
import { canonicalSuiteJson } from '../ui-suite/canonical';
import { listOwners, listUiDefinitions } from '../customization/ownership';
import type { UiSuiteBundle, UiSuiteLibrary } from '../ui-suite/model';
import i18n from '../i18n';

interface Fixture {
  controller: UiEditorController;
  snapshot: DeepReadonly<LauncherSnapshot>;
  actions: LauncherActions;
  ready: boolean;
  setLanguage(language: string): Promise<unknown>;
  resolveSource(target: string): string;
  exportedArchive(): Promise<number[]>;
  importArchive(bytes: number[]): Promise<boolean>;
  pristineStartup(order: 'library-first' | 'source-first', condition?: 'ordinary' | 'safe' | 'reset' | 'corrupt'): Promise<{ before: unknown; after: unknown; failures: string[] }>;
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
const desktop = () =>
  (
    window as unknown as {
      foundationDesktop: {
        calls: { command: string }[];
        suiteLibrary: UiSuiteLibrary | null;
        suiteRaw: Uint8Array | null;
        config: { settings: { personalization: { startup_page: string } } };
      };
    }
  ).foundationDesktop;
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
const wait = async (check: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await turn();
  }
  throw Error('Fixture state did not settle');
};
function Capture() {
  const s = useLauncherSnapshot(),
    a = useLauncherActions(),
    c = useUiEditorController();
  Object.assign(window.suiteBuiltinsFixture, { snapshot: s, actions: a, controller: c });
  return null;
}
function Theme({ children }: { children: ReactNode }) {
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
const equal = (a: unknown, b: unknown, message: string) => {
  if (canonicalSuiteJson(a) !== canonicalSuiteJson(b)) throw Error(message);
};
const assert = (v: unknown, message: string) => {
  if (!v) throw Error(message);
};
export async function installSuiteBuiltinsFixture(root: Root) {
  await i18n.changeLanguage('en-US');
  const live = new Map<string, Blob>(),
    exports: Blob[] = [];
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  const click = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'click')!.value as (
    this: HTMLAnchorElement,
  ) => void;
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
  const fallbackStyle = new URLSearchParams(location.search).get('shellHome') === 'immersive' ? 'immersive' : 'modern';
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
              <Theme>
                <SuiteProvider fallback={fallback}>
                  <Capture />
                  <UiView id="layout.shell" />
                  <NormalEditorHost />
                </SuiteProvider>
              </Theme>
              <RecoveryHost />
            </UiEditorProvider>
          </UiEditorSourceContext.Provider>
        </LauncherProvider>
,
    );
  window.suiteBuiltinsFixture = {
    controller: null as unknown as UiEditorController,
    snapshot: null as unknown as DeepReadonly<LauncherSnapshot>,
    actions: null as unknown as LauncherActions,
    ready: false,
    setLanguage: language => i18n.changeLanguage(language),
    resolveSource(target) {
      const draft = window.suiteBuiltinsFixture.controller.getSnapshot().draft;
      const path = draft?.manifest.views[target];
      if (!path || draft?.files[path]?.encoding !== 'utf8') throw Error('Editable view binding missing: ' + target);
      return path;
    },
    async exportedArchive() {
      const blob = exports.at(-1);
      if (!blob) throw Error('No actual editor export captured');
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    importArchive: bytes => window.suiteBuiltinsFixture.controller.actions.importBundle(new File([new Uint8Array(bytes)], 'redesign-journey.zip', { type: 'application/zip' })),
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
      await check('modern_immersive_same_protocol', async () => {
        const other = await getBuiltinBundle(id === 'modern' ? 'immersive' : 'modern');
        equal(other.manifest.api_version, builtin.manifest.api_version, 'one API protocol');
        const p = await getPreparedBuiltin(id);
        equal(p.digest, await bundleDigest(builtin), 'prepared exact real builtin bytes');
        assert(p.views.has('tool.editor') && p.views.has('host.notifications'), 'complete views');
        p.dispose();
      });
      await check('suite_selection_does_not_save_settings', async () => {
        a.settings.patch('memory_mb', 6144);
        a.accounts.patchClientId('unfinished-client');
        a.java.patchDownloadMajor('21');
        a.content.patchSearch({ query: 'unfinished-query' });
        await turn();
        const commands = desktop().calls.length,
          stableActions = f.actions;
        assert(await c.actions.selectSuite('builtin.' + id), 'builtin selection ACK');
        await turn();
        equal(f.snapshot.settings.draft?.memory_mb, 6144, 'settings draft retained');
        equal(f.snapshot.accounts.clientIdDraft, 'unfinished-client', 'account draft');
        equal(f.snapshot.java.downloadMajorDraft, '21', 'Java draft');
        equal(f.snapshot.content.query, 'unfinished-query', 'content draft');
        assert(f.actions === stableActions, 'stable actions');
        assert(
          !desktop()
            .calls.slice(commands)
            .some((x) =>
              [
                'save_config',
                'get_config',
                'account_state',
                'account_recovery',
                'download_tasks',
                'plugin:event|listen',
              ].includes(x.command),
            ),
          'no settings write/read/new subscription',
        );
        a.settings.patchAppearance('theme', theme);
        await turn();
        assert(
          document.querySelector('.app-shell')?.classList.contains(id + '-shell'),
          'library selects builtin shell',
        );
        const old = c.getSnapshot().selectedSuiteId;
        a.settings.patchAppearance('interface_style', id === 'modern' ? 'immersive' : 'modern');
        await turn();
        equal(c.getSnapshot().selectedSuiteId, old, 'appearance tokens do not select structure');
      });
      await check('builtin_source_equals_copied_export', async () => {
        await c.actions.copyBuiltin(id, 'Task12 copy');
        equal(c.getSnapshot().draft?.files, builtin.files, 'exact complete builtin copy');
        const before = exports.length;
        await c.actions.exportDraft();
        assert(exports.length === before + 1, 'actual editor export sink');
        const reimported = await decodeSuiteArchive(
          new Uint8Array(await exports.at(-1)!.arrayBuffer()),
        );
        equal(reimported.files, builtin.files, 'actual exported ZIP reimport exact');
        const archive = await encodeSuiteArchive(
          await normalizeDraftBundle(structuredClone(c.getSnapshot().draft!) as UiSuiteBundle),
        );
        equal(
          (await decodeSuiteArchive(archive)).files,
          reimported.files,
          'self-contained materialization',
        );
        assert(await c.actions.save(), 'copied source commit');
        const record = c
          .getLibrary()!
          .suites.find((r) => r.instance_id === c.getSnapshot().selectedSuiteId)!;
        equal(materializeSuite(record).files, builtin.files, 'fixed parent materialization');
        equal(
          record.parent_snapshot?.bundle.files[builtin.manifest.views['layout.shell']],
          builtin.files[builtin.manifest.views['layout.shell']],
          'actual source bytes are fixed in the parent snapshot',
        );
      });
      await check('copied_default_can_add_preview_save_and_export_artwork', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="#6387f5" d="M0 0h2v2H0z"/></svg>';
        assert(await c.actions.addAsset(new File([svg], 'user-added.svg', { type: 'image/svg+xml' })), 'public artwork importer accepts a user image');
        const path = c.getSnapshot().files.find((file) => file.kind === 'asset')!.path;
        const home = builtin.manifest.views['page.home'];
        const relative = '../' + path;
        c.actions.patchFile(home, `import image from '${relative}';export default function Home(){return <img data-ui-site="task1-custom-artwork" className="task1-custom-artwork" src={image} alt="User supplied artwork"/>}`);
        a.navigation.navigate('home');
        assert(await c.actions.preview(), 'copied source with a user asset previews');
        await turn();
        const image = document.querySelector<HTMLImageElement>('.task1-custom-artwork');
        assert(image && image.src.startsWith('blob:'), 'custom source resolves its local artwork URL');
        await wait(() => !!image?.complete && !!image.naturalWidth);
        assert(await c.actions.save(), 'user artwork persists with copied source');
        const record = c.getLibrary()!.suites.find((row) => row.instance_id === c.getSnapshot().selectedSuiteId)!;
        equal(materializeSuite(record).files[path], c.getSnapshot().draft!.files[path], 'saved user artwork bytes');
        await c.actions.exportDraft();
        const exported = await decodeSuiteArchive(new Uint8Array(await exports.at(-1)!.arrayBuffer()));
        equal(exported.files[path], c.getSnapshot().draft!.files[path], 'archive keeps user artwork');
      });
      await check('public_catalog_ack_and_readonly', () => {
        const rows = c.getSnapshot().suites;
        assert(
          rows.filter((r) => r.builtin).length === 2 &&
            rows.some((r) => !r.builtin && r.name === 'Task12 copy'),
          'genuine builtins and ACKed user',
        );
        assert(Object.isFrozen(rows) && rows.every(Object.isFrozen), 'detached readonly catalog');
      });
      await check('changed_shell_home_keep_business', async () => {
        const shell = builtin.manifest.views['layout.shell'],
          home = builtin.manifest.views['page.home'],
          file = c.getSnapshot().draft!.files[shell];
        if (file.encoding === 'utf8')
          c.actions.patchFile(
            shell,
            file.text.replace(
              /(<UiView[^>]*id="component.window-bar")/,
              '<h2 data-ui-site="task12-custom-shell">My custom shell</h2>$1',
            ),
          );
        c.actions.patchFile(
          home,
          `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';export default function Home(){const s=useLauncherSnapshot(),a=useLauncherActions();return <section data-ui-site="task12-home"><h2 data-ui-site="task12-home-title">My custom home</h2><input data-ui-site="task12-input" aria-label="Custom home input" defaultValue=""/><button data-ui-site="task12-content" onClick={()=>a.navigation.navigate('content')}>Open shared content</button><p data-ui-site="task12-memory">{s.settings.draft?.memory_mb}</p></section>}`,
        );
        a.navigation.navigate('home');
        assert(await c.actions.preview(), 'actual Shell/Home edits prepare');
        await turn();
        assert(
          document.body.textContent?.includes('My custom shell') &&
            document.body.textContent?.includes('My custom home'),
          'edited sources render',
        );
        equal(f.snapshot.settings.draft?.memory_mb, 6144, 'shared draft retained');
      });
      await check('css_only_keeps_input_identity', async () => {
        const input = document.querySelector<HTMLInputElement>('[aria-label="Custom home input"]')!;
        input.value = 'unfinished-local-input';
        input.focus();
        const homePath = builtin.manifest.views['page.home'], homeFile = builtin.files[homePath];
        assert(homeFile?.encoding === 'utf8', 'current builtin Home is editable');
        const cssImport = homeFile.encoding === 'utf8' ? [...homeFile.text.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)][0]?.[1] : null;
        assert(cssImport, 'current Home imports its own stylesheet');
        const component = c.getActivation()!.primary.prepared.views.get('layout.shell'),
          style = new URL(cssImport!, 'https://fixture.invalid/' + homePath).pathname.slice(1),
          file = c.getSnapshot().draft!.files[style];
        if (file.encoding === 'utf8')
          c.actions.patchFile(
            style,
            file.text + '\n[aria-label="Custom home input"]{color:rgb(20,80,150)}',
          );
        assert(await c.actions.preview(), 'CSS-only compilation');
        await turn();
        assert(
          input === document.querySelector('[aria-label="Custom home input"]'),
          'same local DOM',
        );
        equal(input.value, 'unfinished-local-input', 'text retained');
        assert(
          c.getActivation()!.primary.prepared.views.get('layout.shell') === component,
          'same code graph Component',
        );
        equal(getComputedStyle(input).color, 'rgb(20, 80, 150)', 'current computed CSS');
      });
      await check('custom_help_navigation_startup_registry', async () => {
        c.actions.createFile('Help.tsx', 'tsx');
        c.actions.patchFile(
          'Help.tsx',
          `export default()=> <section data-ui-site="task12-help"><h2 data-ui-site="task12-help-title">Custom help</h2></section>`,
        );
        const manifest = c.getSnapshot().draft!.manifest;
        c.actions.patchManifest({
          views: { ...manifest.views, 'page.custom.help': 'Help.tsx' },
          routes: [
            ...manifest.routes,
            {
              id: 'custom.help',
              entry: 'Help.tsx',
              title: 'Custom help',
              description: 'Suite help',
              navigation: true,
              startupSelectable: true,
              order: 99,
              icon: 'CircleHelp',
            },
          ],
        });
        assert(await c.actions.preview(), 'custom route prepared');
        await turn();
        const route = f.snapshot.navigation.routes.find((r) => r.id === 'custom.help');
        assert(route?.navigation && route.startupSelectable, 'same navigation/startup registry');
        a.settings.setStartupRoute('custom.help');
        a.navigation.navigate('custom.help');
        await turn();
        equal(
          f.snapshot.settings.draft?.personalization.startup_page,
          'custom.help',
          'startup draft',
        );
        assert(document.body.textContent?.includes('Custom help'), 'custom route rendered');
      });
      await check('preset_dialog_has_one_source_owner', async () => {
        a.settings.setTab('appearance');
        a.navigation.navigate('settings');
        a.presets.openDialog({ kind: 'save' });
        await turn();
        equal(
          document.querySelectorAll('[role="dialog"]').length,
          1,
          'one preset dialog mounted by shared page composition',
        );
        a.presets.cancelDialog();
        a.navigation.navigate('custom.help');
        await turn();
      });
      await check('editor_sources_shadow_assets_select_and_notifications', async () => {
        c.actions.open();
        await wait(
          () =>
            !!document
              .getElementById('paradox-suite-editor')
              ?.shadowRoot?.querySelector(`[role="dialog"][aria-label="${i18n.t('uiSuiteEditor.title')}"]`),
        );
        const shadow = document.getElementById('paradox-suite-editor')!.shadowRoot!;
        assert(shadow.querySelector(`[aria-label="${i18n.t('uiSuiteEditor.source')}"]`), 'actual source editor');
        assert(shadow.querySelector(`[role="combobox"][aria-label="${i18n.t('uiSuiteEditor.suite')}"]`), 'foundation Select');
        assert(shadow.querySelector('.suite-assets'), 'actual asset manager');
        assert(shadow.querySelector('.ui-notice-viewport'), 'same editor notice host');
        const notice = a.notifications.publish('info', 'Task12 dual root lease');
        await turn();
        assert(
          [...document.querySelectorAll('.ui-notice')].some((n) =>
            n.textContent?.includes('Task12 dual root lease'),
          ),
          'main notices',
        );
        assert(shadow.textContent?.includes('Task12 dual root lease'), 'editor notices');
        const secondNotice = a.notifications.publish('warning', 'Task4 distinct notice identity');
        await turn();
        const noticeSource = c.getSnapshot().draft!.manifest.views['host.notifications'];
        for (const identity of [notice, secondNotice]) {
          for (const renderRoot of ['launcher.main', 'launcher.editor']) {
            assert(listOwners().some(owner => owner.metadata.sourcePath === noticeSource && owner.locator.renderRoot === renderRoot && owner.locator.business.some(item => item.namespace === 'notice' && item.value === identity)), 'each source notice has its own business identity in each viewport');
          }
        }
        a.notifications.dismiss(secondNotice);
        a.notifications.dismiss(notice);
        c.actions.close();
        await turn();
        assert(!shadow.querySelector('.suite-editor'), 'source editor closes');
      });
      await check('actual_source_and_registry_provenance', () => {
        assert(
          listUiDefinitions().some((d) => d.sourcePath === builtin.manifest.views['layout.shell']),
          'actual source path',
        );
        assert(
          listOwners().some((o) => o.locator.renderRoot === 'launcher.main'),
          'same runtime owners',
        );
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
      mount(); await wait(() => window.suiteBuiltinsFixture.controller !== previous);
      await window.suiteBuiltinsFixture.controller.whenInitialized(); await turn();
    },
    async pristineStartup(order, condition = 'ordinary') {
      const f = window.suiteBuiltinsFixture, previous = f.controller, native = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__, original = native.invoke, originalUrl = location.href;
      desktop().suiteLibrary = condition === 'corrupt' ? null : { kind: 'paradox-ui-suite-library', schema_version: 1, revision: condition === 'reset' ? 1 : 0, active_suite_id: null, suites: [] };
      desktop().suiteRaw = condition === 'corrupt' ? new Uint8Array([255, 0, 65]) : null;
      desktop().config.settings.personalization.startup_page = 'home';
      const beforeWrites = desktop().calls.filter(call => call.command === 'save_ui_suite_library').length;
      const beforeConfigWrites = desktop().calls.filter(call => call.command === 'save_config').length;
      let releaseLibrary!: () => void, releaseSource!: () => void;
      const libraryGate = new Promise<void>(resolve => { releaseLibrary = resolve; });
      sourceGate = new Promise<void>(resolve => { releaseSource = resolve; });
      native.invoke = async (command, args) => { if (command === 'get_ui_suite_library') await libraryGate; return original(command, args); };
      if (condition === 'safe') history.replaceState(null, '', location.pathname + '?ui-safe=1');
      if (order === 'library-first') releaseLibrary(); else releaseSource();
      mount(); await wait(() => f.controller !== previous && f.snapshot.config.ready); await turn();
      const before = { choice: f.controller.getSnapshot().initialSelectionRequired, writes: desktop().calls.filter(call => call.command === 'save_ui_suite_library').length - beforeWrites, workspace: !!document.querySelector('.workspace') };
      const failures: string[] = [];
      if (before.choice || before.writes || before.workspace) failures.push('unready startup published choice, ordinary workspace or saved');
      releaseLibrary(); releaseSource(); sourceGate = null;
      await f.controller.whenInitialized(); await turn(); native.invoke = original; history.replaceState(null, '', originalUrl);
      const after = { choice: f.controller.getSnapshot().initialSelectionRequired, writes: desktop().calls.filter(call => call.command === 'save_ui_suite_library').length - beforeWrites, suspended: f.controller.getSnapshot().suspended, revision: f.controller.getLibrary()?.revision ?? null, choices: document.querySelectorAll('[data-style-choice] input[type=radio]').length };
      if (after.choice !== (condition === 'ordinary')) failures.push('incorrect first-choice eligibility');
      if (after.writes !== (condition === 'reset' ? 1 : 0)) failures.push('incorrect startup save count');
      if (condition === 'ordinary' && after.choices !== 2) failures.push('two static source previews are required');
      if ((condition === 'safe' || condition === 'corrupt') && (!after.suspended || after.choices)) failures.push('Recovery must own safe/corrupt startup');
      if (desktop().calls.filter(call => call.command === 'save_config').length !== beforeConfigWrites) failures.push('startup wrote configuration');
      return { before, after, failures };
    },
    async coldStartup(order = 'library-first', safe = false) {
      const f = window.suiteBuiltinsFixture,
        previous = f.controller;
      if (!previous.getSnapshot().suspended)
        assert(await previous.actions.save(), 'persist complete active custom.help user');
      desktop().config.settings.personalization.startup_page = 'custom.help';
      const native = (
          window as unknown as {
            __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
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
      const writes = desktop().calls.filter((c) => c.command === 'save_config').length;
      const url = location.href;
      if (safe) history.replaceState(null, '', location.pathname + '?ui-safe=1');
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
        failures.push('trusted bootstrap prematurely made active suite routes ready');
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
        failures.push('saved custom.help was consumed before complete active source readiness');
      if (
        safe &&
        (!after.suspended ||
          f.controller.getActivation()!.primary !== f.controller.getActivation()!.trusted)
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
    active: window.suiteBuiltinsFixture.controller.getLibrary()!.active_suite_id,
    revision: window.suiteBuiltinsFixture.controller.getLibrary()!.revision,
  };
  window.suiteBuiltinsFixture.ready = true;
}
