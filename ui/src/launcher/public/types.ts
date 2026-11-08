import type { CSSProperties } from 'react';
import type { SettingsTab } from '../../lib/forms';
import type { ProfileEditor } from '../../lib/forms';
import type { ArgumentTemplateDraft, EnvironmentRow } from '../../lib/argument-templates';
import type {
  Activity,
  AccountsState,
  AppConfig,
  Appearance,
  CatalogSnapshot,
  CloseRequest,
  DownloadTask,
  GameProfile,
  FileRemovalIssue,
  GameVersion,
  InstalledInstance,
  JavaDiscovery,
  LoginPrompt,
  LogLine,
  Personalization,
  ProfileOverrides,
  Settings,
  ContentEntry,
  ContentSearch,
} from '../../types';
import type { UiNotice, UiNoticeKind } from '../../ui-runtime/notices';
import type { UiRouteId, UiRouteDescriptor } from '../../ui-suite/routes';
export type { UiRouteId, UiRouteDescriptor } from '../../ui-suite/routes';

export type {
  Activity,
  AppConfig,
  Appearance,
  GameProfile,
  Personalization,
  Settings,
  SettingsTab,
  ProfileEditor,
  ProfileOverrides,
  EnvironmentRow,
  ArgumentTemplateDraft,
  UiNotice,
  UiNoticeKind,
};
export interface NavigationSnapshot {
  routeId: UiRouteId;
  requestedStartupRouteId: UiRouteId | null;
  routesReady: boolean;
  routes: readonly UiRouteDescriptor[];
  params: { profileKey?: string };
  search: string;
}
export type DeepReadonly<T> = T extends
  string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
export interface Capability {
  allowed: boolean;
  reason: string | null;
}
export interface ProfileSnapshot {
  profile: GameProfile;
  installed: boolean;
  actualInstance: InstalledInstance | null;
  installing: boolean;
  activeTask: DownloadTask | null;
  capabilities: Record<'launch' | 'install' | 'edit' | 'remove', Capability>;
}
export interface LaunchSnapshot {
  phase: 'idle' | 'started' | 'running' | 'cancelling';
  profileKey: string | null;
  canStop: boolean;
  selection: {
    profileKey: string;
    accountId: string | null;
    submitting: boolean;
    canSubmit: boolean;
  } | null;
}
export interface LoaderCatalogSnapshot {
  request: { loader: Exclude<GameProfile['loader'], 'vanilla'>; game: string } | null;
  versions: readonly { version: string; stable: boolean }[];
  pending: boolean;
  error: string | null;
}
export interface ProfileDraftSnapshot {
  editor: ProfileEditor | null;
  pending: boolean;
  canSubmit: boolean;
  loaderCatalog: LoaderCatalogSnapshot;
}
export interface InstanceDraftSnapshot {
  profile: GameProfile | null;
  environment: EnvironmentRow[];
  pending: boolean;
  picking: boolean;
  canSubmit: boolean;
}
export interface ImportDraftSnapshot {
  open: boolean;
  directory: string;
  scannedDirectory: string;
  instances: InstalledInstance[] | null;
  selected: string[];
  scanning: boolean;
  picking: boolean;
  pending: boolean;
  canSubmit: boolean;
}
export interface RemovalSnapshot {
  profileKey: string | null;
  deleteFiles: boolean;
  confirmation: string;
  pending: boolean;
  canSubmit: boolean;
  recovery: FileRemovalIssue | null;
  residuals: FileRemovalIssue[];
}
export type ContentCategory = 'mods' | 'resourcepacks' | 'shaderpacks' | 'saves';
export type ContentKind = 'mod' | 'modpack' | 'resourcepack' | 'shader';
export interface ContentSnapshot {
  selectedProfileKey: string | null;
  category: ContentCategory;
  query: string;
  kind: ContentKind;
  request: { query: string; kind: ContentKind; offset: number } | null;
  results: ContentSearch | null;
  searchError: string | null;
  listRequest: {
    profileKey: string;
    directory: string;
    category: ContentCategory;
    loading: boolean;
    error: string | null;
  } | null;
  list: {
    profileKey: string;
    directory: string;
    category: ContentCategory;
    entries: ContentEntry[];
  } | null;
  pending: boolean;
  searching: boolean;
  removing: string | null;
  includeSaves: boolean;
}
export interface AccountUiSnapshot {
  clientIdDraft: string;
  removingId: string | null;
  promptActionPending: 'open' | 'copy' | null;
  promptExpired: boolean;
}
export interface JavaUiSnapshot {
  downloadMajorDraft: string;
}
export type PresetDialogRequest =
  { kind: 'save' | 'import' } | { kind: 'rename' | 'remove' | 'export'; id: string };
