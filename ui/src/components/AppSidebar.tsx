import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Box, ChevronRight } from 'lucide-react';
import { routeIcon } from '../lib/navigation';
import { appVersion } from '../lib/version';
import type { AppConfig, MicrosoftAccount } from '../types';
import type { DeepReadonly, UiRouteDescriptor, UiRouteId } from '@paradox/launcher';
import AccountAvatar from './AccountAvatar';

interface AppSidebarProps {
  config: AppConfig;
  page: UiRouteId;
  routes: readonly DeepReadonly<UiRouteDescriptor>[];
  immersive: boolean;
  desktop: boolean;
  hasErrors: boolean;
  account?: MicrosoftAccount | null;
  onNavigate: (page: UiRouteId) => void;
}

function AppSidebar({
  config,
  page,
  routes,
  immersive,
  desktop,
  hasErrors,
  account,
  onNavigate,
}: AppSidebarProps) {
  const { t } = useTranslation();
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
      >
        {Icon && <Icon size={19} />}
        <span>{title}</span>
        {route.id === 'instances' && config.profiles.length > 0 && <b>{config.profiles.length}</b>}
        {route.id === 'logs' && hasErrors && <i className="error-dot" />}
      </button>
    );
  };
  const accountRoute = visible.find((route) => route.id === 'accounts');
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Box size={22} strokeWidth={1.8} />
        </div>
        <div>
          <strong>
            Paradox<span>Minecraft Launcher</span>
          </strong>
        </div>
      </div>
      {immersive && accountRoute && (
        <>
          <div className="nav-caption account-caption">{t('nav.accountCaption')}</div>
          <button
            className={`sidebar-account ${page === 'accounts' ? 'active' : ''}`}
            onClick={() => onNavigate('accounts')}
            title={t(accountRoute.title, { defaultValue: accountRoute.title })}
          >
            <AccountAvatar account={account} name={username} />
            <div>
              <strong>{username}</strong>
              <small>{t(account ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small>
            </div>
            <ChevronRight size={14} />
          </button>
        </>
      )}
      <div className="nav-caption">{immersive ? t('nav.gameCaption') : t('nav.workspace')}</div>
      <nav>
        {visible
          .filter(
            (route) =>
              route.id !== 'logs' &&
              route.id !== 'settings' &&
              (!immersive || route.id !== 'accounts'),
          )
          .map(renderRoute)}
      </nav>
      <div className="sidebar-bottom">
        {visible.filter((route) => route.id === 'logs' || route.id === 'settings').map(renderRoute)}
        <div className="engine">
          <span className="status-dot" />
          <div>
            <strong>{desktop ? 'QuintElement Engine' : t('nav.preview')}</strong>
            <small>
              {desktop ? t('nav.rustVersion', { version: appVersion }) : t('nav.desktopRequired')}
            </small>
          </div>
        </div>
      </div>
    </aside>
  );
}

const CustomizedAppSidebar = customComponent('component.app-sidebar', AppSidebar);
export default CustomizedAppSidebar;
