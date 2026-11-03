import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { DeepReadonly } from '../launcher/public/types';
import { createNoticeStore, retainNoticeStore, noticeTime } from '../ui-runtime/notices';
import type { UiNoticeKind } from '../ui-runtime/notices';
import i18n, { getFormattingLocale, translateRuntimeMessage } from '../i18n';
import * as api from '../api';
import { errorMessage } from '../lib/errors';
import { canStopLaunch } from '../lib/activity';
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
  Appearance,
  AppConfig,
  AppearancePreset,
  Bootstrap,
  GameProfile,
  InstalledInstance,
  LogEvent,
  LogIdentity,
  LogLine,
  Personalization,
  Settings,
} from '../types';
import { useCatalog } from './useCatalog';
import { normalizeArgumentTemplates } from '../lib/preferences';
import type { ArgumentTemplate } from '../types';

const MAX_LOG_LINES = 500;
const NOTIFICATION_DEDUPLICATION_MS = 1000;
type ConfigOperation = (current: AppConfig) => Promise<AppConfig | Bootstrap>;
interface LauncherLogLine extends LogLine {
  localSequence?: number;
}

function sameLog(left: LogIdentity | undefined, right: LogIdentity): boolean {
  return left?.session === right.session && left.sequence === right.sequence;
}

function afterLogBoundary(id: LogIdentity, boundary: LogIdentity): boolean {
  return id.session === boundary.session && BigInt(id.sequence) > BigInt(boundary.sequence);
}

function insertLog(current: LauncherLogLine[], line: LauncherLogLine): LauncherLogLine[] {
  const id = line.id;
  if (id && current.some((previous) => sameLog(previous.id, id))) return current;
  const sequence = id ? BigInt(id.sequence) : null;
  const index = id
    ? current.findIndex(
        (previous) =>
          previous.id?.session === id.session &&
          sequence !== null &&
          BigInt(previous.id.sequence) > sequence,
      )
    : -1;
  // Event delivery can lag behind a newer disk snapshot or another event.
  const next = [...current];
  next.splice(index < 0 ? next.length : index, 0, line);
  return next.slice(-MAX_LOG_LINES);
}

function mergeLogs(history: LogLine[], current: LauncherLogLine[]): LauncherLogLine[] {
  return [...history, ...current].reduce<LauncherLogLine[]>(insertLog, []);
}

