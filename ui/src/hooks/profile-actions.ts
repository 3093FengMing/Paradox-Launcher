import * as api from '../api';
import i18n from '../i18n';
import { validateProfileName, validateProfileSettings } from '../lib/forms';
import type { ProfileEditor } from '../lib/forms';
import type { AppConfig, Bootstrap, GameProfile, ProfileRemovalResult } from '../types';
interface Cell<T> {
  current: T;
}
interface ProfileActionDependencies {
  lifecycle: Cell<number>;
  configRef: Cell<AppConfig | null>;
  enqueueConfig: (
    operation?: (current: AppConfig) => Promise<AppConfig | Bootstrap>,
  ) => Promise<AppConfig>;
  scan: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  reportError: (error: unknown) => void;
}
/** Profile transactions read the current owner and reject obsolete completions. */
export function createProfileActions({
  lifecycle,
  configRef,
  enqueueConfig,
  scan,
  notify,
  reportError,
}: ProfileActionDependencies) {
  const selectProfile = async (key: string) => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig((current) => api.saveConfig({ ...current, active_profile: key }));
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
    }
  };

  const saveProfile = async (editor: ProfileEditor): Promise<boolean> => {
    const generation = lifecycle.current;
    try {
      validateProfileName(editor.name);
      await enqueueConfig((current) =>
        editor.editKey
          ? api.saveConfig({
              ...current,
              profiles: current.profiles.map((profile) =>
                profile.instance_key === editor.editKey
                  ? { ...profile, name: editor.name.trim() }
                  : profile,
              ),
            })
          : api.createProfile(editor.name, editor.version, editor.loader, editor.loader_version),
      );
      if (generation !== lifecycle.current) return false;
      notify(i18n.t(editor.editKey ? 'messages.profileRenamed' : 'messages.profileCreated'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };

  const updateProfile = async (profile: GameProfile): Promise<boolean> => {
    const generation = lifecycle.current;
    try {
      if (!configRef.current) return false;
      validateProfileSettings(profile, configRef.current.settings);
      await enqueueConfig(() => api.updateProfile(profile));
      if (generation !== lifecycle.current) return false;
      notify(i18n.t('messages.profileSettingsSaved'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };

  const importProfiles = async (directory: string, keys: string[]): Promise<boolean> => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig(() => api.importInstances(directory, keys));
      if (generation !== lifecycle.current) return false;
      notify(i18n.t('messages.profilesImported'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };

  const removeProfile = async (
    key: string,
    deleteFiles: boolean,
  ): Promise<ProfileRemovalResult | null> => {
    const generation = lifecycle.current;
    try {
      let result: ProfileRemovalResult | undefined;
      await enqueueConfig(async () => {
        result = await api.removeProfile(key, deleteFiles);
        return result.config;
      });
      if (generation !== lifecycle.current || !result) return null;
      await scan();
      if (generation !== lifecycle.current) return null;
      if (result.file_removal_error) reportError(result.file_removal_error);
      else
        notify(
          i18n.t(deleteFiles ? 'messages.profileRemovedWithFiles' : 'messages.profileRemoved'),
        );
      return result;
    } catch (error) {
      if (generation !== lifecycle.current) return null;
      reportError(error);
      try {
        await enqueueConfig(async () => (await api.getConfig()).config);
      } catch (refreshError) {
        if (generation === lifecycle.current) reportError(refreshError);
      }
      return null;
    }
  };

  const retryProfileFiles = async (token: string): Promise<ProfileRemovalResult | null> => {
    const generation = lifecycle.current;
    try {
      let result: ProfileRemovalResult | undefined;
      await enqueueConfig(async () => {
        result = await api.retryProfileFiles(token);
        return result.config;
      });
      if (generation !== lifecycle.current || !result) return null;
      await scan();
      if (generation !== lifecycle.current) return null;
      if (result.file_removal_error) reportError(result.file_removal_error);
      else notify(i18n.t('messages.profileRemovedWithFiles'));
      return result;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return null;
    }
  };

  return {
    selectProfile,
    saveProfile,
    updateProfile,
    importProfiles,
    removeProfile,
    retryProfileFiles,
  };
}
