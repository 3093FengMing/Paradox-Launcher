import { isShortcutInput, matchesLaunchShortcut } from '../lib/shortcuts';
import type { LauncherServices } from './services';
export function acceptsLaunchShortcut(
  event: KeyboardEvent,
  owner: LauncherServices['launcher'],
  queue: LauncherServices['downloads'],
  close: { request: unknown },
  gates: ReturnType<LauncherServices['getInteractionState']>,
  pendingPicks: number,
  desktop: boolean,
): string | null {
  const launcherState = owner.getGuardState();
  const downloadState = queue.getGuardState();
  const config = launcherState.config;
  if (
    !config?.settings.personalization.shortcuts ||
    !desktop ||
    !config.active_profile ||
    launcherState.busy ||
    launcherState.saving ||
    downloadState.active ||
    downloadState.pending.length > 0 ||
    pendingPicks ||
    gates.editorOpen ||
    gates.picking ||
    gates.modalOpen ||
    close.request ||
    isShortcutInput(event.target) ||
    event.defaultPrevented
  )
    return null;
  if (!matchesLaunchShortcut(event, config.settings.personalization.launch_shortcut)) return null;
  return config.active_profile;
}
