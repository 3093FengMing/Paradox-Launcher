import { useEffect, useState } from 'react';
import type { LauncherServices } from '../services';
import { getDomainBlockReason } from '../capabilities';

// Synchronous private state makes same-tick action guards independent of rendering.
// A snapshot accessor below reads it; the public builder detaches and freezes it.
export function useControllerOwner<T>(
  services: LauncherServices,
  initial: T,
  reconnect: (state: T) => T,
) {
  const [, render] = useState(0);
  const [owner] = useState(() => ({
    services,
    state: initial,
    generation: 0,
    mounted: false,
    commit(next: T) {
      this.state = next;
      if (this.mounted) render((value) => value + 1);
    },
  }));
  owner.services = services;
  useEffect(() => {
    owner.generation++;
    owner.mounted = true;
    owner.commit(reconnect(owner.state));
    return () => {
      owner.generation++;
      owner.mounted = false;
    };
  }, [owner, reconnect]);
  return owner;
}

export function domainBlocked(services: LauncherServices): boolean {
  return getDomainBlockReason(services) !== null;
}
export function findProfile(services: LauncherServices, key: string) {
  return services.launcher
    .getGuardState()
    .config?.profiles.find((profile) => profile.instance_key === key);
}
