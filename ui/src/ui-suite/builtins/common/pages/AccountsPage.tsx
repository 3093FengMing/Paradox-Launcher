import '../styles/common.css';
import { Fragment } from 'react';
import DefaultLoginDialog from '../dialogs/AccountLoginDialog';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { Check, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { Badge, Field, Panel } from '@paradox/ui';
import DefaultAccountAvatar from '../components/AccountAvatar';
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
  const { clientIdDraft: clientId, removingId: removing } = accounts;
  const disabled = busy || saving || accounts.pending || accounts.loading || !accounts.ready;
  return (
    <div className="account-grid" data-ui-site="AccountsPage-1">
      <Panel className="account-detail" data-ui-site="AccountsPage-2">
        <div className="card-eyebrow" data-ui-site="AccountsPage-3">
          {t('accounts.offlineIdentity')}
          <Badge data-ui-site="AccountsPage-4">
            {t(
              accounts.ready && accounts.state.active === null
                ? 'auth.selected'
                : 'accounts.enabled',
            )}
          </Badge>
        </div>
        <div className="account-title" data-ui-site="AccountsPage-5">
          <AccountAvatar name={username} className="large" data-ui-site="AccountsPage-6" />
          <div data-ui-site="AccountsPage-7">
            <h2 data-ui-site="AccountsPage-8">{username}</h2>
            <p data-ui-site="AccountsPage-9">{t('accounts.localIdentity')}</p>
          </div>
        </div>
        <Field
          label={t('accounts.playerName')}
          description={t('accounts.nameDescription')}
          data-ui-site="AccountsPage-10"
        >
          <input
            value={draftUsername}
            disabled={disabled}
            onChange={(event) => actions.settings.patch('offline_username', event.target.value)}
            maxLength={16}
            data-ui-site="AccountsPage-11"
          />
        </Field>
        <p className="help-text" data-ui-site="AccountsPage-12">
          {t('accounts.offlineHelp')}
        </p>
        <button
          className="primary"
          disabled={disabled}
          onClick={() => {
            void actions.accounts.saveOfflineName();
          }}
          data-ui-site="AccountsPage-13"
        >
          <Check size={17} data-ui-site="AccountsPage-14" />
          {t('accounts.save')}
        </button>
        <button
          className="secondary"
          disabled={disabled || !desktop || accounts.state.active === null}
          onClick={() => {
            void actions.accounts.select(null);
          }}
          data-ui-site="AccountsPage-15"
        >
          <UserRound size={17} data-ui-site="AccountsPage-16" />
          {t('auth.useOffline')}
        </button>
      </Panel>
      <Panel data-ui-site="AccountsPage-17">
        <div className="microsoft-mark" data-ui-site="AccountsPage-18">
          <i data-ui-site="AccountsPage-19" />
          <i data-ui-site="AccountsPage-20" />
          <i data-ui-site="AccountsPage-21" />
          <i data-ui-site="AccountsPage-22" />
        </div>
        <h2 data-ui-site="AccountsPage-23">{t('accounts.microsoft')}</h2>
        <p className="help-text" data-ui-site="AccountsPage-24">
          {t('auth.description')}
        </p>
        {accounts.loading && (
          <p className="help-text" role="status" data-ui-site="AccountsPage-25">
            {t('auth.loading')}
          </p>
        )}
        {accounts.loadError !== null && (
          <div role="alert" data-ui-site="AccountsPage-26">
            <p className="help-text" data-ui-site="AccountsPage-27">
              {t('auth.loadFailed')}
            </p>
            <button
              className="secondary"
              disabled={busy || saving || accounts.loading || accounts.pending}
              onClick={() => {
                void actions.accounts.reload();
              }}
              data-ui-site="AccountsPage-28"
            >
              <RefreshCw size={16} data-ui-site="AccountsPage-29" />
              {t('common.retry')}
            </button>
          </div>
        )}
        {accounts.pending && !accounts.prompt && (
          <div data-ui-site="AccountsPage-30">
            <p className="help-text" role="status" data-ui-site="AccountsPage-31">
              {t(accounts.cancelling ? 'auth.cancelling' : 'auth.busy')}
            </p>
            {accounts.loginPending && (
              <button
                className="secondary"
                disabled={accounts.cancelling}
                onClick={() => {
                  void actions.accounts.cancelLogin();
                }}
                data-ui-site="AccountsPage-32"
              >
                {t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}
              </button>
            )}
          </div>
        )}
        <Field
          label={t('auth.clientId')}
          description={t('auth.clientIdHelp')}
          data-ui-site="AccountsPage-33"
        >
          <input
            value={clientId}
            disabled={disabled}
            maxLength={36}
            onChange={(event) => actions.accounts.patchClientId(event.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            data-ui-site="AccountsPage-34"
          />
        </Field>
        <div className="action-row" data-ui-site="AccountsPage-35">
          <button
            className="secondary"
            disabled={
              disabled || !desktop || clientId === accounts.state.client_id || !clientId.trim()
            }
            onClick={() => {
              void actions.accounts.configure(clientId);
            }}
            data-ui-site="AccountsPage-36"
          >
            {t('auth.saveClientId')}
          </button>
          <button
            className="primary"
            disabled={disabled || !desktop || !accounts.state.client_id}
            onClick={() => {
              void actions.accounts.login();
            }}
            data-ui-site="AccountsPage-37"
          >
            {t('auth.login')}
          </button>
        </div>
        {!desktop && (
          <p className="help-text" data-ui-site="AccountsPage-38">
            {t('api.desktopOnly')}
          </p>
        )}
        <LoginDialog data-ui-site="AccountsPage-39" />
        {accounts.recovery.length > 0 && (
          <div className="login-prompt" role="alert" data-ui-site="AccountsPage-40">
            <h3 data-ui-site="AccountsPage-41">{t('auth.recoveryTitle')}</h3>
            <p className="help-text" data-ui-site="AccountsPage-42">
              {t('auth.recoveryDescription')}
            </p>
            <div className="account-list" data-ui-site="AccountsPage-43">
              {accounts.recovery.map((id, index) => (
                <div
                  className="action-row account-recovery-entry"
                  key={id}
                  data-ui-site="AccountsPage-44"
                >
                  <span data-ui-site="AccountsPage-45">
                    {t('auth.recoveryCredential', { number: index + 1 })}
                  </span>
                  <button
                    className="secondary"
                    disabled={disabled || !desktop}
                    onClick={() => {
                      void actions.accounts.clearRecovery(id);
                    }}
                    data-ui-site="AccountsPage-46"
                  >
                    {t('auth.clearRecovery')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="account-list" data-ui-site="AccountsPage-47">
          {accounts.ready && accounts.state.accounts.length === 0 && (
            <p className="help-text" data-ui-site="AccountsPage-48">
              {t('auth.noAccounts')}
            </p>
          )}
          {accounts.state.accounts.map((account) => (
            <article className="account-entry" key={account.id} data-ui-site="AccountsPage-49">
              <div className="account-entry-identity" data-ui-site="AccountsPage-50">
                <AccountAvatar
                  account={account}
                  name={account.name}
                  data-ui-site="AccountsPage-51"
                />
                <div data-ui-site="AccountsPage-52">
                  <strong data-ui-site="AccountsPage-53">{account.name}</strong>
                  <p className="help-text" data-ui-site="AccountsPage-54">
                    {account.id}
                  </p>
                  {accounts.state.active === account.id && (
                    <Badge data-ui-site="AccountsPage-55">{t('auth.selected')}</Badge>
                  )}
                </div>
              </div>
              <div className="action-row" data-ui-site="AccountsPage-56">
                <button
                  className="secondary"
                  disabled={disabled || accounts.state.active === account.id}
                  onClick={() => {
                    void actions.accounts.select(account.id);
                  }}
                  data-ui-site="AccountsPage-57"
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
                  data-ui-site="AccountsPage-58"
                >
                  <RefreshCw size={16} data-ui-site="AccountsPage-59" />
                </button>
                {removing === account.id ? (
                  <Fragment data-ui-site="AccountsPage-60">
                    <button
                      className="danger"
                      disabled={disabled}
                      onClick={() => {
                        void actions.accounts.confirmLogout();
                      }}
                      data-ui-site="AccountsPage-61"
                    >
                      {t('auth.confirmLogout')}
                    </button>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={actions.accounts.cancelLogout}
                      data-ui-site="AccountsPage-62"
                    >
                      {t('common.cancel')}
                    </button>
                  </Fragment>
                ) : (
                  <button
                    className="secondary"
                    disabled={disabled}
                    aria-label={t('auth.logout')}
                    onClick={() => actions.accounts.beginLogout(account.id)}
                    data-ui-site="AccountsPage-63"
                  >
                    <LogOut size={16} data-ui-site="AccountsPage-64" />
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
export default AccountsPage;
const AccountAvatar = sourceView('component.account-avatar', DefaultAccountAvatar);
const LoginDialog = sourceView('dialog.login', DefaultLoginDialog);
