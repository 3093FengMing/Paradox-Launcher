import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { errorMessage } from '../lib/errors';
import type { CatalogSnapshot } from '../types';
import i18n from '../i18n';

export function useCatalog(addLog: (level: string, message: string) => void) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const lifecycle = generation;
    lifecycle.current++;
    return () => {
      lifecycle.current++;
    };
  }, []);

  const refreshCatalog = useCallback(
    async (forceRefresh = false) => {
      if (pending.current) return;
      pending.current = true;
      const requestGeneration = generation.current;
      setCatalogBusy(true);
      setCatalogError('');
      try {
        const result = await api.catalog(forceRefresh);
        if (generation.current !== requestGeneration) return;
        setSnapshot(result);
        addLog(
          'info',
          i18n.t(result.source === 'cache' ? 'catalog.cacheLoaded' : 'catalog.networkLoaded', {
            count: result.versions.length,
          }),
        );
        if (result.warning) addLog('warning', result.warning);
      } catch (error) {
        if (generation.current !== requestGeneration) return;
        const message = errorMessage(error);
        setCatalogError(message);
        addLog('error', message);
      } finally {
        pending.current = false;
        if (generation.current === requestGeneration) setCatalogBusy(false);
      }
    },
    [addLog],
  );

  return {
    versions: snapshot?.versions ?? [],
    catalogSnapshot: snapshot,
    catalogBusy,
    catalogError,
    refreshCatalog,
  };
}
