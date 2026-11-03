import { createContext, useContext } from 'react';
import type { DeepReadonly, LauncherActions, LauncherSnapshot } from './types';

export const LauncherSnapshotContext = createContext<DeepReadonly<LauncherSnapshot> | null>(null);
export const LauncherActionsContext = createContext<LauncherActions | null>(null);
export function useLauncherSnapshot(): DeepReadonly<LauncherSnapshot> {
  const snapshot = useContext(LauncherSnapshotContext);
  if (!snapshot) throw new Error('LauncherProvider is missing.');
  return snapshot;
}
export function useLauncherActions(): LauncherActions {
  const actions = useContext(LauncherActionsContext);
  if (!actions) throw new Error('LauncherProvider is missing.');
  return actions;
}
