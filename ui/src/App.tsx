import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Toaster, toast } from 'sonner';
import { ArrowDownToLine, ArrowRight, Box, Check, ChevronRight, Download, Folder, Gamepad2, Home, Layers, LayoutGrid, LoaderCircle, MoreHorizontal, Palette, Play, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Square, Terminal, UserRound, X } from 'lucide-react';
import HomePage from './components/HomePage';
import ImmersiveHome from './components/ImmersiveHome';
import WindowBar from './components/WindowBar';
import AppearanceSettings from './components/AppearanceSettings';
import * as api from './api';
import { accentForeground, readableAccent } from './colors';
import type { Activity, AppConfig, Bootstrap, GameProfile, GameVersion, InstalledInstance, LogLine, Page, Settings } from './types';

const nav: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '开始游戏', icon: Home }, { id: 'instances', label: '我的实例', icon: Layers },
  { id: 'downloads', label: '版本下载', icon: Download }, { id: 'accounts', label: '账户管理', icon: UserRound },
];
const names: Record<Page, string> = { home: '概览', instances: '我的实例', downloads: '版本下载', accounts: '账户管理', settings: '启动器设置', logs: '运行日志' };

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`panel ${className}`}>{children}</section>; }
function Badge({ children, muted = false }: { children: ReactNode; muted?: boolean }) { return <span className={`badge ${muted ? 'muted' : ''}`}>{children}</span>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>; }
function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{description && <small>{description}</small>}{children}</label>; }

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [fatal, setFatal] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [draft, setDraft] = useState<Settings | null>(null);
  const [versions, setVersions] = useState<GameVersion[]>([]);
  const [installed, setInstalled] = useState<InstalledInstance[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState<Activity | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [search, setSearch] = useState('');
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [modal, setModal] = useState<{ name: string; version: string; editKey?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const addLog = useCallback((level: string, message: string) => setLogs(previous => [...previous.slice(-499), { level, message, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }]), []);
  const notify = useCallback((message: string, error = false) => { if (error) toast.error(message); else toast.success(message); }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  useEffect(() => {
    let disposed = false;
    void api.getConfig().then(data => { if (!disposed) { setBootstrap(data); setDraft(structuredClone(data.config.settings)); } }).catch(error => setFatal(String(error)));
    let unsubscribe: (() => void) | undefined;
    void api.subscribe(event => {
      if (disposed) return;
      if (event.status === 'finished' || event.status === 'error') { setBusy(null); notify(event.message, event.status === 'error'); }
      else setBusy(event);
    }, event => { if (!disposed) addLog(event.level, event.message); }).then(cleanup => { if (disposed) cleanup(); else unsubscribe = cleanup; });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => setSystemDark(media.matches);
    media.addEventListener('change', onTheme);
    return () => { disposed = true; unsubscribe?.(); media.removeEventListener('change', onTheme); };
  }, [addLog, notify]);
  const scan = useCallback(async () => { try { setInstalled(await api.inspectInstances()); } catch (error) { addLog('error', String(error)); notify(String(error), true); } }, [addLog, notify]);
  useEffect(() => { if (bootstrap) void scan(); }, [bootstrap?.config.settings.game_directory, scan]);

  const refreshCatalog = async () => {
    setCatalogBusy(true); setCatalogError('');
    try { const result = await api.catalog(); setVersions(result); addLog('info', `获取到 ${result.length} 个 Minecraft 版本`); }
    catch (error) { setCatalogError(String(error)); addLog('error', String(error)); }
    finally { setCatalogBusy(false); }
  };
  const updateConfig = async (next: AppConfig) => {
    const config = await api.saveConfig(next);
    setBootstrap(previous => previous ? { ...previous, config } : null);
    return config;
  };
  const openCreate = (version = versions.find(version => version.kind === 'release')?.id ?? '1.21.1') => setModal({ name: '', version });
  const selectProfile = async (key: string) => {
    if (!bootstrap) return;
    try { await updateConfig({ ...bootstrap.config, active_profile: key }); }
    catch (error) { notify(String(error), true); }
  };
  const runAction = async (action: 'install' | 'launch', profile: GameProfile) => {
    setBusy({ action, status: 'started', message: action === 'install' ? `正在安装 ${profile.name}` : '正在检查 Java 并启动游戏' });
    try {
      if (action === 'install') { await api.prepareInstance(profile.instance_key); await scan(); setBusy(null); }
      else await api.launchInstance(profile.instance_key);
    } catch (error) { setBusy(null); notify(String(error), true); addLog('error', String(error)); }
  };
  const saveSettings = async () => {
    if (!bootstrap || !draft) return;
    setSaving(true);
    try {
      validateSettings(draft);
      const config = await updateConfig({ ...bootstrap.config, settings: draft });
      setDraft(structuredClone(config.settings)); notify('设置已保存'); addLog('info', '启动器设置已保存');
    } catch (error) { notify(String(error), true); }
    finally { setSaving(false); }
  };
  const saveProfile = async () => {
    if (!modal || !bootstrap) return;
    setSaving(true);
    try {
      let config: AppConfig;
      if (modal.editKey) {
        if (!modal.name.trim() || modal.name.trim().length > 64) throw new Error('实例名称应为 1–64 个字符');
        config = await updateConfig({ ...bootstrap.config, profiles: bootstrap.config.profiles.map(profile => profile.instance_key === modal.editKey ? { ...profile, name: modal.name.trim() } : profile) });
      } else config = await api.createProfile(modal.name, modal.version);
      setBootstrap({ ...bootstrap, config }); setModal(null); setPage('instances'); notify(modal.editKey ? '实例已重命名' : '实例已创建，接下来可以安装游戏文件');
    } catch (error) { notify(String(error), true); }
    finally { setSaving(false); }
  };

  const saveAccount = async () => {
    if (!bootstrap || !draft) return;
    setSaving(true);
    try {
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(draft.offline_username)) throw new Error('离线用户名应为 3–16 位英文字母、数字或下划线');
      const config = await updateConfig({ ...bootstrap.config, settings: { ...bootstrap.config.settings, offline_username: draft.offline_username } });
      setDraft(previous => previous ? { ...previous, offline_username: config.settings.offline_username } : previous);
      notify('账户已保存');
    } catch (error) { notify(String(error), true); }
    finally { setSaving(false); }
  };

  if (fatal) return <div className="boot-screen"><Box size={48} /><h1>无法读取启动器配置</h1><p>{fatal}</p><p>请备份并修复配置文件后重新打开启动器。</p><button onClick={() => location.reload()}>重试</button></div>;
  if (!bootstrap || !draft) return <div className="boot-screen"><LoaderCircle className="spin" /><p>正在加载 Paradox…</p></div>;
  const config = bootstrap.config;
  const active = config.profiles.find(profile => profile.instance_key === config.active_profile);
  const appearance = page === 'settings' ? draft.appearance : config.settings.appearance;
  const immersive = appearance.interface_style === 'immersive';
  const theme = appearance.theme === 'system' ? (systemDark ? 'dark' : 'light') : appearance.theme;
  const variables = { '--accent': appearance.accent_color, '--accent-fg': accentForeground(appearance.accent_color), '--accent-ink': readableAccent(appearance.accent_color, theme), '--hero-accent-ink': readableAccent(appearance.accent_color, 'dark'), '--radius': `${appearance.border_radius}px`, '--background-image': appearance.background_art ? "url('/background-placeholder.svg')" : 'none', '--background-blur': `${appearance.background_blur}px`, '--background-dim': appearance.background_dim / 100, '--sidebar-opacity': appearance.sidebar_opacity / 100, fontSize: `${appearance.ui_scale}%` } as CSSProperties;
  const isInstalled = (profile: GameProfile) => installed.some(instance => instance.instance_key === profile.instance_key);
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.settings);
  const visibleVersions = versions.filter(version => (config.settings.show_snapshots || version.kind === 'release') && version.id.toLowerCase().includes(search.toLowerCase()));
  const filteredProfiles = config.profiles.filter(profile => `${profile.name} ${profile.game_version}`.toLowerCase().includes(search.toLowerCase()));
  const profileCard = (profile: GameProfile) => <Panel className={`profile-card ${profile.instance_key === config.active_profile ? 'selected' : ''}`} key={profile.instance_key}>
    <div className="profile-icon"><Box size={25} /></div><div className="profile-info"><h3>{profile.name}</h3><p>Minecraft {profile.game_version} <span>·</span> Vanilla</p></div>
    <Badge muted={!isInstalled(profile)}>{isInstalled(profile) ? '已安装' : '待安装'}</Badge>
    <div className="profile-actions">{isInstalled(profile) && <button className="icon-button" title="安装 / 修复" aria-label={`安装 / 修复 ${profile.name}`} disabled={!!busy || !api.desktop} onClick={() => void runAction('install', profile)}><RefreshCw size={17} /></button>}<button className="icon-button" title="重命名实例" aria-label={`重命名 ${profile.name}`} disabled={!!busy} onClick={() => setModal({ name: profile.name, version: profile.game_version, editKey: profile.instance_key })}><MoreHorizontal size={20} /></button>
      <button className="secondary small" disabled={!!busy} onClick={() => void selectProfile(profile.instance_key)}>{profile.instance_key === config.active_profile ? <><Check size={14} />已选中</> : '选择'}</button>
      <button className="primary small" disabled={!!busy || !api.desktop} onClick={() => void runAction(isInstalled(profile) ? 'launch' : 'install', profile)}>{isInstalled(profile) ? <Play size={14} /> : <Download size={14} />}{isInstalled(profile) ? '启动' : '安装'}</button>
    </div></Panel>;

  return <div className={`app-shell ${immersive ? 'immersive' : 'modern'} ${immersive && page === 'home' ? 'immersive-landing' : ''} ${appearance.compact_sidebar ? 'compact' : ''} ${appearance.reduce_motion ? 'reduce-motion' : ''} ${inputMode === 'keyboard' ? 'keyboard-navigation' : ''}`} data-theme={theme} style={variables} onKeyDownCapture={() => setInputMode('keyboard')} onPointerDownCapture={() => setInputMode('pointer')}>
    <WindowBar onHelp={() => { setSettingsTab('appearance'); setPage('settings'); }} onError={message => notify(message, true)} />
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Box size={22} strokeWidth={1.8} /></div><div><strong>Paradox<span>Minecraft Launcher</span></strong></div></div>
      {immersive && <><div className="nav-caption account-caption">账户</div><button className={`sidebar-account ${page === 'accounts' ? 'active' : ''}`} onClick={() => setPage('accounts')} title="账户管理"><div className="avatar">{config.settings.offline_username.slice(0, 1).toUpperCase()}</div><div><strong>{config.settings.offline_username}</strong><small>离线账户</small></div><ChevronRight size={14} /></button></>}
      <div className="nav-caption">{immersive ? '游戏' : '工作空间'}</div><nav>{nav.filter(item => !immersive || item.id !== 'accounts').map(item => <button key={item.id} title={item.label} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setSearch(''); }}><item.icon size={19} /><span>{item.label}</span>{item.id === 'instances' && config.profiles.length > 0 && <b>{config.profiles.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'logs' ? 'active' : ''}`} onClick={() => setPage('logs')} title="运行日志"><Terminal size={18} /><span>运行日志</span>{logs.some(log => log.level === 'error') && <i className="error-dot" />}</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')} title="设置"><Settings2 size={18} /><span>设置与个性化</span></button>
      <div className="engine"><span className="status-dot" /><div><strong>{api.desktop ? 'Elemental Engine' : '网页预览模式'}</strong><small>{api.desktop ? 'Rust 驱动 · v0.1.0' : '安装与启动请打开桌面应用'}</small></div></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={14} /><strong>{names[page]}</strong></div><div className="topbar-right"><span className="version-tag">EARLY ACCESS <b>0.1</b></span><button className="avatar" aria-label="打开账户管理" onClick={() => setPage('accounts')}>{config.settings.offline_username.slice(0, 1).toUpperCase()}</button></div></header>
    <main><div className="page-heading"><div><h1>{page === 'home' ? `欢迎回来，${config.settings.offline_username}` : names[page]}</h1><p>{({ home: '选择一个世界，开始今天的游戏。', instances: '独立配置，有序管理。为每个世界保留自己的空间。', downloads: '查找 Minecraft 版本，创建属于你的游戏实例。', accounts: '管理你的游戏身份，让下一次出发更简单。', settings: '从界面到游戏，把每一个细节调整为你喜欢的样子。', logs: '查看任务状态和游戏输出，快速定位启动问题。' })[page]}</p></div>
      {(page === 'home' || page === 'instances') && <button className="secondary" disabled={!!busy} onClick={() => openCreate()}><Plus size={17} />创建实例</button>}</div>

    {busy && <div className="activity-bar"><LoaderCircle className="spin" size={18} /><span>{busy.message}</span>{busy.status === 'running' && <button className="secondary small" onClick={() => void api.stopGame().catch(error => notify(String(error), true))}><Square size={13} />停止游戏</button>}<button className="text-button" onClick={() => setPage('logs')}>查看日志<ArrowRight size={14} /></button></div>}

    {page === 'home' && (immersive ? <ImmersiveHome config={config} active={active} busy={busy} desktop={api.desktop} installed={!!active && isInstalled(active)} onCreate={() => openCreate()} onPage={setPage} onSelect={key => void selectProfile(key)} onLaunch={profile => void runAction(isInstalled(profile) ? 'launch' : 'install', profile)} onStop={() => void api.stopGame().catch(error => notify(String(error), true))} onCustomize={() => { setSettingsTab('appearance'); setPage('settings'); }} /> : <HomePage config={config} active={active} busy={!!busy} desktop={api.desktop} backgroundArt={appearance.background_art} isInstalled={isInstalled} renderProfile={profileCard} onCreate={() => openCreate()} onPage={setPage} onLaunch={profile => void runAction(isInstalled(profile) ? 'launch' : 'install', profile)} onGameSettings={() => { setSettingsTab('game'); setPage('settings'); }} />)}

    {page === 'instances' && <><div className="toolbar"><div className="search"><Search size={17} /><input aria-label="搜索实例" placeholder="搜索实例名称或游戏版本…" value={search} onChange={event => setSearch(event.target.value)} /></div><button className="secondary" onClick={() => void scan()}><RefreshCw size={16} />扫描本地</button></div><div className="profile-list">{filteredProfiles.map(profileCard)}</div>{!config.profiles.length && <EmptyState onCreate={() => openCreate()} />}{config.profiles.length > 0 && filteredProfiles.length === 0 && <Panel className="empty-state"><Search /><h3>没有匹配的实例</h3><p>试试其他名称或版本号。</p></Panel>}<Panel className="info-panel"><Folder size={19} /><div><strong>共享资源，独立世界</strong><p>每个实例拥有独立的存档与配置，游戏资源由 Elemental 统一管理。</p><code>{config.settings.game_directory}</code></div></Panel></>}

    {page === 'downloads' && <><div className="toolbar"><div className="search"><Search size={17} /><input aria-label="搜索版本" placeholder="搜索游戏版本，例如 1.21.1…" value={search} onChange={event => setSearch(event.target.value)} /></div><button className="secondary" disabled={catalogBusy} onClick={() => void refreshCatalog()}><RefreshCw className={catalogBusy ? 'spin' : ''} size={16} />{catalogBusy ? '获取中' : '刷新版本'}</button></div><div className="filter-row"><Badge>Vanilla 原版</Badge><label className="inline-check"><input type="checkbox" checked={config.settings.show_snapshots} disabled={!!busy} onChange={event => { void updateConfig({ ...config, settings: { ...config.settings, show_snapshots: event.target.checked } }).then(next => setDraft(previous => previous ? { ...previous, show_snapshots: next.settings.show_snapshots } : previous)).catch(error => notify(String(error), true)); }} />显示快照与历史版本</label><small>{visibleVersions.length} 个版本</small></div>
      {catalogError && <div className="error-banner">{catalogError}<button className="text-button" onClick={() => void refreshCatalog()}>重试</button></div>}
      {!versions.length ? <Panel className="empty-state"><Download size={36} /><h3>{catalogBusy ? '正在获取版本目录' : '探索你的下一个世界'}</h3><p>从 Mojang 获取真实版本列表，或直接输入版本号创建实例。</p><button className="primary" disabled={catalogBusy} onClick={() => void refreshCatalog()}><RefreshCw size={16} />获取版本目录</button><button className="text-button" disabled={!!busy} onClick={() => openCreate()}>手动输入版本号</button></Panel> : <Panel className="version-list"><div className="table-heading"><span>MINECRAFT 版本</span><span>类型</span><span>操作</span></div>{visibleVersions.slice(0, 100).map(version => <div className="version-row" key={version.id}><div><div className="version-icon"><Box size={19} /></div><strong>{version.id}</strong></div><Badge muted={version.kind !== 'release'}>{version.kind === 'release' ? '正式版' : version.kind === 'snapshot' ? '快照' : '历史版本'}</Badge><button className="secondary small" disabled={!!busy} onClick={() => openCreate(version.id)}><Plus size={14} />创建实例</button></div>)}{visibleVersions.length > 100 && <p className="list-note">显示前 100 项，使用搜索查找其他版本。</p>}{!visibleVersions.length && <p className="list-note">没有匹配的版本。</p>}</Panel>}
      <Panel className="info-panel"><Layers size={19} /><div><strong>模组加载器即将加入</strong><p>Fabric、Forge、NeoForge 和 Quilt 已列入开发路线。当前界面只开放原版流程。</p></div></Panel></>}

    {page === 'accounts' && <div className="account-grid"><Panel className="account-detail"><div className="card-eyebrow">离线身份<Badge>已启用</Badge></div><div className="account-title"><div className="avatar large">{config.settings.offline_username[0].toUpperCase()}</div><div><h2>{config.settings.offline_username}</h2><p>Offline · 本地游戏身份</p></div></div><Field label="玩家名称" description="3–16 位英文字母、数字或下划线"><input value={draft.offline_username} onChange={event => patch('offline_username', event.target.value)} maxLength={16} /></Field><p className="help-text">离线账户用于本地游玩；需要正版验证的服务器请使用 Microsoft 账户。</p><button className="primary" disabled={!!busy || saving} onClick={() => void saveAccount()}><Check size={17} />保存账户</button></Panel><Panel className="planned-card"><div className="microsoft-mark"><i /><i /><i /><i /></div><h2>Microsoft 账户</h2><Badge muted>Roadmap · v0.3</Badge><p>设备代码登录、令牌安全存储<br />与 Minecraft 正版权限验证。</p><button className="secondary" onClick={() => { notify('Microsoft 登录计划在 v0.3 接入，详见项目 ROADMAP.md'); }}>查看开发计划<ArrowRight size={16} /></button></Panel></div>}

    {page === 'settings' && <><div className="settings-tabs">{[{ id: 'appearance', label: '外观与体验', icon: Palette }, { id: 'game', label: '游戏与 Java', icon: Gamepad2 }, { id: 'advanced', label: '高级设置', icon: SlidersHorizontal }].map(tab => <button className={settingsTab === tab.id ? 'active' : ''} key={tab.id} onClick={() => setSettingsTab(tab.id)}><tab.icon size={17} />{tab.label}</button>)}</div>
      <Panel className="settings-panel">{settingsTab === 'appearance' && <AppearanceSettings appearance={draft.appearance} onChange={next => patch('appearance', next)} />}
      {settingsTab === 'game' && <><div className="settings-intro"><h2>为世界准备合适的环境</h2><p>Java 留空时，Elemental 会寻找与游戏版本匹配的本地运行时。</p></div><Field label="游戏文件目录" description="使用绝对路径。改变目录会切换本地资源库，已有文件不会自动迁移。"><div className="input-with-icon"><Folder size={18} /><input value={draft.game_directory} onChange={event => patch('game_directory', event.target.value)} /></div></Field><Field label="Java 可执行文件" description="例如 C:\Program Files\Java\jdk-21\bin\java.exe"><input placeholder="自动检测兼容的 Java" value={draft.java_executable} onChange={event => patch('java_executable', event.target.value)} /></Field><div className="field-grid"><Field label="最小内存 (MB)"><input type="number" min={256} max={draft.memory_mb} step={256} value={draft.minimum_memory_mb} onChange={event => patch('minimum_memory_mb', +event.target.value)} /></Field><Field label="最大内存 (MB)"><input type="number" min={512} max={32768} step={512} value={draft.memory_mb} onChange={event => patch('memory_mb', +event.target.value)} /></Field></div><div className="memory-presets">{[2048, 4096, 8192, 16384].map(memory => <button className={draft.memory_mb === memory ? 'selected' : ''} key={memory} onClick={() => patch('memory_mb', memory)}>{memory / 1024} GB</button>)}</div><div className="field-grid"><Field label="游戏窗口宽度"><input type="number" min={640} max={7680} value={draft.resolution_width} onChange={event => patch('resolution_width', +event.target.value)} /></Field><Field label="游戏窗口高度"><input type="number" min={480} max={4320} value={draft.resolution_height} onChange={event => patch('resolution_height', +event.target.value)} /></Field></div></>}
      {settingsTab === 'advanced' && <><div className="settings-intro"><h2>精细控制每次启动</h2><p>参数由 Elemental 解析，支持带引号的参数值。</p></div><Field label="额外 JVM 参数" description="内存请在“游戏与 Java”中设置，避免重复传入 -Xmx / -Xms。"><textarea rows={3} placeholder="例如 -XX:+UseG1GC" value={draft.extra_jvm_arguments} onChange={event => patch('extra_jvm_arguments', event.target.value)} /></Field><Field label="额外游戏参数" description="传递给 Minecraft 主程序的参数。"><textarea rows={3} placeholder="例如 --fullscreen" value={draft.extra_game_arguments} onChange={event => patch('extra_game_arguments', event.target.value)} /></Field><div className="setting-row"><div><h3>显示快照与历史版本</h3><p>在下载页中显示所有可用版本。</p></div><Toggle label="显示快照与历史版本" checked={draft.show_snapshots} onChange={value => patch('show_snapshots', value)} /></div><div className="config-location"><h3>配置文件</h3><code>{bootstrap.config_path}</code><p>配置采用版本化 JSON，保存时执行校验与原子替换。</p></div></>}
      </Panel><div className="save-bar"><span>{dirty ? <><span className="status-dot" />有未保存的修改</> : <><Check size={15} />设置已同步</>}</span><div><button className="secondary" onClick={() => setDraft(structuredClone(config.settings))}>还原修改</button><button className="primary" disabled={!!busy || saving || !dirty} onClick={() => void saveSettings()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存设置</button></div></div></>}

    {page === 'logs' && <><div className="toolbar"><div className="log-status"><span className="status-dot" />{busy ? '任务进行中' : '等待下一次任务'}<small>{logs.length} 条记录 · 最多保留 500 条</small></div><div className="button-group"><button className="secondary" onClick={() => { const content = logs.map(log => `[${log.time}] [${log.level}] ${log.message}`).join('\n'); const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'paradox-launcher.log'; anchor.click(); URL.revokeObjectURL(url); }}><ArrowDownToLine size={16} />导出</button><button className="secondary" onClick={() => setLogs([])}>清空</button></div></div><Panel className="console"><div className="console-header"><Terminal size={16} /><span>LAUNCHER CONSOLE</span><div><i /><i /><i /></div></div>{logs.length ? logs.map((line, index) => <div className={`log-line ${line.level}`} key={index}><time>{line.time}</time><b>{line.level.toUpperCase()}</b><span>{line.message}</span></div>) : <div className="console-empty"><Terminal size={30} /><p>尚无运行日志</p><small>版本查询、安装与游戏输出会显示在这里。</small></div>}</Panel></>}
    <footer className="app-footer"><span>Paradox Launcher <i>·</i> v0.1.0</span><button className="text-button" onClick={() => { setSettingsTab('advanced'); setPage('settings'); }}><Settings2 size={14} />关于与配置</button></footer>
    </main></div>
    <Toaster theme={theme} position="bottom-right" closeButton duration={5000} toastOptions={{ style: { background: "var(--surface)", color: "var(--text)", borderColor: "var(--border)", fontFamily: "inherit" } }} />
    <Dialog.Root open={!!modal} onOpenChange={open => { if (!open && !saving) setModal(null); }}>
      <Dialog.Portal><div className={`dialog-theme ${appearance.reduce_motion ? 'reduce-motion' : ''} ${inputMode === 'keyboard' ? 'keyboard-navigation' : ''}`} data-theme={theme} style={variables}>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className="modal" initialFocus={() => document.getElementById('profile-name')}>
          {modal && <><div className="modal-heading"><div className="metric-icon"><Box size={23} /></div><button className="icon-button" aria-label="关闭对话框" disabled={saving} onClick={() => setModal(null)}><X size={19} /></button></div>
          <Dialog.Title className="modal-title">{modal.editKey ? '重命名实例' : '创建游戏实例'}</Dialog.Title>
          <Dialog.Description className="modal-description">{modal.editKey ? '修改显示名称，实例文件位置保持不变。' : '为不同版本与存档创建独立空间。'}</Dialog.Description>
          <form onSubmit={event => { event.preventDefault(); void saveProfile(); }}>
            <Field label="实例名称"><input id="profile-name" required placeholder="例如：我的生存世界" maxLength={64} value={modal.name} onChange={event => setModal({ ...modal, name: event.target.value })} /></Field>
            <Field label="Minecraft 版本"><input required disabled={!!modal.editKey} value={modal.version} onChange={event => setModal({ ...modal, version: event.target.value })} /></Field>
            <div className="modal-type"><LayoutGrid size={17} /><span>Vanilla 原版</span><Badge>已支持</Badge></div>
            <div className="modal-buttons"><button type="button" className="secondary" disabled={saving} onClick={() => setModal(null)}>取消</button><button type="submit" className="primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{modal.editKey ? '保存名称' : '创建实例'}</button></div>
          </form></>}
        </Dialog.Popup>
      </div></Dialog.Portal>
    </Dialog.Root>
  </div>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) { return <Panel className="empty-state compact-empty"><div className="empty-icon"><Layers size={27} /></div><div><h3>你的冒险，尚待开启</h3><p>创建第一个实例，让这个空间成为你的世界。</p></div><button className="secondary" onClick={onCreate}><Plus size={16} />创建实例</button></Panel>; }
function validateSettings(settings: Settings) {
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(settings.offline_username)) throw new Error('离线用户名应为 3–16 位英文字母、数字或下划线');
  if (settings.memory_mb < 512 || settings.memory_mb > 32768 || settings.minimum_memory_mb < 256 || settings.minimum_memory_mb > settings.memory_mb) throw new Error('请检查最小和最大内存范围');
  if (!/^([A-Za-z]:[\\/]|\/)/.test(settings.game_directory)) throw new Error('游戏目录必须是绝对路径');
  if (settings.java_executable.trim() && !/^([A-Za-z]:[\\/]|\/)/.test(settings.java_executable.trim())) throw new Error('Java 路径必须是绝对路径');
  if (settings.resolution_width < 640 || settings.resolution_width > 7680 || settings.resolution_height < 480 || settings.resolution_height > 4320) throw new Error('游戏窗口分辨率超出支持范围');
}
