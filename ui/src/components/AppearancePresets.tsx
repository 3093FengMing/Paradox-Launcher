import { customComponent } from '../customization/Customizable';
import { useState } from 'react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import {
  Check,
  Copy,
  Download,
  Import,
  Layers,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Field } from './ui';
import { appearancesEqual, MAX_APPEARANCE_PRESETS } from '../lib/appearance-presets';
import '../presets.css';

function AppearancePresets(appearance: DialogAppearance) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const { presets: actions } = useLauncherActions();
  const presets = snapshot.config.value?.appearance_presets ?? [];
  const currentAppearance = snapshot.settings.draft?.appearance;
  const draft = snapshot.drafts.preset;
  const dialog = draft?.request;
  const name = draft?.name ?? '';
  const json = draft?.json ?? '';
  const error = draft?.error;
  const pending = snapshot.drafts.presetPending || (draft?.pending ?? false);
  const [copied, setCopied] = useState(false);
  const blocked =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0 ||
    pending;
  const atCapacity = presets.length >= MAX_APPEARANCE_PRESETS;
  const selected =
    dialog && 'id' in dialog ? presets.find((preset) => preset.id === dialog.id) : null;
  const open: typeof actions.openDialog = (next) => {
    setCopied(false);
    actions.openDialog(next);
  };
  const close = actions.cancelDialog;
  const copy = async () => {
    if (!dialog || dialog.kind !== 'export') return;
    try {
      await actions.copyExport(dialog.id);
      setCopied(true);
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

  return (
    <section className="appearance-presets" aria-labelledby="appearance-presets-title">
      <div className="preset-heading">
        <div>
          <h3 id="appearance-presets-title">{t('presets.title')}</h3>
          <p>{t('presets.description')}</p>
        </div>
        <div className="button-group">
          <button
            type="button"
            className="secondary small"
            disabled={blocked || atCapacity}
            onClick={() => open({ kind: 'import' })}
          >
            <Import size={15} />
            {t('presets.import')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={blocked || atCapacity}
            onClick={() => open({ kind: 'save' })}
          >
            <Plus size={15} />
            {t('presets.saveCurrent')}
          </button>
        </div>
      </div>
      {presets.length ? (
        <div className="preset-list">
          {presets.map((preset) => {
            const current = currentAppearance
              ? appearancesEqual(currentAppearance, preset.appearance)
              : false;
            return (
              <div className="preset-card" key={preset.id}>
                <span
                  className="preset-swatch"
                  style={{ color: preset.appearance.accent_color }}
                  aria-hidden="true"
                >
                  <Layers size={20} />
                </span>
                <div className="preset-info">
                  <h4>{preset.name}</h4>
                  <p>
                    {t(`presets.style.${preset.appearance.interface_style}`)}
                    <span> · </span>
                    {t(`presets.theme.${preset.appearance.theme}`)}
                    <span> · </span>
                    {preset.appearance.ui_scale}%
                  </p>
                </div>
                <div className="preset-actions">
                  <button
                    type="button"
                    className="text-button preset-apply"
                    disabled={blocked || current}
                    onClick={() => actions.apply(preset.id)}
                    aria-label={t('presets.applyAria', { name: preset.name })}
                  >
                    {current && <Check size={14} />}
                    {t(current ? 'presets.current' : 'presets.apply')}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.renameAria', { name: preset.name })}
                    title={t('presets.rename')}
                    onClick={() => open({ kind: 'rename', id: preset.id })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.exportAria', { name: preset.name })}
                    title={t('presets.export')}
                    onClick={() => open({ kind: 'export', id: preset.id })}
                  >
                    <Download size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.removeAria', { name: preset.name })}
                    title={t('presets.remove')}
                    onClick={() => open({ kind: 'remove', id: preset.id })}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="preset-empty">
          <Layers size={18} />
          <p>{t('presets.empty')}</p>
        </div>
      )}
      <p className="preset-note">
        {t(atCapacity ? 'presets.capacityReached' : 'presets.applyHint', {
          maximum: MAX_APPEARANCE_PRESETS,
        })}
      </p>
      {dialog && (
        <LauncherDialog
          {...appearance}
          pending={pending}
          title={dialogTitle}
          description={dialogDescription}
          onClose={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void (dialog.kind === 'export' ? copy() : submit());
            }}
          >
            {(dialog.kind === 'save' || dialog.kind === 'rename') && (
              <Field label={t('presets.name')} description={t('presets.nameHint')}>
                <input
                  autoFocus
                  required
                  maxLength={96}
                  value={name}
                  disabled={blocked}
                  onChange={(event) => actions.patchDraft({ name: event.target.value })}
                  placeholder={t('presets.namePlaceholder')}
                />
              </Field>
            )}
            {dialog.kind === 'import' && (
              <Field label={t('presets.json')} description={t('presets.importHint')}>
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
                />
              </Field>
            )}
            {dialog.kind === 'export' && (
              <Field label={t('presets.json')} description={t('presets.exportHint')}>
                <textarea
                  readOnly
                  rows={12}
                  spellCheck={false}
                  value={json}
                  onFocus={(event) => event.target.select()}
                />
              </Field>
            )}
            {error && (
              <p className="preset-error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="modal-buttons">
              <button type="button" className="secondary" disabled={pending} onClick={close}>
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
              >
                {pending ? (
                  <LoaderCircle className="spin" size={16} />
                ) : dialog.kind === 'export' ? (
                  <Copy size={16} />
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
      )}
    </section>
  );
}

const CustomizedAppearancePresets = customComponent(
  'component.appearance-presets',
  AppearancePresets,
);
export default CustomizedAppearancePresets;
