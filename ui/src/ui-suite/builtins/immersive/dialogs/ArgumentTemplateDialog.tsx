import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Field, Input, TextArea, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { argumentTemplateDialogState } from '../../common/lib/dialog-display';
import DefaultLauncherDialog from './LauncherDialog';
import DefaultEnvironmentEditor from '../components/EnvironmentEditor';
import type { Props as EnvironmentProps } from '../components/EnvironmentEditor';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
const EnvironmentEditor = sourceView<EnvironmentProps>('control.environment-editor', DefaultEnvironmentEditor);
export default function ArgumentTemplateDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().argumentTemplates, { t } = useTranslation(), name = useRef<HTMLInputElement>(null), d = argumentTemplateDialogState(s);
  if (!d.editor) return null;
  return <UiIdentity namespace="argument-template" value={d.editor.id}><LauncherDialog title={t('argumentTemplates.editor')} description={t('argumentTemplates.draftHelp')} pending={d.disabled} onClose={a.cancel} initialFocus={() => name.current?.disabled ? true : name.current} data-ui-site="ImmersiveTemplate-shell">
    <form className="business-dialog-form template-dialog-grid" noValidate onSubmit={event => { event.preventDefault(); if (!d.disabled) a.apply(); }} data-ui-site="ImmersiveTemplate-form">
      <section className="dialog-section template-name-section" data-ui-site="ImmersiveTemplate-name-section"><Field label={t('argumentTemplates.name')} data-ui-site="ImmersiveTemplate-name-field"><Input ref={name} maxLength={96} disabled={d.disabled} value={d.editor.name} onChange={event => a.patch({ name: event.target.value })} data-ui-site="ImmersiveTemplate-name"/></Field></section>
      <section className="dialog-section template-argument-section" data-ui-site="ImmersiveTemplate-argument-section"><div className="dialog-paired-fields" data-ui-site="ImmersiveTemplate-arguments"><Field label={t('instanceDialog.jvmArguments')} data-ui-site="ImmersiveTemplate-jvm-field"><TextArea rows={3} spellCheck={false} value={d.editor.jvm} disabled={d.disabled} onChange={event => a.patch({ jvm: event.target.value })} data-ui-site="ImmersiveTemplate-jvm"/></Field><Field label={t('instanceDialog.gameArguments')} data-ui-site="ImmersiveTemplate-game-field"><TextArea rows={3} spellCheck={false} value={d.editor.game} disabled={d.disabled} onChange={event => a.patch({ game: event.target.value })} data-ui-site="ImmersiveTemplate-game"/></Field></div></section>
      <section className="dialog-section template-environment-section" data-ui-site="ImmersiveTemplate-environment"><h3 data-ui-site="ImmersiveTemplate-environment-title">{t('argumentTemplates.environment')}</h3><p className="dialog-help" data-ui-site="ImmersiveTemplate-environment-help">{t('argumentTemplates.environmentHelp')}</p><EnvironmentEditor rows={s.drafts.environment} disabled={d.disabled} onChange={a.setEnvironment} data-ui-site="ImmersiveTemplate-environment-control"/></section>
      {d.error && <p className="dialog-error" role="alert" data-ui-site="ImmersiveTemplate-error">{t(d.error)}</p>}
      <footer className="dialog-actions" data-ui-site="ImmersiveTemplate-actions"><button type="button" className="secondary" disabled={d.disabled} onClick={a.cancel} data-ui-site="ImmersiveTemplate-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={d.disabled} data-ui-site="ImmersiveTemplate-submit"><Check size={16} aria-hidden="true" data-ui-site="ImmersiveTemplate-apply-icon"/>{t('argumentTemplates.apply')}</button></footer>
    </form>
  </LauncherDialog></UiIdentity>;
}
