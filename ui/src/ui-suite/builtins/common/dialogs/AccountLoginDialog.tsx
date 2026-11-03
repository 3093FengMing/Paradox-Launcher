import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { Copy } from 'lucide-react';
import DefaultLauncherDialog from './LauncherDialog';
export default function AccountLoginDialog() {
  const { t } = useTranslation();
  const accounts = useLauncherSnapshot().accounts,
    actions = useLauncherActions(),
    codeExpired = accounts.promptExpired,
    promptDisabled = accounts.promptActionPending !== null || accounts.cancelling || codeExpired;
  if (!accounts.prompt) return null;
  return (
    <LauncherDialog
      title={t('auth.login')}
      description={t('auth.deviceHelp')}
      pending={accounts.cancelling}
      onClose={() => {
        void actions.accounts.cancelLogin();
      }}
      data-ui-site="AccountLoginDialog-1"
    >
      {' '}
      <div
        className="login-prompt"
        role="status"
        aria-live="polite"
        data-ui-site="AccountLoginDialog-2"
      >
        <p data-ui-site="AccountLoginDialog-3">{t('auth.deviceHelp')}</p>
        <button
          className="text-button"
          disabled={promptDisabled}
          onClick={() => {
            void actions.accounts.openLoginPage();
          }}
          data-ui-site="AccountLoginDialog-4"
        >
          {accounts.prompt.verification_uri}
        </button>
        <p className="device-code" data-ui-site="AccountLoginDialog-5">
          {accounts.prompt.user_code}
        </p>
        <div className="action-row" data-ui-site="AccountLoginDialog-6">
          <button
            className="secondary"
            disabled={promptDisabled}
            onClick={() => {
              void actions.accounts.copyLoginCode();
            }}
            data-ui-site="AccountLoginDialog-7"
          >
            <Copy size={16} data-ui-site="AccountLoginDialog-8" />
            {t('auth.copyCode')}
          </button>
          <button
            className="secondary"
            disabled={accounts.cancelling}
            onClick={() => {
              void actions.accounts.cancelLogin();
            }}
            data-ui-site="AccountLoginDialog-9"
          >
            {t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}
          </button>
        </div>
        <p className="help-text" data-ui-site="AccountLoginDialog-10">
          {accounts.cancelling
            ? t('auth.cancelling')
            : codeExpired
              ? t('auth.codeExpired')
              : t('auth.expiresAt', {
                  time: new Date(accounts.prompt.expires_at * 1000).toLocaleTimeString(),
                })}
        </p>
      </div>
    </LauncherDialog>
  );
}
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
