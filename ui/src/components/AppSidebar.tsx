import { Box, ChevronRight, Settings2, Terminal } from 'lucide-react';
import { navigation } from '../lib/navigation';
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
          <div className="nav-caption account-caption">账户</div>
          <button
            className={`sidebar-account ${page === 'accounts' ? 'active' : ''}`}
            onClick={() => onNavigate('accounts')}
            title="账户管理"
          >
            <div className="avatar">{username.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{username}</strong>
              <small>离线账户</small>
            </div>
            <ChevronRight size={14} />
          </button>
        </>
      )}
      <div className="nav-caption">{immersive ? '游戏' : '工作空间'}</div>
      <nav>
        {navigation
          .filter((item) => !immersive || item.id !== 'accounts')
          .map((item) => (
            <button
              key={item.id}
              title={item.label}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
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
          title="运行日志"
        >
          <Terminal size={18} />
          <span>运行日志</span>
          {hasErrors && <i className="error-dot" />}
        </button>
        <button
          className={`nav-item ${page === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
          title="设置"
        >
          <Settings2 size={18} />
          <span>设置与个性化</span>
        </button>
        <div className="engine">
          <span className="status-dot" />
          <div>
            <strong>{desktop ? 'Elemental Engine' : '网页预览模式'}</strong>
            <small>{desktop ? 'Rust 驱动 · v0.1.0' : '安装与启动请打开桌面应用'}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
