/** @jsxImportSource react */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DeepReadonly } from '../launcher/public/types';
import type { LauncherInteractionPublisher } from '../launcher/services';
import type * as storage from '../ui-suite/storage';
import { bundleDigest, materializeSuite, validateSuiteBundle } from '../ui-suite/bundle';
import { canonicalSuiteJson, utf8 } from '../ui-suite/canonical';
import { uniqueSuitePaths, validateSuitePath } from '../ui-suite/paths';
import type { UiFile, UiSelector, UiSuiteBundle, UiSuiteLibrary, UiSuiteRecord } from '../ui-suite/model';
import type { SuiteRuntimeScope } from '../ui-suite/prepared';
import { publishUiDefinitions, subscribeOwners } from '../customization/ownership';
import { sameSelector } from '../customization/selectors';
import { createDomPreview, locateTarget } from '../customization/dom-preview';
import { startPicker } from '../customization/picker';
import i18n from '../i18n';
import type { DomPreviewHandle, UiEditorActions, UiEditorSnapshot, UiEditorSourceKind } from './public';
import { detached, frozen, draftToSuiteRecord } from './controller-model';
import type { RecoveryActions, SuiteActivation, SuiteActivationLayer, UiEditorDependencies } from './controller-model';
import { createActivation } from './activation';
import { createPreparation } from './preparation';
import { createSelection } from './selection';
import {inheritedFileDescriptors} from './file-operations';
import {createSourceOperations} from './source-operations';
import {createPersistence} from './persistence';
// eslint-disable-next-line react-refresh/only-export-components -- Stable editor barrel keeps the existing model and source-context imports.
export { UiEditorSourceContext, draftToSuiteRecord } from './controller-model';
export type { RecoveryActions, UiEditorSourceServices, SuiteActivationLayer, SuiteActivation, UiEditorDependencies } from './controller-model';
export { UiEditorProvider } from './provider';
// eslint-disable-next-line react-refresh/only-export-components
export function createUiEditorController(deps: UiEditorDependencies) { return new UiEditorController(deps); }
// eslint-disable-next-line react-refresh/only-export-components -- Shared editor model is exported beside its provider.
export class UiEditorController {
  private state: UiEditorSnapshot;
  private library: UiSuiteLibrary | null = null;
  private initialSelectionRequired = false;
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
  private readonly persistenceOperations:ReturnType<typeof createPersistence>;
  private readonly sourceOperations:ReturnType<typeof createSourceOperations>;
  private readonly preparation:ReturnType<typeof createPreparation>;
  private readonly selectionOperations:ReturnType<typeof createSelection>;
  constructor(private readonly deps: UiEditorDependencies) {
    const owner = () => this;
    this.persistenceOperations=createPersistence({deps, get state(){return owner().state;},
      get library(){return owner().library;},set library(value){owner().library=value;},
      get parent(){return owner().parent;},set parent(value){owner().parent=value;},
      get draftIdentity(){return owner().draftIdentity;},set draftIdentity(value){owner().draftIdentity=value;},
      get editRevision(){return owner().editRevision;},set editRevision(value){owner().editRevision=value;},
      get activations(){return owner().activations;},set activations(value){owner().activations=value;},
      get writes(){return owner().writes;},set writes(value){owner().writes=value;},
      get loads(){return owner().loads;},set loads(value){owner().loads=value;},
      get reads(){return owner().reads;},set reads(value){owner().reads=value;},
      get initialSelectionRequired(){return owner().initialSelectionRequired;},set initialSelectionRequired(value){owner().initialSelectionRequired=value;},
      get recoveryVisible(){return owner().recoveryVisible;},set recoveryVisible(value){owner().recoveryVisible=value;},
      get recoveryToken(){return owner().recoveryToken;},set recoveryToken(value){owner().recoveryToken=value;},
      get confirmation(){return owner().confirmation;},set confirmation(value){owner().confirmation=value;},
      begin:pending=>owner().begin(pending),finish:op=>owner().finish(op),alive:life=>owner().alive(life),error:error=>owner().error(error),
      publish:patch=>owner().publish(patch),publishDraft:(draft,dirty)=>owner().publishDraft(draft,dirty),serialize:run=>owner().serialize(run),
      prepareActivation:(draft,id,parent,generation,life,stagedParent)=>owner().prepareActivation(draft,id,parent,generation,life,stagedParent),
      install:(candidate,previewing,id,parent)=>owner().install(candidate,previewing,id,parent),disable:()=>owner().disable(),
      requestReset:mode=>owner().requestReset(mode),disposeActivation:()=>owner().disposeActivation(),
      loadDraft:(id,life,generation)=>owner().loadDraft(id,life,generation),activate:(draft,id,parent,generation,life,previewing)=>owner().activate(draft,id,parent,generation,life,previewing),
    });
    this.sourceOperations=createSourceOperations({deps,
      get state(){return owner().state;}, get draftIdentity(){return owner().draftIdentity;},set draftIdentity(value){owner().draftIdentity=value;},
      get editRevision(){return owner().editRevision;}, set editRevision(value){owner().editRevision=value;},
      get reads(){return owner().reads;}, set reads(value){owner().reads=value;},
      get parent(){return owner().parent;}, set parent(value){owner().parent=value;},
      begin:pending=>owner().begin(pending),finish:op=>owner().finish(op),alive:life=>owner().alive(life),
      error:error=>owner().error(error),edit:update=>owner().edit(update),publish:patch=>owner().publish(patch),
      publishDraft:(draft,dirty)=>owner().publishDraft(draft,dirty),
      selectionFile:(draft,selector,kind)=>owner().selectionFile(draft,selector,kind),patchFile:(path,text)=>owner().actions.patchFile(path,text),
    });
    this.selectionOperations=createSelection({ deps,
      get state(){return owner().state;}, set state(value){owner().state=value;},
      get positionAnchor(){return owner().positionAnchor;}, set positionAnchor(value){owner().positionAnchor=value;},
      publish:patch=>owner().publish(patch), clearHighlight:()=>owner().clearHighlight(),
      updateTargets:opening=>owner().updateTargets(opening), selectTarget:selector=>owner().selectTarget(selector),
      selectionFile:(draft,selector,kind)=>owner().selectionFile(draft,selector,kind),
      previews:owner().previews, error:error=>owner().error(error),
    });
    this.preparation = createPreparation({ deps,
      get scopes(){return owner().scopes;}, set scopes(value){owner().scopes=value;},
      get trusted(){return owner().trusted;}, set trusted(value){owner().trusted=value;},
      get trustedPromise(){return owner().trustedPromise;}, set trustedPromise(value){owner().trustedPromise=value;},
      get activations(){return owner().activations;}, alive:life=>owner().alive(life),
    });
    this.state = frozen({ open: false, mode: 'normal', loaded: false, initialSelectionRequired: false, draft: null, dirty: false, selectedSuiteId: null,
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
  // App may fail before a SuiteProvider exists; use the same permanent Recovery owner.
  reportPreparationFailure = (error: unknown): void => {
    if (!this.connected) return;
    this.error(error); this.disable();
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
    const files = inheritedFileDescriptors(draft);
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
  private updateTargets(opening = false){ return this.selectionOperations.updateTargets(opening); }
  // Launcher navigation/business snapshots are supplied by the existing provider.
  refreshTargets = (): void => { if (this.connected) this.updateTargets(); };
  private initialization: Promise<void> = Promise.resolve();
  /** Completes after this connection has loaded and reached source choice, activation or Recovery. */
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
      if (!this.alive(life) || load !== this.loads) return;
      const ordinary = activation === this.activations && !this.state.suspended;
      const pristine = this.library.revision === 0 && this.library.active_suite_id === null && this.library.suites.length === 0;
      if (ordinary && this.deps.waitForConfiguration && (pristine || this.initialSelectionRequired)) {
        this.initialSelectionRequired = true;
        this.publish({ initialSelectionRequired: true });
        if (!this.state.draft) await this.loadDraft('builtin.modern', life, activation);
        if (this.alive(life) && activation === this.activations && !this.activation) this.installTrusted();
        return;
      }
      // A reset/non-pristine library retains the ordinary default-selection behavior.
      if (ordinary && !pristine && this.library.active_suite_id === null && this.deps.waitForConfiguration) {
        await this.selectSuite(`builtin.${this.deps.getDefaultBuiltin?.() ?? 'modern'}`);
        return;
      }
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
  private async prepareTrusted(life: number): Promise<SuiteActivationLayer>{ return this.preparation.prepareTrusted(life); }
  private installTrusted() {
    if (!this.trusted) return;
    const trusted = this.trusted;
    this.activation = createActivation(trusted, null, trusted, []);
    this.definitionDisposals.push(publishUiDefinitions({ key: 'editor:trusted.modern', definitions: trusted.prepared.sourceDefinitions }));
    this.publish();
  }
  private async prepare(bundle: UiSuiteBundle, id: string, generation: number, life: number): Promise<SuiteActivationLayer>{ return this.preparation.prepare(bundle, id, generation, life); }
  private async prepareActivation(draft: UiSuiteBundle, id: string, parent: UiSuiteRecord['parent_snapshot'], generation: number, life: number, stagedParent: SuiteActivationLayer | null = null): Promise<SuiteActivation>{ return this.preparation.prepareActivation(draft, id, parent, generation, life, stagedParent); }
  private install(candidate: SuiteActivation, previewing: boolean, id: string, parentSnapshot: UiSuiteRecord['parent_snapshot']) {
    const previous = this.activation, accepted = this.accepted, state = this.state;
    const publishDefinitions = (activation: SuiteActivation) => {
      // Read every prepared definition before replacing any publication.
      const publications = [activation.primary, activation.parent, activation.trusted].filter(layer => layer !== null)
        .map(layer => ({ key: `editor:${layer.layerId}`, definitions: layer.prepared.sourceDefinitions }));
      const disposals: (() => void)[] = [];
      try { for (const publication of publications) disposals.push(publishUiDefinitions(publication)); }
      catch (error) { disposals.forEach(dispose => dispose()); throw error; }
      return disposals;
    };
    const nextAccepted = { bundle: detached(candidate.primary.bundle), id, parent: detached(parentSnapshot), previewing };
    let nextDefinitions: (() => void)[] = [];
    try {
      nextDefinitions = publishDefinitions(candidate);
      this.activation = candidate; this.accepted = nextAccepted;
      this.publish({ previewing, suspended: false });
    } catch (error) {
      nextDefinitions.forEach(dispose => dispose());
      this.activation = previous; this.accepted = accepted; this.state = state;
      // Matching layer keys can have replaced a previous definition token.
      this.definitionDisposals.splice(0).forEach(dispose => dispose());
      if (previous) this.definitionDisposals = publishDefinitions(previous);
      throw error;
    }
    this.definitionDisposals.splice(0).forEach(dispose => dispose());
    this.definitionDisposals = nextDefinitions;
    previous?.dispose();
    // Preview feedback cannot reject an installation that already owns the roots.
    for (const preview of this.previews) { try { preview.refresh(); } catch (error) { this.error(error); } }
  }
  private async activate(draft: UiSuiteBundle, id: string, parent: UiSuiteRecord['parent_snapshot'], generation: number, life: number, previewing: boolean, stagedParent: SuiteActivationLayer | null = null) {
    const candidate = await this.prepareActivation(draft, id, parent, generation, life, stagedParent);
    if (!this.alive(life) || generation !== this.activations) { candidate.dispose(); return; }
    try { this.install(candidate, previewing, id, parent); }
    catch (error) { candidate.dispose(); throw error; }
  }
  private disposeActivation() { this.definitionDisposals.splice(0).forEach((dispose) => dispose()); this.activation?.dispose(); this.activation = null; }
  private disable() {
    this.cancelPick(); this.clearHighlight();
    ++this.activations; this.disposeActivation(); this.installTrusted(); this.recoveryVisible = true;
    this.publish({ suspended: true, previewing: false, picking: false });
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> { const work = this.persistence.then(run, run); this.persistence = work.catch(() => {}); return work; }
  private submit(persist: boolean){return this.persistenceOperations.submit(persist);}
  private selectSuite(id: string){return this.persistenceOperations.selectSuite(id);}
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
  private importSource(file: File){return this.sourceOperations.importSource(file);}
  private addAsset(file: File){return this.sourceOperations.addAsset(file);}
  private importBundle(file: File){return this.sourceOperations.importBundle(file);}
  private exportSource(){return this.sourceOperations.exportSource();}
  private exportDraft(){return this.sourceOperations.exportDraft();}
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
  private reset(owner: 'normal' | 'recovery'){return this.persistenceOperations.reset(owner);}
  private selectTarget(selector: UiSelector){ return this.selectionOperations.selectTarget(selector); }
  private selectionFile(draft: UiSuiteBundle | null, selector: UiSelector, kind: UiEditorSourceKind): string | null{ return this.selectionOperations.selectionFile(draft, selector, kind); }
  private setSourceKind(kind: UiEditorSourceKind){ return this.selectionOperations.setSourceKind(kind); }
  private createSelectionOverride(kind: UiEditorSourceKind){return this.sourceOperations.createSelectionOverride(kind);}
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
  private setScope(scope: 'position' | 'business' | 'type'){ return this.selectionOperations.setScope(scope); }
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
