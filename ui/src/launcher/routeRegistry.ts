import { createContext, useContext } from 'react';
import type { UiRouteDescriptor } from '../ui-suite/routes';

interface ActiveRouteRegistry {
  setActiveRouteRegistry(routes: readonly UiRouteDescriptor[]): void;
}
// Host composition only. Never export through @paradox/launcher or services.
export const ActiveRouteRegistryContext = createContext<ActiveRouteRegistry | null>(null);
export function useActiveRouteRegistry(): ActiveRouteRegistry {
  const channel = useContext(ActiveRouteRegistryContext);
  if (!channel) throw new Error('Active route registry requires LauncherProvider');
  return channel;
}
