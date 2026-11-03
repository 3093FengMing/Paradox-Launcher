import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useState } from 'react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { Copy, LoaderCircle } from 'lucide-react';
import { Field } from '@paradox/ui';
import DefaultLauncherDialog from './LauncherDialog';
export default function AppearancePresetDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions().presets,
    presets = snapshot.config.value?.appearance_presets ?? [];
  const draft = snapshot.drafts.preset;
  const dialog = draft?.request;
  const name = draft?.name ?? '';
  const json = draft?.json ?? '';
  const error = draft?.error;
  const pending = snapshot.drafts.presetPending || (draft?.pending ?? false);
  const [copiedDialog, setCopiedDialog] = useState<object | null>(null);
  const copied = copiedDialog === dialog;
  const blocked =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0 ||
    pending;
  const selected =
    dialog && 'id' in dialog ? presets.find((preset) => preset.id === dialog.id) : null;
  const close = actions.cancelDialog;
  const copy = async () => {
    if (!dialog || dialog.kind !== 'export') return;
    try {
      await actions.copyExport(dialog.id);
      setCopiedDialog(dialog);
    } catch {
      /* Owner retains the error. */
    }
  };
  const submit = async () => {
    if (!dialog) return;
    try {
      switch (dialog.kind) {
        case 'save':
          await actions.save(name);
          break;
        case 'rename':
          await actions.rename(dialog.id, name);
          break;
        case 'remove':
          await actions.remove(dialog.id);
          break;
        case 'import':
          await actions.import(json);
          break;
      }
    } catch {
      /* Owner retains input and the failure. */
    }
  };
  const dialogTitle = dialog ? t(`presets.dialog.${dialog.kind}.title`) : '';
  const dialogDescription = dialog
    ? t(`presets.dialog.${dialog.kind}.description`, {
        name: selected?.name,
      })
    : '';
  if (!dialog) return null;
  return (
    <LauncherDialog
      pending={pending}
      title={dialogTitle}
      description={dialogDescription}
      onClose={close}
      data-ui-site="AppearancePresetDialog-1"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (dialog.kind === 'export' ? copy() : submit());
        }}
        data-ui-site="AppearancePresetDialog-2"
      >
        {(dialog.kind === 'save' || dialog.kind === 'rename') && (
          <Field
            label={t('presets.name')}
            description={t('presets.nameHint')}
            data-ui-site="AppearancePresetDialog-3"
          >
            <input
              autoFocus
              required
              maxLength={96}
              value={name}
              disabled={blocked}
              onChange={(event) => actions.patchDraft({ name: event.target.value })}
              placeholder={t('presets.namePlaceholder')}
              data-ui-site="AppearancePresetDialog-4"
            />
          </Field>
        )}
        {dialog.kind === 'import' && (
          <Field
            label={t('presets.json')}
            description={t('presets.importHint')}
            data-ui-site="AppearancePresetDialog-5"
          >
            <textarea
              autoFocus
              required
              rows={10}
              maxLength={32 * 1024}
              spellCheck={false}
              value={json}
              disabled={blocked}
              onChange={(event) => actions.patchDraft({ json: event.target.value })}
              placeholder={t('presets.jsonPlaceholder')}
              data-ui-site="AppearancePresetDialog-6"
            />
          </Field>
        )}
        {dialog.kind === 'export' && (
          <Field
            label={t('presets.json')}
            description={t('presets.exportHint')}
            data-ui-site="AppearancePresetDialog-7"
          >
            <textarea
              readOnly
              rows={12}
              spellCheck={false}
              value={json}
              onFocus={(event) => event.target.select()}
              data-ui-site="AppearancePresetDialog-8"
            />
          </Field>
        )}
        {error && (
          <p className="preset-error" role="alert" data-ui-site="AppearancePresetDialog-9">
            {t(error)}
          </p>
        )}
        <div className="modal-buttons" data-ui-site="AppearancePresetDialog-10">
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={close}
            data-ui-site="AppearancePresetDialog-11"
          >
            {t(dialog.kind === 'export' ? 'presets.close' : 'presets.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              blocked ||
              ((dialog.kind === 'save' || dialog.kind === 'rename') && !name.trim()) ||
              (dialog.kind === 'import' && !json.trim())
            }
            data-ui-site="AppearancePresetDialog-12"
          >
            {pending ? (
              <LoaderCircle className="spin" size={16} data-ui-site="AppearancePresetDialog-13" />
            ) : dialog.kind === 'export' ? (
              <Copy size={16} data-ui-site="AppearancePresetDialog-14" />
            ) : null}
            {t(
              dialog.kind === 'export' && copied
                ? 'presets.copied'
                : `presets.dialog.${dialog.kind}.action`,
            )}
          </button>
        </div>
      </form>
    </LauncherDialog>
  );
}
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
