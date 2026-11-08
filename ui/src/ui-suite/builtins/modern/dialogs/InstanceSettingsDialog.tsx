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
  label: string; value: string | number | null | undefined; inherited: string | number;
  source?: string; numeric?: boolean; multiline?: boolean; readOnly?: boolean;
  min?: number; max?: number; disabled: boolean; site: string;
  onChange: (value: string | number | null) => void;
}
function DefaultOverrideField(input: OverrideProps | { props?: Readonly<Record<string, unknown>> }) {
  const p = viewProps<OverrideProps>(input), { t } = useTranslation();
  const enabled = p.value !== null && p.value !== undefined;
  return <div className="dialog-override" data-ui-site="ModernInstanceSettings-override-group">
    <label className="inline-check" data-ui-site="ModernInstanceSettings-override-label">
      <input type="checkbox" checked={enabled} disabled={p.disabled} onChange={event => p.onChange(event.target.checked ? p.inherited : null)} data-ui-site="ModernInstanceSettings-override-toggle"/>
      {t('instanceDialog.overrideLabel', { label: p.label })}
    </label>
    <small data-ui-site="ModernInstanceSettings-override-hint">{enabled ? t('instanceDialog.overrideDescription') : t(p.source ? 'argumentTemplates.inheritedFrom' : 'instanceDialog.inherited', { source: p.source, value: p.inherited === '' ? t('instanceDialog.emptyInherited') : p.inherited })}</small>
    {enabled && (p.multiline
      ? <TextArea aria-label={p.label} rows={3} spellCheck={false} disabled={p.disabled} value={p.value ?? ''} onChange={event => p.onChange(event.target.value)} data-ui-site="ModernInstanceSettings-override-textarea"/>
      : <Input aria-label={p.label} type={p.numeric ? 'number' : 'text'} min={p.min} max={p.max} disabled={p.disabled} readOnly={p.readOnly} value={p.value ?? ''} onChange={event => p.onChange(p.numeric ? Number(event.target.value) : event.target.value)} data-ui-site="ModernInstanceSettings-override-input"/>)}
  </div>;
}
const OverrideField = sourceView<OverrideProps>('control.override-field', DefaultOverrideField);
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
const EnvironmentEditor = sourceView<EnvironmentProps>('control.environment-editor', DefaultEnvironmentEditor);

