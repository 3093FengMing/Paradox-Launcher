import type { UiSelector, UiSuiteBundle } from '../ui-suite/model';
import type { DomPreviewHandle, UiEditorSnapshot, UiEditorSourceKind } from './public';
import type { UiEditorDependencies } from './controller-model';
import { detached } from './controller-model';
import { canonicalSuiteJson } from '../ui-suite/canonical';
import { sameSelector, selectorMatches } from '../customization/selectors';
import { resolveSelector } from '../customization/ownership';
import {
  describeTarget,
  getScopeChoices,
  getTargetAncestors,
  listCurrentTargets,
} from '../customization/target-catalog';
import i18n from '../i18n';
interface SelectionHost {
  state: UiEditorSnapshot;
  positionAnchor: UiSelector | null;
  readonly deps: UiEditorDependencies;
  publish: (patch: Partial<UiEditorSnapshot>) => void;
  clearHighlight: () => void;
  updateTargets: (opening?: boolean) => void;
  selectTarget: (selector: UiSelector) => void;
  selectionFile: (
    draft: UiSuiteBundle | null,
    selector: UiSelector,
    kind: UiEditorSourceKind,
  ) => string | null;
  readonly previews: Set<DomPreviewHandle>;
  error: (error: unknown) => void;
}
/** Resolve selection and catalog state from the permanent editor owner. */
export function createSelection(host: SelectionHost) {
  return {
    updateTargets(opening = false) {
      // A closed editor has no catalog consumer. Keep an active selection current
      // without reading every unrelated target; opening takes a synchronous fresh catalog.
      if (!opening && !host.state.open && !host.state.selection && !host.state.picking) return;
      const context = host.deps.getTargetContext?.() ?? {};
      const targets =
        opening || host.state.open
          ? listCurrentTargets(
              host.state.draft?.manifest.overrides.map((item) => item.selector) ?? [],
              context,
            )
          : host.state.targets;
      const selector = host.state.selection?.selector;
      const anchor = host.positionAnchor && resolveSelector(host.positionAnchor);
      const anchorOwner = anchor && anchor.owners.length === 1 ? anchor.owners[0] : null;
      const current = selector ? describeTarget(selector, context) : null;
      const ownerId =
        selector &&
        anchorOwner &&
        selectorMatches(selector, anchorOwner.target, anchorOwner.locator)
          ? anchorOwner.ownerId
          : (current?.ownerId ?? null);
      const currentTarget =
        current && ownerId !== current.ownerId ? Object.freeze({ ...current, ownerId }) : current;
      const targetAncestors = ownerId ? getTargetAncestors(ownerId, context) : [];
      const scopeChoices = ownerId ? getScopeChoices(ownerId, context) : [];
      const patch = { targets, currentTarget, targetAncestors, scopeChoices };
      if (
        Object.entries(patch).some(([key, value]) => {
          const before = host.state[key as keyof UiEditorSnapshot];
          return (
            !Object.is(value, before) && canonicalSuiteJson(value) !== canonicalSuiteJson(before)
          );
        })
      )
        host.publish(patch);
    },
    selectTarget(selector: UiSelector) {
      host.clearHighlight();
      if (selector.kind === 'position') host.positionAnchor = detached(selector);
      else if (
        host.positionAnchor?.kind === 'position' &&
        !selectorMatches(selector, host.positionAnchor.target, host.positionAnchor.locator)
      )
        host.positionAnchor = null;
      const binding = host.state.draft?.manifest.overrides.find((item) =>
        sameSelector(item.selector, selector),
      );
      const filePath = binding?.entry ?? binding?.stylesheet ?? null;
      const sourcePath = describeTarget(selector, host.deps.getTargetContext?.()).sourcePath;
      const selectedFile =
        filePath && host.state.draft?.files[filePath]
          ? filePath
          : sourcePath && host.state.draft?.files[sourcePath]
            ? sourcePath
            : host.state.selectedFile;
      host.publish({
        selection: {
          selector: detached(selector),
          scope: selector.kind,
          filePath: binding?.entry ?? binding?.stylesheet ?? null,
          sourceKind: binding?.entry?.endsWith('.html') ? 'html' : binding?.entry ? 'tsx' : 'css',
        },
        selectedFile,
      });
      host.updateTargets();
      for (const preview of host.previews) preview.refresh();
    },
    selectionFile(
      draft: UiSuiteBundle | null,
      selector: UiSelector,
      kind: UiEditorSourceKind,
    ): string | null {
      const binding = draft?.manifest.overrides.find((item) =>
        sameSelector(item.selector, selector),
      );
      const path = kind === 'css' ? binding?.stylesheet : binding?.entry;
      if (!path || !draft?.files[path]) return null;
      const descriptor = draft.manifest.files.find((file) => file.path === path);
      return (descriptor?.kind ?? path.split('.').at(-1)) === kind ? path : null;
    },
    setSourceKind(kind: UiEditorSourceKind) {
      const selection = host.state.selection;
      if (!selection || !['css', 'html', 'tsx'].includes(kind)) return;
      const filePath = host.selectionFile(host.state.draft, selection.selector, kind);
      host.publish({
        selection: { ...selection, sourceKind: kind, filePath },
        selectedFile: filePath,
      });
    },
    setScope(scope: 'position' | 'business' | 'type') {
      const selection = host.state.selection;
      if (!selection) return;
      if (scope === selection.selector.kind) {
        host.publish({ selection: { ...selection, scope } });
        return;
      }
      if (scope === 'type') host.selectTarget({ kind: 'type', target: selection.selector.target });
      else if (scope === 'position' && host.positionAnchor?.target === selection.selector.target)
        host.selectTarget(host.positionAnchor);
      else if (scope === 'business') {
        const choices = host.state.scopeChoices.filter((item) => item.selector.kind === 'business');
        if (choices.length === 1) host.selectTarget(choices[0].selector);
        else
          host.error(
            new Error(
              String(
                i18n.t(choices.length ? 'uiInspector.chooseBusiness' : 'uiInspector.noBusiness'),
              ),
            ),
          );
      }
    },
  };
}
