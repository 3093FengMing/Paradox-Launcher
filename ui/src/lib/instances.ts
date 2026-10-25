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
export function profileIsInstalled(
  profile: GameProfile,
  settings: Settings,
  installed: InstalledInstance[],
): boolean {
  const expected = normalizedPath(
    `${profile.game_directory ?? settings.game_directory}/versions/${profile.instance_key}`,
  );
  return installed.some(
    (instance) =>
      instance.instance_key === profile.instance_key &&
      instance.loader === 'vanilla' &&
      instance.game_version === profile.game_version &&
      normalizedPath(instance.root) === expected,
  );
}
