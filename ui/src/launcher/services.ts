import type { useLauncher } from '../hooks/useLauncher';
import type { useAccounts } from '../hooks/useAccounts';
import type { useJava } from '../hooks/useJava';
import type { useDownloadQueue } from '../hooks/useDownloadQueue';
import type { UiNoticeStore } from '../ui-runtime/notices';
import type { LauncherActions, UiRouteId } from './public/types';
import type * as api from '../api';
export interface LauncherInteractionPublisher {
  publish(patch: Partial<{ editorOpen: boolean; picking: boolean; modalOpen: boolean }>): void;
  release(): void;
}
export interface LauncherServices {
  launcher: ReturnType<typeof useLauncher>;
  accounts: ReturnType<typeof useAccounts>;
  java: ReturnType<typeof useJava>;
  downloads: ReturnType<typeof useDownloadQueue>;
  api: typeof api;
  notices: UiNoticeStore;
  getRouteId(): UiRouteId;
  getNavigation(): Readonly<{
    // Private entry identity; search edits and unchanged registries retain it.
    entryId: number;
    routeId: UiRouteId;
    params: Readonly<{ profileKey?: string }>;
    search: string;
  }>;
  navigate: LauncherActions['navigation']['navigate'];
  getInteractionState(): Readonly<{
    editorOpen: boolean;
    picking: boolean;
    modalOpen: boolean;
    closeRequested: boolean;
  }>;
  setInteractionState(
    patch: Partial<{ editorOpen: boolean; picking: boolean; modalOpen: boolean }>,
  ): void;
  acquireInteractionPublisher(this: void): LauncherInteractionPublisher;
}
