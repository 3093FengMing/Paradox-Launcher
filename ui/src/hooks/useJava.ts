import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { JavaDiscovery } from '../types';

export function useJava(onError: (error: unknown) => void) {
  const [discovery, setDiscovery] = useState<JavaDiscovery | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const discoveryRequested = useRef(false);
  const discoverRef = useRef<() => Promise<void>>(async () => {});
  const generation = useRef(0);
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++;
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
        pending.current = false;
        if (generation.current === requestGeneration) {
          setBusy(false);
          if (discoveryRequested.current) {
            discoveryRequested.current = false;
            queueMicrotask(() => {
              if (generation.current === requestGeneration) void discoverRef.current();
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
  }, [run]);
  useEffect(() => {
    discoverRef.current = discover;
  }, [discover]);
  const inspect = useCallback(
    async (path: string) => {
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
      }
    },
    [run],
  );
  return { discovery, busy, discover, inspect, choose: () => run(api.chooseJava) };
}
