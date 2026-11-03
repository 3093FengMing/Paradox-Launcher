import { createContext, useContext } from 'react';
import type { LauncherServices } from './services';

// Temporary PRIVATE adapter for existing domain views pending Tasks 2–4.
// This module is excluded from JSX replacement and never exported publicly.
export const CompatibilityContext = createContext<{
  services: LauncherServices;
} | null>(null);
export function useLauncherCompatibility() {
  const bridge = useContext(CompatibilityContext);
  if (!bridge) throw new Error('LauncherProvider is missing.');
  return bridge;
}
