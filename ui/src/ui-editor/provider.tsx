/** @jsxImportSource react */
import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useLauncherCompatibility } from '../launcher/compatibility';
import { useLauncherSnapshot } from '../launcher/public/context';
import * as storage from '../ui-suite/storage';
import { UiInteractionContext } from '../customization/context';
import { UiEditorActionsContext, UiEditorSnapshotContext } from './public';
import { UiEditorSourceContext } from './controller-model';
import { createUiEditorController, UiEditorControllerContext } from './controller';
function exportFile(name: string, bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return Promise.resolve();
}
export function UiEditorProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { services } = useLauncherCompatibility();
  const source = useContext(UiEditorSourceContext);
  const launcherSnapshot = useLauncherSnapshot();
  const [current] = useState(() => {
    let ready!: () => void;
    const configuration = new Promise<void>((resolve) => {
      ready = resolve;
    });
    return { services, source, configuration, ready, snapshot: launcherSnapshot };
  });
  current.services = services;
  current.source = source;
  current.snapshot = launcherSnapshot;
  useEffect(() => {
    if (launcherSnapshot.config.ready) current.ready();
  }, [current, launcherSnapshot.config.ready]);
  const [controller] = useState(() =>
    createUiEditorController({
      storage,
      getBuiltinBundle: (id) => {
        if (!current.source) throw new Error('Builtin source services are missing');
        return current.source.getBuiltinBundle(id);
      },
      getBuiltinName: async (id) => {
        if (!current.source) throw new Error('Builtin source services are missing');
        return current.source.getBuiltinName
          ? current.source.getBuiltinName(id)
          : (await current.source.getBuiltinBundle(id)).manifest.name;
      },
      createScope: async () => (await import('../ui-suite/prepared')).createSuiteRuntimeScope(),
      compile: async (bundle, scope, options) =>
        (await import('../ui-suite/compiler')).compileSuiteInScope(bundle, scope, options),
      exportFile,
      acquireInteractionPublisher: () => current.services.acquireInteractionPublisher(),
      reportError: (error) => current.services.launcher.reportError(error),
      getDefaultBuiltin: () =>
        current.services.launcher.getGuardState().config?.settings.appearance.interface_style ===
        'immersive'
          ? 'immersive'
          : 'modern',
      waitForConfiguration: () => current.configuration,
      getTargetContext: () => ({
        routes: current.snapshot.navigation.routes.map((route) => route.id),
        businessNames: [
          ...current.snapshot.profiles.items.map(({ profile }) => ({
            namespace: 'profile',
            value: profile.instance_key,
            name: profile.name,
          })),
          ...current.snapshot.accounts.state.accounts.map((account) => ({
            namespace: 'account',
            value: account.id,
            name: account.name,
          })),
        ],
      }),
      safe:
        typeof location !== 'undefined' &&
        new URLSearchParams(location.search).get('ui-safe') === '1',
    }),
  );
  useEffect(() => controller.connect(), [controller, services.acquireInteractionPublisher]);
  useEffect(
    () => controller.refreshTargets(),
    [controller, launcherSnapshot.navigation, launcherSnapshot.profiles, launcherSnapshot.accounts],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // Accessible names and rectangles reflect the committed normal editor DOM.
  // Equality-checked catalog publication reaches a fixed point after that commit.
  useEffect(() => controller.refreshTargets(), [controller, snapshot]);
  return (
    <UiEditorControllerContext.Provider value={controller}>
      <UiEditorActionsContext.Provider value={controller.actions}>
        <UiEditorSnapshotContext.Provider value={snapshot}>
          <UiInteractionContext.Provider value={{ editing: snapshot.open }}>
            {children}
          </UiInteractionContext.Provider>
        </UiEditorSnapshotContext.Provider>
      </UiEditorActionsContext.Provider>
    </UiEditorControllerContext.Provider>
  );
}
