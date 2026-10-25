import type { GameProfile, ProfileOverrides, Settings } from '../types';
import i18n from '../i18n';

export type SettingsTab = 'appearance' | 'game' | 'advanced';
export type PatchSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export interface ProfileEditor {
  name: string;
  version: string;
  editKey?: string;
  game_directory?: string | null;
  overrides?: ProfileOverrides;
}

const absolutePath = /^([A-Za-z]:[\\/]|\/|\\\\)/;

export function validateUsername(username: string): void {
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) throw new Error(i18n.t('errors.username'));
}

export function validateProfileName(name: string): void {
  if (!name.trim() || Array.from(name.trim()).length > 64)
    throw new Error(i18n.t('errors.profileName'));
}

export function validateSettings(settings: Settings): void {
  validateUsername(settings.offline_username);
  if (!['zh-CN', 'en-US', 'system'].includes(settings.language))
    throw new Error(i18n.t('errors.language'));
  const numbers = [
    settings.memory_mb,
    settings.minimum_memory_mb,
    settings.resolution_width,
    settings.resolution_height,
  ];
  if (numbers.some((value) => !Number.isInteger(value)))
    throw new Error(i18n.t('errors.numericSettings'));
  if (
    settings.memory_mb < 512 ||
    settings.memory_mb > 32768 ||
    settings.minimum_memory_mb < 256 ||
    settings.minimum_memory_mb > settings.memory_mb
  )
    throw new Error(i18n.t('errors.memoryRange'));
  if (!absolutePath.test(settings.game_directory)) throw new Error(i18n.t('errors.gameDirectory'));
  if (settings.java_executable.trim() && !absolutePath.test(settings.java_executable.trim()))
    throw new Error(i18n.t('errors.javaPath'));
  if (
    settings.resolution_width < 640 ||
    settings.resolution_width > 7680 ||
    settings.resolution_height < 480 ||
    settings.resolution_height > 4320
  )
    throw new Error(i18n.t('errors.resolutionRange'));
  const network = settings.network;
  if (
    !Number.isInteger(network.timeout_seconds) ||
    network.timeout_seconds < 1 ||
    network.timeout_seconds > 300 ||
    !Number.isInteger(network.max_concurrent_downloads) ||
    network.max_concurrent_downloads < 1 ||
    network.max_concurrent_downloads > 32 ||
    !Number.isInteger(network.max_retries) ||
    network.max_retries < 0 ||
    network.max_retries > 8
  )
    throw new Error(i18n.t('errors.networkRange'));
  for (const [label, value] of [
    ['proxy', network.proxy_url],
    ['mirror', network.mirror_url],
  ] as const) {
    if (!value.trim()) continue;
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error(i18n.t(`errors.${label}Format`));
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.search || url.hash)
      throw new Error(i18n.t(`errors.${label}Url`));
    if (label === 'mirror' && (url.username || url.password))
      throw new Error(i18n.t('errors.mirrorCredentials'));
  }
}

export function validateProfileSettings(profile: GameProfile, settings: Settings): void {
  validateProfileName(profile.name);
  const values = Object.fromEntries(
    Object.entries(profile.overrides).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<Settings>;
  validateSettings({
    ...settings,
    ...values,
    game_directory: profile.game_directory ?? settings.game_directory,
  });
}
