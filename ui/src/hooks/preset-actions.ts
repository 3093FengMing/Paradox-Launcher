import i18n from '../i18n';
import * as api from '../api';
import {
  createAppearancePreset,
  importAppearancePreset as parseAppearancePreset,
  MAX_APPEARANCE_PRESETS,
  validatePresetName,
} from '../lib/appearance-presets';
import type { AppConfig, AppearancePreset, Bootstrap, Settings } from '../types';
interface Cell<T> {
  current: T;
}
interface PresetDependencies {
  lifecycle: Cell<number>;
  configRef: Cell<AppConfig | null>;
  draftRef: Cell<Settings | null>;
  enqueueConfig: (
    operation: (current: AppConfig) => Promise<AppConfig | Bootstrap>,
  ) => Promise<AppConfig>;
  patchSettings: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  notify: (message: string, error?: boolean) => void;
  reportError: (error: unknown) => void;
}
/** Preset edits share the permanent owner's serialized config queue. */
export function createPresetActions({
  lifecycle,
  configRef,
  draftRef,
  enqueueConfig,
  patchSettings,
  notify,
  reportError,
}: PresetDependencies) {
  const writePresets = async (
    update: (presets: AppearancePreset[]) => AppearancePreset[],
    messageKey: string,
  ): Promise<void> => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig((current) => {
        const presets = update(current.appearance_presets);
        if (presets.length > MAX_APPEARANCE_PRESETS)
          throw new Error(i18n.t('presets.errors.limit'));
        return api.saveConfig({ ...current, appearance_presets: presets });
      });
      if (generation === lifecycle.current) notify(i18n.t(messageKey));
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      throw error;
    }
  };

  const saveAppearancePreset = async (name: string): Promise<void> => {
    if (!draftRef.current) throw new Error(i18n.t('messages.configNotReady'));
    const preset = createAppearancePreset(name, draftRef.current.appearance);
    await writePresets((presets) => [...presets, preset], 'presets.saved');
  };

  const applyAppearancePreset = (id: string): void => {
    const preset = configRef.current?.appearance_presets.find((item) => item.id === id);
    if (!preset) {
      reportError(i18n.t('presets.errors.missing'));
      return;
    }
    patchSettings('appearance', structuredClone(preset.appearance));
    notify(i18n.t('presets.applied'));
  };

  const renameAppearancePreset = async (id: string, name: string): Promise<void> => {
    const trimmed = validatePresetName(name);
    await writePresets((presets) => {
      if (!presets.some((preset) => preset.id === id))
        throw new Error(i18n.t('presets.errors.missing'));
      return presets.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset));
    }, 'presets.renamed');
  };

  const removeAppearancePreset = async (id: string): Promise<void> => {
    await writePresets((presets) => {
      if (!presets.some((preset) => preset.id === id))
        throw new Error(i18n.t('presets.errors.missing'));
      return presets.filter((preset) => preset.id !== id);
    }, 'presets.removed');
  };

  const importAppearancePreset = async (json: string): Promise<void> => {
    const imported = parseAppearancePreset(json);
    const preset = createAppearancePreset(imported.name, imported.appearance);
    await writePresets((presets) => [...presets, preset], 'presets.imported');
  };

  return {
    saveAppearancePreset,
    applyAppearancePreset,
    renameAppearancePreset,
    removeAppearancePreset,
    importAppearancePreset,
  };
}
