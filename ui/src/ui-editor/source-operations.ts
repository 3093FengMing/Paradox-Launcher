import { canonicalSuiteJson } from '../ui-suite/canonical';
import { uniqueSuitePaths } from '../ui-suite/paths';
import type { UiSelector, UiSuiteBundle, UiSuiteRecord } from '../ui-suite/model';
import { sameSelector, selectorDigest } from '../customization/selectors';
import i18n from '../i18n';
import { detached } from './controller-model';
import type { UiEditorDependencies } from './controller-model';
import type { UiEditorSnapshot, UiEditorSourceKind } from './public';
import {
  addFileAsset,
  exportNormalizedBundle,
  exportNormalizedSource,
  readAssetFile,
  readBundleFile,
  readSourceFile,
} from './file-operations';
interface EditorFileHost {
  readonly state: UiEditorSnapshot;
  draftIdentity: number;
  editRevision: number;
  reads: number;
  parent: UiSuiteRecord['parent_snapshot'];
  readonly deps: UiEditorDependencies;
  begin: (pending: UiEditorSnapshot['pending']) => EditorOperation;
  finish: (op: EditorOperation) => void;
  alive: (life: number) => boolean;
  error: (error: unknown) => void;
  edit: (update: (draft: UiSuiteBundle) => void) => boolean;
  publish: (patch: Partial<UiEditorSnapshot>) => void;
  publishDraft: (draft: UiSuiteBundle, dirty: boolean) => void;
  selectionFile: (
    draft: UiSuiteBundle | null,
    selector: UiSelector,
    kind: UiEditorSourceKind,
  ) => string | null;
  patchFile: (path: string, text: string) => void;
}
type EditorOperation = { id: number; life: number };
/** File and override operations borrow the controller's current state and read fences. */
export function createSourceOperations(host: EditorFileHost) {
  return {
    async importSource(file: File): Promise<boolean> {
      const path = host.state.selectedFile,
        identity = host.draftIdentity,
        original = path ? host.state.draft?.files[path] : null;
      if (!path || original?.encoding !== 'utf8') return false;
      const op = host.begin('import'),
        read = ++host.reads;
      try {
        const text = await readSourceFile(file);
        if (
          !host.alive(op.life) ||
          identity !== host.draftIdentity ||
          read !== host.reads ||
          canonicalSuiteJson(host.state.draft?.files[path] ?? null) !== canonicalSuiteJson(original)
        )
          return false;
        host.patchFile(path, text);
        return true;
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        host.finish(op);
      }
    },
    async addAsset(file: File): Promise<boolean> {
      const identity = host.draftIdentity,
        path = file.name,
        op = host.begin('asset'),
        read = ++host.reads;
      try {
        const asset = await readAssetFile(file);
        if (!host.alive(op.life) || identity !== host.draftIdentity || read !== host.reads)
          return false;
        return host.edit((draft) => addFileAsset(draft, path, asset));
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        host.finish(op);
      }
    },
    async importBundle(file: File): Promise<boolean> {
      const identity = host.draftIdentity,
        revision = host.editRevision,
        op = host.begin('import'),
        read = ++host.reads;
      try {
        const bundle = await readBundleFile(file);
        if (
          !host.alive(op.life) ||
          identity !== host.draftIdentity ||
          revision !== host.editRevision ||
          read !== host.reads
        )
          return false;
        ++host.draftIdentity;
        ++host.editRevision;
        host.parent = null;
        host.publish({ selectedSuiteId: crypto.randomUUID(), selection: null });
        host.publishDraft(bundle, true);
        return true;
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
        return false;
      } finally {
        host.finish(op);
      }
    },
    async exportSource() {
      const path = host.state.selectedFile,
        source = path ? host.state.draft?.files[path] : null;
      if (!path || source?.encoding !== 'utf8' || !host.state.draft) return;
      const captured = detached(host.state.draft),
        op = host.begin('export');
      try {
        await exportNormalizedSource(host.deps, captured, path, () => host.alive(op.life));
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
      } finally {
        host.finish(op);
      }
    },
    async exportDraft() {
      if (!host.state.draft) return;
      const captured = detached(host.state.draft),
        op = host.begin('export');
      try {
        await exportNormalizedBundle(host.deps, captured, () => host.alive(op.life));
      } catch (error) {
        if (host.alive(op.life)) host.error(error);
      } finally {
        host.finish(op);
      }
    },
    async createSelectionOverride(kind: UiEditorSourceKind): Promise<boolean> {
      const selection = host.state.selection,
        suiteId = host.state.selectedSuiteId;
      if (!selection || !suiteId || !host.state.draft || !['css', 'html', 'tsx'].includes(kind))
        return false;
      const selector = detached(selection.selector),
        identity = host.draftIdentity;
      const selectedFile = host.state.selectedFile,
        original = host.state.draft.manifest.overrides.find((item) =>
          sameSelector(item.selector, selector),
        );
      const capturedBinding = canonicalSuiteJson(original ?? null),
        read = ++host.reads,
        op = host.begin('import');
      try {
        // Use the same complete-selector digest as the stylesheet/ref adapter. The
        // yield keeps this public async operation within the existing read fences.
        const digest = await Promise.resolve(selectorDigest(selector));
        if (
          !host.alive(op.life) ||
          identity !== host.draftIdentity ||
          read !== host.reads ||
          suiteId !== host.state.selectedSuiteId ||
          !host.state.draft
        )
          return false;
        const current = host.state.draft.manifest.overrides.find((item) =>
          sameSelector(item.selector, selector),
        );
        if (canonicalSuiteJson(current ?? null) !== capturedBinding) return false;
        const prefix = `overrides/${digest}/`;
        const existing = host.selectionFile(host.state.draft, selector, kind);
        if (
          !existing &&
          host.state.draft.manifest.overrides.some(
            (item) =>
              !sameSelector(item.selector, selector) &&
              (selectorDigest(item.selector) === digest ||
                [item.entry, item.stylesheet].some((path) => path?.startsWith(prefix))),
          )
        )
          throw new Error(String(i18n.t('uiInspector.overrideCollision')));
        const path =
          existing ??
          `${prefix}${kind === 'css' ? 'style.css' : kind === 'html' ? 'View.html' : 'View.tsx'}`;
        const file = host.state.draft.files[path],
          descriptor = host.state.draft.manifest.files.find((item) => item.path === path);
        if (
          file &&
          (file.encoding !== 'utf8' || (descriptor?.kind ?? path.split('.').at(-1)) !== kind)
        )
          throw new Error(String(i18n.t('uiInspector.overrideFileConflict')));
        const openCaptured =
          host.state.selection &&
          sameSelector(host.state.selection.selector, selector) &&
          host.state.selection.sourceKind === selection.sourceKind &&
          host.state.selection.filePath === selection.filePath &&
          host.state.selectedFile === selectedFile;
        if (existing) {
          if (openCaptured)
            host.publish({
              selection: { ...selection, sourceKind: kind, filePath: path },
              selectedFile: path,
            });
          return true;
        }
        // Clone the latest captured draft, preserving unrelated edits made during
        // the yield. One existing edit publishes the ordinary file and full binding.
        host.edit((draft) => {
          if (!file) {
            uniqueSuitePaths([...Object.keys(draft.files), path]);
            const text =
              kind === 'css'
                ? "/* Styles for this selector's current roots. */\n"
                : kind === 'html'
                  ? '<ui-slot></ui-slot>\n'
                  : 'export default function TargetOverride({ props, children, Original }) {\n  return <Original {...props}>{children}</Original>;\n}\n';
            draft.files[path] = { encoding: 'utf8', text };
            draft.manifest.files.push({ path, kind, bytes: 0, sha256: '0'.repeat(64) });
          }
          const binding = draft.manifest.overrides.find((item) =>
            sameSelector(item.selector, selector),
          ) ?? { selector, enabled: true, entry: null, stylesheet: null };
          if (!draft.manifest.overrides.includes(binding)) draft.manifest.overrides.push(binding);
          if (kind === 'css') binding.stylesheet = path;
          else binding.entry = path;
        });
        if (host.selectionFile(host.state.draft, selector, kind) !== path) return false;
        if (openCaptured)
          host.publish({
            selection: { ...selection, sourceKind: kind, filePath: path },
            selectedFile: path,
          });
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
