/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../api';
import { useLauncher } from '../hooks/useLauncher';
import { useAccounts } from '../hooks/useAccounts';
import { useJava } from '../hooks/useJava';
import { useDownloadQueue } from '../hooks/useDownloadQueue';
import { useCloseRequest } from '../hooks/useCloseRequest';
import { useSystemTheme } from '../hooks/useSystemTheme';
import { useBackground } from '../hooks/useBackground';
import { applyLanguagePreference } from '../i18n';
import { appearanceVariables } from '../lib/appearance';
import { defaultPersonalization } from '../lib/preferences';
import { isShortcutInput, matchesLaunchShortcut } from '../lib/shortcuts';
import * as nativeWindow from '../ui-runtime/window';
import { UiFoundationAppearanceBridge } from '../ui-foundation/environment';
import { LauncherActionsContext, LauncherSnapshotContext } from './public/context';
import type { LauncherActions, NavigationSnapshot } from './public/types';
import type { SettingsTab } from '../lib/forms';
import type { DownloadTask } from '../types';
import { builtinRoutes } from '../lib/navigation';
import {
  resolveRoute,
  validateRouteId,
  validateRouteRegistry,
  type UiRouteDescriptor,
  type UiRouteId,
} from '../ui-suite/routes';
import { ActiveRouteRegistryContext } from './routeRegistry';
import type { LauncherServices } from './services';
import { CompatibilityContext } from './compatibility';
import { createLauncherSnapshot } from './snapshot';
import { useLaunchController } from './controllers/launch';
import { useProfileDraftController } from './controllers/profileDraft';
import { useInstanceDraftController } from './controllers/instanceDraft';
import { useImportDraftController } from './controllers/importDraft';
import { useRemovalController } from './controllers/removal';
import { installProfile } from './controllers/install';
import { useContentController } from './controllers/content';
import { useAccountUiController } from './controllers/accountUi';
import { downloadJava, useJavaUiController } from './controllers/javaUi';
import { useAvatarCache } from './controllers/avatars';
import { useAppearanceDraftsController } from './controllers/appearanceDrafts';

