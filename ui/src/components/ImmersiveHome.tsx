import { useState, type CSSProperties } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Layers,
  LoaderCircle,
  Palette,
  Play,
  Plus,
  Settings2,
  Square,
  UserRound,
  X,
} from 'lucide-react';
import { readableAccent } from '../colors';
import type { Activity, AppConfig, GameProfile, Page } from '../types';

interface Props {
  config: AppConfig;
  active?: GameProfile;
  busy: Activity | null;
  desktop: boolean;
  installed: boolean;
  onCreate: () => void;
  onPage: (page: Page) => void;
  onSelect: (key: string) => void;
  onLaunch: (profile: GameProfile) => void;
  onStop: () => void;
  onCustomize: () => void;
}

export default function ImmersiveHome({
  config,
  active,
  busy,
  desktop,
  installed,
  onCreate,
  onPage,
  onSelect,
  onLaunch,
  onStop,
  onCustomize,
}: Props) {
  const [showHint, setShowHint] = useState(true);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const working = busy?.status === 'started' || busy?.status === 'running';
  const running = busy?.action === 'launch' && busy.status === 'running';
  const hasProfiles = config.profiles.length > 0;
  const title = working
    ? running
      ? '游戏正在运行'
      : busy?.action === 'install'
        ? '正在准备游戏'
        : '正在启动游戏'
    : active
      ? installed
        ? '启动游戏'
        : '安装游戏'
      : hasProfiles
        ? '选择游戏实例'
        : '创建游戏实例';
  const detail = active
    ? `${active.name} · ${active.game_version}`
    : hasProfiles
      ? '为下一次冒险选择一个世界'
      : '从你的第一个世界开始';
  const menuVariables = {
    '--menu-accent': readableAccent(config.settings.appearance.accent_color, 'dark'),
    '--menu-radius': `${config.settings.appearance.border_radius}px`,
    fontSize: `${config.settings.appearance.ui_scale}%`,
  } as CSSProperties;

  const primaryAction = () => {
    if (active) onLaunch(active);
    else if (hasProfiles) onPage('instances');
    else onCreate();
  };

  return (
    <section
      className="immersive-home"
      aria-label="开始游戏"
      onKeyDownCapture={() => setKeyboardNavigation(true)}
      onPointerDownCapture={() => setKeyboardNavigation(false)}
    >
      {showHint && (
        <aside className="immersive-customize-hint" aria-label="界面个性化">
          <div className="immersive-hint-icon">
            <Palette size={19} strokeWidth={1.7} />
          </div>
          <div className="immersive-hint-copy">
            <h2>让这里成为你的主场</h2>
            <p>切换界面风格，调整背景与透明度。</p>
            <button type="button" onClick={onCustomize}>
              个性化界面
              <ChevronRight size={13} />
            </button>
          </div>
          <button
            type="button"
            className="immersive-hint-close"
            aria-label="关闭个性化提示"
            onClick={() => setShowHint(false)}
          >
            <X size={16} />
          </button>
        </aside>
      )}

      <div className="immersive-launch-area">
        {working && (
          <div className="immersive-activity" role="status">
            {running ? <Gamepad2 size={16} /> : <LoaderCircle size={16} className="spin" />}
            <span>{busy?.message}</span>
            {running && (
              <button type="button" onClick={onStop}>
                <Square size={12} fill="currentColor" />
                停止游戏
              </button>
            )}
          </div>
        )}
        {!desktop && active && (
          <p className="immersive-preview-note">界面预览 · 在桌面启动器中启动游戏</p>
        )}
        <div className="immersive-launch-split">
          <button
            type="button"
            className="immersive-launch-primary"
            disabled={working || (!!active && !desktop)}
            onClick={primaryAction}
            aria-label={`${title}${active ? `：${active.name}` : ''}`}
          >
            {running ? (
              <Gamepad2 size={24} />
            ) : working ? (
              <LoaderCircle size={23} className="spin" />
            ) : active ? (
              <Play size={24} fill="currentColor" strokeWidth={1.4} />
            ) : (
              <Plus size={25} strokeWidth={1.8} />
            )}
            <span className="immersive-launch-copy">
              <strong>{title}</strong>
              <small title={detail}>{detail}</small>
            </span>
          </button>
          <Menu.Root>
            <Menu.Trigger
              className="immersive-launch-select"
              disabled={working}
              aria-label="选择游戏实例"
              title="选择游戏实例"
            >
              <ChevronDown size={20} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side="top"
                align="end"
                sideOffset={10}
                className={`immersive-menu-positioner ${keyboardNavigation ? 'keyboard-navigation' : ''} ${config.settings.appearance.reduce_motion ? 'reduce-motion' : ''}`}
                style={menuVariables}
              >
                <Menu.Popup className="immersive-instance-menu">
                  <div className="immersive-menu-heading">
                    游戏实例<span>{config.profiles.length}</span>
                  </div>
                  <div className="immersive-menu-instances">
                    {hasProfiles ? (
                      config.profiles.map((profile) => (
                        <Menu.Item
                          key={profile.instance_key}
                          className="immersive-instance-entry"
                          label={profile.name}
                          onClick={() => onSelect(profile.instance_key)}
                          aria-label={`${profile.name}，Minecraft ${profile.game_version}${profile.instance_key === active?.instance_key ? '，当前实例' : ''}`}
                        >
                          <span className="immersive-menu-instance-icon">
                            <Box size={19} strokeWidth={1.6} />
                          </span>
                          <span className="immersive-menu-instance-copy">
                            <strong>{profile.name}</strong>
                            <small>Minecraft {profile.game_version} · 原版</small>
                          </span>
                          {profile.instance_key === active?.instance_key && (
                            <Check size={17} className="immersive-menu-check" />
                          )}
                        </Menu.Item>
                      ))
                    ) : (
                      <div className="immersive-menu-empty">
                        还没有游戏实例
                        <br />
                        <span>先创建一个，开始新的冒险。</span>
                      </div>
                    )}
                  </div>
                  <div className="immersive-menu-divider" />
                  <Menu.Item
                    className="immersive-menu-action"
                    label="创建新实例"
                    onClick={onCreate}
                  >
                    <Plus size={16} />
                    创建新实例
                  </Menu.Item>
                  <Menu.Item
                    className="immersive-menu-action"
                    label="管理所有实例"
                    onClick={() => onPage('instances')}
                  >
                    <Layers size={16} />
                    管理所有实例
                    <ChevronRight size={14} />
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div className="immersive-launch-meta">
          <button
            type="button"
            onClick={() => onPage('accounts')}
            className="immersive-account-link"
          >
            <UserRound size={13} />
            <span>{config.settings.offline_username}</span>
            <small>离线账户</small>
          </button>
          <button
            type="button"
            className="immersive-instance-settings"
            onClick={() => onPage('instances')}
            aria-label="管理游戏实例"
            title="管理游戏实例"
          >
            <Settings2 size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
