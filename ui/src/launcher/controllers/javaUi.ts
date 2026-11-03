import { useState } from 'react';
import type { JavaUiSnapshot, LauncherActions } from '../public/types';
import type { LauncherServices } from '../services';
import { useControllerOwner } from './owner';

const reconnect = (state: JavaUiSnapshot): JavaUiSnapshot => state;
// The entered and direct actions share this boundary and the existing queue.
export async function downloadJava(services: LauncherServices, major: number): Promise<boolean> {
  if (
    !Number.isInteger(major) ||
    major < 8 ||
    major > 99 ||
    !services.api.desktop ||
    services.launcher.getGuardState().busy ||
    services.getInteractionState().closeRequested ||
    services.java.getGuardState().discovery?.download_supported === false
  )
    return false;
  return services.downloads.java(major);
}
export function useJavaUiController(services: LauncherServices): {
  snapshot: JavaUiSnapshot;
  actions: LauncherActions['java'];
  readonly picking: boolean;
} {
  const owner = useControllerOwner(services, { downloadMajorDraft: '' }, reconnect);
  const [operation] = useState(() => ({ token: null as symbol | null, generation: -1 }));
  const [actions] = useState<LauncherActions['java']>(() =>
    Object.freeze({
      patchDownloadMajor: (downloadMajorDraft) => {
        if (owner.mounted) owner.commit({ downloadMajorDraft });
      },
      downloadEnteredMajor: () =>
        owner.mounted
          ? downloadJava(owner.services, Number(owner.state.downloadMajorDraft))
          : Promise.resolve(false),
      discover: async () => {
        if (owner.mounted && owner.services.api.desktop) await owner.services.java.discover();
      },
      inspect: async (path) => {
        if (owner.mounted && owner.services.api.desktop && path.trim())
          await owner.services.java.inspect(path);
      },
      selectForSettings: (path) => {
        if (
          !owner.mounted ||
          !owner.services.api.desktop ||
          owner.services.java.getGuardState().busy ||
          !owner.services.java
            .getGuardState()
            .discovery?.installations.some((item) => item.executable === path)
        )
          return;
        owner.generation++;
        owner.services.launcher.patchSettings('java_executable', path);
      },
      chooseForSettings: async () => {
        if (
          !owner.mounted ||
          !owner.services.api.desktop ||
          (operation.token && operation.generation === owner.generation) ||
          owner.services.java.getGuardState().busy
        )
          return;
        const token = Symbol();
        operation.token = token;
        operation.generation = owner.generation;
        const generation = owner.generation,
          javaGeneration = owner.services.java.getGuardState().generation;
        const pathBefore = owner.services.launcher.getSettingsDraft()?.java_executable;
        const current = () =>
          owner.mounted &&
          generation === owner.generation &&
          javaGeneration === owner.services.java.getGuardState().generation;
        try {
          const path = await owner.services.java.choose();
          if (!path || !current() || !owner.services.api.desktop) return;
          const installation = await owner.services.java.inspect(path);
          if (
            installation &&
            current() &&
            owner.services.launcher.getSettingsDraft()?.java_executable === pathBefore
          )
            owner.services.launcher.patchSettings('java_executable', installation.executable);
        } finally {
          if (operation.token === token) operation.token = null;
        }
      },
    }),
  );
  return {
    get snapshot() {
      return owner.state;
    },
    actions,
    get picking() {
      return owner.mounted && operation.token !== null && operation.generation === owner.generation;
    },
  };
}
