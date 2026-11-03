import '../styles/common.css';
import { sourceView } from '../lib/view';
import DefaultTemplateDialog from '../dialogs/ArgumentTemplateDialog';
import { useId } from 'react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
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
  return (
    <section aria-labelledby={titleId} data-ui-site="ArgumentTemplates-1">
      <h3 id={titleId} data-ui-site="ArgumentTemplates-2">
        {t('argumentTemplates.title')}
      </h3>
      <p className="help-text" data-ui-site="ArgumentTemplates-3">
        {t('argumentTemplates.description')}
      </p>
      <p className="help-text" data-ui-site="ArgumentTemplates-4">
        {t('argumentTemplates.precedence')}
      </p>
      {templates.length === 0 && (
        <p className="help-text" data-ui-site="ArgumentTemplates-5">
          {t('argumentTemplates.empty')}
        </p>
      )}
      {templates.map((template) => {
        const used = usedTemplateIds.includes(template.id);
        return (
          <div className="content-entry" key={template.id} data-ui-site="ArgumentTemplates-6">
            <div data-ui-site="ArgumentTemplates-7">
              <strong data-ui-site="ArgumentTemplates-8">{template.name}</strong>
              {used && (
                <p className="help-text" data-ui-site="ArgumentTemplates-9">
                  {t('argumentTemplates.inUse')}
                </p>
              )}
            </div>
            <div className="action-row" data-ui-site="ArgumentTemplates-10">
              <button
                type="button"
                className="secondary small"
                disabled={disabled}
                onClick={() => actions.openEdit(template.id)}
                data-ui-site="ArgumentTemplates-11"
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
                data-ui-site="ArgumentTemplates-12"
              >
                <Trash2 size={15} data-ui-site="ArgumentTemplates-13" />
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
        data-ui-site="ArgumentTemplates-14"
      >
        <Plus size={16} data-ui-site="ArgumentTemplates-15" /> {t('argumentTemplates.add')}
      </button>
      <p className="help-text" data-ui-site="ArgumentTemplates-16">
        {t('argumentTemplates.limit', { count: templates.length })}
      </p>

      <TemplateDialog data-ui-site="ArgumentTemplates-17" />
    </section>
  );
}
export default ArgumentTemplates;
const TemplateDialog = sourceView('dialog.argument-template', DefaultTemplateDialog);
