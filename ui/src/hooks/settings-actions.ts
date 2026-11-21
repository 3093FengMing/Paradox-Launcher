import * as api from '../api';
import i18n from '../i18n';
import { validateSettings, validateUsername } from '../lib/forms';
import type { SetStateAction } from 'react';
import type { AppConfig, Bootstrap, Settings } from '../types';
interface Cell<T> {
  current: T;
}
interface SettingsActionHost {
  draftRef: Cell<Settings | null>;
  lifecycle: Cell<number>;
  enqueueConfig: (
    operation: (current: AppConfig) => Promise<AppConfig | Bootstrap>,
  ) => Promise<AppConfig>;
  setDraft: (next: SetStateAction<Settings | null>) => void;
  notify: (message: string, error?: boolean) => void;
  addLog: (level: string, message: string) => void;
  reportError: (error: unknown) => void;
}
/** Setting writes capture submitted data and merge acknowledgements into the latest owner draft. */
export function createSettingsActions({
  draftRef,
  lifecycle,
  enqueueConfig,
  setDraft,
  notify,
  addLog,
  reportError,
}: SettingsActionHost) {
  const saveSettings = async (): Promise<boolean> => {
    if (!draftRef.current) return false;
    const submitted = structuredClone(draftRef.current);
    const generation = lifecycle.current;
    try {
      validateSettings(submitted);
      const config = await enqueueConfig((current) =>
        api.saveConfig({ ...current, settings: submitted }),
      );
      if (generation !== lifecycle.current) return false;
      setDraft((previous) =>
        JSON.stringify(previous) === JSON.stringify(submitted)
          ? structuredClone(config.settings)
          : previous,
      );
      notify(i18n.t('messages.settingsSaved'));
      addLog('info', i18n.t('messages.settingsLog'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };
  const saveAccount = async (): Promise<boolean> => {
    if (!draftRef.current) return false;
    const username = draftRef.current.offline_username;
    const generation = lifecycle.current;
    try {
      validateUsername(username);
      const config = await enqueueConfig((current) =>
        api.saveConfig({
          ...current,
          settings: { ...current.settings, offline_username: username },
        }),
      );
      if (generation !== lifecycle.current) return false;
      setDraft((previous) =>
        previous?.offline_username === username
          ? { ...previous, offline_username: config.settings.offline_username }
          : previous,
      );
      notify(i18n.t('messages.accountSaved'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };
  const setSnapshots = async (showSnapshots: boolean) => {
    const generation = lifecycle.current;
    try {
      const config = await enqueueConfig((current) =>
        api.saveConfig({
          ...current,
          settings: { ...current.settings, show_snapshots: showSnapshots },
        }),
      );
      if (generation !== lifecycle.current) return;
      setDraft((previous) =>
        previous ? { ...previous, show_snapshots: config.settings.show_snapshots } : previous,
      );
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
    }
  };
  return { saveSettings, saveAccount, setSnapshots };
}
