import type { LauncherServices } from './services';
import type {
  AccountUiSnapshot,
  DeepReadonly,
  JavaUiSnapshot,
  LauncherSnapshot,
} from './public/types';
import { installedProfile, profileIsInstalled } from '../lib/instances';
import { errorMessage } from '../lib/errors';
import {
  capability,
  getDomainBlockReason,
  getLaunchBlockReason,
  getInstallBlockReason,
} from './capabilities';

export function readonlySnapshot<T>(value: T): DeepReadonly<T> {
  const clone = structuredClone(value);
  const freeze = (item: unknown) => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(clone);
  return clone as DeepReadonly<T>;
}
// Explicit runtime schemas drop unexpected backend fields, including credentials.
type Schema = readonly string[] | { [key: string]: Schema | null };
function project<T>(value: T, schema: Schema): T {
  if (value == null) return value;
  if (Array.isArray(value)) return (value as unknown[]).map((item) => project(item, schema)) as T;
  const object = value as Record<string, unknown>;
  const keys: readonly string[] = Array.isArray(schema)
    ? (schema as readonly string[])
    : Object.keys(schema);
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(object, key))
      .map((key) => {
        const child = Array.isArray(schema) ? null : (schema as Record<string, Schema | null>)[key];
        return [key, child ? project(object[key], child) : object[key]];
      }),
  ) as T;
}
const appearance = [
  'interface_style',
  'theme',
  'accent_color',
  'ui_scale',
  'border_radius',
  'compact_sidebar',
  'reduce_motion',
  'background_art',
  'background_blur',
  'background_dim',
  'sidebar_opacity',
];
const personalization = [
  'background_file',
  'background_fit',
  'font',
  'startup_page',
  'notifications',
  'retain_logs',
  'shortcuts',
  'launch_shortcut',
];
const profile = {
  instance_key: null,
  name: null,
  game_version: null,
  loader: null,
  loader_version: null,
  game_directory: null,
  overrides: [
    'argument_template',
    'environment',
    'java_executable',
    'memory_mb',
    'minimum_memory_mb',
    'resolution_width',
    'resolution_height',
    'extra_jvm_arguments',
    'extra_game_arguments',
  ],
};
const settings = {
  game_directory: null,
  java_executable: null,
  memory_mb: null,
  minimum_memory_mb: null,
  offline_username: null,
  show_snapshots: null,
  resolution_width: null,
  resolution_height: null,
  extra_jvm_arguments: null,
  extra_game_arguments: null,
  appearance,
  language: null,
  network: [
    'timeout_seconds',
    'max_concurrent_downloads',
    'max_retries',
    'proxy_url',
    'mirror_url',
  ],
  close_behavior: null,
  personalization,
  argument_templates: { id: null, name: null, jvm: null, game: null, environment: null },
};
const configSchema = {
  schema_version: null,
  settings,
  profiles: profile,
  active_profile: null,
  appearance_presets: { id: null, name: null, appearance },
};
const installedSchema = ['instance_key', 'game_version', 'loader', 'loader_version', 'root'];
const taskSchema = {
  id: null,
  kind: null,
  name: null,
  profile_key: null,
  java_major: null,
  status: null,
  message: null,
  progress: [
    'total_files',
    'completed_files',
    'downloaded_files',
    'reused_files',
    'failed_files',
    'transferred_bytes',
    'completed_bytes',
    'active_bytes',
    'total_bytes',
    'bytes_per_second',
    'current_file',
  ],
};

