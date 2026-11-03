import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import i18n from './i18n';
import { validateSettings } from './lib/forms';
import {
  defaultPersonalization,
  normalizeArgumentTemplates,
  normalizePersonalization,
} from './lib/preferences';
import {
  MAX_APPEARANCE_PRESETS,
  parsePresetAppearance,
  validatePresetName,
} from './lib/appearance-presets';
import type {
  Activity,
  AccountsState,
  LoginPrompt,
  ContentEntry,
  ContentSearch,
  AppearancePreset,
  AppConfig,
  Bootstrap,
  CatalogSnapshot,
  CloseRequest,
  DownloadTask,
  GameProfile,
  InstalledInstance,
  LogEvent,
  LogIdentity,
  StoredLog,
  JavaDiscovery,
  JavaInstallation,
} from './types';

export const desktop = isTauri();
export {
  loadSuiteLibrary,
  saveSuiteLibrary,
  resetSuiteLibrary,
  readRecoverableLibrary,
  inspectSuiteRecovery,
  resetRecoverableSuiteLibrary,
} from './ui-suite/storage';
const previewKey = 'paradox-launcher-preview-v1';
const previewDefaults: AppConfig = {
  schema_version: 1,
  settings: {
    language: 'zh-CN',
    game_directory: 'C:\\Games\\ParadoxLauncher\\minecraft',
    java_executable: '',
    memory_mb: 4096,
    minimum_memory_mb: 512,
    offline_username: 'Player',
    show_snapshots: false,
    resolution_width: 1280,
    resolution_height: 720,
    extra_jvm_arguments: '',
    extra_game_arguments: '',
    close_behavior: 'ask',
    personalization: defaultPersonalization(),
    argument_templates: [],
    network: {
      timeout_seconds: 30,
      max_concurrent_downloads: 8,
      max_retries: 3,
      proxy_url: '',
      mirror_url: '',
    },
    appearance: {
      interface_style: 'immersive',
      theme: 'dark',
      accent_color: '#6387f5',
      ui_scale: 100,
      border_radius: 14,
      compact_sidebar: false,
      reduce_motion: false,
      background_art: true,
      background_blur: 0,
      background_dim: 8,
      sidebar_opacity: 62,
    },
  },
  profiles: [],
  appearance_presets: [],
  active_profile: null,
};

function parsePreviewPresets(value: unknown): AppearancePreset[] {
  if (!Array.isArray(value) || value.length > MAX_APPEARANCE_PRESETS)
    throw new Error(i18n.t('api.previewConfigInvalid'));
  const ids = new Set<string>();
  return value.map((preset: unknown) => {
    if (
      !isRecord(preset) ||
      Object.keys(preset).length !== 3 ||
      typeof preset.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(preset.id) ||
      typeof preset.name !== 'string'
    )
      throw new Error(i18n.t('api.previewConfigInvalid'));
    const id = preset.id.toLowerCase();
    if (ids.has(id) || validatePresetName(preset.name) !== preset.name)
      throw new Error(i18n.t('api.previewConfigInvalid'));
    ids.add(id);
    return {
      id: preset.id,
      name: preset.name,
      appearance: parsePresetAppearance(preset.appearance),
    };
  });
}

function loadPreview(): AppConfig {
  const stored = localStorage.getItem(previewKey);
  if (!stored) return structuredClone(previewDefaults);
  try {
    const config = JSON.parse(stored) as AppConfig;
    const normalized = {
      ...structuredClone(previewDefaults),
      ...config,
      appearance_presets: config.appearance_presets === undefined ? [] : config.appearance_presets,
      settings: {
        ...previewDefaults.settings,
        ...config.settings,
        appearance: { ...previewDefaults.settings.appearance, ...config.settings.appearance },
        network: { ...previewDefaults.settings.network, ...config.settings.network },
        personalization: normalizePersonalization(config.settings.personalization),
        argument_templates: normalizeArgumentTemplates(config.settings.argument_templates),
      },
      profiles: config.profiles.map((profile) => ({
        ...profile,
        loader: profile.loader ?? 'vanilla',
        loader_version: profile.loader_version ?? '',
        game_directory: profile.game_directory ?? null,
        overrides: profile.overrides ?? {},
      })),
    };
    if (normalized.schema_version !== previewDefaults.schema_version)
      throw new Error(i18n.t('api.previewConfigInvalid'));
    validateSettings(normalized.settings);
    normalized.settings.appearance = parsePresetAppearance(normalized.settings.appearance);
    normalized.appearance_presets = parsePreviewPresets(normalized.appearance_presets);
    return normalized;
  } catch (cause) {
    // Keep the original local-storage value intact; a failed load must never
    // silently replace the player's saved presets with an empty configuration.
    throw new Error(i18n.t('api.previewConfigInvalid'), { cause });
  }
}

