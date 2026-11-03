import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Check, Copy, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { Badge, Field, Panel } from '../components/ui';
import AccountAvatar from '../components/AccountAvatar';

function AccountsPage() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions();
  const accounts = snapshot.accounts;
  const username = snapshot.config.value?.settings.offline_username ?? '';
  const draftUsername = snapshot.settings.draft?.offline_username ?? '';
  const busy =
    !!snapshot.activity || snapshot.downloads.active || snapshot.downloads.pending.length > 0;
  const saving = snapshot.settings.saving;
  const desktop = snapshot.window.desktop;
  const {
    clientIdDraft: clientId,
    removingId: removing,
    promptActionPending: promptPending,
    promptExpired: codeExpired,
  } = accounts;
  const disabled = busy || saving || accounts.pending || accounts.loading || !accounts.ready;
  const promptDisabled = promptPending !== null || accounts.cancelling || codeExpired;
  return (
    <div className="account-grid">
      <Panel className="account-detail">
        <div className="card-eyebrow">
          {t('accounts.offlineIdentity')}
          <Badge>
            {t(
              accounts.ready && accounts.state.active === null
                ? 'auth.selected'
                : 'accounts.enabled',
            )}
          </Badge>
        </div>
        <div className="account-title">
          <AccountAvatar name={username} className="large" />
          <div>
            <h2>{username}</h2>
            <p>{t('accounts.localIdentity')}</p>
          </div>
        </div>
        <Field label={t('accounts.playerName')} description={t('accounts.nameDescription')}>
          <input
            value={draftUsername}
            disabled={disabled}
            onChange={(event) => actions.settings.patch('offline_username', event.target.value)}
            maxLength={16}
          />
        </Field>
        <p className="help-text">{t('accounts.offlineHelp')}</p>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => {
            void actions.accounts.saveOfflineName();
          }}
        >
          <Check size={17} />
          {t('accounts.save')}
        </button>
        <button
          className="secondary"
          disabled={disabled || !desktop || accounts.state.active === null}
          onClick={() => {
            void actions.accounts.select(null);
          }}
        >
          <UserRound size={17} />
          {t('auth.useOffline')}
        </button>
      </Panel>
      <Panel>
        <div className="microsoft-mark">
          <i />
          <i />
          <i />
          <i />
        </div>
        <h2>{t('accounts.microsoft')}</h2>
        <p className="help-text">{t('auth.description')}</p>
        {accounts.loading && (
          <p className="help-text" role="status">
            {t('auth.loading')}
          </p>
        )}
        {accounts.loadError !== null && (
          <div role="alert">
            <p className="help-text">{t('auth.loadFailed')}</p>
            <button
              className="secondary"
              disabled={busy || saving || accounts.loading || accounts.pending}
              onClick={() => {
                void actions.accounts.reload();
              }}
            >
              <RefreshCw size={16} />
              {t('common.retry')}
            </button>
          </div>
        )}
        {accounts.pending && !accounts.prompt && (
          <div>
            <p className="help-text" role="status">
              {t(accounts.cancelling ? 'auth.cancelling' : 'auth.busy')}
            </p>
            {accounts.loginPending && (
              <button
                className="secondary"
                disabled={accounts.cancelling}
                onClick={() => {
                  void actions.accounts.cancelLogin();
                }}
              >
                {t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}
              </button>
            )}
          </div>
        )}
        <Field label={t('auth.clientId')} description={t('auth.clientIdHelp')}>
          <input
            value={clientId}
            disabled={disabled}
            maxLength={36}
            onChange={(event) => actions.accounts.patchClientId(event.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </Field>
        <div className="action-row">
          <button
            className="secondary"
            disabled={
              disabled || !desktop || clientId === accounts.state.client_id || !clientId.trim()
            }
            onClick={() => {
              void actions.accounts.configure(clientId);
            }}
          >
            {t('auth.saveClientId')}
          </button>
          <button
            className="primary"
            disabled={disabled || !desktop || !accounts.state.client_id}
            onClick={() => {
              void actions.accounts.login();
            }}
          >
            {t('auth.login')}
          </button>
        </div>
        {!desktop && <p className="help-text">{t('api.desktopOnly')}</p>}
        {accounts.prompt && (
          <div className="login-prompt" role="status" aria-live="polite">
            <p>{t('auth.deviceHelp')}</p>
            <button
              className="text-button"
              disabled={promptDisabled}
              onClick={() => {
                void actions.accounts.openLoginPage();
              }}
            >
              {accounts.prompt.verification_uri}
            </button>
            <p className="device-code">{accounts.prompt.user_code}</p>
            <div className="action-row">
              <button
                className="secondary"
                disabled={promptDisabled}
                onClick={() => {
                  void actions.accounts.copyLoginCode();
                }}
              >
                <Copy size={16} />
                {t('auth.copyCode')}
              </button>
              <button
                className="secondary"
                disabled={accounts.cancelling}
                onClick={() => {
                  void actions.accounts.cancelLogin();
                }}
              >
                {t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}
              </button>
            </div>
            <p className="help-text">
              {accounts.cancelling
                ? t('auth.cancelling')
                : codeExpired
                  ? t('auth.codeExpired')
                  : t('auth.expiresAt', {
                      time: new Date(accounts.prompt.expires_at * 1000).toLocaleTimeString(),
                    })}
            </p>
          </div>
        )}
        {accounts.recovery.length > 0 && (
          <div className="login-prompt" role="alert">
            <h3>{t('auth.recoveryTitle')}</h3>
            <p className="help-text">{t('auth.recoveryDescription')}</p>
            <div className="account-list">
              {accounts.recovery.map((id, index) => (
                <div className="action-row account-recovery-entry" key={id}>
                  <span>{t('auth.recoveryCredential', { number: index + 1 })}</span>
                  <button
                    className="secondary"
                    disabled={disabled || !desktop}
                    onClick={() => {
                      void actions.accounts.clearRecovery(id);
                    }}
                  >
                    {t('auth.clearRecovery')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="account-list">
          {accounts.ready && accounts.state.accounts.length === 0 && (
            <p className="help-text">{t('auth.noAccounts')}</p>
          )}
          {accounts.state.accounts.map((account) => (
            <article className="account-entry" key={account.id}>
              <div className="account-entry-identity">
                <AccountAvatar account={account} name={account.name} />
                <div>
                  <strong>{account.name}</strong>
                  <p className="help-text">{account.id}</p>
                  {accounts.state.active === account.id && <Badge>{t('auth.selected')}</Badge>}
                </div>
              </div>
              <div className="action-row">
                <button
                  className="secondary"
                  disabled={disabled || accounts.state.active === account.id}
                  onClick={() => {
                    void actions.accounts.select(account.id);
                  }}
                >
                  {t('auth.select')}
                </button>
                <button
                  className="secondary"
                  disabled={disabled || !desktop}
                  aria-label={t('auth.refresh')}
                  onClick={() => {
                    void actions.accounts.refresh(account.id);
                  }}
                >
                  <RefreshCw size={16} />
                </button>
                {removing === account.id ? (
                  <>
                    <button
                      className="danger"
                      disabled={disabled}
                      onClick={() => {
                        void actions.accounts.confirmLogout();
                      }}
                    >
                      {t('auth.confirmLogout')}
                    </button>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={actions.accounts.cancelLogout}
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    className="secondary"
                    disabled={disabled}
                    aria-label={t('auth.logout')}
                    onClick={() => actions.accounts.beginLogout(account.id)}
                  >
                    <LogOut size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

const CustomizedAccountsPage = customComponent('page.accounts', AccountsPage);
export default CustomizedAccountsPage;
