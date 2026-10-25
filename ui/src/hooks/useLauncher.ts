import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as api from '../api';
import { errorMessage } from '../lib/errors';
import {
  validateProfileName,
  validateSettings,
  validateUsername,
  type ProfileEditor,
} from '../lib/forms';
import type {
  Activity,
  AppConfig,
  Bootstrap,
  GameProfile,
  GameVersion,
  InstalledInstance,
  LogLine,
  Settings,
} from '../types';

const MAX_LOG_LINES = 500;
const NOTIFICATION_DEDUPLICATION_MS = 1000;
type ConfigOperation = (current: AppConfig) => Promise<AppConfig>;

export function useLauncher() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [fatal, setFatal] = useState('');
  const [versions, setVersions] = useState<GameVersion[]>([]);
  const [installed, setInstalled] = useState<InstalledInstance[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState<Activity | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [pendingWrites, setPendingWrites] = useState(0);
  const configRef = useRef<AppConfig | null>(null);
  const configQueue = useRef<Promise<void>>(Promise.resolve());
  const lifecycle = useRef(0);
  const scanSequence = useRef(0);
  const actionSequence = useRef(0);
  const busyRef = useRef<Activity | null>(null);
  const catalogPending = useRef(false);
  const lastNotification = useRef({ message: '', error: false, time: 0 });

  const addLog = useCallback((level: string, message: string) => {
    setLogs((previous) => [
      ...previous.slice(-(MAX_LOG_LINES - 1)),
      {
        level,
        message,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      },
    ]);
  }, []);

  const notify = useCallback((message: string, error = false) => {
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
      if (!current) throw new Error('启动器配置尚未加载');
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
    try {
      const instances = await api.inspectInstances();
      if (
        generation === lifecycle.current &&
        request === scanSequence.current &&
        directory === configRef.current?.settings.game_directory
      ) {
        setInstalled(instances);
      }
    } catch (error) {
      if (generation === lifecycle.current && request === scanSequence.current) reportError(error);
    }
  }, [reportError]);

  const directory = bootstrap?.config.settings.game_directory;
  useEffect(() => {
    if (directory) void scan();
  }, [directory, scan]);

  const refreshCatalog = useCallback(async () => {
    if (catalogPending.current) return;
    catalogPending.current = true;
    const generation = lifecycle.current;
    setCatalogBusy(true);
    setCatalogError('');
    try {
      const result = await api.catalog();
      if (generation !== lifecycle.current) return;
      setVersions(result);
      addLog('info', `获取到 ${result.length} 个 Minecraft 版本`);
    } catch (error) {
      if (generation !== lifecycle.current) return;
      const message = errorMessage(error);
      setCatalogError(message);
      addLog('error', message);
    } finally {
      catalogPending.current = false;
      if (generation === lifecycle.current) setCatalogBusy(false);
    }
  }, [addLog]);

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
      notify('设置已保存');
      addLog('info', '启动器设置已保存');
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
      notify('账户已保存');
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
      notify(editor.editKey ? '实例已重命名' : '实例已创建，接下来可以安装游戏文件');
      return true;
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
      return false;
    }
  };

  const runAction = async (action: 'install' | 'launch', profile: GameProfile) => {
    if (busyRef.current) return;
    const request = ++actionSequence.current;
    const generation = lifecycle.current;
    const activity: Activity = {
      action,
      status: 'started',
      message: action === 'install' ? `正在安装 ${profile.name}` : '正在检查 Java 并启动游戏',
    };
    busyRef.current = activity;
    setBusy(activity);
    try {
      if (action === 'install') {
        await api.prepareInstance(profile.instance_key);
        await scan();
        if (request === actionSequence.current && generation === lifecycle.current) {
          busyRef.current = null;
          setBusy(null);
        }
      } else await api.launchInstance(profile.instance_key);
    } catch (error) {
      if (request !== actionSequence.current || generation !== lifecycle.current) return;
      busyRef.current = null;
      setBusy(null);
      reportError(error);
    }
  };

  const stopGame = async () => {
    try {
      await api.stopGame();
    } catch (error) {
      reportError(error);
    }
  };

  return {
    bootstrap,
    draft,
    fatal,
    versions,
    installed,
    busy,
    logs,
    catalogBusy,
    catalogError,
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
    refreshCatalog,
    scan,
    stopGame,
    clearLogs: () => setLogs([]),
  };
}
