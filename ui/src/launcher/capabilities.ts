import type { Capability, DeepReadonly, LauncherSnapshot, ProfileSnapshot } from './public/types';
import type { LauncherServices } from './services';

// Private guard projection: public capabilities and controller actions read the
// same existing owners, including reservations made before React renders.
export function getDomainBlockReason(
  services: LauncherServices,
  includeDownloads = true,
): string | null {
  const launcher = services.launcher.getGuardState(),
    downloads = services.downloads.getGuardState();
  return !launcher.config || !services.launcher.draft
    ? 'config.notReady'
    : launcher.busy !== null || launcher.saving
      ? 'launcher.busy'
      : includeDownloads && (downloads.active || downloads.pending.length > 0)
        ? 'downloads.active'
        : services.getInteractionState().closeRequested
          ? 'window.closeRequested'
          : null;
}
export function getLaunchBlockReason(
  services: LauncherServices,
  includeModal = true,
): string | null {
  const interaction = services.getInteractionState(),
    accounts = services.accounts.getLaunchState();
  return !services.api.desktop
    ? 'desktop.required'
    : (getDomainBlockReason(services) ??
        (interaction.editorOpen
          ? 'customization.editing'
          : interaction.picking
            ? 'launcher.picking'
            : includeModal && interaction.modalOpen
              ? 'launcher.modalOpen'
              : !accounts.ready
                ? 'accounts.loading'
                : accounts.pending
                  ? 'accounts.busy'
                  : null));
}
export function getInstallBlockReason(services: LauncherServices, key: string): string | null {
  if (!services.api.desktop) return 'desktop.required';
  const common = getDomainBlockReason(services, false);
  if (common) return common;
  if (
    !services.launcher
      .getGuardState()
      .config?.profiles.some((profile) => profile.instance_key === key)
  )
    return 'profile.missing';
  const downloads = services.downloads.getGuardState();
  return downloads.pending.includes(`install:${key}`) ||
    downloads.tasks.some(
      (task) =>
        task.profile_key === key && ['queued', 'running', 'cancelling'].includes(task.status),
    )
    ? 'downloads.pending'
    : null;
}

export function capability(reason: string | null): Capability {
  return { allowed: reason === null, reason };
}
const unavailable = Object.freeze({ allowed: false, reason: 'profile.missing' });
const missing = Object.freeze({
  launch: unavailable,
  install: unavailable,
  edit: unavailable,
  remove: unavailable,
});
export function getProfileCapabilities(
  snapshot: DeepReadonly<LauncherSnapshot>,
  key: string,
): DeepReadonly<ProfileSnapshot['capabilities']> {
  return (
    snapshot.profiles.items.find((item) => item.profile.instance_key === key)?.capabilities ??
    missing
  );
}
