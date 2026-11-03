import { useState } from 'react';
import type { LauncherServices } from '../services';
import type {
  AppearanceDraftsSnapshot,
  ArgumentTemplateDraft,
  LauncherActions,
  PresetDialogRequest,
  PresetDialogSnapshot,
} from '../public/types';
import {
  environmentRows,
  removeArgumentTemplate,
  saveArgumentTemplate,
} from '../../lib/argument-templates';
import {
  exportAppearancePreset,
  MAX_APPEARANCE_PRESETS,
  PresetValidationError,
} from '../../lib/appearance-presets';
import { errorMessage } from '../../lib/errors';
import { domainBlocked, useControllerOwner } from './owner';

interface State {
  preset: PresetDialogSnapshot | null;
  argumentTemplate: Omit<ArgumentTemplateDraft, 'environment'> | null;
  environment: ArgumentTemplateDraft['environment'];
  argumentTemplateError: string | null;
  operation: symbol | null;
}
const reconnect = (state: State): State => ({
  ...state,
  operation: null,
  preset: state.preset ? { ...state.preset, pending: false } : null,
});
export function useAppearanceDraftsController(services: LauncherServices): {
  snapshot: AppearanceDraftsSnapshot;
  presets: LauncherActions['presets'];
  argumentTemplates: LauncherActions['argumentTemplates'];
} {
  const owner = useControllerOwner<State>(
    services,
    {
      preset: null,
      argumentTemplate: null,
      environment: [],
      argumentTemplateError: null,
      operation: null,
    },
    reconnect,
  );
  const [actions] = useState(() => {
    const allowed = () => owner.mounted && !domainBlocked(owner.services);
    const presetAllowed = () => allowed() && !owner.state.operation;
    const library = () => owner.services.launcher.getGuardState().config?.appearance_presets ?? [];
    const findPreset = (id: string) => {
      const preset = library().find((item) => item.id === id);
      if (!preset) throw new Error('presets.errors.missing');
      return preset;
    };
    const matching = (
      request: PresetDialogRequest,
      kind: PresetDialogRequest['kind'],
      id?: string,
    ) => request.kind === kind && (!('id' in request) || request.id === id);
    const run = async (
      kind: PresetDialogRequest['kind'],
      operation: () => Promise<void>,
      id?: string,
    ) => {
      if (!presetAllowed()) return;
      const token = Symbol(),
        generation = owner.generation;
      const dialog = owner.state.preset;
      const target = dialog && matching(dialog.request, kind, id) ? dialog : null;
      owner.commit({
        ...owner.state,
        operation: token,
        preset: target ? { ...target, pending: true, error: null } : dialog,
      });
      const current = () =>
        owner.mounted && owner.generation === generation && owner.state.operation === token;
      try {
        await operation();
        if (current() && target)
          owner.commit({
            ...owner.state,
            preset: kind === 'export' ? { ...owner.state.preset!, pending: false } : null,
          });
      } catch (cause) {
        if (current() && target)
          owner.commit({
            ...owner.state,
            preset: {
              ...owner.state.preset!,
              pending: false,
              error: cause instanceof PresetValidationError ? cause.key : errorMessage(cause),
            },
          });
        throw cause;
      } finally {
        if (current()) owner.commit({ ...owner.state, operation: null });
      }
    };
    const cancel = () =>
      owner.commit({
        ...owner.state,
        argumentTemplate: null,
        environment: [],
        argumentTemplateError: null,
      });
    const presets: LauncherActions['presets'] = Object.freeze({
      openDialog(request) {
        if (!presetAllowed()) return;
        if (
          (request.kind === 'save' || request.kind === 'import') &&
          library().length >= MAX_APPEARANCE_PRESETS
        )
          return;
        try {
          const preset = 'id' in request ? findPreset(request.id) : null;
          owner.commit({
            ...owner.state,
            preset: {
              request: structuredClone(request),
              name: request.kind === 'rename' ? preset!.name : '',
              json: request.kind === 'export' ? exportAppearancePreset(preset!) : '',
              pending: false,
              error: null,
            },
          });
        } catch (cause) {
          owner.services.launcher.reportError(cause);
        }
      },
      patchDraft(patch) {
        if (!owner.mounted || !owner.state.preset || owner.state.operation) return;
        owner.commit({
          ...owner.state,
          preset: {
            ...owner.state.preset,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.json !== undefined ? { json: patch.json } : {}),
            error: null,
          },
        });
      },
      cancelDialog() {
        if (!owner.state.operation) owner.commit({ ...owner.state, preset: null });
      },
      save: (name) => run('save', () => owner.services.launcher.saveAppearancePreset(name)),
      rename: (id, name) =>
        run('rename', () => owner.services.launcher.renameAppearancePreset(id, name), id),
      remove: (id) => run('remove', () => owner.services.launcher.removeAppearancePreset(id), id),
      import: (text) => run('import', () => owner.services.launcher.importAppearancePreset(text)),
      apply(id) {
        if (presetAllowed()) owner.services.launcher.applyAppearancePreset(id);
      },
      export(id) {
        return presetAllowed() ? exportAppearancePreset(findPreset(id)) : '';
      },
      copyExport: (id) =>
        run(
          'export',
          async () => {
            const text = exportAppearancePreset(findPreset(id));
            try {
              await navigator.clipboard.writeText(text);
            } catch {
              throw new Error('presets.errors.clipboard');
            }
          },
          id,
        ),
    });
    const argumentTemplates: LauncherActions['argumentTemplates'] = Object.freeze({
      openNew() {
        const draft = owner.services.launcher.getSettingsDraft();
        if (!allowed() || !draft || draft.argument_templates.length >= 16) return;
        owner.commit({
          ...owner.state,
          argumentTemplate: { id: crypto.randomUUID(), name: '', jvm: '', game: '' },
          environment: [],
          argumentTemplateError: null,
        });
      },
      openEdit(id) {
        if (!allowed()) return;
        const template = owner.services.launcher
          .getSettingsDraft()
          ?.argument_templates.find((item) => item.id === id);
        if (!template) return;
        owner.commit({
          ...owner.state,
          argumentTemplate: {
            id: template.id,
            name: template.name,
            jvm: template.jvm,
            game: template.game,
          },
          environment: environmentRows(structuredClone(template.environment)),
          argumentTemplateError: null,
        });
      },
      patch(patch) {
        if (!allowed() || !owner.state.argumentTemplate) return;
        const { environment, ...fields } = patch;
        owner.commit({
          ...owner.state,
          argumentTemplate: {
            ...owner.state.argumentTemplate,
            ...(fields.id !== undefined ? { id: fields.id } : {}),
            ...(fields.name !== undefined ? { name: fields.name } : {}),
            ...(fields.jvm !== undefined ? { jvm: fields.jvm } : {}),
            ...(fields.game !== undefined ? { game: fields.game } : {}),
          },
          environment:
            environment === undefined ? owner.state.environment : structuredClone(environment),
          argumentTemplateError: null,
        });
      },
      setEnvironment(rows) {
        argumentTemplates.patch({ environment: rows });
      },
      apply() {
        if (!allowed() || !owner.state.argumentTemplate) return;
        try {
          const draft = {
            ...owner.state.argumentTemplate,
            environment: structuredClone(owner.state.environment),
          };
          if (
            owner.services.launcher.updateArgumentTemplates((current) =>
              saveArgumentTemplate([...current], draft),
            )
          )
            cancel();
        } catch (cause) {
          owner.commit({ ...owner.state, argumentTemplateError: errorMessage(cause) });
        }
      },
      cancel,
      remove(id) {
        if (!allowed()) return;
        const used =
          owner.services.launcher
            .getGuardState()
            .config?.profiles.flatMap((profile) =>
              profile.overrides.argument_template ? [profile.overrides.argument_template] : [],
            ) ?? [];
        try {
          if (
            owner.services.launcher.updateArgumentTemplates((current) =>
              removeArgumentTemplate([...current], id, used),
            ) &&
            owner.state.argumentTemplate?.id === id
          )
            cancel();
        } catch (cause) {
          owner.commit({ ...owner.state, argumentTemplateError: errorMessage(cause) });
        }
      },
    });
    return { presets, argumentTemplates };
  });
  return {
    get snapshot() {
      return {
        preset: owner.state.preset,
        presetPending: owner.mounted && owner.state.operation !== null,
        argumentTemplate: owner.state.argumentTemplate
          ? { ...owner.state.argumentTemplate, environment: owner.state.environment }
          : null,
        environment: owner.state.environment,
        argumentTemplateError: owner.state.argumentTemplateError,
      };
    },
    ...actions,
  };
}
