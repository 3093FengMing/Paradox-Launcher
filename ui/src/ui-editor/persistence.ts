import { materializeSuite, normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSuiteBundle, UiSuiteLibrary, UiSuiteRecord } from '../ui-suite/model';
import type * as storage from '../ui-suite/storage';
import type { UiEditorSnapshot } from './public';
import { detached, draftToSuiteRecord } from './controller-model';
import type {
  UiEditorDependencies,
  SuiteActivation,
  SuiteActivationLayer,
} from './controller-model';
interface PersistenceHost {
  readonly state: UiEditorSnapshot;
  library: UiSuiteLibrary | null;
  parent: UiSuiteRecord['parent_snapshot'];
  draftIdentity: number;
  editRevision: number;
  activations: number;
  writes: number;
  loads: number;
  reads: number;
  initialSelectionRequired: boolean;
  recoveryVisible: boolean;
  recoveryToken: storage.RecoveryToken | null;
  confirmation: 'normal' | 'recovery' | null;
  readonly deps: UiEditorDependencies;
  begin: (pending: UiEditorSnapshot['pending']) => EditorOperation;
  finish: (op: EditorOperation) => void;
  alive: (life: number) => boolean;
  error: (error: unknown) => void;
  publish: (patch: Partial<UiEditorSnapshot>) => void;
  publishDraft: (draft: UiSuiteBundle, dirty: boolean) => void;
  serialize: <T>(run: () => Promise<T>) => Promise<T>;
  prepareActivation: (
    draft: UiSuiteBundle,
    id: string,
    parent: UiSuiteRecord['parent_snapshot'],
    generation: number,
    life: number,
    stagedParent?: SuiteActivationLayer | null,
  ) => Promise<SuiteActivation>;
  install: (
    candidate: SuiteActivation,
    previewing: boolean,
    id: string,
    parent: UiSuiteRecord['parent_snapshot'],
  ) => void;
  disable: () => void;
  requestReset: (owner: 'normal' | 'recovery') => void;
  disposeActivation: () => void;
  loadDraft: (
    id: string,
    life: number,
    generation?: number,
  ) => Promise<SuiteActivationLayer | null>;
  activate: (
    draft: UiSuiteBundle,
    id: string,
    parent: UiSuiteRecord['parent_snapshot'],
    generation: number,
    life: number,
    previewing: boolean,
  ) => Promise<void>;
}
type EditorOperation = { id: number; life: number };
/** Submitted writes keep CAS authority while activation and draft leases remain current. */
export function createPersistence(host: PersistenceHost) {
  return {
    async submit(persist: boolean): Promise<boolean> {
      if (!host.state.loaded || !host.state.draft) return false;
      const op = host.begin(persist ? 'save' : 'preview'),
        identity = host.draftIdentity,
        revision = host.editRevision;
      const captured = detached(host.state.draft),
        parent = detached(host.parent),
        id = host.state.selectedSuiteId;
      const generation = ++host.activations,
        write = host.writes;
      let candidate: SuiteActivation | null = null;
      try {
        if (!id || (persist && id.startsWith('builtin.')))
          throw new Error('Copy the builtin suite before saving');
        const normalized = await normalizeDraftBundle(captured);
        candidate = await host.prepareActivation(normalized, id, parent, generation, op.life);
        if (persist) {
          const ack = await host.serialize(async () => {
            if (!host.alive(op.life) || write !== host.writes || !host.library)
              throw new DOMException('Superseded', 'AbortError');
            const current = detached(host.library),
              record = draftToSuiteRecord(normalized, id, parent);
            const index = current.suites.findIndex((item) => item.instance_id === id);
            if (index < 0) current.suites.push(record);
            else current.suites[index] = record;
            current.active_suite_id = id;
            const ack = await host.deps.storage.saveSuiteLibrary(current, host.library.revision);
            if (host.alive(op.life)) host.library = detached(ack);
            return ack;
          });
          if (!host.alive(op.life)) return false;
          if (identity === host.draftIdentity && revision === host.editRevision) {
            host.parent = detached(
              ack.suites.find((item) => item.instance_id === id)?.parent_snapshot ?? parent,
            );
            host.publishDraft(normalized, false);
          }
        }
        if (!host.alive(op.life) || generation !== host.activations) return persist;
        host.recoveryVisible = false;
        host.install(candidate, !persist, id, parent);
        candidate = null;
        return true;
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        candidate?.dispose();
        host.finish(op);
      }
    },
    async selectSuite(id: string): Promise<boolean> {
      if (
        !host.library ||
        (!['builtin.modern', 'builtin.immersive'].includes(id) &&
          !host.library.suites.some((item) => item.instance_id === id))
      )
        return false;
      const op = host.begin('save'),
        generation = ++host.activations,
        write = host.writes;
      const identity = host.draftIdentity,
        editRevision = host.editRevision;
      const current = () =>
        host.alive(op.life) && write === host.writes && generation === host.activations;
      let candidate: SuiteActivation | null = null;
      let selected = id,
        parent: UiSuiteRecord['parent_snapshot'] = null;
      const prepare = async (suiteId: string) => {
        const record = host.library?.suites.find((item) => item.instance_id === suiteId);
        if (!record && !['builtin.modern', 'builtin.immersive'].includes(suiteId))
          throw new Error('Selected suite is no longer available');
        parent = detached(record?.parent_snapshot ?? null);
        const bundle = record
          ? materializeSuite(detached(record))
          : await host.deps.getBuiltinBundle(
              suiteId === 'builtin.immersive' ? 'immersive' : 'modern',
            );
        if (!current()) throw new DOMException('Superseded', 'AbortError');
        candidate = await host.prepareActivation(
          detached(bundle),
          suiteId,
          parent,
          generation,
          op.life,
        );
        if (!current()) throw new DOMException('Superseded', 'AbortError');
      };
      try {
        await prepare(id);
        const persisted = await host.serialize(async () => {
          if (!current() || !host.library) throw new DOMException('Superseded', 'AbortError');
          if (
            !id.startsWith('builtin.') &&
            !host.library.suites.some((item) => item.instance_id === id)
          )
            throw new Error('Selected suite is no longer available');
          const next = detached(host.library);
          next.active_suite_id = id;
          try {
            const ack = await host.deps.storage.saveSuiteLibrary(next, host.library.revision);
            // A submitted write remains authoritative even if Recovery took over.
            if (host.alive(op.life)) host.library = detached(ack);
            if (current() && ack.active_suite_id !== selected) {
              candidate?.dispose();
              candidate = null;
              if (!ack.active_suite_id) throw new Error('Saved library has no active suite');
              selected = ack.active_suite_id;
              await prepare(selected);
            }
            return true;
          } catch (error) {
            if (!host.alive(op.life) || (error instanceof Error && error.name === 'AbortError'))
              throw error;
            host.error(error);
            try {
              const authority = await host.deps.storage.loadSuiteLibrary();
              if (!host.alive(op.life)) return false;
              host.library = detached(authority);
              host.recoveryToken = null;
            } catch (reloadError) {
              if (host.alive(op.life)) {
                host.library = null;
                host.error(reloadError);
                host.disable();
                try {
                  const inspection = await host.deps.storage.inspectSuiteRecovery();
                  if (host.alive(op.life)) host.recoveryToken = inspection.token;
                } catch (inspectionError) {
                  if (host.alive(op.life)) host.error(inspectionError);
                }
              }
              return false;
            }
            if (!current() || !host.library.active_suite_id) return false;
            // An external successful choice is installed under this same activation generation.
            candidate?.dispose();
            candidate = null;
            selected = host.library.active_suite_id;
            await prepare(selected);
            return false;
          }
        });
        if (!host.alive(op.life)) return false;
        if (!current()) return persisted;
        if (
          !persisted &&
          (!host.library?.active_suite_id || selected !== host.library.active_suite_id)
        )
          return false;
        if (!candidate) return false;
        host.install(candidate, false, selected, parent);
        const installed: SuiteActivation = candidate;
        candidate = null;
        host.initialSelectionRequired = false;
        host.recoveryVisible = false;
        host.publish({ initialSelectionRequired: false });
        if (identity === host.draftIdentity && editRevision === host.editRevision) {
          ++host.draftIdentity;
          host.parent = detached(parent);
          host.editRevision = 0;
          host.publish({ selectedSuiteId: selected, selection: null });
          host.publishDraft(detached(installed.primary.bundle), false);
        }
        return true;
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        (candidate as SuiteActivation | null)?.dispose();
        host.finish(op);
      }
    },
    async reset(owner: 'normal' | 'recovery'): Promise<boolean> {
      if (host.confirmation !== owner) {
        if (owner === 'recovery') host.requestReset(owner);
        return false;
      }
      const op = host.begin('reset'),
        generation = ++host.activations,
        write = ++host.writes;
      ++host.loads;
      ++host.reads;
      try {
        const ack = await host.serialize(async () => {
          if (!host.alive(op.life) || write !== host.writes)
            throw new DOMException('Superseded', 'AbortError');
          const ack = host.library
            ? await host.deps.storage.resetSuiteLibrary(host.library.revision)
            : await host.deps.storage.resetRecoverableSuiteLibrary(
                host.recoveryToken ?? (await host.deps.storage.inspectSuiteRecovery()).token,
              );
          if (host.alive(op.life)) host.library = detached(ack);
          return ack;
        });
        if (!host.alive(op.life) || write !== host.writes) return false;
        host.confirmation = null;
        host.recoveryToken = null;
        host.initialSelectionRequired = false;
        host.publish({
          loaded: true,
          resetConfirmationOpen: false,
          initialSelectionRequired: false,
        });
        if (generation !== host.activations) return true;
        host.disposeActivation();
        host.recoveryVisible = false;
        ++host.draftIdentity;
        host.parent = null;
        host.publish({
          draft: null,
          files: [],
          dirty: false,
          selectedSuiteId: ack.active_suite_id,
          selectedFile: null,
          selection: null,
          diagnostics: [],
          previewing: false,
        });
        await host.loadDraft(ack.active_suite_id ?? 'builtin.modern', op.life);
        if (host.state.draft && generation === host.activations)
          await host.activate(
            host.state.draft,
            host.state.selectedSuiteId!,
            null,
            generation,
            op.life,
            false,
          );
        return true;
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        host.finish(op);
      }
    },
  };
}
