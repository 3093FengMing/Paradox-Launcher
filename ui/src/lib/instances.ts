import type { GameProfile, InstalledInstance, Settings } from '../types';

function normalizedPath(path: string): string {
  const slashes = path
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .replaceAll('\\', '/')
    .replace(/\/+$/, '');
  const normalized = `${slashes.startsWith('//') ? '/' : ''}${slashes.replace(/\/{2,}/g, '/')}`;
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}
export function installedProfile(
  profile: GameProfile,
  settings: Settings,
  installed: InstalledInstance[],
): InstalledInstance | undefined {
  const expected = normalizedPath(
    `${profile.game_directory ?? settings.game_directory}/versions/${profile.instance_key}`,
  );
  return installed.find(
    (instance) =>
      instance.instance_key === profile.instance_key && normalizedPath(instance.root) === expected,
  );
}

export function profileIsInstalled(
  profile: GameProfile,
  settings: Settings,
  installed: InstalledInstance[],
): boolean {
  const instance = installedProfile(profile, settings, installed);
  return (
    !!instance &&
    instance.loader === (profile.loader ?? 'vanilla') &&
    instance.game_version === profile.game_version &&
    (instance.loader === 'vanilla' || instance.loader_version === profile.loader_version)
  );
}
