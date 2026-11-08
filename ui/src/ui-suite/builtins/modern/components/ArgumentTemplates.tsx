import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { argumentTemplateState } from '../../common/lib/settings-display';
import DefaultDialog from '../dialogs/ArgumentTemplateDialog';
import '../styles/settings.css';
const Dialog = sourceView('dialog.argument-template', DefaultDialog);
export default function ArgumentTemplates() {
    const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions().argumentTemplates, id = useId();
    const { templates, usedIds, disabled } = argumentTemplateState(s);
    const add = <button type="button" className="secondary" disabled={disabled || templates.length >= 16} onClick={a.openNew} data-ui-site="Templates-1">
    <Plus size={16} aria-hidden="true" data-ui-site="Templates-2"/>{t('argumentTemplates.add')}</button>;
    const list = <div className="settings-template-list" data-ui-site="Templates-3">{templates.map(template => {
            const used = usedIds.includes(template.id);
            return <UiIdentity key={template.id} namespace="argument-template" value={template.id}>
            <article className="settings-template" data-ui-site="Templates-4">
            <div className="settings-template-copy" data-ui-site="Templates-5">
            <h4 data-ui-site="Templates-6">{template.name}</h4>{used && <p data-ui-site="Templates-7">{t('argumentTemplates.inUse')}</p>}</div>
            <div className="settings-template-actions" data-ui-site="Templates-8">
            <button type="button" className="secondary" disabled={disabled} onClick={() => a.openEdit(template.id)} data-ui-site="Templates-9">{t('argumentTemplates.edit')}</button>
            <button type="button" className="secondary" disabled={disabled || used} title={used ? t('argumentTemplates.inUse') : undefined} aria-label={t('argumentTemplates.remove', { name: template.name })} onClick={() => a.remove(template.id)} data-ui-site="Templates-10">
            <Trash2 size={15} aria-hidden="true" data-ui-site="Templates-11"/>
            </button>
            </div>
            </article>
            </UiIdentity>;
        })}</div>;
    return <section className="settings-templates modern-templates" aria-labelledby={id} data-ui-site="Templates-12">
    <header className="settings-template-heading" data-ui-site="Templates-13">
    <div data-ui-site="Templates-14">
    <h2 id={id} data-ui-site="Templates-15">{t('argumentTemplates.title')}</h2>
    <p data-ui-site="Templates-16">{t('argumentTemplates.description')}</p>
    </div>{add}</header>
    <p data-ui-site="Templates-17">{t('argumentTemplates.precedence')}</p>{templates.length === 0 && <p className="settings-template-empty" data-ui-site="Templates-18">{t('argumentTemplates.empty')}</p>}{list}<p className="settings-template-limit" data-ui-site="Templates-19">{t('argumentTemplates.limit', { count: templates.length })}</p>
    {s.drafts.argumentTemplate ? <UiIdentity namespace="argument-template" value={s.drafts.argumentTemplate.id}><Dialog data-ui-site="Templates-dialog-bound"/></UiIdentity> : <Dialog data-ui-site="Templates-20"/>}
    </section>;
}
