import { createContext, useContext } from 'react';
import type { DeepReadonly } from '../launcher/public/types';
import type { UiFileDescriptor, UiSelector, UiSuiteBundle, UiSuiteManifest } from '../ui-suite/model';
import type { UiRouteId } from '../launcher/public/types';
import type { UiResolution } from '../customization/ownership';
export type UiEditorSourceKind = 'css' | 'html' | 'tsx';
export type UiTargetStatus = UiResolution['status'];
export interface DomPreviewSnapshot {
  readonly status: UiTargetStatus;
  readonly reason: string | null;
  readonly rootCount: number;
  readonly locations: readonly Readonly<{ selector: UiSelector; index: number; rootCount: number }>[];
}
export interface DomPreviewHandle {
  readonly status: UiTargetStatus;
  readonly reason: string | null;
  getSnapshot(this: void): Readonly<DomPreviewSnapshot>;
  subscribe(this: void, listener: () => void): () => void;
  refresh(this: void): void;
  dispose(this: void): void;
}
export interface UiTargetDescriptor {
  readonly selector: DeepReadonly<UiSelector>;
  readonly name: string;
  readonly type: string;
  readonly sourcePath: string | null;
  readonly routeId: UiRouteId | null;
  readonly status: UiTargetStatus;
  readonly stability: string;
  readonly matchCount: number;
  readonly reason: string | null;
  readonly ownerId: string | null;
  readonly visibility: 'onscreen' | 'offscreen' | 'mixed' | 'none';
}
export interface UiEditorSelection {
  selector: UiSelector;
  scope: 'position' | 'business' | 'type';
  filePath: string | null;
  sourceKind: UiEditorSourceKind;
}
export interface UiEditorSnapshot {
  open: boolean;
  mode: 'normal' | 'builtin';
  loaded: boolean;
  draft: UiSuiteBundle | null;
  dirty: boolean;
  selectedSuiteId: string | null;
  readonly suites: readonly Readonly<{ id: string; name: string; builtin: boolean }>[];
  selectedFile: string | null;
  selection: UiEditorSelection | null;
  files: UiFileDescriptor[];
  readonly targets: readonly UiTargetDescriptor[];
  readonly currentTarget: UiTargetDescriptor | null;
  readonly targetAncestors: readonly UiTargetDescriptor[];
  readonly scopeChoices: readonly UiTargetDescriptor[];
  picking: boolean;
  pending: 'import' | 'export' | 'compile' | 'preview' | 'save' | 'revert' | 'reset' | 'asset' | null;
  diagnostics: string[];
  previewing: boolean;
  suspended: boolean;
  resetConfirmationOpen: boolean;
}
export interface UiEditorActions {
  open(): void;
  close(): void;
  selectSuite(id: string): Promise<boolean>;
  copyBuiltin(id: 'modern' | 'immersive', name: string): Promise<void>;
  selectFile(path: string): void;
  patchFile(path: string, text: string): void;
  createFile(path: string, kind: UiFileDescriptor['kind']): void;
  renameFile(path: string, nextPath: string): void;
  removeFile(path: string): void;
  addAsset(file: File): Promise<boolean>;
  removeAsset(path: string): void;
  patchManifest(patch: Partial<Omit<UiSuiteManifest, 'kind' | 'schema_version' | 'api_version' | 'files'>>): void;
  importSource(file: File): Promise<boolean>;
  importBundle(file: File): Promise<boolean>;
  exportSource(): Promise<void>;
  exportDraft(): Promise<void>;
  preview(): Promise<boolean>;
  save(): Promise<boolean>;
  revert(): Promise<boolean>;
  requestReset(): void;
  cancelReset(): void;
  confirmReset(): Promise<boolean>;
  clearDiagnostics(): void;
  /** One fixed-host hover/capture lease; normal source replacement cannot own it. */
  beginPick(): void;
  /** Cancels selection; a pressed gesture's consumed release/click tail drains first. */
  cancelPick(): void;
  selectTarget(selector: UiSelector): void;
  setScope(scope: 'position' | 'business' | 'type'): void;
  createDomPreview(selector: UiSelector, container: HTMLElement): DomPreviewHandle;
  locateTarget(selector: UiSelector, index?: number): Promise<boolean>;
  /** Select a source tab and open only its existing exact-selector binding. */
  setSourceKind(kind: UiEditorSourceKind): void;
  /** Capture the suite/draft/selector and atomically create or open its source file. */
  createSelectionOverride(kind: UiEditorSourceKind): Promise<boolean>;
  resetSelectionOverride(): void;
}
// Shared objects only. Importing a source hook cannot initialize a controller or compiler.
export const UiEditorSnapshotContext = createContext<DeepReadonly<UiEditorSnapshot> | null>(null);
export const UiEditorActionsContext = createContext<UiEditorActions | null>(null);
export function useUiEditorSnapshot(): DeepReadonly<UiEditorSnapshot> {
  const value = useContext(UiEditorSnapshotContext);
  if (!value) throw new Error('UiEditorProvider is missing.');
  return value;
}
export function useUiEditorActions(): UiEditorActions {
  const value = useContext(UiEditorActionsContext);
  if (!value) throw new Error('UiEditorProvider is missing.');
  return value;
}
export type { UiSelector, UiPositionLocator, BusinessIdentity } from '../ui-suite/model';