export async function getConfig(): Promise<Bootstrap> {
  return desktop
    ? invoke('get_config')
    : { config: loadPreview(), config_path: i18n.t('api.previewStorage') };
}
export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  if (desktop) return invoke('save_config', { config });
  if (config.schema_version !== previewDefaults.schema_version)
    throw new Error(i18n.t('api.previewConfigInvalid'));
  validateSettings(config.settings);
  const normalized = {
    ...config,
    settings: {
      ...config.settings,
      personalization: normalizePersonalization(config.settings.personalization),
      argument_templates: normalizeArgumentTemplates(config.settings.argument_templates),
    },
  };
  parsePresetAppearance(config.settings.appearance);
  parsePreviewPresets(config.appearance_presets);
  localStorage.setItem(previewKey, JSON.stringify(normalized));
  return normalized;
}
export async function createProfile(
  name: string,
  version: string,
  loader: GameProfile['loader'] = 'vanilla',
  loaderVersion = '',
): Promise<AppConfig> {
  if (desktop) return invoke('create_profile', { name, version, loader, loaderVersion });
  if (!name.trim() || Array.from(name.trim()).length > 64)
    throw new Error(i18n.t('errors.profileName'));
  const gameVersion = version.trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(gameVersion) || ['.', '..'].includes(gameVersion))
    throw new Error(i18n.t('errors.version'));
  const config = loadPreview();
  const profile = {
    instance_key: crypto.randomUUID(),
    name: name.trim(),
    game_version: gameVersion,
    loader,
    loader_version: loaderVersion,
    game_directory: null,
    overrides: {},
  };
  config.profiles.push(profile);
  config.active_profile = profile.instance_key;
  return saveConfig(config);
}
export async function catalog(forceRefresh = false): Promise<CatalogSnapshot> {
  if (desktop) return invoke('catalog', { forceRefresh });
  const response = await fetch(
    import.meta.env.DEV
      ? '/mojang/mc/game/version_manifest_v2.json'
      : 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(i18n.t('api.catalogRequestFailed', { status: response.status }));
  const manifest: unknown = await response.json();
  if (!isRecord(manifest) || !Array.isArray(manifest.versions)) {
    throw new Error(i18n.t('api.catalogFormat'));
  }
  const versions = manifest.versions.map((version: unknown) => {
    if (!isRecord(version) || typeof version.id !== 'string' || typeof version.type !== 'string') {
      throw new Error(i18n.t('api.catalogEntry'));
    }
    return { id: version.id, kind: version.type };
  });
  return {
    versions,
    fetched_at: Math.floor(Date.now() / 1000),
    source: 'network',
    stale: false,
    warning: null,
    error_kind: null,
  };
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!desktop) return Promise.reject(new Error(i18n.t('api.desktopOnly')));
  return invoke<T>(command, args);
}

export const discoverJava = () => invokeDesktop<JavaDiscovery>('discover_java');
export const searchContent = (query: string, category: string, offset: number) =>
  invokeDesktop<ContentSearch>('search_content', { query, category, offset });
export const listContent = (key: string, category: string) =>
  invokeDesktop<ContentEntry[]>('list_content', { key, category });
export const toggleMod = (key: string, name: string) =>
  invokeDesktop<void>('toggle_mod', { key, name });
export const removeContent = (key: string, category: string, name: string) =>
  invokeDesktop<void>('remove_content', { key, category, name });
export const openContentDirectory = (key: string, category: string) =>
  invokeDesktop<void>('open_content_directory', { key, category });
export const enqueueContent = (key: string, project: string, category: string) =>
  invokeDesktop<DownloadTask>('enqueue_content', { key, project, category });
export const enqueuePack = (source: string, remote: boolean) =>
  invokeDesktop<DownloadTask>('enqueue_pack', { source, remote });
export const choosePack = () => invokeDesktop<string | null>('choose_pack');
export const chooseBackground = () => invokeDesktop<string | null>('choose_background');
export const readBackground = (id: string) => invokeDesktop<string>('read_background', { id });
export const storedLogs = () =>
  desktop ? invoke<StoredLog[]>('stored_logs') : Promise.resolve<StoredLog[]>([]);
export const clearStoredLogs = () =>
  desktop ? invoke<LogIdentity>('clear_stored_logs') : Promise.resolve(null);
export const exportInstance = (key: string, includeSaves: boolean) =>
  invokeDesktop<boolean>('export_instance', { key, includeSaves });
export const accountState = () =>
  desktop
    ? invoke<AccountsState>('account_state')
    : Promise.resolve<AccountsState>({ client_id: '', active: null, accounts: [] });
export const accountSkin = (accountId: string) =>
  desktop ? invoke<string | null>('account_skin', { accountId }) : Promise.resolve(null);
export const accountRecovery = () =>
  desktop ? invoke<string[]>('account_recovery') : Promise.resolve<string[]>([]);