export function LauncherProvider({
  children,
  initialRouteRegistry = 'builtin',
}: {
  children: ReactNode;
  initialRouteRegistry?: 'builtin' | 'suite';
}): React.JSX.Element {
  const { t } = useTranslation();
  const launcher = useLauncher();
  const accounts = useAccounts(launcher.reportError);
  const java = useJava(launcher.reportError);
  const { scan, reloadConfig, reportError } = launcher;
  const { discover } = java;
  const onFinished = useCallback(
    (task: DownloadTask) => {
      if (task.kind === 'install') void scan();
      else if (task.kind === 'java') void discover();
      else if (task.kind === 'pack') void reloadConfig().then(scan);
    },
    [scan, reloadConfig, discover],
  );
  const downloads = useDownloadQueue(launcher.reportError, onFinished);
  const closeRequest = useCloseRequest(launcher.reportError);
  const systemDark = useSystemTheme();
  const [navigation, setNavigation] = useState<
    Omit<NavigationSnapshot, 'requestedStartupRouteId'> & { entryId: number }
  >(() => ({
    entryId: 0,
    routeId: 'home',
    params: {},
    search: '',
    routesReady: initialRouteRegistry === 'builtin',
    routes: initialRouteRegistry === 'builtin' ? builtinRoutes : [],
  }));
  const navigationRef = useRef(navigation);
  const startupApplied = useRef(false);
  const { routeId, params, search } = navigation;
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [choosingBackground, setChoosingBackground] = useState(false);
  const [choosingGameDirectory, setChoosingGameDirectory] = useState(false);
  const lifecycle = useRef(0);
  const picking = useRef(new Set<string>());
  const interaction = useRef({ editorOpen: false, picking: false, modalOpen: false });
  const interactionLease = useRef<object | null>(null);
  const [, publishInteraction] = useState(0);
  const acquireInteractionPublisher = useCallback<LauncherServices['acquireInteractionPublisher']>(() => {
    const token = {};
    interactionLease.current = token;
    let released = false;
    const publish = (patch: Partial<typeof interaction.current>) => {
      if (released || interactionLease.current !== token) return;
      let changed = false;
      for (const key of ['editorOpen', 'picking', 'modalOpen'] as const) {
        if (typeof patch[key] === 'boolean' && interaction.current[key] !== patch[key]) {
          interaction.current[key] = patch[key];
          changed = true;
        }
      }
      if (changed) publishInteraction((revision) => revision + 1);
    };
    return {
      publish,
      release() {
        if (released) return;
        if (interactionLease.current === token) {
          publish({ editorOpen: false, picking: false, modalOpen: false });
          interactionLease.current = null;
        }
        released = true;
      },
    };
  }, []);
  const controllers = useRef<{
    launch: ReturnType<typeof useLaunchController>;
    profileDraft: ReturnType<typeof useProfileDraftController>;
    instanceDraft: ReturnType<typeof useInstanceDraftController>;
    importDraft: ReturnType<typeof useImportDraftController>;
    removal: ReturnType<typeof useRemovalController>;
    content: ReturnType<typeof useContentController>;
    javaUi: ReturnType<typeof useJavaUiController>;
    appearanceDrafts: ReturnType<typeof useAppearanceDraftsController>;
  } | null>(null);
  const appearance =
    (routeId === 'settings'
      ? launcher.draft?.appearance
      : launcher.bootstrap?.config.settings.appearance) ?? null;
  const personalization =
    (routeId === 'settings'
      ? launcher.draft?.personalization
      : launcher.bootstrap?.config.settings.personalization) ?? defaultPersonalization();
  const language =
    routeId === 'settings'
      ? launcher.draft?.language
      : launcher.bootstrap?.config.settings.language;
  const background = useBackground(personalization.background_file, launcher.reportError);
  const theme =
    appearance?.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : (appearance?.theme ?? 'dark');
  const variables = appearance
    ? appearanceVariables(appearance, theme, personalization, background)
    : {};
  const current = useRef({
    launcher,
    accounts,
    java,
    downloads,
    closeRequest,
    routeId,
    t,
    params,
    search,
  });
  useEffect(() => {
    const life = lifecycle;
    const picks = picking.current;
    const flags = interaction.current;
    life.current++;
    setChoosingBackground(false);
    setChoosingGameDirectory(false);
    return () => {
      life.current++;
      picks.clear();
      interactionLease.current = null;
      Object.assign(flags, { editorOpen: false, picking: false, modalOpen: false });
    };
  }, []);
  current.current = {
    launcher,
    accounts,
    java,
    downloads,
    closeRequest,
    routeId,
    t,
    params,
    search,
  };
  useEffect(() => {
    void applyLanguagePreference(language ?? 'zh-CN').catch(reportError);
  }, [language, reportError]);
  const publishNavigation = useCallback((next: typeof navigation) => {
    navigationRef.current = next;
    Object.assign(current.current, {
      routeId: next.routeId,
      params: next.params,
      search: next.search,
    });
    setNavigation(next);
  }, []);
  const navigate = useCallback<LauncherActions['navigation']['navigate']>(
    (id, next) => {
      let requested: UiRouteId;
      try {
        requested = validateRouteId(id);
      } catch (error) {
        current.current.launcher.reportError(error);
        return;
      }
      const active = navigationRef.current;
      const resolved = resolveRoute(requested, active.routes);
      const profileKey =
        (resolved === 'content' || resolved.startsWith('custom.')) &&
        typeof next?.profileKey === 'string' &&
        next.profileKey.length > 0
          ? next.profileKey
          : null;
      publishNavigation({
        ...active,
        entryId: active.entryId + 1,
        routeId: resolved,
        params: profileKey ? { profileKey } : {},
        search: '',
      });
    },
    [publishNavigation],
  );
  const setSearch = useCallback(
    (value: string) => {
      publishNavigation({ ...navigationRef.current, search: value });
    },
    [publishNavigation],
  );
  const [registryChannel] = useState(() =>
    Object.freeze({
      setActiveRouteRegistry(routes: readonly UiRouteDescriptor[]) {
        const detached = validateRouteRegistry(routes);
        const active = navigationRef.current;
        const requested = current.current.launcher.requestedStartupRouteId;
        const applyStartup = !startupApplied.current && requested !== null;
        const resolved = resolveRoute(applyStartup ? requested : active.routeId, detached);
        if (applyStartup) startupApplied.current = true;
        const changed = applyStartup || resolved !== active.routeId;
        publishNavigation({
          ...active,
          entryId: changed ? active.entryId + 1 : active.entryId,
          routes: detached,
          routesReady: true,
          routeId: resolved,
          params: changed ? {} : active.params,
          search: changed ? '' : active.search,
        });
      },
    }),
  );
  useEffect(() => {
    const requested = launcher.requestedStartupRouteId;
    const active = navigationRef.current;
    if (!startupApplied.current && requested !== null && active.routesReady) {
      startupApplied.current = true;
      publishNavigation({
        ...active,
        entryId: active.entryId + 1,
        routeId: resolveRoute(requested, active.routes),
        params: {},
        search: '',
      });
    }
  }, [launcher.requestedStartupRouteId, publishNavigation]);
  const getInteractionState = useCallback<LauncherServices['getInteractionState']>(() => {
    const domains = controllers.current;
    return {
      editorOpen: interaction.current.editorOpen,
      picking:
        picking.current.size > 0 ||
        interaction.current.picking ||
        !!domains?.instanceDraft.snapshot.picking ||
        !!domains?.importDraft.snapshot.picking ||
        !!domains?.content.picking ||
        !!domains?.javaUi.picking,
      modalOpen:
        interaction.current.modalOpen ||
        !!domains?.launch.snapshot.selection ||
        !!domains?.profileDraft.snapshot.editor ||
        !!domains?.instanceDraft.snapshot.profile ||
        !!domains?.importDraft.snapshot.open ||
        !!domains?.removal.snapshot.profileKey ||
        !!domains?.content.snapshot.removing ||
        !!domains?.appearanceDrafts.snapshot.preset,
      closeRequested: current.current.closeRequest.request !== null,
    };
  }, []);
  const services = useMemo<LauncherServices>(
    () => ({
      launcher,
      accounts,
      java,
      downloads,
      api,
      notices: launcher.notices,
      getRouteId: () => current.current.routeId,
      getNavigation: () => ({
        entryId: navigationRef.current.entryId,
        routeId: current.current.routeId,
        params: { ...current.current.params },
        search: current.current.search,
      }),
      navigate,
      setInteractionState: (patch) => Object.assign(interaction.current, patch),
      getInteractionState,
      acquireInteractionPublisher,
    }),
    [launcher, accounts, java, downloads, navigate, getInteractionState, acquireInteractionPublisher],
  );
  const launch = useLaunchController(services);
  const currentServices = useRef(services);
  currentServices.current = services;
  const profileDraft = useProfileDraftController(services);
  const instanceDraft = useInstanceDraftController(services);
  const importDraft = useImportDraftController(services);
  const removal = useRemovalController(services);
  const content = useContentController(services);
  const accountUi = useAccountUiController(services);
  const javaUi = useJavaUiController(services);
  const avatars = useAvatarCache(services);
  const appearanceDrafts = useAppearanceDraftsController(services);
  controllers.current = {
    launch,
    profileDraft,
    instanceDraft,
    importDraft,
    removal,
    content,
    javaUi,
    appearanceDrafts,
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const { launcher: owner, downloads: queue, closeRequest: close } = current.current;
      const launcherState = owner.getGuardState();
      const downloadState = queue.getGuardState();
      const config = launcherState.config;
      const gates = getInteractionState();
      if (
        !config?.settings.personalization.shortcuts ||
        !api.desktop ||
        !config.active_profile ||
        launcherState.busy ||
        launcherState.saving ||
        downloadState.active ||
        downloadState.pending.length > 0 ||
        picking.current.size ||
        gates.editorOpen ||
        gates.picking ||
        gates.modalOpen ||
        close.request ||
        isShortcutInput(event.target) ||
        event.defaultPrevented
      )
        return;
      if (!matchesLaunchShortcut(event, config.settings.personalization.launch_shortcut)) return;
      event.preventDefault();
      void controllers.current?.launch.actions.request(config.active_profile);
    };
    // Bubble phase preserves input/control cancellation before global dispatch.
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [getInteractionState]);
  const [actions] = useState<LauncherActions>(() => {
    const owner = () => current.current;
    const patchPersonalization: LauncherActions['settings']['patchPersonalization'] = (
      key,
      value,
    ) => {
      owner().launcher.patchPersonalization(key, value);
    };
    const choose = async (kind: 'background' | 'directory') => {
      if (picking.current.has(kind)) return;
      picking.current.add(kind);
      const generation = lifecycle.current;
      const setPending = kind === 'background' ? setChoosingBackground : setChoosingGameDirectory;
      setPending(true);
      try {
        const value =
          kind === 'background'
            ? await api.chooseBackground()
            : await api.chooseDirectory(owner().t('app.gameDirectory'));
        if (value && generation === lifecycle.current) {
          if (kind === 'background') patchPersonalization('background_file', value);
          else owner().launcher.patchSettings('game_directory', value);
        }
      } catch (error) {
        if (generation === lifecycle.current) owner().launcher.reportError(error);
      } finally {
        if (generation === lifecycle.current) {
          picking.current.delete(kind);
          setPending(false);
        }
      }
    };
    return Object.freeze({
      presets: appearanceDrafts.presets,
      argumentTemplates: appearanceDrafts.argumentTemplates,
      launch: launch.actions,
      profileDraft: profileDraft.actions,
      instanceDraft: instanceDraft.actions,
      importDraft: importDraft.actions,
      removal: removal.actions,
      content: content.actions,
      config: Object.freeze({ reload: () => owner().launcher.reloadConfig() }),
      settings: Object.freeze({
        patch: (key, value) => owner().launcher.patchSettings(key, structuredClone(value)),
        patchAppearance: (key, value) => owner().launcher.patchAppearance(key, value),
        patchPersonalization,
        setTab,
        save: () => owner().launcher.saveSettings(),
        reset: () => {
          owner().launcher.resetSettings();
          appearanceDrafts.argumentTemplates.cancel();
        },
        chooseGameDirectory: () => choose('directory'),
        chooseBackground: () => choose('background'),
        clearBackground: () => patchPersonalization('background_file', ''),
        setStartupRoute: (id) => {
          try {
            const requested = validateRouteId(id);
            if (
              !navigationRef.current.routes.some(
                (route) => route.id === requested && route.startupSelectable,
              )
            )
              throw new Error(`Unavailable startup route: ${requested}`);
            patchPersonalization('startup_page', requested);
          } catch (error) {
            owner().launcher.reportError(error);
          }
        },
      }),
      profiles: Object.freeze({
        scan: () => owner().launcher.scan(),
        select: (key) => owner().launcher.selectProfile(key),
      }),
      catalog: Object.freeze({
        requestLoaders: profileDraft.requestLoaders,
        refresh: (force) => owner().launcher.refreshCatalog(force),
        setSnapshots: (value) => owner().launcher.setSnapshots(value),
      }),
      accounts: accountUi.actions,
      downloads: Object.freeze({
        install: (key) => installProfile(currentServices.current, key),
        java: (major) => downloadJava(currentServices.current, major),
        cancel: (id) => owner().downloads.cancel(id),
        retry: (id) => owner().downloads.retry(id),
      }),
      java: javaUi.actions,
      navigation: Object.freeze({
        navigate,
        setSearch,
      }),
      window: Object.freeze({
        minimize: nativeWindow.minimizeNativeWindow,
        maximize: nativeWindow.maximizeNativeWindow,
        requestClose: nativeWindow.requestNativeWindowClose,
        startDragging: nativeWindow.startNativeWindowDrag,
        respondToClose: (mode) => owner().closeRequest.close(mode),
      }),
      logs: Object.freeze({ clear: () => owner().launcher.clearLogs() }),
      notifications: Object.freeze({
        publish: (kind, message) => owner().launcher.publishNotice(kind, message),
        dismiss: (id) => owner().launcher.notices.dismiss(id),
        pause: (id, source) => owner().launcher.notices.pause(id, source),
        resume: (id, source) => owner().launcher.notices.resume(id, source),
      }),
    } satisfies LauncherActions);
  });
  const noticeSource = useMemo(
    () => ({
      subscribe: (listener: () => void) => launcher.notices.subscribe(listener),
      getSnapshot: () => launcher.notices.getSnapshot(),
    }),
    [launcher.notices],
  );
  const notices = useSyncExternalStore(
    noticeSource.subscribe,
    noticeSource.getSnapshot,
    noticeSource.getSnapshot,
  );
  const snapshot = createLauncherSnapshot(services, {
    settings: {
      draft: launcher.draft,
      saving: launcher.saving,
      dirty: JSON.stringify(launcher.draft) !== JSON.stringify(launcher.bootstrap?.config.settings),
      tab,
      choosingBackground,
      choosingGameDirectory,
    },
    navigation: {
      routeId,
      params,
      search,
      routesReady: navigation.routesReady,
      routes: navigation.routes,
      requestedStartupRouteId: launcher.requestedStartupRouteId,
    },
    appearance: { value: appearance, personalization, theme, variables, background },
    window: { desktop: api.desktop, request: closeRequest.request, closing: closeRequest.closing },
    notifications: { items: notices },
    launch: launch.snapshot,
    profileDraft: profileDraft.snapshot,
    instanceDraft: instanceDraft.snapshot,
    importDraft: importDraft.snapshot,
    removal: removal.snapshot,
    content: content.snapshot,
    accountUi: accountUi.snapshot,
    javaUi: javaUi.snapshot,
    avatars,
    drafts: appearanceDrafts.snapshot,
    loaderCatalog: profileDraft.snapshot.loaderCatalog,
  });
  return (
    <ActiveRouteRegistryContext.Provider value={registryChannel}>
      <LauncherActionsContext.Provider value={actions}>
        <LauncherSnapshotContext.Provider value={snapshot}>
          <CompatibilityContext.Provider value={{ services }}>
            <UiFoundationAppearanceBridge value={{ theme, variables }} />
            {children}
          </CompatibilityContext.Provider>
        </LauncherSnapshotContext.Provider>
      </LauncherActionsContext.Provider>
    </ActiveRouteRegistryContext.Provider>
  );
}
export default LauncherProvider;
