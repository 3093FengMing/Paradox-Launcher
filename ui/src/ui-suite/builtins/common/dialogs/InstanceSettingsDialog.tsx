import '../styles/common.css';
import { useTranslation } from 'react-i18next';
import { Check, Folder, LoaderCircle } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import DefaultLauncherDialog from '../dialogs/LauncherDialog';
import { sourceView } from '../lib/view';
import { Field, Select } from '@paradox/ui';
import DefaultEnvironmentEditor from '../lib/EnvironmentEditor';
import type { ProfileOverrides } from '@paradox/launcher';
// This detached identity keeps per-instance customization targets addressable.
// Editable values and operations still come only from the permanent controller.
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
    <div className="field" data-ui-site="InstanceSettingsDialog-1">
      <label className="inline-check" data-ui-site="InstanceSettingsDialog-2">
        <input
          type="checkbox"
          disabled={disabled}
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? inherited : null)}
          data-ui-site="InstanceSettingsDialog-3"
        />
        {t('instanceDialog.overrideLabel', { label })}
      </label>
      <small data-ui-site="InstanceSettingsDialog-4">
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
            data-ui-site="InstanceSettingsDialog-5"
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
            data-ui-site="InstanceSettingsDialog-6"
          />
        ))}
    </div>
  );
}
function InstanceSettingsDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().instanceDraft;
  const { profile: draft, environment, picking, pending, canSubmit } = snapshot.instanceDraft;
  const settings = snapshot.config.value?.settings;
  const saving = snapshot.settings.saving || pending;
  const onClose = actions.cancel;
  const setEnvironment = actions.setEnvironment;
  if (!draft || !settings) return null;
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
      pending={saving || picking}
      onClose={onClose}
      title={t('instances.settings')}
      description={t('instanceDialog.description', { version: draft.game_version })}
      data-ui-site="InstanceSettingsDialog-7"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.submit();
        }}
        data-ui-site="InstanceSettingsDialog-8"
      >
        <Field label={t('instances.name')} data-ui-site="InstanceSettingsDialog-9">
          <input
            required
            maxLength={64}
            disabled={saving}
            value={draft.name}
            onChange={(event) => actions.patch({ name: event.target.value })}
            data-ui-site="InstanceSettingsDialog-10"
          />
        </Field>
        <Field
          label={t('instanceDialog.gameRoot')}
          description={t('instanceDialog.gameRootDescription')}
          data-ui-site="InstanceSettingsDialog-11"
        >
          <input
            readOnly
            value={draft.game_directory ?? settings.game_directory}
            data-ui-site="InstanceSettingsDialog-12"
          />
        </Field>
        <OverrideField
          label={t('settings.javaExecutable')}
          value={draft.overrides.java_executable}
          inherited={settings.java_executable}
          disabled={saving}
          onChange={(value) => patchOverride('java_executable', value)}
          data-ui-site="InstanceSettingsDialog-13"
        />
        <button
          type="button"
          className="secondary small"
          disabled={!snapshot.window.desktop || saving || picking}
          onClick={() => {
            void actions.chooseJava();
          }}
          data-ui-site="InstanceSettingsDialog-14"
        >
          <Folder size={15} data-ui-site="InstanceSettingsDialog-15" />
          {t('instanceDialog.chooseJava')}
        </button>
        <div className="field-grid" data-ui-site="InstanceSettingsDialog-16">
          {numericFields.map((field) => (
            <OverrideField
              key={field.key}
              label={field.label}
              numeric
              value={draft.overrides[field.key]}
              inherited={settings[field.key]}
              disabled={saving}
              onChange={(value) => patchOverride(field.key, value)}
              data-ui-site="InstanceSettingsDialog-17"
            />
          ))}
        </div>
        <Field
          label={t('argumentTemplates.select')}
          description={t('argumentTemplates.precedence')}
          data-ui-site="InstanceSettingsDialog-18"
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
            data-ui-site="InstanceSettingsDialog-19"
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
          data-ui-site="InstanceSettingsDialog-20"
        />
        <OverrideField
          label={t('instanceDialog.gameArguments')}
          multiline
          value={draft.overrides.extra_game_arguments}
          inherited={template?.game ?? settings.extra_game_arguments}
          source={argumentSource}
          disabled={saving}
          onChange={(value) => patchOverride('extra_game_arguments', value)}
          data-ui-site="InstanceSettingsDialog-21"
        />
        <h3 data-ui-site="InstanceSettingsDialog-22">
          {t('argumentTemplates.instanceEnvironment')}
        </h3>
        <p className="help-text" data-ui-site="InstanceSettingsDialog-23">
          {t('argumentTemplates.environmentPrecedence')}
        </p>
        {template && Object.keys(template.environment).length > 0 && (
          <details data-ui-site="InstanceSettingsDialog-24">
            <summary data-ui-site="InstanceSettingsDialog-25">
              {t('argumentTemplates.inheritedEnvironment', { name: template.name })}
            </summary>
            {Object.entries(template.environment).map(([key, value]) => (
              <Field label={key} key={key} data-ui-site="InstanceSettingsDialog-26">
                <textarea
                  readOnly
                  value={value}
                  rows={2}
                  data-ui-site="InstanceSettingsDialog-27"
                />
              </Field>
            ))}
          </details>
        )}
        <EnvironmentEditor
          rows={environment.map((row) => ({ ...row }))}
          disabled={saving || picking}
          onChange={setEnvironment}
          data-ui-site="InstanceSettingsDialog-28"
        />
        <p className="help-text" data-ui-site="InstanceSettingsDialog-29">
          {t('argumentTemplates.environmentHelp')}
        </p>
        <div className="modal-buttons" data-ui-site="InstanceSettingsDialog-30">
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={onClose}
            data-ui-site="InstanceSettingsDialog-31"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!canSubmit}
            data-ui-site="InstanceSettingsDialog-32"
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} data-ui-site="InstanceSettingsDialog-33" />
            ) : (
              <Check size={16} data-ui-site="InstanceSettingsDialog-34" />
            )}
            {t('instanceDialog.save')}
          </button>
        </div>
      </form>
    </LauncherDialog>
  );
}
const OverrideField = sourceView<OverrideFieldProps>(
  'control.override-field',
  DefaultOverrideField,
);
export default InstanceSettingsDialog;
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
const EnvironmentEditor = sourceView('control.environment-editor', DefaultEnvironmentEditor);
