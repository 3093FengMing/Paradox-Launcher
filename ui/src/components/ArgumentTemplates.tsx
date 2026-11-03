import { customComponent } from '../customization/Customizable';
import { useId } from 'react';
import { useLauncherActions, useLauncherSnapshot, type DeepReadonly } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { EnvironmentRow } from '../lib/argument-templates';
import { Field } from './ui';

interface EnvironmentEditorProps {
  rows: DeepReadonly<EnvironmentRow[]>;
  disabled: boolean;
  onChange: (rows: EnvironmentRow[]) => void;
}

function EnvironmentEditor({ rows, disabled, onChange }: EnvironmentEditorProps) {
  const { t } = useTranslation();
  return (
    <div>
      {rows.map((row, index) => (
        <div className="field-grid" key={index}>
          <Field label={t('argumentTemplates.variableName', { index: index + 1 })}>
            <input
              value={row.key}
              maxLength={128}
              disabled={disabled}
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  rows.map((value, current) =>
                    current === index ? { ...value, key: event.target.value } : value,
                  ),
                )
              }
            />
          </Field>
          <Field label={t('argumentTemplates.variableValue', { index: index + 1 })}>
            <textarea
              value={row.value}
              rows={2}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  rows.map((value, current) =>
                    current === index ? { ...value, value: event.target.value } : value,
                  ),
                )
              }
            />
          </Field>
          <button
            type="button"
            className="secondary small"
            disabled={disabled}
            aria-label={t('argumentTemplates.removeVariable', { index: index + 1 })}
            onClick={() => onChange(rows.filter((_, current) => current !== index))}
          >
            <Trash2 size={15} /> {t('common.remove')}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={disabled || rows.length >= 64}
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        <Plus size={15} /> {t('argumentTemplates.addVariable')}
      </button>
    </div>
  );
}

function ArgumentTemplates() {
  const { t } = useTranslation();
  const titleId = useId();
  const snapshot = useLauncherSnapshot();
  const { argumentTemplates: actions } = useLauncherActions();
  const templates = snapshot.settings.draft?.argument_templates ?? [];
  const usedTemplateIds =
    snapshot.config.value?.profiles.flatMap((profile) =>
      profile.overrides.argument_template ? [profile.overrides.argument_template] : [],
    ) ?? [];
  const disabled =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0;
  const editor = snapshot.drafts.argumentTemplate;
  const error = snapshot.drafts.argumentTemplateError;
  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId}>{t('argumentTemplates.title')}</h3>
      <p className="help-text">{t('argumentTemplates.description')}</p>
      <p className="help-text">{t('argumentTemplates.precedence')}</p>
      {templates.length === 0 && <p className="help-text">{t('argumentTemplates.empty')}</p>}
      {templates.map((template) => {
        const used = usedTemplateIds.includes(template.id);
        return (
          <div className="content-entry" key={template.id}>
            <div>
              <strong>{template.name}</strong>
              {used && <p className="help-text">{t('argumentTemplates.inUse')}</p>}
            </div>
            <div className="action-row">
              <button
                type="button"
                className="secondary small"
                disabled={disabled}
                onClick={() => actions.openEdit(template.id)}
              >
                {t('argumentTemplates.edit')}
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={disabled || used}
                title={used ? t('argumentTemplates.inUse') : undefined}
                aria-label={t('argumentTemplates.remove', { name: template.name })}
                onClick={() => actions.remove(template.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="secondary"
        disabled={disabled || templates.length >= 16}
        onClick={actions.openNew}
      >
        <Plus size={16} /> {t('argumentTemplates.add')}
      </button>
      <p className="help-text">{t('argumentTemplates.limit', { count: templates.length })}</p>
      {editor && (
        <div className="settings-section">
          <h3>{t('argumentTemplates.editor')}</h3>
          <Field label={t('argumentTemplates.name')}>
            <input
              value={editor.name}
              disabled={disabled}
              maxLength={96}
              onChange={(event) => actions.patch({ name: event.target.value })}
            />
          </Field>
          <Field label={t('instanceDialog.jvmArguments')}>
            <textarea
              rows={3}
              value={editor.jvm}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => actions.patch({ jvm: event.target.value })}
            />
          </Field>
          <Field label={t('instanceDialog.gameArguments')}>
            <textarea
              rows={3}
              value={editor.game}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => actions.patch({ game: event.target.value })}
            />
          </Field>
          <h4>{t('argumentTemplates.environment')}</h4>
          <p className="help-text">{t('argumentTemplates.environmentHelp')}</p>
          <EnvironmentEditor
            rows={snapshot.drafts.environment}
            disabled={disabled}
            onChange={actions.setEnvironment}
          />
          <p className="help-text">{t('argumentTemplates.draftHelp')}</p>
          <div className="action-row">
            <button type="button" className="primary" disabled={disabled} onClick={actions.apply}>
              <Check size={16} /> {t('argumentTemplates.apply')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={actions.cancel}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="help-text">
          {t(error)}
        </p>
      )}
    </section>
  );
}

const CustomizedEnvironmentEditor = customComponent(
  'control.environment-editor',
  EnvironmentEditor,
);
export { CustomizedEnvironmentEditor as EnvironmentEditor };

const CustomizedArgumentTemplates = customComponent(
  'component.argument-templates',
  ArgumentTemplates,
);
export default CustomizedArgumentTemplates;
