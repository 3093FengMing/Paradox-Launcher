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
  const selected = s.launch.selection, config = s.config.value;
  if (!selected || !config) return null;
  const disabled = selected.submitting || s.accounts.pending || !s.accounts.ready || s.accounts.loading;
  return <LauncherDialog title={t('auth.launchTitle')} description={t('auth.launchDescription', { name: config.profiles.find(profile => profile.instance_key === selected.profileKey)?.name ?? selected.profileKey })} pending={selected.submitting} onClose={a.cancelSelection} initialFocus={() => select.current?.disabled ? true : select.current} data-ui-site="ImmersiveLaunchAccount-shell">
    <form className="business-dialog-form" data-ui-site="ImmersiveLaunchAccount-form" onSubmit={event => { event.preventDefault(); if (selected.canSubmit) void a.confirmAccount(); }}>
      <section className="dialog-section" data-ui-site="ImmersiveLaunchAccount-content"><Field label={t('auth.select')} data-ui-site="ImmersiveLaunchAccount-account-field"><Select ref={select} value={selected.accountId ?? ''} disabled={disabled} options={[{ value: '', label: t('auth.offlineOption', { name: config.settings.offline_username }) }, ...s.accounts.state.accounts.map(account => ({ value: account.id, label: account.name }))]} onValueChange={id => a.chooseAccount(id || null)} data-ui-site="ImmersiveLaunchAccount-select"/></Field></section>
      <footer className="dialog-actions" data-ui-site="ImmersiveLaunchAccount-actions"><button type="button" className="secondary" disabled={selected.submitting} onClick={a.cancelSelection} data-ui-site="ImmersiveLaunchAccount-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!selected.canSubmit} data-ui-site="ImmersiveLaunchAccount-submit">{t('auth.launch')}</button></footer>
    </form>
  </LauncherDialog>;
}
