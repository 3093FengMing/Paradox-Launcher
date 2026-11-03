import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { CloseRequest } from '../types';

export function useCloseRequest(onError: (error: unknown) => void) {
  const [request, setRequest] = useState<CloseRequest | null>(null);
  const [closing, setClosing] = useState(false);
  const pending = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    const life = lifecycle;
    const generation = ++life.current;
    pending.current = false;
    setClosing(false);
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void api
      .subscribeCloseRequests(
        (next) => {
          if (!disposed) setRequest(next);
        },
        (error) => {
          if (!disposed) {
            pending.current = false;
            setClosing(false);
            onError(error);
          }
        },
      )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        if (!disposed) onError(error);
      });
    return () => {
      disposed = true;
      if (life.current === generation) life.current++;
      unsubscribe?.();
    };
  }, [onError]);
  const close = async (mode: 'stop' | 'background' | 'stay') => {
    if (pending.current) return;
    pending.current = true;
    const generation = lifecycle.current;
    setClosing(true);
    try {
      await api.closeLauncher(mode);
      if (lifecycle.current === generation) setRequest(null);
    } catch (error) {
      if (lifecycle.current === generation) onError(error);
    } finally {
      if (lifecycle.current === generation) {
        pending.current = false;
        setClosing(false);
      }
    }
  };
  return { request, closing, close };
}