export default function InstanceSettingsDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().instanceDraft, { t } = useTranslation();
  const state = instanceDialogState(s), name = useRef<HTMLInputElement>(null);
  if (!state) return null;
  const { draft, settings, template, saving, locked } = state;
  const editingBlocked = locked || !!s.activity || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  const source = template?.name ?? t('argumentTemplates.global');
  const patch = (key: keyof ProfileOverrides, value: string | number | null) => a.patchOverride(key, value);
  return <LauncherDialog title={t('instances.settings')} description={t('instanceDialog.description', { version: draft.game_version })} pending={locked} onClose={a.cancel} initialFocus={name} data-ui-site="ModernInstanceSettings-shell">
    <form className="business-dialog-form" data-ui-site="ModernInstanceSettings-form" onSubmit={event => { event.preventDefault(); if (s.instanceDraft.canSubmit) void a.submit(); }}>
      <section className="dialog-section" data-ui-site="ModernInstanceSettings-general">
        <h3 data-ui-site="ModernInstanceSettings-general-title">{t('businessDialogs.instanceGeneral')}</h3>
        <Field label={t('instances.name')} data-ui-site="ModernInstanceSettings-name-field"><Input ref={name} required maxLength={64} disabled={editingBlocked} value={draft.name} onChange={event => a.patch({ name: event.target.value })} data-ui-site="ModernInstanceSettings-name"/></Field>
        <Field label={t('instanceDialog.gameRoot')} description={t('instanceDialog.gameRootDescription')} data-ui-site="ModernInstanceSettings-directory-field">
          <Input readOnly value={draft.game_directory ?? settings.game_directory} data-ui-site="ModernInstanceSettings-directory"/>
        </Field>
        <div className="dialog-inline-tools" data-ui-site="ModernInstanceSettings-directory-tools">
          <label className="inline-check" data-ui-site="ModernInstanceSettings-directory-inherit-label"><input type="checkbox" checked={draft.game_directory == null} disabled={editingBlocked || (!s.window.desktop && draft.game_directory == null)} onChange={event => { if (event.target.checked) a.patch({ game_directory: null }); else void a.chooseDirectory(); }} data-ui-site="ModernInstanceSettings-directory-inherit"/>{t('businessDialogs.inheritDirectory')}</label>
          <button type="button" className="secondary small" disabled={editingBlocked || !s.window.desktop} onClick={() => void a.chooseDirectory()} data-ui-site="ModernInstanceSettings-choose-directory"><Folder size={15} aria-hidden="true" data-ui-site="ModernInstanceSettings-directory-icon"/>{t('importDialog.chooseDirectory')}</button>
        </div>
      </section>
      <section className="dialog-section" data-ui-site="ModernInstanceSettings-runtime">
        <h3 data-ui-site="ModernInstanceSettings-runtime-title">{t('businessDialogs.instanceRuntime')}</h3>
        <UiIdentity namespace="setting" value="java_executable"><OverrideField label={t('settings.javaExecutable')} value={draft.overrides.java_executable} inherited={settings.java_executable} readOnly disabled={editingBlocked} onChange={value => patch('java_executable', value)} site="ModernInstanceSettings-java" data-ui-site="ModernInstanceSettings-java-control"/></UiIdentity>
        <button type="button" className="secondary small" disabled={editingBlocked || !s.window.desktop} onClick={() => void a.chooseJava()} data-ui-site="ModernInstanceSettings-choose-java"><Folder size={15} aria-hidden="true" data-ui-site="ModernInstanceSettings-java-icon"/>{t('instanceDialog.chooseJava')}</button>
        <div className="dialog-paired-fields" data-ui-site="ModernInstanceSettings-numeric">{instanceNumericFields.map(field => <UiIdentity key={field.key} namespace="setting" value={field.key}><OverrideField label={t(field.label)} value={draft.overrides[field.key]} inherited={settings[field.key]} numeric min={field.min} max={field.max} disabled={editingBlocked} onChange={value => patch(field.key, value)} site={`ModernInstanceSettings-${field.key}`} data-ui-site="ModernInstanceSettings-numeric-control"/></UiIdentity>)}</div>
      </section>
      <section className="dialog-section" data-ui-site="ModernInstanceSettings-arguments">
        <h3 data-ui-site="ModernInstanceSettings-arguments-title">{t('businessDialogs.instanceArguments')}</h3>
        <Field label={t('argumentTemplates.select')} description={t('argumentTemplates.precedence')} data-ui-site="ModernInstanceSettings-template-field"><Select disabled={editingBlocked} value={draft.overrides.argument_template ?? ''} onValueChange={value => patch('argument_template', value || null)} options={[{ value: '', label: t('argumentTemplates.global') }, ...settings.argument_templates.map(item => ({ value: item.id, label: item.name }))]} data-ui-site="ModernInstanceSettings-template"/></Field>
        <UiIdentity namespace="setting" value="extra_jvm_arguments"><OverrideField label={t('instanceDialog.jvmArguments')} value={draft.overrides.extra_jvm_arguments} inherited={template?.jvm ?? settings.extra_jvm_arguments} source={source} multiline disabled={editingBlocked} onChange={value => patch('extra_jvm_arguments', value)} site="ModernInstanceSettings-jvm" data-ui-site="ModernInstanceSettings-jvm-control"/></UiIdentity>
        <UiIdentity namespace="setting" value="extra_game_arguments"><OverrideField label={t('instanceDialog.gameArguments')} value={draft.overrides.extra_game_arguments} inherited={template?.game ?? settings.extra_game_arguments} source={source} multiline disabled={editingBlocked} onChange={value => patch('extra_game_arguments', value)} site="ModernInstanceSettings-game" data-ui-site="ModernInstanceSettings-game-control"/></UiIdentity>
      </section>
      <section className="dialog-section" data-ui-site="ModernInstanceSettings-environment">
        <h3 data-ui-site="ModernInstanceSettings-environment-title">{t('argumentTemplates.instanceEnvironment')}</h3>
        <p className="dialog-help" data-ui-site="ModernInstanceSettings-environment-precedence">{t('argumentTemplates.environmentPrecedence')}</p>
        {template && Object.keys(template.environment).length > 0 && <details className="dialog-inherited" data-ui-site="ModernInstanceSettings-inherited"><summary data-ui-site="ModernInstanceSettings-inherited-summary">{t('argumentTemplates.inheritedEnvironment', { name: template.name })}</summary>{Object.entries(template.environment).map(([key, value]) => <UiIdentity key={key} namespace="environment" value={key}><Field label={key} data-ui-site="ModernInstanceSettings-inherited-field"><TextArea rows={2} readOnly value={value} data-ui-site="ModernInstanceSettings-inherited-value"/></Field></UiIdentity>)}</details>}
        <EnvironmentEditor rows={s.instanceDraft.environment} disabled={editingBlocked} onChange={a.setEnvironment} data-ui-site="ModernInstanceSettings-environment-control"/>
        <p className="dialog-help" data-ui-site="ModernInstanceSettings-environment-help">{t('argumentTemplates.environmentHelp')}</p>
      </section>
      <footer className="dialog-actions" data-ui-site="ModernInstanceSettings-actions"><button type="button" className="secondary" disabled={locked} onClick={a.cancel} data-ui-site="ModernInstanceSettings-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!s.instanceDraft.canSubmit} data-ui-site="ModernInstanceSettings-submit">{saving ? <LoaderCircle className="spin" size={16} aria-hidden="true" data-ui-site="ModernInstanceSettings-saving-icon"/> : <Check size={16} aria-hidden="true" data-ui-site="ModernInstanceSettings-save-icon"/>}{t('instanceDialog.save')}</button></footer>
    </form>
  </LauncherDialog>;
}
