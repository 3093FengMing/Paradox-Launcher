import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Folder, LoaderCircle } from 'lucide-react';
import { Field, Input, Select, TextArea, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { ProfileOverrides } from '@paradox/launcher';
import { sourceView, viewProps } from '../../common/lib/view';
import { instanceDialogState, instanceNumericFields } from '../../common/lib/dialog-display';
import DefaultLauncherDialog from './LauncherDialog';
import DefaultEnvironmentEditor from '../components/EnvironmentEditor';
import type { Props as EnvironmentProps } from '../components/EnvironmentEditor';
import '../styles/business-dialogs.css';

interface OverrideProps {
  label: string; inherited: string | number; value: string | number | null | undefined;
  disabled: boolean; site: string; source?: string; multiline?: boolean; numeric?: boolean;
  readOnly?: boolean; min?: number; max?: number; onChange: (value: string | number | null) => void;
}
function DefaultOverrideField(input: OverrideProps | { props?: Readonly<Record<string, unknown>> }) {
  const p = viewProps<OverrideProps>(input), { t } = useTranslation(), enabled = p.value != null;
  return <div className={`dialog-override ${enabled ? 'is-override' : ''}`} data-ui-site="ImmersiveInstanceSettings-override-group">
    <div className="dialog-override-heading" data-ui-site="ImmersiveInstanceSettings-override-heading"><label className="inline-check" data-ui-site="ImmersiveInstanceSettings-override-label"><input type="checkbox" disabled={p.disabled} checked={enabled} onChange={event => p.onChange(event.target.checked ? p.inherited : null)} data-ui-site="ImmersiveInstanceSettings-override-toggle"/>{t('instanceDialog.overrideLabel', { label: p.label })}</label></div>
    <small data-ui-site="ImmersiveInstanceSettings-override-hint">{enabled ? t('instanceDialog.overrideDescription') : t(p.source ? 'argumentTemplates.inheritedFrom' : 'instanceDialog.inherited', { source: p.source, value: p.inherited === '' ? t('instanceDialog.emptyInherited') : p.inherited })}</small>
    {enabled && (p.multiline ? <TextArea rows={3} spellCheck={false} aria-label={p.label} disabled={p.disabled} value={p.value ?? ''} onChange={event => p.onChange(event.target.value)} data-ui-site="ImmersiveInstanceSettings-override-textarea"/>
      : <Input aria-label={p.label} value={p.value ?? ''} disabled={p.disabled} readOnly={p.readOnly} type={p.numeric ? 'number' : 'text'} min={p.min} max={p.max} onChange={event => p.onChange(p.numeric ? Number(event.target.value) : event.target.value)} data-ui-site="ImmersiveInstanceSettings-override-input"/>)}
  </div>;
}
const OverrideField = sourceView<OverrideProps>('control.override-field', DefaultOverrideField);
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
const EnvironmentEditor = sourceView<EnvironmentProps>('control.environment-editor', DefaultEnvironmentEditor);

export default function InstanceSettingsDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().instanceDraft, { t } = useTranslation(), name = useRef<HTMLInputElement>(null);
  const state = instanceDialogState(s);
  if (!state) return null;
  const { draft, settings, template, saving, locked } = state;
  const disabled = locked || !!s.activity || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  const source = template?.name ?? t('argumentTemplates.global');
  const patch = (key: keyof ProfileOverrides, value: string | number | null) => a.patchOverride(key, value);
  return <LauncherDialog title={t('instances.settings')} description={t('instanceDialog.description', { version: draft.game_version })} pending={locked} onClose={a.cancel} initialFocus={name} data-ui-site="ImmersiveInstanceSettings-shell">
    <form className="business-dialog-form instance-dialog-grid" data-ui-site="ImmersiveInstanceSettings-form" onSubmit={event => { event.preventDefault(); if (s.instanceDraft.canSubmit) void a.submit(); }}>
      <section className="dialog-section instance-general" data-ui-site="ImmersiveInstanceSettings-general">
        <h3 data-ui-site="ImmersiveInstanceSettings-general-title">{t('businessDialogs.instanceGeneral')}</h3>
        <Field label={t('instances.name')} data-ui-site="ImmersiveInstanceSettings-name-field"><Input ref={name} required value={draft.name} maxLength={64} disabled={disabled} onChange={event => a.patch({ name: event.target.value })} data-ui-site="ImmersiveInstanceSettings-name"/></Field>
        <Field label={t('instanceDialog.gameRoot')} description={t('instanceDialog.gameRootDescription')} data-ui-site="ImmersiveInstanceSettings-directory-field"><Input readOnly value={draft.game_directory ?? settings.game_directory} data-ui-site="ImmersiveInstanceSettings-directory"/></Field>
        <div className="dialog-inline-tools" data-ui-site="ImmersiveInstanceSettings-directory-tools">
          <button type="button" className="secondary small" disabled={disabled || !s.window.desktop} onClick={() => void a.chooseDirectory()} data-ui-site="ImmersiveInstanceSettings-choose-directory"><Folder size={15} aria-hidden="true" data-ui-site="ImmersiveInstanceSettings-directory-icon"/>{t('importDialog.chooseDirectory')}</button>
          <label className="inline-check" data-ui-site="ImmersiveInstanceSettings-directory-inherit-label"><input type="checkbox" disabled={disabled || (!s.window.desktop && draft.game_directory == null)} checked={draft.game_directory == null} onChange={event => { if (event.target.checked) a.patch({ game_directory: null }); else void a.chooseDirectory(); }} data-ui-site="ImmersiveInstanceSettings-directory-inherit"/>{t('businessDialogs.inheritDirectory')}</label>
        </div>
      </section>
      <section className="dialog-section instance-runtime" data-ui-site="ImmersiveInstanceSettings-runtime">
        <h3 data-ui-site="ImmersiveInstanceSettings-runtime-title">{t('businessDialogs.instanceRuntime')}</h3>
        <UiIdentity namespace="setting" value="java_executable"><OverrideField site="ImmersiveInstanceSettings-java" label={t('settings.javaExecutable')} inherited={settings.java_executable} value={draft.overrides.java_executable} readOnly disabled={disabled} onChange={value => patch('java_executable', value)} data-ui-site="ImmersiveInstanceSettings-java-control"/></UiIdentity>
        <button type="button" className="secondary small" disabled={disabled || !s.window.desktop} onClick={() => void a.chooseJava()} data-ui-site="ImmersiveInstanceSettings-choose-java"><Folder size={15} aria-hidden="true" data-ui-site="ImmersiveInstanceSettings-java-icon"/>{t('instanceDialog.chooseJava')}</button>
        <div className="dialog-paired-fields" data-ui-site="ImmersiveInstanceSettings-numeric">{instanceNumericFields.map(field => <UiIdentity key={field.key} namespace="setting" value={field.key}><OverrideField site={`ImmersiveInstanceSettings-${field.key}`} label={t(field.label)} inherited={settings[field.key]} value={draft.overrides[field.key]} numeric min={field.min} max={field.max} disabled={disabled} onChange={value => patch(field.key, value)} data-ui-site="ImmersiveInstanceSettings-numeric-control"/></UiIdentity>)}</div>
      </section>
      <section className="dialog-section instance-arguments" data-ui-site="ImmersiveInstanceSettings-arguments">
        <h3 data-ui-site="ImmersiveInstanceSettings-arguments-title">{t('businessDialogs.instanceArguments')}</h3>
        <Field label={t('argumentTemplates.select')} description={t('argumentTemplates.precedence')} data-ui-site="ImmersiveInstanceSettings-template-field"><Select value={draft.overrides.argument_template ?? ''} disabled={disabled} options={[{ value: '', label: t('argumentTemplates.global') }, ...settings.argument_templates.map(item => ({ value: item.id, label: item.name }))]} onValueChange={value => patch('argument_template', value || null)} data-ui-site="ImmersiveInstanceSettings-template"/></Field>
        <div className="dialog-paired-fields" data-ui-site="ImmersiveInstanceSettings-argument-fields">
          <UiIdentity namespace="setting" value="extra_jvm_arguments"><OverrideField site="ImmersiveInstanceSettings-jvm" label={t('instanceDialog.jvmArguments')} inherited={template?.jvm ?? settings.extra_jvm_arguments} value={draft.overrides.extra_jvm_arguments} source={source} multiline disabled={disabled} onChange={value => patch('extra_jvm_arguments', value)} data-ui-site="ImmersiveInstanceSettings-jvm-control"/></UiIdentity>
          <UiIdentity namespace="setting" value="extra_game_arguments"><OverrideField site="ImmersiveInstanceSettings-game" label={t('instanceDialog.gameArguments')} inherited={template?.game ?? settings.extra_game_arguments} value={draft.overrides.extra_game_arguments} source={source} multiline disabled={disabled} onChange={value => patch('extra_game_arguments', value)} data-ui-site="ImmersiveInstanceSettings-game-control"/></UiIdentity>
        </div>
      </section>
      <section className="dialog-section instance-environment" data-ui-site="ImmersiveInstanceSettings-environment">
        <h3 data-ui-site="ImmersiveInstanceSettings-environment-title">{t('argumentTemplates.instanceEnvironment')}</h3><p className="dialog-help" data-ui-site="ImmersiveInstanceSettings-environment-precedence">{t('argumentTemplates.environmentPrecedence')}</p>
        {template && Object.keys(template.environment).length > 0 && <details className="dialog-inherited" data-ui-site="ImmersiveInstanceSettings-inherited"><summary data-ui-site="ImmersiveInstanceSettings-inherited-summary">{t('argumentTemplates.inheritedEnvironment', { name: template.name })}</summary>{Object.entries(template.environment).map(([key, value]) => <UiIdentity key={key} namespace="environment" value={key}><Field label={key} data-ui-site="ImmersiveInstanceSettings-inherited-field"><TextArea readOnly rows={2} value={value} data-ui-site="ImmersiveInstanceSettings-inherited-value"/></Field></UiIdentity>)}</details>}
        <EnvironmentEditor rows={s.instanceDraft.environment} disabled={disabled} onChange={a.setEnvironment} data-ui-site="ImmersiveInstanceSettings-environment-control"/><p className="dialog-help" data-ui-site="ImmersiveInstanceSettings-environment-help">{t('argumentTemplates.environmentHelp')}</p>
      </section>
      <footer className="dialog-actions" data-ui-site="ImmersiveInstanceSettings-actions"><button type="button" className="secondary" disabled={locked} onClick={a.cancel} data-ui-site="ImmersiveInstanceSettings-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!s.instanceDraft.canSubmit} data-ui-site="ImmersiveInstanceSettings-submit">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ImmersiveInstanceSettings-saving-icon"/> : <Check size={16} aria-hidden="true" data-ui-site="ImmersiveInstanceSettings-save-icon"/>}{t('instanceDialog.save')}</button></footer>
    </form>
  </LauncherDialog>;
}
