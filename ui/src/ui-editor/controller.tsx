/** @jsxImportSource react */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { DeepReadonly } from '../launcher/public/types';
import type { LauncherInteractionPublisher } from '../launcher/services';
import { useLauncherCompatibility } from '../launcher/compatibility';
import { useLauncherSnapshot } from '../launcher/public/context';
import * as storage from '../ui-suite/storage';
import { bundleDigest, materializeSuite, normalizeDraftBundle, validateSuiteBundle } from '../ui-suite/bundle';
import { decodeSuiteArchive, encodeSuiteArchive } from '../ui-suite/archive';
import { canonicalSuiteJson, encodeBase64, utf8 } from '../ui-suite/canonical';
import { uniqueSuitePaths, validateSuitePath } from '../ui-suite/paths';
import { suiteLimits } from '../ui-suite/model';
import type { UiFile, UiFileDescriptor, UiSelector, UiSuiteBundle, UiSuiteLibrary, UiSuiteRecord } from '../ui-suite/model';
import type { PreparedSuiteRuntime, SuiteRuntimeScope } from '../ui-suite/prepared';
import { publishUiDefinitions, resolveSelector, subscribeOwners } from '../customization/ownership';
import { sameSelector, selectorDigest, selectorMatches } from '../customization/selectors';
import { describeTarget, getScopeChoices, getTargetAncestors, listCurrentTargets } from '../customization/target-catalog';
import type { TargetCatalogContext } from '../customization/target-catalog';
import { createDomPreview, locateTarget } from '../customization/dom-preview';
import { startPicker } from '../customization/picker';
import i18n from '../i18n';
import { UiInteractionContext } from '../customization/context';
import { UiEditorActionsContext, UiEditorSnapshotContext } from './public';
import type { DomPreviewHandle, UiEditorActions, UiEditorSnapshot, UiEditorSourceKind } from './public';

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
// eslint-disable-next-line react-refresh/only-export-components
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
  compile(bundle: UiSuiteBundle, scope: SuiteRuntimeScope, options: { isCurrent(): boolean }): Promise<PreparedSuiteRuntime>;
  exportFile(name: string, bytes: Uint8Array): Promise<void>;
  acquireInteractionPublisher(): LauncherInteractionPublisher;
  reportError?(error: unknown): void;
  safe: boolean;
  getDefaultBuiltin?(): 'modern' | 'immersive';
  waitForConfiguration?(): Promise<void>;
  getTargetContext?(): TargetCatalogContext;
}
function detached<T>(value: T): T { return structuredClone(value); }
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    if (Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
// Diff against the immediate fixed parent, using exact spelling. Case-only rename is valid.
// eslint-disable-next-line react-refresh/only-export-components
export function draftToSuiteRecord(bundle: UiSuiteBundle, instanceId: string, parent: UiSuiteRecord['parent_snapshot']): UiSuiteRecord {
  const overlay = Object.create(null) as Record<string, UiFile>;
  const inherited = parent?.bundle.files ?? {};
  for (const [path, file] of Object.entries(bundle.files)) {
    if (!Object.hasOwn(inherited, path) || canonicalSuiteJson(inherited[path]) !== canonicalSuiteJson(file)) overlay[path] = detached(file);
  }
  return { instance_id: instanceId, manifest: detached(bundle.manifest), parent_snapshot: detached(parent), overlay,
    deleted: Object.keys(inherited).filter((path) => !Object.hasOwn(bundle.files, path)) };
}
// eslint-disable-next-line react-refresh/only-export-components
export function createUiEditorController(deps: UiEditorDependencies) { return new UiEditorController(deps); }
export class UiEditorController {
  private state: UiEditorSnapshot;
  private library: UiSuiteLibrary | null = null;
  private builtinCatalog: {id:string;name:string;builtin:boolean}[] = [];
  private parent: UiSuiteRecord['parent_snapshot'] = null;
  private draftIdentity = 0;
  private editRevision = 0;
  private life = 0;
  private connected = false;
  private loads = 0;
  private reads = 0;
  private writes = 0;
  private activations = 0;
  private operation = 0;
  private persistence: Promise<unknown> = Promise.resolve();
  private activation: SuiteActivation | null = null;
  private accepted: { bundle: UiSuiteBundle; id: string; parent: UiSuiteRecord['parent_snapshot']; previewing: boolean } | null = null;
  private connectionCleanup: (() => void) | null = null;
  private trusted: SuiteActivationLayer | null = null;
  private trustedPromise: Promise<SuiteActivationLayer> | null = null;
  private scopes = new Map<string, Promise<SuiteRuntimeScope>>();
  private listeners = new Set<() => void>();
  private publisher: LauncherInteractionPublisher | null = null;
  private confirmation: 'normal' | 'recovery' | null = null;
  private positionAnchor: UiSelector | null = null;
  private recoveryVisible = false;
  private recoveryToken: storage.RecoveryToken | null = null;
  private definitionDisposals: (() => void)[] = [];
  private previews = new Set<DomPreviewHandle>();
  private highlightCleanup: (() => void) | null = null;
  private highlightAbort: AbortController | null = null;
  private pickerCleanup: (() => void) | null = null;
  constructor(private readonly deps: UiEditorDependencies) {
    this.state = frozen({ open: false, mode: 'normal', loaded: false, draft: null, dirty: false, selectedSuiteId: null,
      suites: [], selectedFile: null, selection: null, files: [], targets: [], currentTarget: null, targetAncestors: [], scopeChoices: [], picking: false, pending: null, diagnostics: [],
      previewing: false, suspended: deps.safe, resetConfirmationOpen: false });
    this.recoveryVisible = deps.safe;
    this.actions = Object.freeze({
      open: () => { this.updateTargets(true); this.publish({ open: true, mode: 'normal' }); },
      close: () => { this.clearHighlight(); this.cancelPick(); this.publish({ open: false }); },
      selectSuite: (id) => this.selectSuite(id), copyBuiltin: (id, name) => this.copyBuiltin(id, name),
      selectFile: (path) => { if (this.state.draft?.files[path]) this.publish({ selectedFile: path }); },
      patchFile: (path, text) => this.edit((draft) => { if (draft.files[path]?.encoding === 'utf8') draft.files[path] = { encoding: 'utf8', text }; }),
      createFile: (path, kind) => this.edit((draft) => {
        if (kind === 'asset') throw new Error('Use addAsset for binary files');
        validateSuitePath(path); uniqueSuitePaths([...Object.keys(draft.files), path]);
        draft.files[path] = { encoding: 'utf8', text: '' };
        draft.manifest.files.push({ path, kind, bytes: 0, sha256: '0'.repeat(64) });
      }),
      renameFile: (path, nextPath) => {
        if (path === nextPath) return;
        this.edit((draft) => {
          if (!Object.hasOwn(draft.files, path)) return;
          validateSuitePath(nextPath); uniqueSuitePaths([...Object.keys(draft.files).filter((p) => p !== path), nextPath]);
          draft.files[nextPath] = draft.files[path]; delete draft.files[path];
          draft.manifest.files = draft.manifest.files.map((file) => file.path === path ? { ...file, path: nextPath } : file);
          if (this.state.selectedFile === path) this.publish({ selectedFile: nextPath });
        });
      },
      removeFile: (path) => this.edit((draft) => { delete draft.files[path]; }),
      removeAsset: (path) => this.edit((draft) => { if (draft.files[path]?.encoding === 'base64') delete draft.files[path]; }),
      addAsset: (file) => this.addAsset(file),
      patchManifest: (patch) => this.edit((draft) => {
        const owned = detached(patch);
        for (const key of ['id', 'name', 'version', 'views', 'routes', 'styles', 'overrides'] as const)
          if (Object.hasOwn(owned, key)) Object.assign(draft.manifest, { [key]: owned[key] });
      }),
      importSource: (file) => this.importSource(file), importBundle: (file) => this.importBundle(file),
      exportSource: () => this.exportSource(), exportDraft: () => this.exportDraft(),
      preview: () => this.submit(false), save: () => this.submit(true), revert: () => this.revert(),
      requestReset: () => this.requestReset('normal'), cancelReset: () => { this.confirmation = null; this.publish({ resetConfirmationOpen: false }); },
      confirmReset: () => this.reset('normal'), clearDiagnostics: () => this.publish({ diagnostics: [] }),
      beginPick: () => this.beginPick(), cancelPick: () => this.cancelPick(),
      selectTarget: (selector) => this.selectTarget(selector), setScope: (scope) => this.setScope(scope),
      createDomPreview: (selector, container) => {
        const handle = createDomPreview(selector, container), dispose = handle.dispose;
        handle.dispose = () => { dispose(); this.previews.delete(handle); };
        this.previews.add(handle); return handle;
      },
      locateTarget: (selector, index) => {
        const life = this.life; this.clearHighlight();
        const abort = new AbortController(); this.highlightAbort = abort;
        return locateTarget(selector, index, (dispose) => {
          if (!this.alive(life)) { dispose(); return; }
          const timer = setTimeout(() => this.clearHighlight(), 3000);
          this.highlightCleanup = () => { clearTimeout(timer); dispose(); };
        }, abort.signal);
      },
      setSourceKind: (kind) => this.setSourceKind(kind),
      createSelectionOverride: (kind) => this.createSelectionOverride(kind),
      resetSelectionOverride: () => {
        const selector = this.state.selection?.selector;
        if (!selector) return;
        ++this.reads;
        this.edit((draft) => { draft.manifest.overrides = draft.manifest.overrides.filter((item) => !sameSelector(item.selector, selector)); });
      },
    } satisfies UiEditorActions);
    this.recovery = Object.freeze({ disable: () => this.disable(), openBuiltinEditor: () => {
      this.disable(); this.recoveryVisible = false; this.updateTargets(true); this.publish({ open: true, mode: 'builtin' });
    }, exportRecoverable: () => this.exportRecoverable(), reset: () => this.reset('recovery') });
  }
  readonly actions: UiEditorActions;
  readonly recovery: RecoveryActions;
  getSnapshot = (): DeepReadonly<UiEditorSnapshot> => this.state;
  getLibrary = (): UiSuiteLibrary | null => detached(this.library);
  getActivation = (): SuiteActivation | null => this.activation;
  isRecoveryVisible = (): boolean => this.recoveryVisible;
  // Private renderer feedback uses the existing bounded history and business notice owner.
  reportRenderError = (error: unknown, sourcePath: string): void => {
    if (!this.connected) return;
    const message = `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`;
    if (!this.state.diagnostics.includes(message)) this.error(new Error(message));
  };
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<UiEditorSnapshot> = {}) {
    const suites = [...this.builtinCatalog, ...(this.library?.suites ?? []).map(record => ({
      id: record.instance_id, name: record.manifest.name, builtin: false,
    }))];
    if (canonicalSuiteJson(suites) !== canonicalSuiteJson(this.state.suites)) patch = {...patch, suites};
    const next = { ...this.state, ...patch };
    this.publisher?.publish({ editorOpen: next.open, picking: next.picking,
      modalOpen: this.recoveryVisible || next.resetConfirmationOpen });
    const changed = Object.entries(patch).some(([key, value]) => {
      const before = this.state[key as keyof UiEditorSnapshot];
      return !Object.is(value, before) && canonicalSuiteJson(value) !== canonicalSuiteJson(before);
    });
    if (changed) this.state = frozen(next);
    this.listeners.forEach((listener) => listener());
  }
  private error(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'AbortError') return;
    if (!this.state.diagnostics.includes(message)) this.publish({ diagnostics: [...this.state.diagnostics.slice(-19), message] });
    this.deps.reportError?.(error);
  }
  private begin(pending: UiEditorSnapshot['pending']): { id: number; life: number } {
    const value = { id: ++this.operation, life: this.life }; this.publish({ pending }); return value;
  }
  private finish(op: { id: number; life: number }) { if (this.alive(op.life) && op.id === this.operation) this.publish({ pending: null }); }
  private alive(life: number) { return this.connected && this.life === life; }
  private edit(update: (draft: UiSuiteBundle) => void) {
    if (!this.state.draft) return false;
    try {
      const draft = detached(this.state.draft); update(draft); ++this.editRevision;
      this.publishDraft(draft, true);
      return true;
    } catch (error) { this.error(error); return false; }
  }
  private publishDraft(draft: UiSuiteBundle, dirty: boolean) {
    const known = new Map(draft.manifest.files.map((file) => [file.path, file]));
    const files = Object.entries(draft.files).map(([path, file]): UiFileDescriptor => ({
      path, kind: file.encoding === 'base64' ? 'asset' : known.get(path)?.kind ?? path.split('.').at(-1) as UiFileDescriptor['kind'],
      bytes: known.get(path)?.bytes ?? 0, sha256: known.get(path)?.sha256 ?? '0'.repeat(64),
      ...(file.encoding === 'base64' ? { media_type: file.media_type } : {}) }));
    const selection = this.state.selection;
    this.publish({ draft, dirty, files,
      ...(selection ? { selection: { ...selection, filePath: this.selectionFile(draft, selection.selector, selection.sourceKind) } } : {}),
      selectedFile: this.state.selectedFile && draft.files[this.state.selectedFile] ? this.state.selectedFile : Object.keys(draft.files)[0] ?? null });
    this.updateTargets();
  }
  connect(): () => void {
    this.connectionCleanup?.();
    const life = ++this.life; this.connected = true;
    this.publisher = this.deps.acquireInteractionPublisher(); ++this.operation; this.publish({ pending: null, picking: false });
    const owners = subscribeOwners(() => this.updateTargets());
    const language = () => this.updateTargets(); i18n.on('languageChanged', language); this.updateTargets();
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'F11' || event.key === 'F12')) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'F12') this.disable(); else this.actions.open();
      } else if (event.key === 'Escape' && this.state.picking) {
        event.preventDefault(); event.stopImmediatePropagation(); this.actions.cancelPick();
      } else if (event.key === 'Escape') {
        this.clearHighlight();
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('keydown', keydown, true);
    this.initialization = this.load(life);
    const cleanup = () => {
      owners(); i18n.off('languageChanged', language); if (typeof window !== 'undefined') window.removeEventListener('keydown', keydown, true);
      if (this.life !== life) return;
      this.connected = false; ++this.life; ++this.loads; ++this.reads; ++this.writes; ++this.activations;
      this.cancelPick(); this.clearHighlight(); for (const preview of this.previews) preview.dispose();
      this.publisher?.release(); this.publisher = null; this.disposeActivation();
      this.trusted?.prepared.dispose(); this.trusted = null; this.trustedPromise = null;
      if (this.connectionCleanup === cleanup) this.connectionCleanup = null;
    };
    this.connectionCleanup = cleanup; return cleanup;
  }
  private updateTargets(opening = false) {
    // A closed editor has no catalog consumer. Keep an active selection current
    // without reading every unrelated target; opening takes a synchronous fresh catalog.
    if (!opening && !this.state.open && !this.state.selection && !this.state.picking) return;
    const context = this.deps.getTargetContext?.() ?? {};
    const targets = opening || this.state.open
      ? listCurrentTargets(this.state.draft?.manifest.overrides.map((item) => item.selector) ?? [], context)
      : this.state.targets;
    const selector = this.state.selection?.selector;
    const anchor = this.positionAnchor && resolveSelector(this.positionAnchor);
    const anchorOwner = anchor && anchor.owners.length === 1 ? anchor.owners[0] : null;
    const current = selector ? describeTarget(selector, context) : null;
    const ownerId = selector && anchorOwner && selectorMatches(selector, anchorOwner.target, anchorOwner.locator) ? anchorOwner.ownerId : current?.ownerId ?? null;
    const currentTarget = current && ownerId !== current.ownerId ? Object.freeze({ ...current, ownerId }) : current;
    const targetAncestors = ownerId ? getTargetAncestors(ownerId, context) : [];
    const scopeChoices = ownerId ? getScopeChoices(ownerId, context) : [];
    const patch = { targets, currentTarget, targetAncestors, scopeChoices };
    if (Object.entries(patch).some(([key, value]) => {
      const before = this.state[key as keyof UiEditorSnapshot];
      return !Object.is(value, before) && canonicalSuiteJson(value) !== canonicalSuiteJson(before);
    })) this.publish(patch);
  }
  // Launcher navigation/business snapshots are supplied by the existing provider.
  refreshTargets = (): void => { if (this.connected) this.updateTargets(); };
  private initialization: Promise<void> = Promise.resolve();
  /** Completes after this connection has loaded, committed its default and activated or recovered. */
  whenInitialized = (): Promise<void> => this.initialization;
  private async load(life: number) {
    const load = ++this.loads, activation = this.activations, identity = this.draftIdentity;
    let dataLoaded = false;
    try {
      const library = await this.deps.storage.loadSuiteLibrary();
      if (!this.alive(life) || load !== this.loads) return;
      this.library = detached(library); dataLoaded = true; this.recoveryToken = null; this.publish({ loaded: true });
      await this.deps.waitForConfiguration?.();
      if (!this.alive(life) || load !== this.loads) return;
      await this.prepareTrusted(life);
      if (this.deps.waitForConfiguration) {
        const immersiveName = this.deps.getBuiltinName
          ? await this.deps.getBuiltinName('immersive')
          : (await validateSuiteBundle(await this.deps.getBuiltinBundle('immersive'))).manifest.name;
        if (!this.alive(life) || load !== this.loads) return;
        this.builtinCatalog = [{id:'builtin.modern',name:this.trusted!.bundle.manifest.name,builtin:true},
          {id:'builtin.immersive',name:immersiveName,builtin:true}];
        this.publish();
      }
      // Initialize once through the existing writer, after real source readiness.
      // Only an actual acknowledgement changes the authoritative library.
      if (this.library.active_suite_id === null && this.deps.waitForConfiguration) {
        const id = `builtin.${this.deps.getDefaultBuiltin?.() ?? 'modern'}`;
        await validateSuiteBundle(await this.deps.getBuiltinBundle(id === 'builtin.immersive' ? 'immersive' : 'modern'));
        const write = this.writes;
        await this.serialize(async () => {
          if (!this.alive(life) || load !== this.loads || write !== this.writes || !this.library)
            throw new DOMException('Superseded', 'AbortError');
          if (this.library.active_suite_id !== null) return;
          const candidate = detached(this.library); candidate.active_suite_id = id;
          const ack = await this.deps.storage.saveSuiteLibrary(candidate, this.library.revision);
          if (this.alive(life)) this.library = detached(ack);
        });
      }
      if (!this.alive(life) || load !== this.loads) return;
      const stagedParent = identity === this.draftIdentity && !this.state.draft
        ? await this.loadDraft(this.library.active_suite_id ?? `builtin.${this.deps.getDefaultBuiltin?.() ?? 'modern'}`, life, activation, true) : null;
      if (this.alive(life) && this.state.suspended && !this.activation) this.installTrusted();
      if (activation === this.activations && !this.state.suspended && this.state.draft) {
        // Reconnect replays an accepted submission, never an unsubmitted/imported draft.
        const replay = this.accepted;
        if (replay) await this.activate(replay.bundle, replay.id, replay.parent, ++this.activations, life, replay.previewing, stagedParent);
        else if (!this.state.dirty) await this.activate(this.state.draft, this.state.selectedSuiteId!, this.parent, ++this.activations, life, false, stagedParent);
        else { stagedParent?.prepared.dispose(); this.installTrusted(); }
      }
      else stagedParent?.prepared.dispose();
    } catch (error) {
      if (!this.alive(life) || load !== this.loads) return;
      if (!dataLoaded) this.library = null;
      this.error(error); this.publish({ loaded: true }); this.disable();
      if (!this.library) {
        try { const inspection = await this.deps.storage.inspectSuiteRecovery();
          if (this.alive(life) && load === this.loads) this.recoveryToken = inspection.token;
        } catch (inspectionError) { if (this.alive(life)) this.error(inspectionError); }
      }
      try { await this.prepareTrusted(life); if (this.alive(life) && !this.activation) this.installTrusted(); }
      catch (trustedError) { if (this.alive(life)) this.error(trustedError); }
    }
  }
  private async loadDraft(id: string, life: number, generation = this.activations, allowSuspendedData = false): Promise<SuiteActivationLayer | null> {
    const identity = ++this.draftIdentity;
    const record = this.library?.suites.find((item) => item.instance_id === id);
    // Runtime parent preparation precedes normal child composition. Suspended
    // recovery composes checked DATA only; it must never initialize a user parent.
    let stagedParent: SuiteActivationLayer | null = null;
    if (record?.parent_snapshot && !this.state.suspended) {
      try { stagedParent = await this.prepare(record.parent_snapshot.bundle,
        `${id}.parent.${record.parent_snapshot.digest}`, generation, life); }
      catch (error) {
        if (!(allowSuspendedData && this.state.suspended && error instanceof Error && error.name === 'AbortError')) throw error;
      }
    }
    let draft: UiSuiteBundle;
    try { draft = record ? materializeSuite(record) : await this.deps.getBuiltinBundle(id === 'builtin.immersive' ? 'immersive' : 'modern'); }
    catch (error) { stagedParent?.prepared.dispose(); throw error; }
    if (!this.alive(life) || identity !== this.draftIdentity ||
      (generation !== this.activations && !(allowSuspendedData && this.state.suspended))) { stagedParent?.prepared.dispose(); return null; }
    this.parent = detached(record?.parent_snapshot ?? null); this.editRevision = 0;
    this.publish({ selectedSuiteId: id, selection: null }); this.publishDraft(detached(draft), false);
    return stagedParent;
  }
  private scope(key: string): Promise<SuiteRuntimeScope> {
    let value = this.scopes.get(key); if (!value) { value = Promise.resolve(this.deps.createScope()); this.scopes.set(key, value); } return value;
  }
  private async prepareTrusted(life: number): Promise<SuiteActivationLayer> {
    if (this.trusted) return this.trusted;
    if (!this.trustedPromise) this.trustedPromise = (async () => {
      const bundle = await this.deps.getBuiltinBundle('modern'), scope = await this.scope('trusted.modern');
      const isCurrent = () => this.alive(life);
      if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
      const prepared = await this.deps.compile(bundle, scope, { isCurrent });
      if (!isCurrent()) { prepared.dispose(); throw new DOMException('Superseded', 'AbortError'); }
      this.trusted = { layerId: 'trusted.modern', bundle: detached(bundle), prepared }; return this.trusted;
    })();
    return this.trustedPromise;
  }
  private installTrusted() {
    if (!this.trusted) return;
    const trusted = this.trusted;
    this.activation = this.createActivation(trusted, null, trusted, []);
    this.definitionDisposals.push(publishUiDefinitions({ key: 'editor:trusted.modern', definitions: trusted.prepared.sourceDefinitions }));
    this.publish();
  }
  private createActivation(primary: SuiteActivationLayer, parent: SuiteActivationLayer | null, trusted: SuiteActivationLayer, owned: readonly SuiteActivationLayer[]): SuiteActivation {
    let retired = false;
    const listeners = new Set<() => void>();
    return {
      primary, parent, trusted,
      get retired() { return retired; },
      onRetire(listener) {
        if (retired) { listener(); return () => {}; }
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      dispose() {
        if (retired) return;
        retired = true;
        // Physical roots detach synchronously, before prepared resources release.
        // A later passive effect can observe retirement without taking a lease.
        try { for (const listener of [...listeners]) listener(); }
        finally { listeners.clear(); owned.forEach((layer) => layer.prepared.dispose()); }
      },
    };
  }
  private async prepare(bundle: UiSuiteBundle, id: string, generation: number, life: number): Promise<SuiteActivationLayer> {
    const isCurrent = () => this.alive(life) && generation === this.activations;
    if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
    const scope = await this.scope(id);
    if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
    const prepared = await this.deps.compile(bundle, scope, { isCurrent });
    if (!isCurrent()) { prepared.dispose(); throw new DOMException('Superseded', 'AbortError'); }
    return { layerId: id, bundle: detached(bundle), prepared };
  }
  private async prepareActivation(draft: UiSuiteBundle, id: string, parent: UiSuiteRecord['parent_snapshot'], generation: number, life: number, stagedParent: SuiteActivationLayer | null = null): Promise<SuiteActivation> {
    const layers: SuiteActivationLayer[] = stagedParent ? [stagedParent] : [];
    try {
      const trusted = await this.prepareTrusted(life), trustedBundle = trusted.bundle;
      const parentLayer = stagedParent ?? (parent ? await this.prepare(parent.bundle, `${id}.parent.${parent.digest}`, generation, life) : null);
      if (parentLayer && !stagedParent) layers.push(parentLayer);
      const primary = id === 'builtin.modern' && canonicalSuiteJson(draft) === canonicalSuiteJson(trustedBundle)
        ? trusted : await this.prepare(draft, id, generation, life);
      if (primary !== trusted) layers.push(primary);
      return this.createActivation(primary, parentLayer, trusted, layers);
    } catch (error) { layers.forEach((layer) => layer.prepared.dispose()); throw error; }
  }
  private install(candidate: SuiteActivation, previewing: boolean, id: string, parentSnapshot: UiSuiteRecord['parent_snapshot']) {
    const previous = this.activation;
    this.definitionDisposals.splice(0).forEach((dispose) => dispose());
    this.activation = candidate;
    this.accepted = { bundle: detached(candidate.primary.bundle), id, parent: detached(parentSnapshot), previewing };
    for (const layer of [candidate.primary, candidate.parent, candidate.trusted]) if (layer) this.definitionDisposals.push(publishUiDefinitions({ key: `editor:${layer.layerId}`, definitions: layer.prepared.sourceDefinitions }));
    this.publish({ previewing, suspended: false }); previous?.dispose();
    // The next frame reads the committed real roots/styles. Draft publication never calls this.
    for (const preview of this.previews) preview.refresh();
  }
  private async activate(draft: UiSuiteBundle, id: string, parent: UiSuiteRecord['parent_snapshot'], generation: number, life: number, previewing: boolean, stagedParent: SuiteActivationLayer | null = null) {
    const candidate = await this.prepareActivation(draft, id, parent, generation, life, stagedParent);
    if (!this.alive(life) || generation !== this.activations) { candidate.dispose(); return; }
    this.install(candidate, previewing, id, parent);
  }
  private disposeActivation() { this.definitionDisposals.splice(0).forEach((dispose) => dispose()); this.activation?.dispose(); this.activation = null; }
  private disable() {
    this.cancelPick(); this.clearHighlight();
    ++this.activations; this.disposeActivation(); this.installTrusted(); this.recoveryVisible = true;
    this.publish({ suspended: true, previewing: false, picking: false });
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> { const work = this.persistence.then(run, run); this.persistence = work.catch(() => {}); return work; }
  private async submit(persist: boolean): Promise<boolean> {
    if (!this.state.loaded || !this.state.draft) return false;
    const op = this.begin(persist ? 'save' : 'preview'), identity = this.draftIdentity, revision = this.editRevision;
    const captured = detached(this.state.draft), parent = detached(this.parent), id = this.state.selectedSuiteId;
    const generation = ++this.activations, write = this.writes;
    let candidate: SuiteActivation | null = null;
    try {
      if (!id || (persist && id.startsWith('builtin.'))) throw new Error('Copy the builtin suite before saving');
      const normalized = await normalizeDraftBundle(captured);
      candidate = await this.prepareActivation(normalized, id, parent, generation, op.life);
      if (persist) {
        const ack = await this.serialize(async () => {
          if (!this.alive(op.life) || write !== this.writes || !this.library) throw new DOMException('Superseded', 'AbortError');
          const current = detached(this.library), record = draftToSuiteRecord(normalized, id, parent);
          const index = current.suites.findIndex((item) => item.instance_id === id);
          if (index < 0) current.suites.push(record); else current.suites[index] = record;
          current.active_suite_id = id;
          const ack = await this.deps.storage.saveSuiteLibrary(current, this.library.revision);
          if (this.alive(op.life)) this.library = detached(ack);
          return ack;
        });
        if (!this.alive(op.life)) return false;
        if (identity === this.draftIdentity && revision === this.editRevision) {
          this.parent = detached(ack.suites.find((item) => item.instance_id === id)?.parent_snapshot ?? parent);
          this.publishDraft(normalized, false);
        }
      }
      if (!this.alive(op.life) || generation !== this.activations) return persist;
      this.recoveryVisible = false; this.install(candidate, !persist, id, parent); candidate = null; return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; }
    finally { candidate?.dispose(); this.finish(op); }
  }
  private async selectSuite(id: string): Promise<boolean> {
    if (!this.library || (!['builtin.modern', 'builtin.immersive'].includes(id) && !this.library.suites.some((item) => item.instance_id === id))) return false;
    const op = this.begin('save'), generation = ++this.activations, write = this.writes;
    try {
      const ack = await this.serialize(async () => {
        if (!this.alive(op.life) || write !== this.writes || !this.library) throw new DOMException('Superseded', 'AbortError');
        const candidate = detached(this.library); candidate.active_suite_id = id;
        const ack = await this.deps.storage.saveSuiteLibrary(candidate, this.library.revision);
        if (this.alive(op.life)) this.library = detached(ack); return ack;
      });
      if (!this.alive(op.life) || write !== this.writes) return false;
      if (generation !== this.activations) return true;
      const stagedParent = await this.loadDraft(ack.active_suite_id!, op.life, generation);
      if (this.state.draft && generation === this.activations) { this.recoveryVisible = false; await this.activate(this.state.draft, id, this.parent, generation, op.life, false, stagedParent); }
      else stagedParent?.prepared.dispose();
      return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private async copyBuiltin(id: 'modern' | 'immersive', name: string): Promise<void> {
    const op = this.begin('import'), identity = this.draftIdentity, revision = this.editRevision;
    try {
      const parentBundle = await validateSuiteBundle(await this.deps.getBuiltinBundle(id));
      const digest = await bundleDigest(parentBundle);
      if (!this.alive(op.life) || identity !== this.draftIdentity || revision !== this.editRevision) return;
      ++this.draftIdentity; ++this.editRevision;
      const draft = detached(parentBundle); const instanceId = crypto.randomUUID(); draft.manifest.id = crypto.randomUUID(); draft.manifest.name = name;
      this.parent = { digest, bundle: parentBundle }; this.publish({ selectedSuiteId: instanceId, selection: null }); this.publishDraft(draft, true);
    } catch (error) { if (this.alive(op.life)) this.error(error); } finally { this.finish(op); }
  }
  // Explicit host/editor integration seam; ordinary editing never retargets inheritance.
  async replaceParent(bundle: UiSuiteBundle): Promise<boolean> {
    if (!this.state.draft || !this.state.selectedSuiteId) return false;
    const identity = this.draftIdentity, revision = this.editRevision, op = this.begin('import');
    const captured = detached(this.state.draft), previous = detached(this.parent), id = this.state.selectedSuiteId;
    try {
      const checked = await validateSuiteBundle(bundle), digest = await bundleDigest(checked);
      if (!this.alive(op.life) || identity !== this.draftIdentity || revision !== this.editRevision) return false;
      const old = draftToSuiteRecord(captured, id, previous), files = detached(checked.files);
      for (const path of old.deleted) if (Object.hasOwn(files, path)) delete files[path];
      Object.assign(files, old.overlay); uniqueSuitePaths(Object.keys(files));
      this.parent = { digest, bundle: checked }; ++this.editRevision;
      this.publishDraft({ manifest: captured.manifest, files }, true); return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  restoreFile(path: string, replacement?: UiFile): void {
    const inherited = this.parent?.bundle.files[path];
    if (!inherited) return;
    this.edit((draft) => { draft.files[path] = detached(replacement ?? inherited); uniqueSuitePaths(Object.keys(draft.files)); });
  }
  private async revert(): Promise<boolean> {
    if (!this.state.selectedSuiteId || !this.library) return false;
    const op = this.begin('revert'), generation = ++this.activations, id = this.state.selectedSuiteId;
    try {
      const stagedParent = await this.loadDraft(id, op.life, generation);
      if (!this.alive(op.life) || generation !== this.activations || !this.state.draft) { stagedParent?.prepared.dispose(); return false; }
      this.recoveryVisible = false; await this.activate(this.state.draft, id, this.parent, generation, op.life, false, stagedParent); return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private async importSource(file: File): Promise<boolean> {
    const path = this.state.selectedFile, identity = this.draftIdentity, original = path ? this.state.draft?.files[path] : null;
    if (!path || original?.encoding !== 'utf8') return false;
    const op = this.begin('import'), read = ++this.reads;
    try {
      if (file.size > suiteLimits.source) throw new Error('Source exceeds limit');
      const text = await file.text();
      if (!this.alive(op.life) || identity !== this.draftIdentity || read !== this.reads || canonicalSuiteJson(this.state.draft?.files[path] ?? null) !== canonicalSuiteJson(original)) return false;
      this.actions.patchFile(path, text); return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private async addAsset(file: File): Promise<boolean> {
    const identity = this.draftIdentity, path = file.name, op = this.begin('asset'), read = ++this.reads;
    try {
      validateSuitePath(path); if (file.size > suiteLimits.asset) throw new Error('Asset exceeds limit');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!this.alive(op.life) || identity !== this.draftIdentity || read !== this.reads) return false;
      return this.edit((draft) => { if (Object.hasOwn(draft.files, path)) throw new Error('File already exists'); uniqueSuitePaths([...Object.keys(draft.files), path]);
        draft.files[path] = { encoding: 'base64', media_type: file.type, data: encodeBase64(bytes) }; });
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private async importBundle(file: File): Promise<boolean> {
    const identity = this.draftIdentity, revision = this.editRevision, op = this.begin('import'), read = ++this.reads;
    try {
      if (file.size > suiteLimits.total) throw new Error('Bundle input exceeds limit');
      const bundle = await decodeSuiteArchive(new Uint8Array(await file.arrayBuffer()));
      if (!this.alive(op.life) || identity !== this.draftIdentity || revision !== this.editRevision || read !== this.reads) return false;
      ++this.draftIdentity; ++this.editRevision; this.parent = null;
      this.publish({ selectedSuiteId: crypto.randomUUID(), selection: null }); this.publishDraft(bundle, true); return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private async exportSource() {
    const path = this.state.selectedFile, source = path ? this.state.draft?.files[path] : null;
    if (!path || source?.encoding !== 'utf8' || !this.state.draft) return;
    const captured = detached(this.state.draft), op = this.begin('export');
    try {
      const normalized = await normalizeDraftBundle(captured), file = normalized.files[path];
      if (this.alive(op.life) && file.encoding === 'utf8') await this.deps.exportFile(path.split('/').at(-1)!, utf8(file.text));
    } catch (error) { if (this.alive(op.life)) this.error(error); } finally { this.finish(op); }
  }
  private async exportDraft() {
    if (!this.state.draft) return; const captured = detached(this.state.draft), op = this.begin('export');
    try { const normalized = await normalizeDraftBundle(captured); const bytes = await encodeSuiteArchive(normalized);
      if (this.alive(op.life)) await this.deps.exportFile(`${normalized.manifest.name}.paradox-ui`, bytes);
    } catch (error) { if (this.alive(op.life)) this.error(error); } finally { this.finish(op); }
  }
  private async exportRecoverable() {
    const captured = detached(this.state.draft), op = this.begin('export');
    try {
      const raw = await this.deps.storage.readRecoverableLibrary();
      if (!this.alive(op.life)) return;
      await this.deps.exportFile('ui-suite-library.recoverable.bin', raw);
      if (captured) await this.deps.exportFile('ui-suite-draft.recoverable.json', utf8(JSON.stringify(captured)));
    } catch (error) { if (this.alive(op.life)) this.error(error); } finally { this.finish(op); }
  }
  private requestReset(owner: 'normal' | 'recovery') { this.confirmation = owner; this.publish({ resetConfirmationOpen: true }); }
  private async reset(owner: 'normal' | 'recovery'): Promise<boolean> {
    if (this.confirmation !== owner) { if (owner === 'recovery') this.requestReset(owner); return false; }
    const op = this.begin('reset'), generation = ++this.activations, write = ++this.writes; ++this.loads; ++this.reads;
    try {
      const ack = await this.serialize(async () => {
        if (!this.alive(op.life) || write !== this.writes) throw new DOMException('Superseded', 'AbortError');
        const ack = this.library ? await this.deps.storage.resetSuiteLibrary(this.library.revision)
          : await this.deps.storage.resetRecoverableSuiteLibrary(this.recoveryToken ?? (await this.deps.storage.inspectSuiteRecovery()).token);
        if (this.alive(op.life)) this.library = detached(ack); return ack;
      });
      if (!this.alive(op.life) || write !== this.writes) return false;
      this.confirmation = null; this.recoveryToken = null; this.publish({ loaded: true, resetConfirmationOpen: false });
      if (generation !== this.activations) return true;
      this.disposeActivation(); this.recoveryVisible = false; ++this.draftIdentity; this.parent = null;
      this.publish({ draft: null, files: [], dirty: false, selectedSuiteId: ack.active_suite_id, selectedFile: null, selection: null, diagnostics: [], previewing: false });
      await this.loadDraft(ack.active_suite_id ?? 'builtin.modern', op.life);
      if (this.state.draft && generation === this.activations) await this.activate(this.state.draft, this.state.selectedSuiteId!, null, generation, op.life, false);
      return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private selectTarget(selector: UiSelector) {
    this.clearHighlight();
    if (selector.kind === 'position') this.positionAnchor = detached(selector);
    else if (this.positionAnchor?.kind === 'position' && !selectorMatches(selector, this.positionAnchor.target, this.positionAnchor.locator)) this.positionAnchor = null;
    const binding = this.state.draft?.manifest.overrides.find((item) => sameSelector(item.selector, selector));
    const filePath = binding?.entry ?? binding?.stylesheet ?? null;
    const sourcePath = describeTarget(selector, this.deps.getTargetContext?.()).sourcePath;
    const selectedFile = filePath && this.state.draft?.files[filePath] ? filePath : sourcePath && this.state.draft?.files[sourcePath] ? sourcePath : this.state.selectedFile;
    this.publish({ selection: { selector: detached(selector), scope: selector.kind, filePath: binding?.entry ?? binding?.stylesheet ?? null,
      sourceKind: binding?.entry?.endsWith('.html') ? 'html' : binding?.entry ? 'tsx' : 'css' }, selectedFile });
    this.updateTargets();
    for (const preview of this.previews) preview.refresh();
  }
  private selectionFile(draft: UiSuiteBundle | null, selector: UiSelector, kind: UiEditorSourceKind): string | null {
    const binding = draft?.manifest.overrides.find(item => sameSelector(item.selector, selector));
    const path = kind === 'css' ? binding?.stylesheet : binding?.entry;
    if (!path || !draft?.files[path]) return null;
    const descriptor = draft.manifest.files.find(file => file.path === path);
    return (descriptor?.kind ?? path.split('.').at(-1)) === kind ? path : null;
  }
  private setSourceKind(kind: UiEditorSourceKind) {
    const selection = this.state.selection;
    if (!selection || !['css', 'html', 'tsx'].includes(kind)) return;
    const filePath = this.selectionFile(this.state.draft, selection.selector, kind);
    this.publish({ selection: { ...selection, sourceKind: kind, filePath }, selectedFile: filePath });
  }
  private async createSelectionOverride(kind: UiEditorSourceKind): Promise<boolean> {
    const selection = this.state.selection, suiteId = this.state.selectedSuiteId;
    if (!selection || !suiteId || !this.state.draft || !['css', 'html', 'tsx'].includes(kind)) return false;
    const selector = detached(selection.selector), identity = this.draftIdentity;
    const selectedFile = this.state.selectedFile, original = this.state.draft.manifest.overrides.find(item => sameSelector(item.selector, selector));
    const capturedBinding = canonicalSuiteJson(original ?? null), read = ++this.reads, op = this.begin('import');
    try {
      // Use the same complete-selector digest as the stylesheet/ref adapter. The
      // yield keeps this public async operation within the existing read fences.
      const digest = await Promise.resolve(selectorDigest(selector));
      if (!this.alive(op.life) || identity !== this.draftIdentity || read !== this.reads || suiteId !== this.state.selectedSuiteId || !this.state.draft) return false;
      const current = this.state.draft.manifest.overrides.find(item => sameSelector(item.selector, selector));
      if (canonicalSuiteJson(current ?? null) !== capturedBinding) return false;
      const prefix = `overrides/${digest}/`;
      const existing = this.selectionFile(this.state.draft, selector, kind);
      if (!existing && this.state.draft.manifest.overrides.some(item => !sameSelector(item.selector, selector) &&
        (selectorDigest(item.selector) === digest || [item.entry, item.stylesheet].some(path => path?.startsWith(prefix)))))
        throw new Error(String(i18n.t('uiInspector.overrideCollision')));
      const path = existing ?? `${prefix}${kind === 'css' ? 'style.css' : kind === 'html' ? 'View.html' : 'View.tsx'}`;
      const file = this.state.draft.files[path], descriptor = this.state.draft.manifest.files.find(item => item.path === path);
      if (file && (file.encoding !== 'utf8' || (descriptor?.kind ?? path.split('.').at(-1)) !== kind))
        throw new Error(String(i18n.t('uiInspector.overrideFileConflict')));
      const openCaptured = this.state.selection && sameSelector(this.state.selection.selector, selector) &&
        this.state.selection.sourceKind === selection.sourceKind && this.state.selection.filePath === selection.filePath && this.state.selectedFile === selectedFile;
      if (existing) {
        if (openCaptured) this.publish({ selection: { ...selection, sourceKind: kind, filePath: path }, selectedFile: path });
        return true;
      }
      // Clone the latest captured draft, preserving unrelated edits made during
      // the yield. One existing edit publishes the ordinary file and full binding.
      this.edit(draft => {
        if (!file) {
          uniqueSuitePaths([...Object.keys(draft.files), path]);
          const text = kind === 'css' ? '/* Styles for this selector\'s current roots. */\n' : kind === 'html' ? '<ui-slot></ui-slot>\n' :
            'export default function TargetOverride({ props, children, Original }) {\n  return <Original {...props}>{children}</Original>;\n}\n';
          draft.files[path] = { encoding: 'utf8', text };
          draft.manifest.files.push({ path, kind, bytes: 0, sha256: '0'.repeat(64) });
        }
        const binding = draft.manifest.overrides.find(item => sameSelector(item.selector, selector)) ??
          { selector, enabled: true, entry: null, stylesheet: null };
        if (!draft.manifest.overrides.includes(binding)) draft.manifest.overrides.push(binding);
        if (kind === 'css') binding.stylesheet = path; else binding.entry = path;
      });
      if (this.selectionFile(this.state.draft, selector, kind) !== path) return false;
      if (openCaptured) this.publish({ selection: { ...selection, sourceKind: kind, filePath: path }, selectedFile: path });
      return true;
    } catch (error) { if (this.alive(op.life)) this.error(error); return false; } finally { this.finish(op); }
  }
  private clearHighlight() { this.highlightAbort?.abort(); this.highlightAbort = null; this.highlightCleanup?.(); this.highlightCleanup = null; }
  private cancelPick() {
    const cleanup = this.pickerCleanup;
    cleanup?.(); this.publish({ picking: false });
  }
  private beginPick() {
    if (!this.connected || this.pickerCleanup) return;
    this.clearHighlight(); this.publish({ picking: true });
    this.pickerCleanup = startPicker({
      onHover: target => { if (target) this.selectTarget(target.selector); },
      onSelect: selector => { this.selectTarget(selector); this.publish({ picking: false }); },
      onCancel: () => this.publish({ picking: false }),
      onEnd: () => { this.pickerCleanup = null; },
      getSelector: () => this.state.selection?.selector ?? null,
      subscribeSelection: this.subscribe,
      getContext: () => this.deps.getTargetContext?.() ?? {},
    });
  }
  private setScope(scope: 'position' | 'business' | 'type') {
    const selection = this.state.selection; if (!selection) return;
    if (scope === selection.selector.kind) { this.publish({ selection: { ...selection, scope } }); return; }
    if (scope === 'type') this.selectTarget({ kind: 'type', target: selection.selector.target });
    else if (scope === 'position' && this.positionAnchor?.target === selection.selector.target) this.selectTarget(this.positionAnchor);
    else if (scope === 'business') {
      const choices = this.state.scopeChoices.filter((item) => item.selector.kind === 'business');
      if (choices.length === 1) this.selectTarget(choices[0].selector);
      else this.error(new Error(String(i18n.t(choices.length ? 'uiInspector.chooseBusiness' : 'uiInspector.noBusiness'))));
    }
  }
}
// eslint-disable-next-line react-refresh/only-export-components
export const UiEditorControllerContext = createContext<UiEditorController | null>(null);
// eslint-disable-next-line react-refresh/only-export-components
export function useUiEditorController(): UiEditorController { const value = useContext(UiEditorControllerContext); if (!value) throw new Error('UiEditorProvider is missing.'); return value; }
// eslint-disable-next-line react-refresh/only-export-components
export function useSuiteActivation(): SuiteActivation | null {
  const controller = useUiEditorController();
  return useSyncExternalStore(controller.subscribe, controller.getActivation, controller.getActivation);
}
function exportFile(name: string, bytes: Uint8Array): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer]));
  try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  return Promise.resolve();
}
export function UiEditorProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { services } = useLauncherCompatibility(); const source = useContext(UiEditorSourceContext);
  const launcherSnapshot = useLauncherSnapshot();
  const [current] = useState(() => {
    let ready!: () => void;
    const configuration = new Promise<void>((resolve) => { ready = resolve; });
    return { services, source, configuration, ready, snapshot: launcherSnapshot };
  }); current.services = services; current.source = source; current.snapshot = launcherSnapshot;
  useEffect(() => { if (launcherSnapshot.config.ready) current.ready(); }, [current, launcherSnapshot.config.ready]);
  const [controller] = useState(() => createUiEditorController({ storage,
    getBuiltinBundle: (id) => { if (!current.source) throw new Error('Builtin source services are missing'); return current.source.getBuiltinBundle(id); },
    getBuiltinName: async (id) => {
      if (!current.source) throw new Error('Builtin source services are missing');
      return current.source.getBuiltinName
        ? current.source.getBuiltinName(id)
        : (await current.source.getBuiltinBundle(id)).manifest.name;
    },
    createScope: async () => (await import('../ui-suite/prepared')).createSuiteRuntimeScope(),
    compile: async (bundle, scope, options) => (await import('../ui-suite/compiler')).compileSuiteInScope(bundle, scope, options),
    exportFile, acquireInteractionPublisher: () => current.services.acquireInteractionPublisher(),
    reportError: (error) => current.services.launcher.reportError(error),
    getDefaultBuiltin: () => current.services.launcher.getGuardState().config?.settings.appearance.interface_style === 'immersive' ? 'immersive' : 'modern',
    waitForConfiguration: () => current.configuration,
    getTargetContext: () => ({ routes: current.snapshot.navigation.routes.map((route) => route.id),
      businessNames: [...current.snapshot.profiles.items.map(({ profile }) => ({ namespace: 'profile', value: profile.instance_key, name: profile.name })),
        ...current.snapshot.accounts.state.accounts.map((account) => ({ namespace: 'account', value: account.id, name: account.name }))] }),
    safe: typeof location !== 'undefined' && new URLSearchParams(location.search).get('ui-safe') === '1',
  }));
  useEffect(() => controller.connect(), [controller, services.acquireInteractionPublisher]);
  useEffect(() => controller.refreshTargets(), [controller, launcherSnapshot.navigation, launcherSnapshot.profiles, launcherSnapshot.accounts]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Accessible names and rectangles reflect the committed normal editor DOM.
  // Equality-checked catalog publication reaches a fixed point after that commit.
  useEffect(() => controller.refreshTargets(), [controller, snapshot]);
  return <UiEditorControllerContext.Provider value={controller}>
    <UiEditorActionsContext.Provider value={controller.actions}>
      <UiEditorSnapshotContext.Provider value={snapshot}><UiInteractionContext.Provider value={{ editing: snapshot.open }}>{children}</UiInteractionContext.Provider></UiEditorSnapshotContext.Provider>
    </UiEditorActionsContext.Provider>
  </UiEditorControllerContext.Provider>;
}
