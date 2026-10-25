import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { Check, Folder, LoaderCircle } from 'lucide-react';
import * as api from '../api';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Field } from './ui';
import type { GameProfile, ProfileOverrides, Settings } from '../types';

interface Props extends DialogAppearance {
  profile: GameProfile;
  settings: Settings;
  saving: boolean;
  onClose: () => void;
  onError: (error: unknown) => void;
  onSave: (profile: GameProfile) => Promise<boolean>;
}
interface OverrideFieldProps {
  label: string;
  value: string | number | null | undefined;
  inherited: string | number;
  numeric?: boolean;
  multiline?: boolean;
  disabled: boolean;
  onChange: (value: string | number | null) => void;
}
function OverrideField({
  label,
  value,
  inherited,
  numeric = false,
  multiline = false,
  disabled,
  onChange,
}: OverrideFieldProps) {
  const { t } = useTranslation();
  const enabled = value !== null && value !== undefined;
  return (
    <div className="field">
      <label className="inline-check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? inherited : null)}
        />
        {t('instanceDialog.overrideLabel', { label })}
      </label>
      <small>
        {enabled
          ? t('instanceDialog.overrideDescription')
          : t('instanceDialog.inherited', {
              value: inherited === '' ? t('instanceDialog.emptyInherited') : inherited,
            })}
      </small>
      {enabled &&
        (multiline ? (
          <textarea
            aria-label={label}
            rows={2}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            type={numeric ? 'number' : 'text'}
            disabled={disabled}
            value={value}
            onChange={(event) =>
              onChange(numeric ? Number(event.target.value) : event.target.value)
            }
          />
        ))}
    </div>
  );
}
export default function InstanceSettingsDialog({
  profile,
  settings,
  saving,
  onClose,
  onError,
  onSave,
  ...appearance
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => structuredClone(profile));
  const [picking, setPicking] = useState(false);
  const pending = useRef(false);
  const patchOverride = (key: keyof ProfileOverrides, value: string | number | null) =>
    setDraft((previous) => ({ ...previous, overrides: { ...previous.overrides, [key]: value } }));
  const pickJava = async () => {
    setPicking(true);
    try {
      const path = await api.chooseJava();
      if (path) {
        const installation = await api.inspectJava(path);
        patchOverride('java_executable', installation.executable);
      }
    } catch (error) {
      onError(error);
    } finally {
      setPicking(false);
    }
  };
  const submit = async () => {
    if (pending.current || saving) return;
    pending.current = true;
    try {
      if (
        await onSave({
          ...draft,
          name: draft.name.trim(),
        })
      )
        onClose();
    } catch (error) {
      onError(error);
    } finally {
      pending.current = false;
    }
  };
  const numericFields = [
    { key: 'minimum_memory_mb', label: t('settings.minimumMemory') },
    { key: 'memory_mb', label: t('settings.maximumMemory') },
    { key: 'resolution_width', label: t('settings.windowWidth') },
    { key: 'resolution_height', label: t('settings.windowHeight') },
  ] as const;
  return (
    <LauncherDialog
      {...appearance}
      pending={saving || picking}
      onClose={onClose}
      title={t('instances.settings')}
      description={t('instanceDialog.description', { version: profile.game_version })}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('instances.name')}>
          <input
            required
            maxLength={64}
            disabled={saving}
            value={draft.name}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, name: event.target.value }))
            }
          />
        </Field>
        <Field
          label={t('instanceDialog.gameRoot')}
          description={t('instanceDialog.gameRootDescription')}
        >
          <input readOnly value={draft.game_directory ?? settings.game_directory} />
        </Field>
        <OverrideField
          label={t('settings.javaExecutable')}
          value={draft.overrides.java_executable}
          inherited={settings.java_executable}
          disabled={saving}
          onChange={(value) => patchOverride('java_executable', value)}
        />
        <button
          type="button"
          className="secondary small"
          disabled={!api.desktop || saving || picking}
          onClick={() => {
            void pickJava();
          }}
        >
          <Folder size={15} />
          {t('instanceDialog.chooseJava')}
        </button>
        <div className="field-grid">
          {numericFields.map((field) => (
            <OverrideField
              key={field.key}
              label={field.label}
              numeric
              value={draft.overrides[field.key]}
              inherited={settings[field.key]}
              disabled={saving}
              onChange={(value) => patchOverride(field.key, value)}
            />
          ))}
        </div>
        <OverrideField
          label={t('instanceDialog.jvmArguments')}
          multiline
          value={draft.overrides.extra_jvm_arguments}
          inherited={settings.extra_jvm_arguments}
          disabled={saving}
          onChange={(value) => patchOverride('extra_jvm_arguments', value)}
        />
        <OverrideField
          label={t('instanceDialog.gameArguments')}
          multiline
          value={draft.overrides.extra_game_arguments}
          inherited={settings.extra_game_arguments}
          disabled={saving}
          onChange={(value) => patchOverride('extra_game_arguments', value)}
        />
        <div className="modal-buttons">
          <button type="button" className="secondary" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={saving || picking}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {t('instanceDialog.save')}
          </button>
        </div>
      </form>
    </LauncherDialog>
  );
}
