import type { LauncherServices } from '../services';
import { getInstallBlockReason } from '../capabilities';

// One guarded entry for public installation, explicit repair and uninstalled launch requests.
// The existing queue still reserves and owns the actual command.
export function installProfile(services: LauncherServices, key: string): Promise<boolean> {
  if (getInstallBlockReason(services, key) !== null) return Promise.resolve(false);
  return services.downloads.install(key);
}