export function createLauncherSnapshot(
  services: LauncherServices,
  shell: Pick<
    LauncherSnapshot,
    | 'settings'
    | 'navigation'
    | 'appearance'
    | 'window'
    | 'notifications'
    | 'launch'
    | 'profileDraft'
    | 'instanceDraft'
    | 'importDraft'
    | 'removal'
    | 'content'
    | 'avatars'
    | 'drafts'
  > & {
    loaderCatalog: LauncherSnapshot['catalog']['loaders'];
    accountUi: AccountUiSnapshot;
    javaUi: JavaUiSnapshot;
  },
): DeepReadonly<LauncherSnapshot> {
  const { launcher, accounts, java, downloads } = services;
  const config = project(launcher.bootstrap?.config ?? null, configSchema);
  const tasks = project(downloads.tasks, taskSchema);
  const installed = project(launcher.installed, installedSchema);
  const items = (config?.profiles ?? []).map((item) => {
    const actualInstance = installedProfile(item, config!.settings, installed) ?? null;
    const isInstalled = profileIsInstalled(item, config!.settings, installed);
    const activeTask =
      tasks.find(
        (task) =>
          task.profile_key === item.instance_key &&
          ['queued', 'running', 'cancelling'].includes(task.status),
      ) ?? null;
    const installing =
      activeTask !== null || downloads.pending.includes(`install:${item.instance_key}`);
    const domain = getDomainBlockReason(services);
    const modal = services.getInteractionState().modalOpen ? 'launcher.modalOpen' : null;
    return {
      profile: item,
      installed: isInstalled,
      actualInstance,
      installing,
      activeTask,
      capabilities: {
        launch: capability(
          getLaunchBlockReason(services) ?? (!isInstalled ? 'profile.notInstalled' : null),
        ),
        install: capability(getInstallBlockReason(services, item.instance_key)),
        edit: capability(domain ?? modal),
        remove: capability(domain ?? modal),
      },
    };
  });
  return readonlySnapshot({
    config: {
      ready: config !== null && launcher.draft !== null,
      fatal: launcher.fatal || null,
      value: config,
      path: launcher.bootstrap?.config_path ?? null,
    },
    settings: { ...shell.settings, draft: project(shell.settings.draft, settings) },
    drafts: {
      presetPending: shell.drafts.presetPending,
      preset: project(shell.drafts.preset, {
        request: ['kind', 'id'],
        name: null,
        json: null,
        pending: null,
        error: null,
      }),
      argumentTemplate: project(shell.drafts.argumentTemplate, {
        id: null,
        name: null,
        jvm: null,
        game: null,
        environment: ['key', 'value'],
      }),
      environment: project(shell.drafts.environment, ['key', 'value']),
      argumentTemplateError: shell.drafts.argumentTemplateError,
    },
    profiles: { items, installed, activeKey: config?.active_profile ?? null },
    activity: project(launcher.busy, ['action', 'status', 'message']),
    launch: shell.launch,
    profileDraft: {
      ...shell.profileDraft,
      editor: project(shell.profileDraft.editor, {
        name: null,
        version: null,
        loader: null,
        loader_version: null,
        editKey: null,
        game_directory: null,
        overrides: profile.overrides,
      }),
    },
    instanceDraft: {
      ...shell.instanceDraft,
      profile: project(shell.instanceDraft.profile, profile),
      environment: project(shell.instanceDraft.environment, ['key', 'value']),
    },
    importDraft: {
      ...shell.importDraft,
      instances: project(shell.importDraft.instances, installedSchema),
    },
    removal: shell.removal,
    content: {
      ...project(shell.content, [
        'selectedProfileKey',
        'category',
        'query',
        'kind',
        'pending',
        'searching',
        'removing',
        'includeSaves',
      ]),
      request: project(shell.content.request, ['query', 'kind', 'offset']),
      results: project(shell.content.results, {
        hits: ['project_id', 'title', 'description', 'project_type', 'downloads'],
        total_hits: null,
        offset: null,
      }),
      list: project(shell.content.list, {
        profileKey: null,
        directory: null,
        category: null,
        entries: {
          name: null,
          category: null,
          size: null,
          enabled: null,
          record: ['project_id', 'version_id', 'title'],
        },
      }),
    },
    avatars: Object.fromEntries(
      Object.entries(shell.avatars).map(([id, value]) => [
        id,
        typeof value === 'string' && value.startsWith('data:') ? value : null,
      ]),
    ),
    catalog: {
      loaders: shell.loaderCatalog,
      versions: project(launcher.versions, ['id', 'kind']),
      snapshot: project(launcher.catalogSnapshot, {
        versions: ['id', 'kind'],
        fetched_at: null,
        source: null,
        stale: null,
        warning: null,
        error_kind: null,
      }),
      busy: launcher.catalogBusy,
      error: launcher.catalogError || null,
    },
    accounts: {
      ...project(shell.accountUi, [
        'clientIdDraft',
        'removingId',
        'promptActionPending',
        'promptExpired',
      ]),
      state: project(accounts.state, {
        client_id: null,
        active: null,
        accounts: ['id', 'name', 'skin_url'],
      }),
      recovery: [...accounts.recovery],
      prompt: project(accounts.prompt, ['id', 'user_code', 'verification_uri', 'expires_at']),
      pending: accounts.pending,
      loginPending: accounts.loginPending,
      cancelling: accounts.cancelling,
      loading: accounts.loading,
      ready: accounts.ready,
      loadError: accounts.loadError === null ? null : { message: errorMessage(accounts.loadError) },
    },
    downloads: { tasks, pending: [...downloads.pending], active: downloads.active },
    java: {
      downloadMajorDraft: shell.javaUi.downloadMajorDraft,
      discovery: project(java.discovery, {
        installations: [
          'executable',
          'java_home',
          'major_version',
          'version',
          'vendor',
          'architecture',
          'source',
        ],
        warnings: ['path', 'message'],
        download_supported: null,
      }),
      busy: java.busy,
    },
    navigation: shell.navigation,
    appearance: {
      ...shell.appearance,
      value: project(shell.appearance.value, appearance),
      personalization: project(shell.appearance.personalization, personalization),
    },
    window: {
      ...shell.window,
      request: project(shell.window.request, ['game_running', 'downloads_active']),
    },
    logs: {
      lines: project(launcher.logs, {
        id: ['session', 'sequence'],
        level: null,
        message: null,
        time: null,
      }),
    },
    notifications: {
      items: project(shell.notifications.items, ['id', 'kind', 'message', 'remainingMs']),
    },
  });
}
