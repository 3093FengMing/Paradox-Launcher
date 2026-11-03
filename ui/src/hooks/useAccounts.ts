import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AccountsState, LoginPrompt } from '../types';

export function useAccounts(onError: (error: unknown) => void) {
  const [state, setRenderedState] = useState<AccountsState>({
    client_id: '',
    active: null,
    accounts: [],
  });
  const stateRef = useRef(state);
  const setState = useCallback((value: AccountsState) => {
    stateRef.current = value;
    setRenderedState(value);
  }, []);
  const [prompt, setRenderedPrompt] = useState<LoginPrompt | null>(null);
  const promptRef = useRef(prompt);
  const setPrompt = useCallback((value: LoginPrompt | null) => {
    promptRef.current = value;
    setRenderedPrompt(value);
  }, []);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [cancellationPending, setCancellationPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const operation = useRef<symbol | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);
  const loginId = useRef<string | null>(null);
  const cancelling = useRef<string | null>(null);
  const lifecycle = useRef(0);
  const reload = useCallback(async (): Promise<boolean> => {
    if (!mounted.current || operation.current) return false;
    const request = Symbol();
    const generation = lifecycle.current;
    operation.current = request;
    loaded.current = false;
    setLoading(true);
    setReady(false);
    setLoadError(null);
    try {
      const [value, recoverable] = await Promise.all([api.accountState(), api.accountRecovery()]);
      if (lifecycle.current !== generation || operation.current !== request) return false;
      loaded.current = true;
      setState(value);
      setRecovery(recoverable);
      setReady(true);
      return true;
    } catch (error) {
      if (lifecycle.current === generation && operation.current === request) {
        const failure = error ?? new Error('auth.loadFailed');
        setLoadError(failure);
        onError(failure);
      }
      return false;
    } finally {
      if (operation.current === request) operation.current = null;
      if (lifecycle.current === generation) setLoading(false);
    }
  }, [onError, setState]);
  useEffect(() => {
    const lifecycleRef = lifecycle;
    const mountedRef = mounted;
    const operationRef = operation;
    const loadedRef = loaded;
    const loginRef = loginId;
    const cancellingRef = cancelling;
    lifecycleRef.current++;
    mountedRef.current = true;
    setPending(false);
    setLoginPending(false);
    setCancellationPending(false);
    setPrompt(null);
    void reload();
    return () => {
      lifecycleRef.current++;
      mountedRef.current = false;
      loadedRef.current = false;
      operationRef.current = null;
      cancellingRef.current = null;
      const id = loginRef.current;
      loginRef.current = null;
      if (id) void api.cancelLogin(id).catch(() => {});
    };
  }, [reload, setPrompt]);
  const performOperation = useCallback(
    async <T>(action: () => Promise<T>, commit: (value: T) => void): Promise<boolean> => {
      if (!mounted.current || !loaded.current || operation.current) return false;
      const request = Symbol();
      operation.current = request;
      setPending(true);
      setCancellationPending(false);
      const generation = lifecycle.current;
      try {
        const value = await action();
        if (lifecycle.current !== generation || operation.current !== request) return false;
        commit(value);
        return true;
      } catch (error) {
        if (lifecycle.current === generation && operation.current === request) {
          if (error !== 'auth.errors.cancelled') onError(error);
          try {
            const recoverable = await api.accountRecovery();
            if (lifecycle.current === generation && operation.current === request)
              setRecovery(recoverable);
          } catch (recoveryError) {
            if (lifecycle.current === generation && operation.current === request)
              onError(recoveryError);
          }
        }
        return false;
      } finally {
        if (operation.current === request) operation.current = null;
        if (lifecycle.current === generation) setPending(false);
      }
    },
    [onError],
  );
  const perform = (action: () => Promise<AccountsState>) => performOperation(action, setState);
  const login = () =>
    perform(async () => {
      const generation = lifecycle.current;
      const requestId = crypto.randomUUID();
      let id: string = requestId;
      loginId.current = id;
      setLoginPending(true);
      try {
        const value = await api.beginLogin(requestId);
        id = value.id;
        if (lifecycle.current !== generation) {
          await api.cancelLogin(id);
          throw new Error('auth.errors.cancelled');
        }
        loginId.current = id;
        if (cancelling.current === requestId) {
          cancelling.current = id;
          try {
            // The first cancellation can arrive before the backend reserves
            // this request. Cancel a late prompt before starting completion.
            await api.cancelLogin(id);
          } catch (error) {
            if (lifecycle.current === generation && loginId.current === id) {
              onError(error);
              setCancellationPending(false);
              if (cancelling.current === id) cancelling.current = null;
            }
          }
          if (lifecycle.current !== generation) throw new Error('auth.errors.cancelled');
        }
        setPrompt(value);
        return await api.completeLogin(id);
      } finally {
        if (loginId.current === id) loginId.current = null;
        if (cancelling.current === id) cancelling.current = null;
        if (lifecycle.current === generation) {
          setPrompt(null);
          setLoginPending(false);
          setCancellationPending(false);
        }
      }
    });
  return {
    getLaunchState: () => ({
      state: stateRef.current,
      ready: mounted.current && loaded.current,
      pending: operation.current !== null,
      generation: lifecycle.current,
      prompt: promptRef.current,
      cancelling: cancelling.current !== null,
    }),
    state,
    recovery,
    prompt,
    pending,
    loginPending,
    cancelling: cancellationPending,
    loading,
    ready,
    loadError,
    reload,
    login,
    configure: (id: string) => perform(() => api.configureMicrosoft(id)),
    select: (id: string | null) => perform(() => api.selectAccount(id)),
    refresh: (id: string) => perform(() => api.refreshAccount(id)),
    logout: (id: string) => perform(() => api.logoutAccount(id)),
    clearRecovery: (id: string) =>
      performOperation(() => api.clearAccountRecovery(id), setRecovery),
    cancel: async () => {
      const id = loginId.current;
      if (!id || cancelling.current === id) return;
      const generation = lifecycle.current;
      cancelling.current = id;
      setCancellationPending(true);
      try {
        await api.cancelLogin(id);
      } catch (error) {
        if (lifecycle.current === generation && loginId.current === id) {
          onError(error);
          setCancellationPending(false);
          if (cancelling.current === id) cancelling.current = null;
        }
      }
    },
  };
}