export const clearAccountRecovery = (accountId: string) =>
  invokeDesktop<string[]>('clear_account_recovery', { accountId });
export const configureMicrosoft = (clientId: string) =>
  invokeDesktop<AccountsState>('configure_microsoft', { clientId });
export const openLoginPage = (id: string) => invokeDesktop<void>('open_login_page', { id });
export const loaderVersions = (loader: string, game: string) =>
  invokeDesktop<{ version: string; stable: boolean }[]>('loader_versions', { loader, game });
export const beginLogin = (requestId?: string) =>
  invokeDesktop<LoginPrompt>('begin_login', { requestId });
export const completeLogin = (id: string) => invokeDesktop<AccountsState>('complete_login', { id });
export const cancelLogin = (id: string) => invokeDesktop<void>('cancel_login', { id });
export const selectAccount = (id: string | null) =>
  invokeDesktop<AccountsState>('select_account', { id });
export const refreshAccount = (id: string) =>
  invokeDesktop<AccountsState>('refresh_account', { id });
export const logoutAccount = (id: string) => invokeDesktop<AccountsState>('logout_account', { id });
export const inspectJava = (path: string) =>
  invokeDesktop<JavaInstallation>('inspect_java', { path });
export const enqueueJava = (majorVersion: number) =>
  invokeDesktop<DownloadTask>('enqueue_java', { majorVersion });
export const enqueueInstall = (key: string) =>
  invokeDesktop<DownloadTask>('enqueue_install', { key });
export const downloadTasks = () =>
  desktop ? invoke<DownloadTask[]>('download_tasks') : Promise.resolve([]);
export const cancelTask = (id: string) => invokeDesktop<void>('cancel_task', { id });
export const retryTask = (id: string) => invokeDesktop<DownloadTask>('retry_task', { id });
export const chooseDirectory = (title: string) =>
  invokeDesktop<string | null>('choose_directory', { title });
export const chooseJava = () =>
  invokeDesktop<string | null>('choose_java', { title: i18n.t('java.chooseFile') });
export const scanImport = (directory: string) =>
  invokeDesktop<InstalledInstance[]>('scan_import', { directory });
export const importInstances = (directory: string, keys: string[]) =>
  invokeDesktop<AppConfig>('import_instances', { directory, keys });
export const closeLauncher = (mode: 'stop' | 'background' | 'stay') =>
  invokeDesktop<void>('close_launcher', { mode });

export async function updateProfile(profile: GameProfile): Promise<AppConfig> {
  if (desktop) return invoke('update_profile', { profile });
  const config = loadPreview();
  if (!config.profiles.some((item) => item.instance_key === profile.instance_key))
    throw new Error(i18n.t('api.profileMissing'));
  config.profiles = config.profiles.map((item) =>
    item.instance_key === profile.instance_key ? profile : item,
  );
  return saveConfig(config);
}

export async function removeProfile(key: string, deleteFiles: boolean): Promise<AppConfig> {
  if (desktop) return invoke('remove_profile', { key, deleteFiles });
  if (deleteFiles) throw new Error(i18n.t('api.removeFilesDesktopOnly'));
  const config = loadPreview();
  config.profiles = config.profiles.filter((profile) => profile.instance_key !== key);
  if (config.active_profile === key)
    config.active_profile = config.profiles[0]?.instance_key ?? null;
  return saveConfig(config);
}

export async function subscribeDownloads(
  callback: (tasks: DownloadTask[]) => void,
): Promise<() => void> {
  if (!desktop) return () => {};
  return listen<DownloadTask[]>('launcher://downloads', (event) => callback(event.payload));
}

export async function subscribeCloseRequests(
  callback: (request: CloseRequest) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  if (!desktop) return () => {};
  const close = await listen<CloseRequest>('launcher://close-requested', (event) =>
    callback(event.payload),
  );
  try {
    const error = await listen<string>('launcher://close-error', (event) => onError(event.payload));
    return () => {
      close();
      error();
    };
  } catch (error) {
    close();
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function inspectInstances(): Promise<InstalledInstance[]> {
  return desktop ? invoke('inspect_instances') : [];
}
export async function launchInstance(key: string): Promise<void> {
  return invokeDesktop('launch_instance', { key });
}
export async function stopGame(): Promise<void> {
  return invokeDesktop('stop_game');
}
export async function subscribe(
  onActivity: (event: Activity) => void,
  onLog: (event: LogEvent) => void,
): Promise<() => void> {
  if (!desktop) return () => {};
  const activity = await listen<Activity>('launcher://activity', (event) =>
    onActivity(event.payload),
  );
  try {
    const log = await listen<LogEvent>('launcher://log', (event) => onLog(event.payload));
    return () => {
      activity();
      log();
    };
  } catch (error) {
    activity();
    throw error;
  }
}
