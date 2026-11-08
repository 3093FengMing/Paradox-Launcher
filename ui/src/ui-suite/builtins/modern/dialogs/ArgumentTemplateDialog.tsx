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
  const s = useLauncherSnapshot(), a = useLauncherActions().argumentTemplates, { t } = useTranslation(), name = useRef<HTMLInputElement>(null);
  const { editor, error, disabled } = argumentTemplateDialogState(s);
  if (!editor) return null;
  return <UiIdentity namespace="argument-template" value={editor.id}><LauncherDialog title={t('argumentTemplates.editor')} description={t('argumentTemplates.draftHelp')} pending={disabled} onClose={a.cancel} initialFocus={() => name.current?.disabled ? true : name.current} data-ui-site="ModernTemplate-shell">
    <form className="business-dialog-form" noValidate onSubmit={event => { event.preventDefault(); if (!disabled) a.apply(); }} data-ui-site="ModernTemplate-form">
      <section className="dialog-section" data-ui-site="ModernTemplate-fields"><Field label={t('argumentTemplates.name')} data-ui-site="ModernTemplate-name-field"><Input ref={name} value={editor.name} disabled={disabled} maxLength={96} onChange={event => a.patch({ name: event.target.value })} data-ui-site="ModernTemplate-name"/></Field><Field label={t('instanceDialog.jvmArguments')} data-ui-site="ModernTemplate-jvm-field"><TextArea rows={3} value={editor.jvm} disabled={disabled} spellCheck={false} onChange={event => a.patch({ jvm: event.target.value })} data-ui-site="ModernTemplate-jvm"/></Field><Field label={t('instanceDialog.gameArguments')} data-ui-site="ModernTemplate-game-field"><TextArea rows={3} value={editor.game} disabled={disabled} spellCheck={false} onChange={event => a.patch({ game: event.target.value })} data-ui-site="ModernTemplate-game"/></Field></section>
      <section className="dialog-section" data-ui-site="ModernTemplate-environment"><h3 data-ui-site="ModernTemplate-environment-title">{t('argumentTemplates.environment')}</h3><p className="dialog-help" data-ui-site="ModernTemplate-environment-help">{t('argumentTemplates.environmentHelp')}</p><EnvironmentEditor rows={s.drafts.environment} disabled={disabled} onChange={a.setEnvironment} data-ui-site="ModernTemplate-environment-control"/></section>
      {error && <p className="dialog-error" role="alert" data-ui-site="ModernTemplate-error">{t(error)}</p>}
      <footer className="dialog-actions" data-ui-site="ModernTemplate-actions"><button type="button" className="secondary" disabled={disabled} onClick={a.cancel} data-ui-site="ModernTemplate-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={disabled} data-ui-site="ModernTemplate-submit"><Check size={16} aria-hidden="true" data-ui-site="ModernTemplate-apply-icon"/>{t('argumentTemplates.apply')}</button></footer>
    </form>
  </LauncherDialog></UiIdentity>;
}
