import { createContext } from 'react';
import type * as storage from '../ui-suite/storage';
import type { LauncherInteractionPublisher } from '../launcher/services';
import type { UiFile, UiSuiteBundle, UiSuiteRecord } from '../ui-suite/model';
import type { PreparedSuiteRuntime, SuiteRuntimeScope } from '../ui-suite/prepared';
import type { TargetCatalogContext } from '../customization/target-catalog';
import { canonicalSuiteJson } from '../ui-suite/canonical';
export interface RecoveryActions {
  disable(): void;
  openBuiltinEditor(): void;
  exportRecoverable(): Promise<void>;
  reset(): Promise<boolean>;
}
export interface UiEditorSourceServices {
  getBuiltinBundle(id: 'modern' | 'immersive'): Promise<UiSuiteBundle>;
  getBuiltinName?(id: 'modern' | 'immersive'): Promise<string>;
}
export const UiEditorSourceContext = createContext<UiEditorSourceServices | null>(null);
export interface SuiteActivationLayer {
  readonly layerId: string;
  readonly bundle: UiSuiteBundle;
  readonly prepared: PreparedSuiteRuntime;
}
// Accepted publications only; the shared renderer consumes this carrier and the controller owns disposal.
export interface SuiteActivation {
  readonly primary: SuiteActivationLayer;
  readonly parent: SuiteActivationLayer | null;
  readonly trusted: SuiteActivationLayer;
  readonly retired: boolean;
  onRetire(listener: () => void): () => void;
  dispose(): void;
}
export interface UiEditorDependencies extends UiEditorSourceServices {
  storage: typeof storage;
  createScope(): SuiteRuntimeScope | Promise<SuiteRuntimeScope>;
  compile(
    bundle: UiSuiteBundle,
    scope: SuiteRuntimeScope,
    options: { isCurrent(): boolean },
  ): Promise<PreparedSuiteRuntime>;
  exportFile(name: string, bytes: Uint8Array): Promise<void>;
  acquireInteractionPublisher(): LauncherInteractionPublisher;
  reportError?(error: unknown): void;
  safe: boolean;
  getDefaultBuiltin?(): 'modern' | 'immersive';
  waitForConfiguration?(): Promise<void>;
  getTargetContext?(): TargetCatalogContext;
}
export function detached<T>(value: T): T {
  return structuredClone(value);
}
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    if (Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
// Diff against the immediate fixed parent, using exact spelling. Case-only rename is valid.
export function draftToSuiteRecord(
  bundle: UiSuiteBundle,
  instanceId: string,
  parent: UiSuiteRecord['parent_snapshot'],
): UiSuiteRecord {
  const overlay = Object.create(null) as Record<string, UiFile>;
  const inherited = parent?.bundle.files ?? {};
  for (const [path, file] of Object.entries(bundle.files)) {
    if (
      !Object.hasOwn(inherited, path) ||
      canonicalSuiteJson(inherited[path]) !== canonicalSuiteJson(file)
    )
      overlay[path] = detached(file);
  }
  return {
    instance_id: instanceId,
    manifest: detached(bundle.manifest),
    parent_snapshot: detached(parent),
    overlay,
    deleted: Object.keys(inherited).filter((path) => !Object.hasOwn(bundle.files, path)),
  };
}