export interface PresetDialogSnapshot {
  request: PresetDialogRequest;
  name: string;
  json: string;
  pending: boolean;
  error: string | null;
}
export interface AppearanceDraftsSnapshot {
  preset: PresetDialogSnapshot | null;
  presetPending: boolean;
  argumentTemplate: ArgumentTemplateDraft | null;
  environment: EnvironmentRow[];
  argumentTemplateError: string | null;
}
export interface LauncherSnapshot {
  config: { ready: boolean; fatal: string | null; value: AppConfig | null; path: string | null };
  settings: {
    draft: Settings | null;
    saving: boolean;
    dirty: boolean;
    tab: SettingsTab;
    choosingBackground: boolean;
    choosingGameDirectory: boolean;
  };
  profiles: {
    items: ProfileSnapshot[];
    activeKey: string | null;
    installed: InstalledInstance[];
    scanning: boolean;
    scanError: string | null;
  };
  activity: Activity | null;
  launch: LaunchSnapshot;
  profileDraft: ProfileDraftSnapshot;
  instanceDraft: InstanceDraftSnapshot;
  importDraft: ImportDraftSnapshot;
  removal: RemovalSnapshot;
  content: ContentSnapshot;
  avatars: Readonly<Record<string, string | null>>;
  catalog: {
    versions: GameVersion[];
    snapshot: CatalogSnapshot | null;
    busy: boolean;
    error: string | null;
    loaders: LoaderCatalogSnapshot;
  };
  accounts: AccountUiSnapshot & {
    state: AccountsState;
    recovery: string[];
    prompt: LoginPrompt | null;
    pending: boolean;
    loginPending: boolean;
    cancelling: boolean;
    loading: boolean;
    ready: boolean;
    loadError: { message: string } | null;
  };
  downloads: { tasks: DownloadTask[]; pending: string[]; active: boolean };
  java: JavaUiSnapshot & { discovery: JavaDiscovery | null; busy: boolean };
  drafts: AppearanceDraftsSnapshot;
  navigation: NavigationSnapshot;
  appearance: {
    value: Appearance | null;
    personalization: Personalization;
    theme: 'dark' | 'light';
    variables: CSSProperties;
    background: string | null;
  };
  window: { desktop: boolean; request: CloseRequest | null; closing: boolean };
  logs: { lines: LogLine[] };
  notifications: { items: readonly UiNotice[] };
}
// Domain draft/controller groups are added by Tasks 2–4 when their guards move.
// No raw service fallback or success-returning placeholder is part of this API.
export interface LauncherActions {
  presets: {
    openDialog(this: void, request: PresetDialogRequest): void;
    patchDraft(this: void, patch: Partial<Pick<PresetDialogSnapshot, 'name' | 'json'>>): void;
    cancelDialog(this: void): void;
    save(this: void, name: string): Promise<void>;
    rename(this: void, id: string, name: string): Promise<void>;
    remove(this: void, id: string): Promise<void>;
    import(this: void, text: string): Promise<void>;
    apply(this: void, id: string): void;
    export(this: void, id: string): string;
    copyExport(this: void, id: string): Promise<void>;
  };
  argumentTemplates: {
    openNew(this: void): void;
    openEdit(this: void, id: string): void;
    patch(this: void, patch: Partial<ArgumentTemplateDraft>): void;
    setEnvironment(this: void, rows: EnvironmentRow[]): void;
    apply(this: void): void;
    cancel(this: void): void;
    remove(this: void, id: string): void;
  };
  config: { reload(this: void): Promise<void> };
  settings: {
    patch<K extends keyof Settings>(this: void, key: K, value: Settings[K]): void;
    patchAppearance<K extends keyof Appearance>(this: void, key: K, value: Appearance[K]): void;
    patchPersonalization<K extends keyof Personalization>(
      this: void,
      key: K,
      value: Personalization[K],
    ): void;
    setTab(this: void, tab: SettingsTab): void;
    save(this: void): Promise<boolean>;
    reset(this: void): void;
    chooseGameDirectory(this: void): Promise<void>;
    chooseBackground(this: void): Promise<void>;
    clearBackground(this: void): void;
    setStartupRoute(this: void, id: UiRouteId): void;
  };
  profiles: { scan(this: void): Promise<void>; select(this: void, key: string): Promise<void> };
  launch: {
    request(this: void, key: string): Promise<void>;
    chooseAccount(this: void, id: string | null): void;
    confirmAccount(this: void): Promise<void>;
    cancelSelection(this: void): void;
    stop(this: void): Promise<void>;
  };
  profileDraft: {
    openCreate(this: void, version?: string): void;
    openRename(this: void, key: string): void;
    patch(this: void, patch: Partial<ProfileEditor>): void;
    cancel(this: void): void;
    submit(this: void): Promise<boolean>;
  };
  instanceDraft: {
    open(this: void, key: string): void;
    patch(this: void, patch: Partial<Pick<GameProfile, 'name' | 'game_directory'>>): void;
    patchOverride<K extends keyof ProfileOverrides>(
      this: void,
      key: K,
      value: ProfileOverrides[K],
    ): void;
    setEnvironment(this: void, rows: EnvironmentRow[]): void;
    cancel(this: void): void;
    chooseJava(this: void): Promise<void>;
    chooseDirectory(this: void): Promise<void>;
    submit(this: void): Promise<boolean>;
  };
  importDraft: {
    open(this: void): void;
    setDirectory(this: void, path: string): void;
    setSelected(this: void, keys: string[]): void;
    cancel(this: void): void;
    chooseDirectory(this: void): Promise<void>;
    scan(this: void): Promise<void>;
    submit(this: void): Promise<boolean>;
  };
  removal: {
    open(this: void, key: string): void;
    openResidual(this: void, token: string): void;
    setDeleteFiles(this: void, value: boolean): void;
    setConfirmation(this: void, text: string): void;
    cancel(this: void): void;
    submit(this: void): Promise<boolean>;
  };
  catalog: {
    requestLoaders(
      this: void,
      loader: Exclude<GameProfile['loader'], 'vanilla'>,
      game: string,
    ): Promise<void>;
    refresh(this: void, force?: boolean): Promise<void>;
    setSnapshots(this: void, value: boolean): Promise<void>;
  };
  accounts: {
    patchClientId(this: void, text: string): void;
    beginLogout(this: void, id: string): void;
    confirmLogout(this: void): Promise<boolean>;
    cancelLogout(this: void): void;
    openLoginPage(this: void): Promise<void>;
    copyLoginCode(this: void): Promise<void>;
    reload(this: void): Promise<boolean>;
    login(this: void): Promise<boolean>;
    configure(this: void, clientId: string): Promise<boolean>;
    select(this: void, id: string | null): Promise<boolean>;
    refresh(this: void, id: string): Promise<boolean>;
    clearRecovery(this: void, id: string): Promise<boolean>;
    cancelLogin(this: void): Promise<void>;
    saveOfflineName(this: void): Promise<boolean>;
  };
  downloads: {
    install(this: void, key: string): Promise<boolean>;
    java(this: void, major: number): Promise<boolean>;
    cancel(this: void, id: string): Promise<boolean>;
    retry(this: void, id: string): Promise<boolean>;
  };
  java: {
    patchDownloadMajor(this: void, text: string): void;
    downloadEnteredMajor(this: void): Promise<boolean>;
    discover(this: void): Promise<void>;
    inspect(this: void, path: string): Promise<void>;
    chooseForSettings(this: void): Promise<void>;
    selectForSettings(this: void, path: string): void;
  };
  content: {
    selectProfile(this: void, key: string | null): void;
    setCategory(this: void, value: ContentCategory): void;
    patchSearch(this: void, patch: { query?: string; kind?: ContentKind }): void;
    search(this: void, offset?: number): Promise<void>;
    refresh(this: void): Promise<void>;
    toggleMod(this: void, name: string): Promise<void>;
    beginRemove(this: void, name: string): void;
    cancelRemove(this: void): void;
    confirmRemove(this: void): Promise<void>;
    openDirectory(this: void): Promise<void>;
    installProject(this: void, projectId: string, kind: ContentKind): Promise<void>;
    importPack(this: void): Promise<void>;
    exportInstance(this: void): Promise<void>;
    setIncludeSaves(this: void, value: boolean): void;
  };
  navigation: {
    navigate(this: void, id: UiRouteId, params?: { profileKey?: string }): void;
    setSearch(this: void, value: string): void;
  };
  window: {
    minimize(this: void): Promise<void>;
    maximize(this: void): Promise<void>;
    requestClose(this: void): Promise<void>;
    respondToClose(this: void, mode: 'stop' | 'background' | 'stay'): Promise<void>;
    startDragging(this: void): Promise<void>;
  };
  logs: { clear(this: void): Promise<void> };
  notifications: {
    publish(this: void, kind: UiNoticeKind, message: string): string;
    dismiss(this: void, id: string): void;
    pause(this: void, id: string, source: 'pointer' | 'focus'): void;
    resume(this: void, id: string, source: 'pointer' | 'focus'): void;
  };
}
