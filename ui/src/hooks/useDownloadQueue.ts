import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { DownloadTask } from '../types';

export function useDownloadQueue(
  onError: (error: unknown) => void,
  onComplete: (task: DownloadTask) => void,
) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const completedIds = useRef(new Set<string>());
  const commandRef = useRef(new Set<string>());
  const generation = useRef(0);
  const revision = useRef(0);

  const acceptTasks = useCallback(
    (next: DownloadTask[]) => {
      setTasks(next);
      for (const task of next) {
        if (task.status === 'completed' && !completedIds.current.has(task.id)) {
          completedIds.current.add(task.id);
          onComplete(task);
        }
      }
    },
    [onComplete],
  );

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    const requestRevision = revision.current;
    try {
      const next = await api.downloadTasks();
      if (generation.current === requestGeneration && revision.current === requestRevision)
        acceptTasks(next);
    } catch (error) {
      if (generation.current === requestGeneration) onError(error);
    }
  }, [acceptTasks, onError]);

  useEffect(() => {
    const lifecycle = generation;
    const requestGeneration = ++lifecycle.current;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void api
      .subscribeDownloads((next) => {
        if (disposed) return;
        revision.current++;
        acceptTasks(next);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else {
          unsubscribe = cleanup;
          void refresh();
        }
      })
      .catch((error) => {
        if (!disposed) {
          onError(error);
          void refresh();
        }
      });
    return () => {
      disposed = true;
      if (lifecycle.current === requestGeneration) lifecycle.current++;
      unsubscribe?.();
    };
  }, [acceptTasks, onError, refresh]);

  const perform = useCallback(
    async (key: string, operation: () => Promise<unknown>) => {
      if (commandRef.current.has(key)) return false;
      commandRef.current.add(key);
      setPending([...commandRef.current]);
      const requestGeneration = generation.current;
      try {
        await operation();
        await refresh();
        return true;
      } catch (error) {
        if (generation.current === requestGeneration) onError(error);
        return false;
      } finally {
        commandRef.current.delete(key);
        if (generation.current === requestGeneration) setPending([...commandRef.current]);
      }
    },
    [onError, refresh],
  );

  return {
    tasks,
    pending,
    active: tasks.some((task) => ['queued', 'running', 'cancelling'].includes(task.status)),
    install: (key: string) => perform(`install:${key}`, () => api.enqueueInstall(key)),
    java: (major: number) => perform(`java:${major}`, () => api.enqueueJava(major)),
    cancel: (id: string) => perform(id, () => api.cancelTask(id)),
    retry: (id: string) => perform(id, () => api.retryTask(id)),
  };
}
