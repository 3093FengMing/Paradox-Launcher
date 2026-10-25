import { useEffect, useRef, useState } from 'react';
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
import {
  appearancesEqual,
  exportAppearancePreset,
  MAX_APPEARANCE_PRESETS,
  PresetValidationError,
  validatePresetName,
} from '../lib/appearance-presets';
import type { Appearance, AppearancePreset } from '../types';
import '../presets.css';

interface Props extends DialogAppearance {
  presets: AppearancePreset[];
  currentAppearance: Appearance;
  disabled: boolean;
  onSavePreset: (name: string) => Promise<void>;
  onApplyPreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => Promise<void>;
  onRemovePreset: (id: string) => Promise<void>;
  onImportPreset: (json: string) => Promise<void>;
}

type PresetDialog =
  | { kind: 'save' }
  | { kind: 'rename'; preset: AppearancePreset }
  | { kind: 'remove'; preset: AppearancePreset }
  | { kind: 'import' }
  | { kind: 'export'; preset: AppearancePreset; json: string };

export default function AppearancePresets({
  presets,
  currentAppearance,
  disabled,
  onSavePreset,
  onApplyPreset,
  onRenamePreset,
  onRemovePreset,
  onImportPreset,
  ...appearance
}: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<PresetDialog | null>(null);
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const blocked = disabled || pending;
  const atCapacity = presets.length >= MAX_APPEARANCE_PRESETS;
  const open = (next: PresetDialog) => {
    if (blocked) return;
    setName(next.kind === 'rename' ? next.preset.name : '');
    setJson('');
    setError('');
    setCopied(false);
    setDialog(next);
  };
  const close = () => {
    if (!inFlight.current) setDialog(null);
  };
  const submit = async () => {
    if (!dialog || inFlight.current || disabled || dialog.kind === 'export') return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      switch (dialog.kind) {
        case 'save':
          await onSavePreset(validatePresetName(name));
          break;
        case 'rename':
          await onRenamePreset(dialog.preset.id, validatePresetName(name));
          break;
        case 'remove':
          await onRemovePreset(dialog.preset.id);
          break;
        case 'import':
          await onImportPreset(json);
          break;
      }
      if (mounted.current) setDialog(null);
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof PresetValidationError
            ? t(cause.key)
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const copy = async () => {
    if (!dialog || dialog.kind !== 'export' || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    try {
      await navigator.clipboard.writeText(dialog.json);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setError(t('presets.errors.clipboard'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const dialogTitle = dialog ? t(`presets.dialog.${dialog.kind}.title`) : '';
  const dialogDescription = dialog
    ? t(`presets.dialog.${dialog.kind}.description`, {
        name: 'preset' in dialog ? dialog.preset.name : undefined,
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
            const current = appearancesEqual(currentAppearance, preset.appearance);
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
                    onClick={() => onApplyPreset(preset.id)}
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
                    onClick={() => open({ kind: 'rename', preset })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.exportAria', { name: preset.name })}
                    title={t('presets.export')}
                    onClick={() =>
                      open({ kind: 'export', preset, json: exportAppearancePreset(preset) })
                    }
                  >
                    <Download size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.removeAria', { name: preset.name })}
                    title={t('presets.remove')}
                    onClick={() => open({ kind: 'remove', preset })}
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
                  onChange={(event) => setName(event.target.value)}
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
                  onChange={(event) => setJson(event.target.value)}
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
                  value={dialog.json}
                  onFocus={(event) => event.target.select()}
                />
              </Field>
            )}
            {error && (
              <p className="preset-error" role="alert">
                {error}
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
