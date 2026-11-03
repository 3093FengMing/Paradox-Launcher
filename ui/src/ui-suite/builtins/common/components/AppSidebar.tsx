import '../styles/common.css';
import { Fragment } from 'react';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { Box, ChevronRight } from 'lucide-react';
import { routeIcon } from '../lib/navigation';
import { appVersion } from '../lib/version';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { DeepReadonly, UiRouteDescriptor } from '@paradox/launcher';
import DefaultAccountAvatar from './AccountAvatar';
import { viewProps } from '../lib/view';
function AppSidebar(input?: {props?:Readonly<Record<string,unknown>>;immersive?:boolean}) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    config = snapshot.config.value;
  const page = snapshot.navigation.routeId,
    routes = snapshot.navigation.routes,
    desktop = snapshot.window.desktop,
    immersive = viewProps<{immersive?:boolean}>(input).immersive ?? false;
  const hasErrors = snapshot.logs.lines.some((line) => line.level === 'error'),
    account = snapshot.accounts.state.accounts.find(
      (item) => item.id === snapshot.accounts.state.active,
    );
  const onNavigate = actions.navigation.navigate;
  if (!config) return null;
  const username = account?.name ?? config.settings.offline_username;
  const visible = routes.filter((route) => route.navigation);
  const renderRoute = (route: DeepReadonly<UiRouteDescriptor>) => {
    const Icon = routeIcon(route.icon);
    const title = t(route.title, { defaultValue: route.title });
    return (
      <button
        key={route.id}
        title={title}
        className={`nav-item ${page === route.id ? 'active' : ''}`}
        onClick={() => onNavigate(route.id)}
        data-ui-site="AppSidebar-1"
      >
        {Icon && <Icon size={19} data-ui-site="AppSidebar-2" />}
        <span data-ui-site="AppSidebar-3">{title}</span>
        {route.id === 'instances' && config.profiles.length > 0 && (
          <b data-ui-site="AppSidebar-4">{config.profiles.length}</b>
        )}
        {route.id === 'logs' && hasErrors && (
          <i className="error-dot" data-ui-site="AppSidebar-5" />
        )}
      </button>
    );
  };
  const accountRoute = visible.find((route) => route.id === 'accounts');
  return (
    <aside className="sidebar" data-ui-site="AppSidebar-6">
      <div className="brand" data-ui-site="AppSidebar-7">
        <div className="brand-mark" data-ui-site="AppSidebar-8">
          <Box size={22} strokeWidth={1.8} data-ui-site="AppSidebar-9" />
        </div>
        <div data-ui-site="AppSidebar-10">
          <strong data-ui-site="AppSidebar-11">
            Paradox<span data-ui-site="AppSidebar-12">Minecraft Launcher</span>
          </strong>
        </div>
      </div>
      {immersive && accountRoute && (
        <Fragment data-ui-site="AppSidebar-13">
          <div className="nav-caption account-caption" data-ui-site="AppSidebar-14">
            {t('nav.accountCaption')}
          </div>
          <button
            className={`sidebar-account ${page === 'accounts' ? 'active' : ''}`}
            onClick={() => onNavigate('accounts')}
            title={t(accountRoute.title, { defaultValue: accountRoute.title })}
            data-ui-site="AppSidebar-15"
          >
            <AccountAvatar account={account} name={username} data-ui-site="AppSidebar-16" />
            <div data-ui-site="AppSidebar-17">
              <strong data-ui-site="AppSidebar-18">{username}</strong>
              <small data-ui-site="AppSidebar-19">
                {t(account ? 'auth.microsoftIdentity' : 'common.offlineAccount')}
              </small>
            </div>
            <ChevronRight size={14} data-ui-site="AppSidebar-20" />
          </button>
        </Fragment>
      )}
      <div className="nav-caption" data-ui-site="AppSidebar-21">
        {immersive ? t('nav.gameCaption') : t('nav.workspace')}
      </div>
      <nav data-ui-site="AppSidebar-22">
        {visible
          .filter(
            (route) =>
              route.id !== 'logs' &&
              route.id !== 'settings' &&
              (!immersive || route.id !== 'accounts'),
          )
          .map(renderRoute)}
      </nav>
      <div className="sidebar-bottom" data-ui-site="AppSidebar-23">
        {visible.filter((route) => route.id === 'logs' || route.id === 'settings').map(renderRoute)}
        <div className="engine" data-ui-site="AppSidebar-24">
          <span className="status-dot" data-ui-site="AppSidebar-25" />
          <div data-ui-site="AppSidebar-26">
            <strong data-ui-site="AppSidebar-27">
              {desktop ? 'QuintElement Engine' : t('nav.preview')}
            </strong>
            <small data-ui-site="AppSidebar-28">
              {desktop ? t('nav.rustVersion', { version: appVersion }) : t('nav.desktopRequired')}
            </small>
          </div>
        </div>
      </div>
    </aside>
  );
}
export default AppSidebar;
const AccountAvatar = sourceView('component.account-avatar', DefaultAccountAvatar);
