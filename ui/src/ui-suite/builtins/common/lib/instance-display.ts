import type { DeepReadonly, LauncherSnapshot, Settings } from '@paradox/launcher';

type Snapshot = DeepReadonly<LauncherSnapshot>;
type Profile = Snapshot['profiles']['items'][number];
type DisplayValue = {
  value: string;
  valueKey: 'instancePages.explicitEmpty' | 'instancePages.invalidEffective' | null;
};
export type InstanceDisplaySource = {
  sourceKey: 'instancePages.override' | 'instancePages.global' | 'instancePages.templateSource';
  templateName?: string;
};

function text(value: string | number): DisplayValue {
  return { value: String(value), valueKey: null };
}

function explicitText(value: string | number): DisplayValue {
  return value === '' ? { value: '', valueKey: 'instancePages.explicitEmpty' } : text(value);
}

function source(value: unknown): InstanceDisplaySource {
  return { sourceKey: value !== null && value !== undefined ? 'instancePages.override' : 'instancePages.global' };
}

/** Read committed values and exact-key status; suite components own translation, markup and actions. */
export function getInstanceDisplay(snapshot: Snapshot, entry: Profile, settings: DeepReadonly<Settings>, key: string) {
  const { profile, installed, actualInstance: actual, capabilities } = entry;
  const overrides = profile.overrides;
  const base = profile.game_directory ?? settings.game_directory;
  const root = actual?.root ?? base.replace(/[\\/]+$/, '') + '/versions/' + key;
  const template = settings.argument_templates.find(item => item.id === overrides.argument_template);
  const invalidTemplate = overrides.argument_template !== null && overrides.argument_template !== undefined && !template;
  const argumentSource = (value: unknown): InstanceDisplaySource => value !== null && value !== undefined
    ? { sourceKey: 'instancePages.override' }
    : template ? { sourceKey: 'instancePages.templateSource', templateName: template.name } : { sourceKey: 'instancePages.global' };
  const invalidValue: DisplayValue = { value: '', valueKey: 'instancePages.invalidEffective' };
  const rows = [
    { id: 'java', labelKey: 'settings.javaExecutable', ...explicitText(overrides.java_executable ?? settings.java_executable), source: source(overrides.java_executable) },
    { id: 'minimum-memory', labelKey: 'settings.minimumMemory', ...text((overrides.minimum_memory_mb ?? settings.minimum_memory_mb) + ' MB'), source: source(overrides.minimum_memory_mb) },
    { id: 'maximum-memory', labelKey: 'settings.maximumMemory', ...text((overrides.memory_mb ?? settings.memory_mb) + ' MB'), source: source(overrides.memory_mb) },
    { id: 'width', labelKey: 'settings.windowWidth', ...text(overrides.resolution_width ?? settings.resolution_width), source: source(overrides.resolution_width) },
    { id: 'height', labelKey: 'settings.windowHeight', ...text(overrides.resolution_height ?? settings.resolution_height), source: source(overrides.resolution_height) },
    { id: 'jvm', labelKey: 'instanceDialog.jvmArguments', ...(invalidTemplate ? invalidValue : explicitText(overrides.extra_jvm_arguments ?? template?.jvm ?? settings.extra_jvm_arguments)), source: argumentSource(overrides.extra_jvm_arguments) },
    { id: 'game', labelKey: 'instanceDialog.gameArguments', ...(invalidTemplate ? invalidValue : explicitText(overrides.extra_game_arguments ?? template?.game ?? settings.extra_game_arguments)), source: argumentSource(overrides.extra_game_arguments) },
  ];
  const environment = Object.entries({ ...(template?.environment ?? {}), ...overrides.environment }).map(([name, value]): { name: string; value: string; source: InstanceDisplaySource } => ({
    name,
    value,
    source: Object.prototype.hasOwnProperty.call(overrides.environment ?? {}, name)
      ? { sourceKey: 'instancePages.override' }
      : { sourceKey: 'instancePages.templateSource', templateName: template?.name },
  }));
  const ownLaunch = snapshot.launch.profileKey === key && snapshot.launch.phase !== 'idle';
  const status = ownLaunch ? snapshot.launch.phase === 'running' ? 'instancePages.running' : snapshot.launch.phase === 'cancelling' ? 'common.stopping' : 'instancePages.launching' : snapshot.launch.selection?.profileKey === key ? 'instancePages.selectAccount' : entry.installing ? 'instancePages.taskActive' : installed ? 'common.installed' : actual ? 'instancePages.filterStatus.repair' : 'common.notInstalled';
  const capability = installed ? capabilities.launch : capabilities.install;
  const current = key === snapshot.profiles.activeKey;
  const tasks = snapshot.downloads.tasks.filter(task => task.profile_key === key);
  const exportDisabled = !snapshot.window.desktop || snapshot.content.pending || snapshot.content.selectedProfileKey !== key || !!snapshot.activity || snapshot.settings.saving || snapshot.downloads.active || snapshot.downloads.pending.length > 0;
  return { base, root, baseSource: source(profile.game_directory), invalidTemplate, rows, environment, ownLaunch, status, capability, current, tasks, exportDisabled };
}
