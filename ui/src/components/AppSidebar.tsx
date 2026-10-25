import { useTranslation } from 'react-i18next';
import { Box, ChevronRight, Settings2, Terminal } from 'lucide-react';
import { navigation } from '../lib/navigation';
import { appVersion } from '../lib/version';
import type { AppConfig, Page } from '../types';

interface AppSidebarProps {
  config: AppConfig;
  page: Page;
  immersive: boolean;
  desktop: boolean;
  hasErrors: boolean;
  onNavigate: (page: Page) => void;
}

export default function AppSidebar({
  config,
  page,
  immersive,
  desktop,
  hasErrors,
  onNavigate,
}: AppSidebarProps) {
  const { t } = useTranslation();
  const username = config.settings.offline_username;
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
      {immersive && (
        <>
          <div className="nav-caption account-caption">{t('nav.accountCaption')}</div>
          <button
            className={`sidebar-account ${page === 'accounts' ? 'active' : ''}`}
            onClick={() => onNavigate('accounts')}
            title={t('nav.accounts')}
          >
            <div className="avatar">{username.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{username}</strong>
              <small>{t('common.offlineAccount')}</small>
            </div>
            <ChevronRight size={14} />
          </button>
        </>
      )}
      <div className="nav-caption">{immersive ? t('nav.gameCaption') : t('nav.workspace')}</div>
      <nav>
        {navigation
          .filter((item) => !immersive || item.id !== 'accounts')
          .map((item) => (
            <button
              key={item.id}
              title={t(item.label)}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <item.icon size={19} />
              <span>{t(item.label)}</span>
              {item.id === 'instances' && config.profiles.length > 0 && (
                <b>{config.profiles.length}</b>
              )}
            </button>
          ))}
      </nav>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${page === 'logs' ? 'active' : ''}`}
          onClick={() => onNavigate('logs')}
          title={t('nav.logs')}
        >
          <Terminal size={18} />
          <span>{t('nav.logs')}</span>
          {hasErrors && <i className="error-dot" />}
        </button>
        <button
          className={`nav-item ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
          title={t('window.settings')}
        >
          <Settings2 size={18} />
          <span>{t('nav.settings')}</span>
        </button>
        <div className="engine">
          <span className="status-dot" />
          <div>
            <strong>{desktop ? 'Elemental Engine' : t('nav.preview')}</strong>
            <small>
              {desktop ? t('nav.rustVersion', { version: appVersion }) : t('nav.desktopRequired')}
            </small>
          </div>
        </div>
      </div>
    </aside>
  );
}
