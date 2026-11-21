import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { DeepReadonly } from '../launcher/public/types';
import { createNoticeStore, retainNoticeStore } from '../ui-runtime/notices';
import type { UiNoticeKind } from '../ui-runtime/notices';
import i18n, { getFormattingLocale } from '../i18n';
import * as api from '../api';
import { errorMessage } from '../lib/errors';

import type {
  Activity,
  Appearance,
  AppConfig,
  Bootstrap,
  InstalledInstance,
  LogEvent,
  LogIdentity,
  Personalization,
  Settings,
} from '../types';
import { useCatalog } from './useCatalog';
import {createSettingsActions} from './settings-actions';
import { createProfileActions } from './profile-actions';
import { createPresetActions } from './preset-actions';
import { createGameActions } from './game-actions';
import { publishOwnerNotice } from './notice-publisher';
import { MAX_LOG_LINES, afterLogBoundary, insertLog, mergeLogs } from './launcher-log';
import type { LauncherLogLine } from './launcher-log';
import { normalizeArgumentTemplates } from '../lib/preferences';
import type { ArgumentTemplate } from '../types';

type ConfigOperation = (current: AppConfig) => Promise<AppConfig | Bootstrap>;
interface ScanRead {
  generation: number;
  request: number;
  roots: string;
  scanning: boolean;
  error: string | null;
}
const scanRoots = (config: AppConfig | null) =>
  JSON.stringify([
    config?.settings.game_directory,
    config?.profiles.map((profile) => [profile.instance_key, profile.game_directory]),
  ]);

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
  const scanRead = useRef<ScanRead | null>(null);
  const [, renderScan] = useState(0);
  const actionSequence = useRef(0);
  const historySequence = useRef(0);
  const historyRestored = useRef(false);
  const pendingClear = useRef<Promise<void> | null>(null);
  const clearedThrough = useRef<LogIdentity | null>(null);
  const localLogSequence = useRef(0);
  const busyRef = useRef<Activity | null>(null);
  const launchProfileKey = useRef<string | null>(null);
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
      return publishOwnerNotice(notices, configRef, lastNotification, kind, message);
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
    // Reconnected native activity has no reliable instance identity.
    launchProfileKey.current = null;
    scanRead.current = null;
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
        setFatal('');
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
            launchProfileKey.current = null;
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
      if (lifecycleRef.current === generation) {
        lifecycleRef.current++;
        launchProfileKey.current = null;
        scanRead.current = null;
      }
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
  const enqueueConfig = useCallback((operation?: ConfigOperation): Promise<AppConfig> => {
    const generation = lifecycle.current;
    pendingWritesRef.current++;
    setPendingWrites((previous) => previous + 1);
    const task = configQueue.current.then(async () => {
      const current = configRef.current;
      if (generation !== lifecycle.current) throw new Error(i18n.t('messages.configNotReady'));
      let result: AppConfig | Bootstrap;
      if (operation) {
        if (!current) throw new Error(i18n.t('messages.configNotReady'));
        result = await operation(current);
      } else {
        // A reload can establish the first valid config after bootstrap failed.
        // Writes still require the queue's latest acknowledged configuration.
        result = await api.getConfig();
      }
      const config = 'config' in result ? result.config : result;
      if (lifecycle.current === generation) {
        if (!config.settings.personalization.retain_logs) historySequence.current++;
        configRef.current = config;
        setBootstrap((previous) =>
          'config' in result ? result : previous ? { ...previous, config } : previous,
        );
        if (!current) {
          setDraft(structuredClone(config.settings));
          setStartupPage((previous) => previous ?? config.settings.personalization.startup_page);
        }
        if (!operation) setFatal('');
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
  }, [setDraft]);

  const scan = useCallback(async () => {
    const read: ScanRead = {
      generation: lifecycle.current,
      request: ++scanSequence.current,
      roots: scanRoots(configRef.current),
      scanning: true,
      error: null,
    };
    scanRead.current = read;
    renderScan((value) => value + 1);
    const current = () =>
      read.generation === lifecycle.current &&
      read.request === scanSequence.current &&
      read.roots === scanRoots(configRef.current);
    try {
      const instances = await api.inspectInstances();
      if (current()) {
        installedRef.current = instances;
        setInstalled(instances);
      }
    } catch (error) {
      if (current()) {
        read.error = errorMessage(error);
        reportError(error);
      }
    } finally {
      if (current()) {
        read.scanning = false;
        renderScan((value) => value + 1);
      }
    }
  }, [reportError]);

  const directory = bootstrap?.config.settings.game_directory;
  const reloadConfig = useCallback(async () => {
    const generation = lifecycle.current;
    try {
      await enqueueConfig();
    } catch (error) {
      if (generation === lifecycle.current) {
        if (!configRef.current) setFatal(errorMessage(error));
        reportError(error);
      }
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







  const {saveSettings,saveAccount,setSnapshots}=createSettingsActions({draftRef,lifecycle,enqueueConfig,setDraft,notify,addLog,reportError});
  const { selectProfile, saveProfile, updateProfile, importProfiles, removeProfile, retryProfileFiles } =
    createProfileActions({ lifecycle, configRef, enqueueConfig, scan, notify, reportError });

  const {runAction, stopGame} = createGameActions({ busyRef, stopPending, actionSequence, lifecycle, launchProfileKey, setBusy, notify, reportError });

  const { saveAppearancePreset, applyAppearancePreset, renameAppearancePreset, removeAppearancePreset, importAppearancePreset } =
    createPresetActions({ lifecycle, configRef, draftRef, enqueueConfig, patchSettings, notify, reportError });

  return {
    getSettingsDraft: (): DeepReadonly<Settings> | null =>
      draftRef.current ? structuredClone(draftRef.current) : null,
    updateArgumentTemplates,
    getGuardState: () => {
      const read = scanRead.current;
      const currentScan =
        read &&
        read.generation === lifecycle.current &&
        read.request === scanSequence.current &&
        read.roots === scanRoots(configRef.current);
      return {
        config: configRef.current,
        installed: installedRef.current,
        busy: busyRef.current,
        launchProfileKey: launchProfileKey.current,
        scanning: currentScan ? read.scanning : false,
        scanError: currentScan ? read.error : null,
        saving: pendingWritesRef.current > 0,
      };
    },
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
    retryProfileFiles,
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
