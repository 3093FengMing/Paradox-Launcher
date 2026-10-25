import type { ReactNode } from 'react';
import { ArrowRight, Box, ChevronRight, Cpu, Gamepad2, Layers, Monitor, Palette, Play, Plus, Sparkles, UserRound } from 'lucide-react';
import type { AppConfig, GameProfile, Page } from '../types';

interface Props {
  config: AppConfig;
  active?: GameProfile;
  busy: boolean;
  desktop: boolean;
  backgroundArt: boolean;
  isInstalled: (profile: GameProfile) => boolean;
  renderProfile: (profile: GameProfile) => ReactNode;
  onCreate: () => void;
  onPage: (page: Page) => void;
  onLaunch: (profile: GameProfile) => void;
  onGameSettings: () => void;
}

export default function HomePage(props: Props) {
  const { config, active, busy, desktop, backgroundArt, isInstalled, renderProfile, onCreate, onPage, onLaunch, onGameSettings } = props;
  return <div className="home-page">
    <section className={`launch-banner ${backgroundArt ? '' : 'no-art'}`}>
      <div className="banner-illustration" aria-hidden="true" />
      <div className="banner-copy"><div className="edition-label"><Box size={15} /><span>MINECRAFT</span><i /><span>JAVA EDITION</span></div>
        <h2>{active ? active.name : <>你的世界，<br />即刻开始。</>}</h2>
        <p>{active ? `Minecraft ${active.game_version} · Vanilla 原版` : '创建一个独立实例，从第一块方块开始。'}</p>
        <div className="banner-actions"><button className="primary launch-button" disabled={busy || (!!active && !desktop)} onClick={() => active ? onLaunch(active) : onCreate()}>{active ? <Play size={17} fill="currentColor" /> : <Plus size={18} />}{active ? (isInstalled(active) ? '启动游戏' : '安装游戏') : '创建实例'}<ArrowRight size={17} /></button>
          {active && <button className="banner-secondary" onClick={() => onPage('instances')}>管理实例<ChevronRight size={15} /></button>}
        </div>
      </div>
      <div className="banner-label"><span className="status-dot" />{active ? (isInstalled(active) ? '实例已就绪' : '等待安装游戏文件') : '准备好开始你的冒险'}</div>
    </section>

    <div className="home-bottom-grid"><section className="library-section"><div className="section-heading"><h2>实例库<span>{config.profiles.length}</span></h2><button className="text-button" onClick={() => onPage('instances')}>查看全部<ChevronRight size={15} /></button></div>
      {config.profiles.length ? <div className="profile-list">{config.profiles.slice(0, 2).map(renderProfile)}</div> : <div className="library-empty"><div className="empty-cubes"><Layers size={30} strokeWidth={1.4} /></div><h3>留一个位置，给下一个世界</h3><p>不同版本、不同存档，都有独立的空间。</p><button className="text-button" disabled={busy} onClick={onCreate}><Plus size={15} />创建第一个实例</button></div>}
      <div className="discovery-row"><button className="discovery-button" onClick={() => onPage('downloads')}><div className="discovery-icon"><Gamepad2 size={19} /></div><div><strong>发现游戏版本</strong><span>查找版本，创建新实例</span></div><ArrowRight size={17} /></button><button className="discovery-button" onClick={() => onPage('settings')}><div className="discovery-icon"><Palette size={19} /></div><div><strong>按你的喜好调整</strong><span>主题、界面与启动选项</span></div><ArrowRight size={17} /></button></div>
    </section>
    <section className="preferences-card"><div className="section-heading"><h2>启动偏好</h2><button className="icon-button" aria-label="调整启动偏好" onClick={onGameSettings}><Sparkles size={17} /></button></div>
      <button className="preference-row" onClick={onGameSettings}><Cpu size={17} /><span>游戏内存</span><strong>{(config.settings.memory_mb / 1024).toFixed(1)} GB</strong><ChevronRight size={14} /></button>
      <button className="preference-row" onClick={onGameSettings}><Box size={17} /><span>Java 运行时</span><strong>{config.settings.java_executable ? '手动指定' : '自动选择'}</strong><ChevronRight size={14} /></button>
      <button className="preference-row" onClick={onGameSettings}><Monitor size={17} /><span>窗口大小</span><strong>{config.settings.resolution_width} × {config.settings.resolution_height}</strong><ChevronRight size={14} /></button>
      <button className="account-summary" onClick={() => onPage('accounts')}><div className="avatar">{config.settings.offline_username[0].toUpperCase()}</div><div><strong>{config.settings.offline_username}</strong><span><UserRound size={11} />离线账户</span></div><ChevronRight size={16} /></button>
    </section></div>
  </div>;
}
