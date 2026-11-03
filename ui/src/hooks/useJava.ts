import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { JavaDiscovery, JavaInstallation } from '../types';

export function useJava(onError: (error: unknown) => void) {
  const [discovery, setRenderedDiscovery] = useState<JavaDiscovery | null>(null);
  const discoveryState = useRef(discovery);
  const setDiscovery = useCallback((value: JavaDiscovery) => {
    discoveryState.current = value;
    setRenderedDiscovery(value);
  }, []);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const discoveryRequested = useRef(false);
  const discoverRef = useRef<() => Promise<void>>(async () => {});
  const generation = useRef(0);
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++;
    pending.current = false;
    setBusy(false);
    return () => {
      lifecycle.current++;
      discoveryRequested.current = false;
    };
  }, []);

  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | null> => {
      if (pending.current) return null;
      pending.current = true;
      setBusy(true);
      const requestGeneration = generation.current;
      try {
        const result = await operation();
        return generation.current === requestGeneration ? result : null;
      } catch (error) {
        if (generation.current === requestGeneration) onError(error);
        return null;
      } finally {
        if (generation.current === requestGeneration) {
          pending.current = false;
          setBusy(false);
          if (discoveryRequested.current) {
            discoveryRequested.current = false;
            queueMicrotask(() => {
              // Let a successful chooser hand its result to inspect first. If
              // inspection reserves this same owner, discover defers again.
              queueMicrotask(() => {
                if (generation.current === requestGeneration) void discoverRef.current();
              });
            });
          }
        }
      }
    },
    [onError],
  );
  const discover = useCallback(async () => {
    if (pending.current) {
      discoveryRequested.current = true;
      return;
    }
    const requestGeneration = generation.current;
    const result = await run(api.discoverJava);
    if (result && generation.current === requestGeneration) setDiscovery(result);
  }, [run, setDiscovery]);
  useEffect(() => {
    discoverRef.current = discover;
  }, [discover]);
  const inspect = useCallback(
    async (path: string): Promise<JavaInstallation | null> => {
      const requestGeneration = generation.current;
      const result = await run(async () => {
        const installation = await api.inspectJava(path);
        const detected = await api.discoverJava();
        return { installation, detected };
      });
      if (result && generation.current === requestGeneration) {
        const { installation, detected } = result;
        setDiscovery({
          installations: [
            installation,
            ...detected.installations.filter((item) => item.executable !== installation.executable),
          ],
          warnings: detected.warnings,
          download_supported: detected.download_supported,
        });
        return installation;
      }
      return null;
    },
    [run, setDiscovery],
  );
  return {
    getGuardState: () => ({
      discovery: discoveryState.current,
      busy: pending.current,
      generation: generation.current,
    }),
    discovery,
    busy,
    discover,
    inspect,
    choose: () => run(api.chooseJava),
  };
}