export function useLauncher() {
  // Permanent business owner. Every main/editor viewport borrows this same store.
  const [notices] = useState(() => createNoticeStore());
  useEffect(() => retainNoticeStore(notices), [notices]);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [draft, setRenderedDraft] = useState<Settings | null>(null);
  const draftRef = useRef<Settings | null>(null);
  // The sole settings owner commits before React renders. Existing conditional
  // ACK and nested merge updaters always receive this latest accepted draft.
  const setDraft = useCallback((next: SetStateAction<Settings | null>) => {
    const accepted = typeof next === 'function' ? next(draftRef.current) : next;
    draftRef.current = accepted;
    setRenderedDraft(accepted);
  }, []);
  const [fatal, setFatal] = useState('');
  const [installed, setInstalled] = useState<InstalledInstance[]>([]);
  const installedRef = useRef<InstalledInstance[]>([]);
  const [busy, setBusy] = useState<Activity | null>(null);
  const [logs, setLogs] = useState<LauncherLogLine[]>([]);
  const [startupPage, setStartupPage] = useState<
    Settings['personalization']['startup_page'] | null
  >(null);
  const [subscriptionGeneration, setSubscriptionGeneration] = useState(0);
  const [pendingWrites, setPendingWrites] = useState(0);
  const pendingWritesRef = useRef(0);
  const configRef = useRef<AppConfig | null>(null);
  const configQueue = useRef<Promise<void>>(Promise.resolve());
  const lifecycle = useRef(0);
  const scanSequence = useRef(0);
  const actionSequence = useRef(0);
  const historySequence = useRef(0);
  const historyRestored = useRef(false);
  const pendingClear = useRef<Promise<void> | null>(null);
  const clearedThrough = useRef<LogIdentity | null>(null);
  const localLogSequence = useRef(0);
  const busyRef = useRef<Activity | null>(null);
  const stopPending = useRef(false);
  const lastNotification = useRef<{
    message: string;
    kind: UiNoticeKind;
    time: number;
    id: string;
  }>({ message: '', kind: 'success', time: 0, id: '' });

  const addLog = useCallback((level: string, message: string) => {
    const localSequence = ++localLogSequence.current;
    setLogs((previous) => [
      ...previous.slice(-(MAX_LOG_LINES - 1)),
      {
        level,
        message,
        localSequence,
        time: new Date().toLocaleTimeString(getFormattingLocale(), { hour12: false }),
      },
    ]);
  }, []);

  const receiveLog = useCallback((event: LogEvent) => {
    const boundary = clearedThrough.current;
    if (boundary && !afterLogBoundary(event.id, boundary)) return;
    const line = {
      ...event,
      time: new Date(event.time * 1000).toLocaleTimeString(getFormattingLocale(), {
        hour12: false,
      }),
    };
    setLogs((previous) => insertLog(previous, line));
  }, []);

  const publishNotice = useCallback(
    (kind: UiNoticeKind, message: string): string => {
      if (kind !== 'error' && configRef.current?.settings.personalization.notifications === false)
        return '';
      message = translateRuntimeMessage(message);
      const previous = lastNotification.current;
      const time = noticeTime(notices);
      if (
        previous.message === message &&
        previous.kind === kind &&
        time - previous.time < NOTIFICATION_DEDUPLICATION_MS
      )
        return previous.id;
      const id = notices.publish(kind, message);
      lastNotification.current = { message, kind, time, id };
      return id;
    },
    [notices],
  );
  const notify = useCallback(
    (message: string, error = false) => {
      publishNotice(error ? 'error' : 'success', message);
    },
    [publishNotice],
  );

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
    pendingWritesRef.current = 0;
    setPendingWrites(0);
    pendingClear.current = null;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    configQueue.current = api
      .getConfig()
      .then((data) => {
        if (disposed) return;
        configRef.current = data.config;
        setBootstrap(data);
        setDraft(structuredClone(data.config.settings));
        setStartupPage((previous) => previous ?? data.config.settings.personalization.startup_page);
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
          if (!disposed) receiveLog(event);
        },
      )
      .then((cleanup) => {
        if (disposed) cleanup();
        else {
          unsubscribe = cleanup;
          setSubscriptionGeneration(generation);
        }
      })
      .catch((error) => {
        if (!disposed) {
          reportError(error);
          setSubscriptionGeneration(generation);
        }
      });
    return () => {
      disposed = true;
      if (lifecycleRef.current === generation) lifecycleRef.current++;
      unsubscribe?.();
    };
  }, [notify, receiveLog, reportError, setDraft]);

  const retainLogs = bootstrap?.config.settings.personalization.retain_logs ?? false;
  useEffect(() => {
    // Subscribe before taking a snapshot. Shared identities make the overlap safe.
    if (!retainLogs || historyRestored.current || subscriptionGeneration !== lifecycle.current)
      return;
    const historyRef = historySequence;
    const generation = lifecycle.current;
    const request = ++historyRef.current;
    const isCurrent = () =>
      generation === lifecycle.current &&
      request === historyRef.current &&
      configRef.current?.settings.personalization.retain_logs;
    void api
      .storedLogs()
      .then((history) => {
        if (!isCurrent()) return;
        historyRestored.current = true;
        const restored = history.map((line) => ({
          ...line,
          time: new Date(line.time * 1000).toLocaleTimeString(getFormattingLocale(), {
            hour12: false,
          }),
        }));
        setLogs((previous) => mergeLogs(restored, previous));
      })
      .catch((error) => {
        if (isCurrent()) reportError(error);
      });
    return () => {
      if (request === historyRef.current) historyRef.current++;
    };
  }, [retainLogs, reportError, subscriptionGeneration]);

  const clearLogs = useCallback((): Promise<void> => {
    if (pendingClear.current) return pendingClear.current;
    const generation = lifecycle.current;
    const localBoundary = localLogSequence.current;
    // A history snapshot taken before clearing must never repopulate the view.
    historySequence.current++;
    const task = api
      .clearStoredLogs()
      .then((boundary) => {
        if (generation !== lifecycle.current) return;
        historySequence.current++;
        historyRestored.current = true;
        clearedThrough.current = boundary;
        setLogs((previous) =>
          previous.filter((line) =>
            line.id
              ? boundary && afterLogBoundary(line.id, boundary)
              : line.localSequence !== undefined && line.localSequence > localBoundary,
          ),
        );
      })
      .catch((error) => {
        if (generation === lifecycle.current) reportError(error);
      })
      .finally(() => {
        if (pendingClear.current === task) pendingClear.current = null;
      });
    pendingClear.current = task;
    return task;
  }, [reportError]);

  // Reads and writes share one queue, so a delayed reload cannot replace a newer
  // save and every update builds on the last acknowledged config.
  const enqueueConfig = useCallback((operation: ConfigOperation): Promise<AppConfig> => {
    const generation = lifecycle.current;
    pendingWritesRef.current++;
    setPendingWrites((previous) => previous + 1);
    const task = configQueue.current.then(async () => {
      const current = configRef.current;
      if (generation !== lifecycle.current || !current)
        throw new Error(i18n.t('messages.configNotReady'));
      const result = await operation(current);
      const config = 'config' in result ? result.config : result;
      if (lifecycle.current === generation) {
        if (!config.settings.personalization.retain_logs) historySequence.current++;
        configRef.current = config;
        setBootstrap((previous) =>
          'config' in result ? result : previous ? { ...previous, config } : previous,
        );
      }
      return config;
    });
    configQueue.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task.finally(() => {
      if (lifecycle.current === generation) {
        pendingWritesRef.current--;
        setPendingWrites((previous) => previous - 1);
      }
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
        installedRef.current = instances;
        setInstalled(instances);
      }
    } catch (error) {
      if (generation === lifecycle.current && request === scanSequence.current) reportError(error);
    }
  }, [reportError]);

  const directory = bootstrap?.config.settings.game_directory;
  const reloadConfig = useCallback(async () => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig(() => api.getConfig());
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
    }
  }, [enqueueConfig, reportError]);
  const profileRoots = JSON.stringify(
    bootstrap?.config.profiles.map((profile) => [profile.instance_key, profile.game_directory]),
  );
  useEffect(() => {
    if (directory) void scan();
  }, [directory, profileRoots, scan]);

  const patchSettings = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
    },
    [setDraft],
  );
  const patchAppearance = useCallback(
    <K extends keyof Appearance>(key: K, value: Appearance[K]) => {
      setDraft((previous) =>
        previous ? { ...previous, appearance: { ...previous.appearance, [key]: value } } : previous,
      );
    },
    [setDraft],
  );
  const patchPersonalization = useCallback(
    <K extends keyof Personalization>(key: K, value: Personalization[K]) => {
      setDraft((previous) =>
        previous
          ? { ...previous, personalization: { ...previous.personalization, [key]: value } }
          : previous,
      );
    },
    [setDraft],
  );

  const resetSettings = useCallback(() => {
    if (configRef.current) setDraft(structuredClone(configRef.current.settings));
  }, [setDraft]);

  const updateArgumentTemplates = useCallback(
    (update: (current: readonly ArgumentTemplate[]) => ArgumentTemplate[]): boolean => {
      if (!draftRef.current) return false;
      // Validate a detached list synchronously; a rejected updater cannot change
      // the owner, and publishing touches only the latest draft's template field.
      const next = normalizeArgumentTemplates(
        update(structuredClone(draftRef.current.argument_templates)),
      );
      setDraft((previous) => (previous ? { ...previous, argument_templates: next } : previous));
      return true;
    },
    [setDraft],
  );

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
    if (busyRef.current || stopPending.current) return;
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
      // A rejected command can release its optimistic state before registration.
      // Once activity events arrive, only a backend terminal event releases busy.
      if (busyRef.current === activity) {
        busyRef.current = null;
        setBusy(null);
      }
      reportError(error);
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

  const removeProfile = async (key: string, deleteFiles: boolean): Promise<boolean> => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig(() => api.removeProfile(key, deleteFiles));
      if (generation !== lifecycle.current) return false;
      await scan();
      if (generation !== lifecycle.current) return false;
      notify(i18n.t(deleteFiles ? 'messages.profileRemovedWithFiles' : 'messages.profileRemoved'));
      return true;
    } catch (error) {
      if (generation !== lifecycle.current) return false;
      reportError(error);
      try {
        await enqueueConfig(async () => (await api.getConfig()).config);
      } catch (refreshError) {
        if (generation === lifecycle.current) reportError(refreshError);
      }
      return false;
    }
  };

  const stopGame = async () => {
    if (stopPending.current || !canStopLaunch(busyRef.current)) return;
    stopPending.current = true;
    const generation = lifecycle.current;
    try {
      await api.stopGame();
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
    } finally {
      stopPending.current = false;
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
    getSettingsDraft: (): DeepReadonly<Settings> | null =>
      draftRef.current ? structuredClone(draftRef.current) : null,
    updateArgumentTemplates,
    getGuardState: () => ({
      config: configRef.current,
      installed: installedRef.current,
      busy: busyRef.current,
      saving: pendingWritesRef.current > 0,
    }),
    notices,
    bootstrap,
    draft,
    fatal,
    installed,
    busy,
    logs,
    startupPage: startupPage ?? 'home',
    requestedStartupRouteId: startupPage,
    ...catalog,
    saving: pendingWrites > 0,
    notify,
    publishNotice,
    reportError,
    patchSettings,
    patchAppearance,
    patchPersonalization,
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
    reloadConfig,
    stopGame,
    saveAppearancePreset,
    applyAppearancePreset,
    renameAppearancePreset,
    removeAppearancePreset,
    importAppearancePreset,
    clearLogs,
  };
}
