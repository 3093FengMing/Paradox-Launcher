import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';
import { appearancesEqual, MAX_APPEARANCE_PRESETS } from './appearance-presets';
type Snapshot = DeepReadonly<LauncherSnapshot>;
function downloadsBusy(snapshot: Snapshot): boolean {
    return snapshot.downloads.active || snapshot.downloads.pending.length > 0;
}
function settingsBusinessBlocked(snapshot: Snapshot): boolean {
    return !!snapshot.activity || snapshot.settings.saving || downloadsBusy(snapshot);
}
export function settingsPageState(snapshot: Snapshot) {
    const { saving, choosingBackground, choosingGameDirectory, dirty } = snapshot.settings;
    const downloads = downloadsBusy(snapshot);
    const reason = saving
        ? 'saving'
        : choosingGameDirectory
            ? 'directory'
            : choosingBackground
                ? 'background'
                : snapshot.activity
                    ? 'activity'
                    : downloads
                        ? 'downloads'
                        : !dirty
                            ? 'unchanged'
                            : null;
    return {
        busy: !!snapshot.activity || downloads,
        locked: saving || choosingBackground || choosingGameDirectory,
        reason,
    };
}
export function javaSettingsState(snapshot: Snapshot) {
    const major = Number(snapshot.java.downloadMajorDraft);
    const gameRunning = !!snapshot.activity;
    return {
        gameRunning,
        validMajor: Number.isInteger(major) && major >= 8 && major <= 99,
        canDownload: snapshot.window.desktop &&
            !gameRunning &&
            snapshot.java.discovery?.download_supported !== false,
    };
}
export function javaArchitectureLabel(value: string): string {
    const architecture = value.toLowerCase();
    if (['amd64', 'x86_64', 'x64'].includes(architecture))
        return 'java.architecture64';
    if (['aarch64', 'arm64'].includes(architecture))
        return 'ARM64';
    if (['x86', 'i386', 'i486', 'i586', 'i686'].includes(architecture))
        return 'java.architecture32';
    return value;
}
export function argumentTemplateState(snapshot: Snapshot) {
    return {
        templates: snapshot.settings.draft?.argument_templates ?? [],
        usedIds: snapshot.config.value?.profiles.flatMap((profile) => profile.overrides.argument_template ? [profile.overrides.argument_template] : []) ?? [],
        disabled: settingsBusinessBlocked(snapshot),
    };
}
export function appearancePresetState(snapshot: Snapshot) {
    const presets = snapshot.config.value?.appearance_presets ?? [];
    const appearance = snapshot.settings.draft?.appearance;
    const pending = snapshot.drafts.presetPending || !!snapshot.drafts.preset?.pending;
    return {
        presets,
        blocked: settingsBusinessBlocked(snapshot) || pending,
        capacity: presets.length >= MAX_APPEARANCE_PRESETS,
        maximum: MAX_APPEARANCE_PRESETS,
        currentIds: presets
            .filter((preset) => appearance && appearancesEqual(appearance, preset.appearance))
            .map((preset) => preset.id),
    };
}
export function personalizationSettingsState(snapshot: Snapshot) {
    return { disabled: settingsBusinessBlocked(snapshot) || snapshot.settings.choosingBackground };
}
