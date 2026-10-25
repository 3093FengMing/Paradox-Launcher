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
}
export interface GameProfile {
  instance_key: string;
  name: string;
  game_version: string;
}
export interface AppConfig {
  schema_version: number;
  settings: Settings;
  profiles: GameProfile[];
  active_profile: string | null;
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
