import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import i18n, { getFormattingLocale, translateRuntimeMessage } from '../i18n';
import * as api from '../api';
import { errorMessage } from '../lib/errors';
import {
  createAppearancePreset,
  importAppearancePreset as parseAppearancePreset,
  MAX_APPEARANCE_PRESETS,
  validatePresetName,
} from '../lib/appearance-presets';
import {
  validateProfileName,
  validateProfileSettings,
  validateSettings,
  validateUsername,
  type ProfileEditor,
} from '../lib/forms';
import type {
  Activity,
  AppConfig,
  AppearancePreset,
  Bootstrap,
  GameProfile,
  InstalledInstance,
  LogLine,
  Settings,
} from '../types';
import { useCatalog } from './useCatalog';

const MAX_LOG_LINES = 500;
const NOTIFICATION_DEDUPLICATION_MS = 1000;
type ConfigOperation = (current: AppConfig) => Promise<AppConfig>;

export function useLauncher() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [fatal, setFatal] = useState('');
  const [installed, setInstalled] = useState<InstalledInstance[]>([]);
  const [busy, setBusy] = useState<Activity | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [pendingWrites, setPendingWrites] = useState(0);
  const configRef = useRef<AppConfig | null>(null);
  const configQueue = useRef<Promise<void>>(Promise.resolve());
  const lifecycle = useRef(0);
  const scanSequence = useRef(0);
  const actionSequence = useRef(0);
  const busyRef = useRef<Activity | null>(null);
  const lastNotification = useRef({ message: '', error: false, time: 0 });

  const addLog = useCallback((level: string, message: string) => {
    setLogs((previous) => [
      ...previous.slice(-(MAX_LOG_LINES - 1)),
      {
        level,
        message,
        time: new Date().toLocaleTimeString(getFormattingLocale(), { hour12: false }),
      },
    ]);
  }, []);

  const notify = useCallback((message: string, error = false) => {
    message = translateRuntimeMessage(message);
    const previous = lastNotification.current;
    const time = Date.now();
    if (
      previous.message === message &&
      previous.error === error &&
      time - previous.time < NOTIFICATION_DEDUPLICATION_MS
    )
      return;
    lastNotification.current = { message, error, time };
    if (error) toast.error(message);
    else toast.success(message);
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      const message = errorMessage(error);
      addLog('error', message);
      notify(message, true);
    },
    [addLog, notify],
  );
  const catalog = useCatalog(addLog);

  useEffect(() => {
    const lifecycleRef = lifecycle;
    const generation = ++lifecycleRef.current;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void api
      .getConfig()
      .then((data) => {
        if (disposed) return;
        configRef.current = data.config;
        setBootstrap(data);
        setDraft(structuredClone(data.config.settings));
      })
      .catch((error) => {
        if (!disposed) setFatal(errorMessage(error));
      });
    void api
      .subscribe(
        (event) => {
          if (disposed) return;
          if (event.action === 'install') return;
          if (event.status === 'finished' || event.status === 'error') {
            busyRef.current = null;
            setBusy(null);
            notify(event.message, event.status === 'error');
          } else {
            busyRef.current = event;
            setBusy(event);
          }
        },
        (event) => {
          if (!disposed) addLog(event.level, event.message);
        },
      )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        if (!disposed) reportError(error);
      });
    return () => {
      disposed = true;
      if (lifecycleRef.current === generation) lifecycleRef.current++;
      unsubscribe?.();
    };
  }, [addLog, notify, reportError]);

  // Build each update from the last acknowledged config, so independent actions
  // such as account saving and instance selection cannot overwrite each other.
  const enqueueConfig = useCallback((operation: ConfigOperation): Promise<AppConfig> => {
    const generation = lifecycle.current;
    setPendingWrites((previous) => previous + 1);
    const task = configQueue.current.then(async () => {
      const current = configRef.current;
      if (!current) throw new Error(i18n.t('messages.configNotReady'));
      const config = await operation(current);
      configRef.current = config;
      if (lifecycle.current === generation) {
        setBootstrap((previous) => (previous ? { ...previous, config } : previous));
      }
      return config;
    });
    configQueue.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task.finally(() => {
      if (lifecycle.current === generation) setPendingWrites((previous) => previous - 1);
    });
  }, []);

  const scan = useCallback(async () => {
    const generation = lifecycle.current;
    const request = ++scanSequence.current;
    const directory = configRef.current?.settings.game_directory;
    const profileRoots = JSON.stringify(
      configRef.current?.profiles.map((profile) => [profile.instance_key, profile.game_directory]),
    );
    try {
      const instances = await api.inspectInstances();
      if (
        generation === lifecycle.current &&
        request === scanSequence.current &&
        directory === configRef.current?.settings.game_directory &&
        profileRoots ===
          JSON.stringify(
            configRef.current?.profiles.map((profile) => [
              profile.instance_key,
              profile.game_directory,
            ]),
          )
      ) {
        setInstalled(instances);
      }
    } catch (error) {
      if (generation === lifecycle.current && request === scanSequence.current) reportError(error);
    }
  }, [reportError]);

  const directory = bootstrap?.config.settings.game_directory;
  const profileRoots = JSON.stringify(
    bootstrap?.config.profiles.map((profile) => [profile.instance_key, profile.game_directory]),
  );
  useEffect(() => {
    if (directory) void scan();
  }, [directory, profileRoots, scan]);

  const patchSettings = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
  }, []);

  const resetSettings = useCallback(() => {
    if (configRef.current) setDraft(structuredClone(configRef.current.settings));
  }, []);

  const saveSettings = async (): Promise<boolean> => {
    if (!draft) return false;
    const submitted = structuredClone(draft);
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
    if (!draft) return false;
    const username = draft.offline_username;
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
          : api.createProfile(editor.name, editor.version),
      );
      if (generation !== lifecycle.current) return false;
      notify(i18n.t(editor.editKey ? 'messages.profileRenamed' : 'messages.profileCreated'));
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };

  const runAction = async (action: 'install' | 'launch', profile: GameProfile) => {
    if (action === 'install') {
      try {
        await api.enqueueInstall(profile.instance_key);
        notify(i18n.t('messages.profileQueued', { name: profile.name }));
      } catch (error) {
        reportError(error);
      }
      return;
    }
    if (busyRef.current) return;
    const request = ++actionSequence.current;
    const generation = lifecycle.current;
    const activity: Activity = {
      action,
      status: 'started',
      message: i18n.t('messages.checkingJava'),
    };
    busyRef.current = activity;
    setBusy(activity);
    try {
      await api.launchInstance(profile.instance_key);
    } catch (error) {
      if (request !== actionSequence.current || generation !== lifecycle.current) return;
      busyRef.current = null;
      setBusy(null);
      reportError(error);
    }
  };

  const updateProfile = async (profile: GameProfile): Promise<boolean> => {
    try {
      if (!configRef.current) return false;
      validateProfileSettings(profile, configRef.current.settings);
      await enqueueConfig(() => api.updateProfile(profile));
      notify(i18n.t('messages.profileSettingsSaved'));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const importProfiles = async (directory: string, keys: string[]): Promise<boolean> => {
    try {
      await enqueueConfig(() => api.importInstances(directory, keys));
      notify(i18n.t('messages.profilesImported'));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const removeProfile = async (key: string, deleteFiles: boolean): Promise<boolean> => {
    try {
      await enqueueConfig(() => api.removeProfile(key, deleteFiles));
      await scan();
      notify(i18n.t(deleteFiles ? 'messages.profileRemovedWithFiles' : 'messages.profileRemoved'));
      return true;
    } catch (error) {
      reportError(error);
      try {
        await enqueueConfig(async () => (await api.getConfig()).config);
      } catch (refreshError) {
        reportError(refreshError);
      }
      return false;
    }
  };

  const stopGame = async () => {
    try {
      await api.stopGame();
    } catch (error) {
      reportError(error);
    }
  };

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
    if (!draft) throw new Error(i18n.t('messages.configNotReady'));
    const preset = createAppearancePreset(name, draft.appearance);
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
    bootstrap,
    draft,
    fatal,
    installed,
    busy,
    logs,
    ...catalog,
    saving: pendingWrites > 0,
    notify,
    reportError,
    patchSettings,
    resetSettings,
    saveSettings,
    saveAccount,
    setSnapshots,
    selectProfile,
    saveProfile,
    runAction,
    updateProfile,
    importProfiles,
    removeProfile,
    scan,
    stopGame,
    saveAppearancePreset,
    applyAppearancePreset,
    renameAppearancePreset,
    removeAppearancePreset,
    importAppearancePreset,
    clearLogs: () => setLogs([]),
  };
}
