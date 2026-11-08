import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function LaunchAccountDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().launch, { t } = useTranslation(), select = useRef<HTMLButtonElement>(null);
  const selection = s.launch.selection, config = s.config.value;
  if (!selection || !config) return null;
  const disabled = selection.submitting || s.accounts.pending || !s.accounts.ready || s.accounts.loading;
  const name = config.profiles.find(profile => profile.instance_key === selection.profileKey)?.name ?? selection.profileKey;
  return <LauncherDialog title={t('auth.launchTitle')} description={t('auth.launchDescription', { name })} pending={selection.submitting} onClose={a.cancelSelection} initialFocus={() => select.current?.disabled ? true : select.current} data-ui-site="ModernLaunchAccount-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); if (selection.canSubmit) void a.confirmAccount(); }} data-ui-site="ModernLaunchAccount-form">
      <section className="dialog-section" data-ui-site="ModernLaunchAccount-content"><Field label={t('auth.select')} data-ui-site="ModernLaunchAccount-account-field"><Select ref={select} value={selection.accountId ?? ''} disabled={disabled} onValueChange={id => a.chooseAccount(id || null)} options={[{ value: '', label: t('auth.offlineOption', { name: config.settings.offline_username }) }, ...s.accounts.state.accounts.map(account => ({ value: account.id, label: account.name }))]} data-ui-site="ModernLaunchAccount-select"/></Field></section>
      <footer className="dialog-actions" data-ui-site="ModernLaunchAccount-actions"><button type="button" className="secondary" disabled={selection.submitting} onClick={a.cancelSelection} data-ui-site="ModernLaunchAccount-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!selection.canSubmit} data-ui-site="ModernLaunchAccount-submit">{t('auth.launch')}</button></footer>
    </form>
  </LauncherDialog>;
}
