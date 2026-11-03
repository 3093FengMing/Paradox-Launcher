import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Check, Folder, LoaderCircle } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Field, Select } from './ui';
import { EnvironmentEditor } from './ArgumentTemplates';
import type { ProfileOverrides } from '../types';

// This detached identity keeps per-instance customization targets addressable.
// Editable values and operations still come only from the permanent controller.
type Props = DialogAppearance & { profile: { instance_key: string } };
interface OverrideFieldProps {
  label: string;
  value: string | number | null | undefined;
  inherited: string | number;
  source?: string;
  numeric?: boolean;
  multiline?: boolean;
  disabled: boolean;
  onChange: (value: string | number | null) => void;
}
function DefaultOverrideField({
  label,
  value,
  inherited,
  source,
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
          : t(source ? 'argumentTemplates.inheritedFrom' : 'instanceDialog.inherited', {
              source,
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
function InstanceSettingsDialog({ profile: identity, ...appearance }: Props) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().instanceDraft;
  const { profile: draft, environment, picking, pending, canSubmit } = snapshot.instanceDraft;
  const settings = snapshot.config.value?.settings;
  const saving = snapshot.settings.saving || pending;
  const onClose = actions.cancel;
  const setEnvironment = actions.setEnvironment;
  if (!draft || !settings || draft.instance_key !== identity.instance_key) return null;
  const template = settings.argument_templates.find(
    (value) => value.id === draft.overrides.argument_template,
  );
  const argumentSource = template?.name ?? t('argumentTemplates.global');
  const patchOverride = (key: keyof ProfileOverrides, value: string | number | null) =>
    actions.patchOverride(key, value);
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
      description={t('instanceDialog.description', { version: draft.game_version })}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.submit();
        }}
      >
        <Field label={t('instances.name')}>
          <input
            required
            maxLength={64}
            disabled={saving}
            value={draft.name}
            onChange={(event) => actions.patch({ name: event.target.value })}
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
          disabled={!snapshot.window.desktop || saving || picking}
          onClick={() => {
            void actions.chooseJava();
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
        <Field
          label={t('argumentTemplates.select')}
          description={t('argumentTemplates.precedence')}
        >
          <Select
            value={draft.overrides.argument_template ?? ''}
            disabled={saving}
            onValueChange={(value) => patchOverride('argument_template', value || null)}
            options={[
              { value: '', label: t('argumentTemplates.global') },
              ...settings.argument_templates.map((value) => ({
                value: value.id,
                label: value.name,
              })),
            ]}
          />
        </Field>
        <OverrideField
          label={t('instanceDialog.jvmArguments')}
          multiline
          value={draft.overrides.extra_jvm_arguments}
          inherited={template?.jvm ?? settings.extra_jvm_arguments}
          source={argumentSource}
          disabled={saving}
          onChange={(value) => patchOverride('extra_jvm_arguments', value)}
        />
        <OverrideField
          label={t('instanceDialog.gameArguments')}
          multiline
          value={draft.overrides.extra_game_arguments}
          inherited={template?.game ?? settings.extra_game_arguments}
          source={argumentSource}
          disabled={saving}
          onChange={(value) => patchOverride('extra_game_arguments', value)}
        />
        <h3>{t('argumentTemplates.instanceEnvironment')}</h3>
        <p className="help-text">{t('argumentTemplates.environmentPrecedence')}</p>
        {template && Object.keys(template.environment).length > 0 && (
          <details>
            <summary>
              {t('argumentTemplates.inheritedEnvironment', { name: template.name })}
            </summary>
            {Object.entries(template.environment).map(([key, value]) => (
              <Field label={key} key={key}>
                <textarea readOnly value={value} rows={2} />
              </Field>
            ))}
          </details>
        )}
        <EnvironmentEditor
          rows={environment.map((row) => ({ ...row }))}
          disabled={saving || picking}
          onChange={setEnvironment}
        />
        <p className="help-text">{t('argumentTemplates.environmentHelp')}</p>
        <div className="modal-buttons">
          <button type="button" className="secondary" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={!canSubmit}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {t('instanceDialog.save')}
          </button>
        </div>
      </form>
    </LauncherDialog>
  );
}

const OverrideField = customComponent('control.override-field', DefaultOverrideField);

const CustomizedInstanceSettingsDialog = customComponent(
  'component.instance-settings-dialog',
  InstanceSettingsDialog,
);
export default CustomizedInstanceSettingsDialog;
