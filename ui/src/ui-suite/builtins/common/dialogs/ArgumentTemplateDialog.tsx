import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { Check } from 'lucide-react';
import { Field } from '@paradox/ui';
import DefaultEnvironmentEditor from '../lib/EnvironmentEditor';
import DefaultLauncherDialog from './LauncherDialog';
export default function ArgumentTemplateDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions().argumentTemplates,
    editor = snapshot.drafts.argumentTemplate,
    error = snapshot.drafts.argumentTemplateError;
  const disabled =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0;
  if (!editor) return null;
  return (
    <LauncherDialog
      title={t('argumentTemplates.editor')}
      description={t('argumentTemplates.draftHelp')}
      pending={disabled}
      onClose={actions.cancel}
      data-ui-site="ArgumentTemplateDialog-1"
    >
      {' '}
      <div className="settings-section" data-ui-site="ArgumentTemplateDialog-2">
        <h3 data-ui-site="ArgumentTemplateDialog-3">{t('argumentTemplates.editor')}</h3>
        <Field label={t('argumentTemplates.name')} data-ui-site="ArgumentTemplateDialog-4">
          <input
            value={editor.name}
            disabled={disabled}
            maxLength={96}
            onChange={(event) => actions.patch({ name: event.target.value })}
            data-ui-site="ArgumentTemplateDialog-5"
          />
        </Field>
        <Field label={t('instanceDialog.jvmArguments')} data-ui-site="ArgumentTemplateDialog-6">
          <textarea
            rows={3}
            value={editor.jvm}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => actions.patch({ jvm: event.target.value })}
            data-ui-site="ArgumentTemplateDialog-7"
          />
        </Field>
        <Field label={t('instanceDialog.gameArguments')} data-ui-site="ArgumentTemplateDialog-8">
          <textarea
            rows={3}
            value={editor.game}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => actions.patch({ game: event.target.value })}
            data-ui-site="ArgumentTemplateDialog-9"
          />
        </Field>
        <h4 data-ui-site="ArgumentTemplateDialog-10">{t('argumentTemplates.environment')}</h4>
        <p className="help-text" data-ui-site="ArgumentTemplateDialog-11">
          {t('argumentTemplates.environmentHelp')}
        </p>
        <EnvironmentEditor
          rows={snapshot.drafts.environment}
          disabled={disabled}
          onChange={actions.setEnvironment}
          data-ui-site="ArgumentTemplateDialog-12"
        />
        <p className="help-text" data-ui-site="ArgumentTemplateDialog-13">
          {t('argumentTemplates.draftHelp')}
        </p>
        <div className="action-row" data-ui-site="ArgumentTemplateDialog-14">
          <button
            type="button"
            className="primary"
            disabled={disabled}
            onClick={actions.apply}
            data-ui-site="ArgumentTemplateDialog-15"
          >
            <Check size={16} data-ui-site="ArgumentTemplateDialog-16" />{' '}
            {t('argumentTemplates.apply')}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={actions.cancel}
            data-ui-site="ArgumentTemplateDialog-17"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" data-ui-site="ArgumentTemplateDialog-18">
          {t(error)}
        </p>
      )}
    </LauncherDialog>
  );
}
const EnvironmentEditor = sourceView('control.environment-editor', DefaultEnvironmentEditor);
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
