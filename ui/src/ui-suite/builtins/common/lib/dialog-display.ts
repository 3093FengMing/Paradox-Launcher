import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';
import { appearancePresetState, argumentTemplateState } from './settings-display';

type Snapshot = DeepReadonly<LauncherSnapshot>;
export const instanceNumericFields = [
  { key: 'minimum_memory_mb', label: 'settings.minimumMemory', min: 256, max: 32768 },
  { key: 'memory_mb', label: 'settings.maximumMemory', min: 512, max: 32768 },
  { key: 'resolution_width', label: 'settings.windowWidth', min: 640, max: 7680 },
  { key: 'resolution_height', label: 'settings.windowHeight', min: 480, max: 4320 },
] as const;

/** Display facts only. The permanent public owner retains validation and reservations. */
export function instanceDialogState(snapshot: Snapshot) {
  const draft = snapshot.instanceDraft.profile;
  const settings = snapshot.config.value?.settings;
  if (!draft || !settings) return null;
  const template = settings.argument_templates.find(item => item.id === draft.overrides.argument_template);
  const saving = snapshot.settings.saving || snapshot.instanceDraft.pending;
  return { draft, settings, template, saving, locked: saving || snapshot.instanceDraft.picking };
}
export function importDialogState(snapshot: Snapshot) {
  const saving = snapshot.settings.saving || snapshot.importDraft.pending;
  return { saving, locked: saving || snapshot.importDraft.scanning || snapshot.importDraft.picking };
}
export function importInstanceEligible(instance: { loader: string; game_version: string | null }) {
  return instance.loader === 'vanilla' && !!instance.game_version;
}
export function presetDialogState(snapshot: Snapshot) {
  const draft = snapshot.drafts.preset;
  const request = draft?.request;
  const pending = snapshot.drafts.presetPending || !!draft?.pending;
  const selected = request && 'id' in request
    ? snapshot.config.value?.appearance_presets.find(item => item.id === request.id)
    : null;
  const blocked = appearancePresetState(snapshot).blocked;
  const actionBlocked = blocked || ((request?.kind === 'save' || request?.kind === 'rename') && !draft?.name.trim())
    || (request?.kind === 'import' && !draft?.json.trim());
  return { draft, request, selected, pending, blocked, actionBlocked,
    requestKey: request ? `${request.kind}:${'id' in request ? request.id : ''}` : null };
}
export function argumentTemplateDialogState(snapshot: Snapshot) {
  return { editor: snapshot.drafts.argumentTemplate, error: snapshot.drafts.argumentTemplateError,
    disabled: argumentTemplateState(snapshot).disabled };
}
