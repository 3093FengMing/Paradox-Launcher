import { useEffect, useRef, useState } from 'react';
import type { LauncherServices } from '../services';
import { createAccountAvatar } from '../../lib/account-avatar';
export function useAvatarCache(
  services: LauncherServices,
): Readonly<Record<string, string | null>> {
  const [cache, setCache] = useState<Record<string, string | null>>({});
  const current = useRef(services);
  current.current = services;
  const generation = useRef(0);
  const entries = useRef(new Map<string, { key: string; image: string | null; token: symbol }>());
  useEffect(() => {
    const lifecycle = generation,
      accepted = entries.current;
    lifecycle.current++;
    return () => {
      lifecycle.current++;
      accepted.clear();
    };
  }, []);
  const identity = JSON.stringify(
    services.accounts.state.accounts.map((account) => [account.id, account.skin_url]),
  );
  useEffect(() => {
    const accounts = current.current.accounts.getLaunchState().state.accounts;
    const accepted = entries.current;
    for (const id of accepted.keys())
      if (!accounts.some((account) => account.id === id)) accepted.delete(id);
    const publish = () =>
      setCache(Object.fromEntries([...accepted].map(([id, entry]) => [id, entry.image])));
    for (const account of accounts) {
      const key = `${account.id}\0${account.skin_url ?? ''}`;
      if (accepted.get(account.id)?.key === key) continue;
      const entry = { key, image: null as string | null, token: Symbol() };
      accepted.set(account.id, entry);
      if (!account.skin_url || !current.current.api.desktop) continue;
      const requestGeneration = generation.current;
      const owns = () =>
        generation.current === requestGeneration &&
        accepted.get(account.id) === entry &&
        current.current.accounts
          .getLaunchState()
          .state.accounts.some(
            (value) => value.id === account.id && value.skin_url === account.skin_url,
          );
      void current.current.api
        .accountSkin(account.id)
        .then(async (data) => {
          if (!data || !owns()) return;
          const image = await createAccountAvatar(data);
          if (owns()) {
            entry.image = image;
            publish();
          }
        })
        .catch(() => {
          /* Missing or corrupt local images retain the identity fallback. */
        });
    }
    publish();
  }, [identity]);
  // Identity filtering also excludes stale cached data before the effect runs.
  return Object.fromEntries(
    services.accounts.state.accounts.map((account) => [
      account.id,
      entries.current.get(account.id)?.key === `${account.id}\0${account.skin_url ?? ''}`
        ? (cache[account.id] ?? null)
        : null,
    ]),
  );
}
