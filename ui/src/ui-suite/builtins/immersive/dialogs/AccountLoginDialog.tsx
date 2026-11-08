import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { Copy, ExternalLink, KeyRound } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/account-login.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function AccountLoginDialog() {
  const { t } = useTranslation(), accounts = useLauncherSnapshot().accounts, a = useLauncherActions().accounts;
  const prompt = accounts.prompt;
  if (!prompt) return null;
  const disabled = accounts.promptActionPending !== null || accounts.cancelling || accounts.promptExpired;
  return <UiIdentity namespace="login" value={prompt.id}><LauncherDialog title={t('auth.login')} description={t('auth.deviceHelp')} pending={accounts.cancelling} onClose={() => void a.cancelLogin()} data-ui-site="Login-dialog">
    <div className="account-login immersive-login" data-ui-site="Login-content">
      <div className="account-login-code" data-ui-site="Login-code-panel"><KeyRound size={24} data-ui-site="Login-code-icon"/><p data-ui-site="Login-code-label">{t('accountDiscovery.deviceCode')}</p><strong data-ui-site="Login-code">{prompt.user_code}</strong></div>
      <div className="account-login-steps" data-ui-site="Login-steps"><p data-ui-site="Login-step-help">{t('accountDiscovery.deviceSteps')}</p><button className="primary account-login-open" disabled={disabled} onClick={() => void a.openLoginPage()} data-ui-site="Login-open"><ExternalLink size={16} data-ui-site="Login-open-icon"/>{t(accounts.promptActionPending === 'open' ? 'accountDiscovery.opening' : 'accountDiscovery.openPage')}</button><p className="account-login-uri" data-ui-site="Login-uri">{prompt.verification_uri}</p><button className="secondary" disabled={disabled} onClick={() => void a.copyLoginCode()} data-ui-site="Login-copy"><Copy size={16} data-ui-site="Login-copy-icon"/>{t(accounts.promptActionPending === 'copy' ? 'accountDiscovery.copying' : 'auth.copyCode')}</button></div>
      <div className="account-login-footer" data-ui-site="Login-footer"><p role="status" aria-live="polite" data-ui-site="Login-status">{accounts.cancelling ? t('auth.cancelling') : accounts.promptExpired ? t('auth.codeExpired') : t('auth.expiresAt', { time: new Date(prompt.expires_at * 1000).toLocaleTimeString() })}</p>{accounts.promptExpired && !accounts.cancelling && <p data-ui-site="Login-expired-help">{t('accountDiscovery.expiredHelp')}</p>}<button className="secondary" disabled={accounts.cancelling} onClick={() => void a.cancelLogin()} data-ui-site="Login-cancel">{t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}</button></div>
    </div>
  </LauncherDialog></UiIdentity>;
}
