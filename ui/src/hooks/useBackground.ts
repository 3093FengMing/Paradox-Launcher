import { useEffect, useState } from 'react';
import * as api from '../api';

export function useBackground(id: string, onError: (error: unknown) => void): string | null {
  const [loaded, setLoaded] = useState<{ id: string; data: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let current = true;
    void api
      .readBackground(id)
      .then((data) => {
        if (current) setLoaded({ id, data });
      })
      .catch((error: unknown) => {
        if (current) onError(error);
      });
    return () => {
      current = false;
    };
  }, [id, onError]);
  return id && loaded?.id === id ? loaded.data : null;
}
