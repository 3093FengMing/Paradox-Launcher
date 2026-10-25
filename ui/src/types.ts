export interface Appearance {
  interface_style: 'immersive' | 'modern';
  theme: 'dark' | 'light' | 'system';
  accent_color: string;
  ui_scale: number;
  border_radius: number;
  compact_sidebar: boolean;
  reduce_motion: boolean;
  background_art: boolean;
  background_blur: number;
  background_dim: number;
  sidebar_opacity: number;
}
export interface AppearancePreset {
  id: string;
  name: string;
  appearance: Appearance;
}
export type LanguagePreference = 'zh-CN' | 'en-US' | 'system';
export interface Settings {
  game_directory: string;
  java_executable: string;
  memory_mb: number;
  minimum_memory_mb: number;
  offline_username: string;
  show_snapshots: boolean;
  resolution_width: number;
  resolution_height: number;
  extra_jvm_arguments: string;
  extra_game_arguments: string;
  appearance: Appearance;
  language: LanguagePreference;
  network: NetworkOptions;
  close_behavior: 'ask' | 'stop' | 'background';
}
export interface GameProfile {
  instance_key: string;
  name: string;
  game_version: string;
  game_directory: string | null;
  overrides: ProfileOverrides;
}

export interface ProfileOverrides {
  java_executable?: string | null;
  memory_mb?: number | null;
  minimum_memory_mb?: number | null;
  resolution_width?: number | null;
  resolution_height?: number | null;
  extra_jvm_arguments?: string | null;
  extra_game_arguments?: string | null;
}

export interface NetworkOptions {
  timeout_seconds: number;
  max_concurrent_downloads: number;
  max_retries: number;
  proxy_url: string;
  mirror_url: string;
}

export interface CatalogSnapshot {
  versions: GameVersion[];
  fetched_at: number;
  source: 'network' | 'cache';
  stale: boolean;
  warning: string | null;
  error_kind: string | null;
}

export interface JavaInstallation {
  executable: string;
  java_home: string;
  major_version: number;
  version: string;
  vendor: string;
  architecture: string;
  source: string;
}

export interface JavaDiscovery {
  installations: JavaInstallation[];
  warnings: { path: string; message: string }[];
  download_supported: boolean;
}

export interface DownloadProgress {
  total_files: number;
  completed_files: number;
  downloaded_files: number;
  reused_files: number;
  failed_files: number;
  transferred_bytes: number;
  completed_bytes: number;
  active_bytes: number;
  total_bytes: number | null;
  bytes_per_second: number;
  current_file: string | null;
}

export interface DownloadTask {
  id: string;
  kind: 'install' | 'java';
  name: string;
  profile_key: string | null;
  java_major: number | null;
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  message: string;
  progress: DownloadProgress | null;
}

export interface CloseRequest {
  game_running: boolean;
  downloads_active: boolean;
}
export interface AppConfig {
  schema_version: number;
  settings: Settings;
  profiles: GameProfile[];
  active_profile: string | null;
  appearance_presets: AppearancePreset[];
}
export interface Bootstrap {
  config: AppConfig;
  config_path: string;
}
export interface GameVersion {
  id: string;
  kind: string;
}
export interface InstalledInstance {
  instance_key: string;
  game_version: string | null;
  loader: string;
  root: string;
}
export interface Activity {
  action: 'install' | 'launch';
  status: 'started' | 'running' | 'finished' | 'error';
  message: string;
}
export interface LogLine {
  level: string;
  message: string;
  time: string;
}
export type Page = 'home' | 'instances' | 'downloads' | 'accounts' | 'settings' | 'logs';
