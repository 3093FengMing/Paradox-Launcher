import { useTranslation } from 'react-i18next';
import { Check, LogOut, RefreshCw, UserRound, KeyRound } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { Badge, Field, UiIdentity } from '@paradox/ui';
import DefaultAccountAvatar from '../components/AccountAvatar';
import { sourceView } from '../../common/lib/view';
import DefaultLoginDialog from '../dialogs/AccountLoginDialog';
import '../styles/accounts.css';

const AccountAvatar = sourceView('component.account-avatar', DefaultAccountAvatar);
const LoginDialog = sourceView('dialog.login', DefaultLoginDialog);

export default function AccountsPage() {
  const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions();
  const accounts = s.accounts, desktop = s.window.desktop;
  const busy = !!s.activity || s.downloads.active || s.downloads.pending.length > 0 || s.settings.saving;
  const disabled = busy || accounts.pending || accounts.loading || !accounts.ready;
  const username = s.config.value?.settings.offline_username ?? '';
  const draftUsername = s.settings.draft?.offline_username ?? '';
  const { clientIdDraft: clientId, removingId } = accounts;
  const offline = <section
    className="accounts-offline"
    data-ui-site="Accounts-offline">

    <div
      className="accounts-section-heading"
      data-ui-site="Accounts-offline-heading">
      <UserRound
      size={19}
      data-ui-site="Accounts-offline-icon"/>
      <h2
        data-ui-site="Accounts-offline-title">{t('accounts.offlineIdentity')}
      </h2>{accounts.ready && accounts.state.active === null && <Badge
        data-ui-site="Accounts-offline-active">{t('auth.selected')}
      </Badge>}
    </div>

    <div
      className="accounts-identity"
      data-ui-site="Accounts-offline-identity">
      <AccountAvatar
      name={username}
      className="large"
      data-ui-site="Accounts-offline-avatar"/>
      <div
        data-ui-site="Accounts-offline-copy">
        <strong
          data-ui-site="Accounts-offline-name">{username}
        </strong>
        <p
          data-ui-site="Accounts-offline-subtitle">{t('accounts.localIdentity')}
        </p>
      </div>
    </div>

    <Field
      label={t('accounts.playerName')}
      description={t('accounts.nameDescription')}
      data-ui-site="Accounts-name-field">
      <input
      data-ui-site="Accounts-name"
      value={draftUsername}
      maxLength={16}
      disabled={disabled}
      onChange={event => a.settings.patch('offline_username', event.target.value)}/>
    </Field>

    <p
      className="accounts-help"
      data-ui-site="Accounts-offline-help">{t('accounts.offlineHelp')}
    </p>

    <div
      className="accounts-actions"
      data-ui-site="Accounts-offline-actions">
      <button
        className="primary"
        disabled={disabled}
        onClick={() => void a.accounts.saveOfflineName()}
        data-ui-site="Accounts-save-name">
        <Check
        size={16}
        data-ui-site="Accounts-save-icon"/>{t('accounts.save')}
      </button>
      <button
        className="secondary"
        disabled={disabled || !desktop || accounts.state.active === null}
        onClick={() => void a.accounts.select(null)}
        data-ui-site="Accounts-use-offline">{t('auth.useOffline')}
      </button>
    </div>

  </section>;
  const configuration = <section
    className="accounts-configuration"
    data-ui-site="Accounts-configuration">

    <div
      className="accounts-section-heading"
      data-ui-site="Accounts-config-heading">
      <KeyRound
      size={19}
      data-ui-site="Accounts-config-icon"/>
      <h2
        data-ui-site="Accounts-config-title">{t('accountDiscovery.connection')}
      </h2>
    </div>

    <Field
      label={t('auth.clientId')}
      description={t('auth.clientIdHelp')}
      data-ui-site="Accounts-client-field">
      <input
      data-ui-site="Accounts-client-id"
      value={clientId}
      disabled={disabled || !desktop}
      maxLength={36}
      onChange={event => a.accounts.patchClientId(event.target.value)}
      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/>
    </Field>

    <button
      className="secondary"
      data-ui-site="Accounts-save-client"
      disabled={disabled || !desktop || clientId === accounts.state.client_id || !clientId.trim()}
      onClick={() => void a.accounts.configure(clientId)}>{t('auth.saveClientId')}
    </button>
    {!desktop && <p
      className="accounts-help"
      data-ui-site="Accounts-desktop-only">{t('api.desktopOnly')}
    </p>}

  </section>;
  const microsoft = <section
    className="accounts-microsoft"
    data-ui-site="Accounts-microsoft">

    <header
      className="accounts-microsoft-heading"
      data-ui-site="Accounts-microsoft-heading">
      <div
        data-ui-site="Accounts-microsoft-intro">
        <p
          className="accounts-eyebrow"
          data-ui-site="Accounts-microsoft-eyebrow">{t('auth.microsoftIdentity')}
        </p>
        <h2
          data-ui-site="Accounts-microsoft-title">{t('accounts.microsoft')}
        </h2>
        <p
          className="accounts-help"
          data-ui-site="Accounts-microsoft-description">{t('auth.description')}
        </p>
      </div>
      <button
        className="primary"
        disabled={disabled || !desktop || !accounts.state.client_id}
        onClick={() => void a.accounts.login()}
        data-ui-site="Accounts-login">{t('auth.login')}
      </button>
    </header>
    {accounts.loading && <p
      role="status"
      data-ui-site="Accounts-loading">{t('auth.loading')}
    </p>}
    {accounts.loadError !== null && <div
      className="accounts-notice"
      role="alert"
      data-ui-site="Accounts-load-error">
      <strong
        data-ui-site="Accounts-load-error-title">{t('auth.loadFailed')}
      </strong>
      <p
        data-ui-site="Accounts-load-error-detail">{accounts.loadError.message}
      </p>
      <button
        className="secondary"
        disabled={busy || accounts.loading || accounts.pending || !desktop}
        onClick={() => void a.accounts.reload()}
        data-ui-site="Accounts-reload">
        <RefreshCw
        size={16}
        data-ui-site="Accounts-reload-icon"/>{t('common.retry')}
      </button>
    </div>}
    {accounts.pending && !accounts.prompt && <div
      className="accounts-notice"
      data-ui-site="Accounts-pending">
      <p
        role="status"
        data-ui-site="Accounts-pending-status">{t(accounts.cancelling ? 'auth.cancelling' : 'auth.busy')}
      </p>{accounts.loginPending && <button
        className="secondary"
        disabled={accounts.cancelling}
        onClick={() => void a.accounts.cancelLogin()}
        data-ui-site="Accounts-cancel-start">{t(accounts.cancelling ? 'auth.cancelling' : 'common.cancel')}
      </button>}
    </div>}
    {accounts.ready && !accounts.state.accounts.length && <div
      className="accounts-empty"
      data-ui-site="Accounts-empty">
      <UserRound
      size={28}
      data-ui-site="Accounts-empty-icon"/>
      <p
        data-ui-site="Accounts-empty-text">{t('auth.noAccounts')}
      </p>
    </div>}

    <div
      className="accounts-list"
      data-ui-site="Accounts-list">{accounts.state.accounts.map(account =>
      <UiIdentity
        key={account.id}
        namespace="account"
        value={account.id}>
        <article
          className="accounts-row"
          data-account-id={account.id}
          data-ui-site="Accounts-row">
          <div
            className="accounts-identity"
            data-ui-site="Accounts-row-identity">
            <AccountAvatar
            account={account}
            name={account.name}
            data-ui-site="Accounts-row-avatar"/>
            <div
              data-ui-site="Accounts-row-copy">
              <strong
                data-ui-site="Accounts-row-name">{account.name}
              </strong>
              <small
                data-ui-site="Accounts-row-id">{account.id}
              </small>{accounts.ready && accounts.state.active === account.id && <Badge
                data-ui-site="Accounts-row-active">{t('auth.selected')}
              </Badge>}
            </div>
          </div>

          <div
            className="accounts-actions"
            data-ui-site="Accounts-row-actions">
            <button
              className="secondary"
              disabled={disabled || !desktop || accounts.state.active === account.id}
              onClick={() => void a.accounts.select(account.id)}
              data-ui-site="Accounts-select">{t('auth.select')}
            </button>
            <button
              className="secondary"
              disabled={disabled || !desktop}
              onClick={() => void a.accounts.refresh(account.id)}
              data-ui-site="Accounts-refresh">
              <RefreshCw
              size={15}
              data-ui-site="Accounts-refresh-icon"/>{t('auth.refresh')}
            </button>{removingId !== account.id && <button
              className="text-button"
              disabled={disabled || !desktop}
              onClick={() => a.accounts.beginLogout(account.id)}
              data-ui-site="Accounts-logout">
              <LogOut
              size={15}
              data-ui-site="Accounts-logout-icon"/>{t('auth.logout')}
            </button>}
          </div>
      {removingId === account.id && <div
            className="accounts-confirm"
            data-ui-site="Accounts-logout-confirm">
            <p
              data-ui-site="Accounts-logout-question">{t('accountDiscovery.logoutPrompt', { name: account.name })}
            </p>
            <div
              className="accounts-actions"
              data-ui-site="Accounts-confirm-actions">
              <button
                className="danger"
                disabled={disabled || !desktop}
                onClick={() => void a.accounts.confirmLogout()}
                data-ui-site="Accounts-confirm-logout">{t('auth.confirmLogout')}
              </button>
              <button
                className="secondary"
                disabled={disabled}
                onClick={a.accounts.cancelLogout}
                data-ui-site="Accounts-cancel-logout">{t('common.cancel')}
              </button>
            </div>
          </div>}

        </article>
      </UiIdentity>)}
    </div>

  </section>;
  const recovery = accounts.recovery.length > 0 && <section
    className="accounts-recovery accounts-notice"
    role="alert"
    data-ui-site="Accounts-recovery">
    <h2
      data-ui-site="Accounts-recovery-title">{t('auth.recoveryTitle')}
    </h2>
    <p
      data-ui-site="Accounts-recovery-description">{t('auth.recoveryDescription')}
    </p>{accounts.recovery.map((id, index) =>
    <UiIdentity
      key={id}
      namespace="recovery"
      value={id}>
      <div
        className="accounts-recovery-row"
        data-ui-site="Accounts-recovery-row">
        <span
          data-ui-site="Accounts-recovery-number">{t('auth.recoveryCredential', { number: index + 1 })}
        </span>
        <button
          className="secondary"
          disabled={disabled || !desktop}
          onClick={() => void a.accounts.clearRecovery(id)}
          data-ui-site="Accounts-clear-recovery">{t('auth.clearRecovery')}
        </button>
      </div>
    </UiIdentity>)}
  </section>;
  return <div
    className="accounts-page modern-accounts"
    data-ui-site="Accounts-page">
    <div
      className="accounts-overview"
      data-ui-site="Accounts-overview">{offline}{configuration}
    </div>{microsoft}{recovery}{s.accounts.prompt ? <UiIdentity
      namespace="login"
      value={s.accounts.prompt.id}>
      <LoginDialog
      data-ui-site="Accounts-login-dialog-bound"/>
    </UiIdentity> : <LoginDialog
    data-ui-site="Accounts-login-dialog"/>}
  </div>;
}
