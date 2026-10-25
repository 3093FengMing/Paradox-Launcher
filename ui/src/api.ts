import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Activity, AppConfig, Bootstrap, GameVersion, InstalledInstance } from './types';

export const desktop = isTauri();
const previewKey = 'paradox-launcher-preview-v1';
const previewDefaults: AppConfig = {
  schema_version: 1,
  settings: {
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
  active_profile: null,
};

function loadPreview(): AppConfig {
  const stored = localStorage.getItem(previewKey);
  if (!stored) return structuredClone(previewDefaults);
  try {
    const config = JSON.parse(stored) as AppConfig;
    return {
      ...config,
      settings: {
        ...previewDefaults.settings,
        ...config.settings,
        appearance: { ...previewDefaults.settings.appearance, ...config.settings.appearance },
      },
    };
  } catch {
    return structuredClone(previewDefaults);
  }
}

export async function getConfig(): Promise<Bootstrap> {
  return desktop
    ? invoke('get_config')
    : { config: loadPreview(), config_path: '网页预览：浏览器本地存储' };
}
export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  if (desktop) return invoke('save_config', { config });
  localStorage.setItem(previewKey, JSON.stringify(config));
  return config;
}
export async function createProfile(name: string, version: string): Promise<AppConfig> {
  if (desktop) return invoke('create_profile', { name, version });
  if (!name.trim() || Array.from(name.trim()).length > 64)
    throw new Error('实例名称应为 1–64 个字符');
  const gameVersion = version.trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(gameVersion) || ['.', '..'].includes(gameVersion))
    throw new Error('版本号无效');
  const config = loadPreview();
  const profile = {
    instance_key: crypto.randomUUID(),
    name: name.trim(),
    game_version: gameVersion,
  };
  config.profiles.push(profile);
  config.active_profile = profile.instance_key;
  return saveConfig(config);
}
export async function catalog(): Promise<GameVersion[]> {
  if (desktop) return invoke('catalog');
  const response = await fetch(
    import.meta.env.DEV
      ? '/mojang/mc/game/version_manifest_v2.json'
      : 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`版本目录请求失败 (${response.status})`);
  const manifest: unknown = await response.json();
  if (!isRecord(manifest) || !Array.isArray(manifest.versions)) {
    throw new Error('版本目录格式无效，请稍后重试');
  }
  return manifest.versions.map((version: unknown) => {
    if (!isRecord(version) || typeof version.id !== 'string' || typeof version.type !== 'string') {
      throw new Error('版本目录包含无效条目，请稍后重试');
    }
    return { id: version.id, kind: version.type };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function inspectInstances(): Promise<InstalledInstance[]> {
  return desktop ? invoke('inspect_instances') : [];
}
export async function prepareInstance(key: string): Promise<string> {
  if (!desktop) throw new Error('请通过 npm run dev 打开桌面应用以安装 Minecraft');
  return invoke('prepare_instance', { key });
}
export async function launchInstance(key: string): Promise<void> {
  if (!desktop) throw new Error('启动游戏需要打开 Tauri 桌面应用');
  return invoke('launch_instance', { key });
}
export async function stopGame(): Promise<void> {
  return invoke('stop_game');
}
export async function subscribe(
  onActivity: (event: Activity) => void,
  onLog: (event: { level: string; message: string }) => void,
): Promise<() => void> {
  if (!desktop) return () => {};
  const activity = await listen<Activity>('launcher://activity', (event) =>
    onActivity(event.payload),
  );
  try {
    const log = await listen<{ level: string; message: string }>('launcher://log', (event) =>
      onLog(event.payload),
    );
    return () => {
      activity();
      log();
    };
  } catch (error) {
    activity();
    throw error;
  }
}
