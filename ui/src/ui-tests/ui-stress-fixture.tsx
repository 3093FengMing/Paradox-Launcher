/** @jsxImportSource react */
/* eslint-disable react-refresh/only-export-components -- Explicit dev fixture exposes an installer and its consumer. */
import { useEffect, useRef } from 'react';
import { useLauncherActions, useLauncherSnapshot } from '../launcher/public/context';
import type { DeepReadonly, LauncherActions, LauncherSnapshot } from '../launcher/public/types';
import type { AppConfig, AccountsState, GameProfile } from '../types';

type Dataset = 'demo' | 'worst' | 'empty' | 'one' | '1000';
const datasets: { id: Dataset; label: string }[] = [
  { id: 'demo', label: 'Demo data' },
  { id: 'worst', label: 'Worst case' },
  { id: 'empty', label: 'Empty' },
  { id: 'one', label: 'One' },
  { id: '1000', label: '1,000 rows' },
];
const previewKey = 'paradox-launcher-preview-v1';
const backupKey = 'paradox-ui-stress-preview-backup';
const names = [
  'AllTheMods10-CommunityServer-PerformanceProfile-2026.11.16',
  '机械动力：星际远征 · 社区联机服务器专用整合包（高分辨率材质与光影测试）',
  'J',
  '🦊 Fox — Cozy Cottage & Exploration',
  'Đặng Thị Ngọc Hân — Better Minecraft',
  'Community Survival',
  'Community Survival',
  'Benachrichtigungseinstellungen-Community-Modpack',
  'Create & Explore <testing> — FINAL v12',
];

// Values enter at the same configuration boundary as ordinary preview data.
// Profile names respect model.rs's 64-character limit. Missing optional paths
// and overrides remain missing; the component must handle its own fallbacks.
function profilesFor(dataset: Dataset): GameProfile[] {
  const count = dataset === 'empty' ? 0 : dataset === 'one' ? 1 : dataset === '1000' ? 1000 : dataset === 'worst' ? names.length : 3;
  return Array.from({ length: count }, (_, index) => ({
    instance_key: `stress-profile-${index + 1}`,
    name: dataset === 'demo' ? ['Survival', 'Create Workshop', 'Vanilla'][index] : dataset === 'one' ? 'J' : index < names.length ? names[index] : `Community Server Archive — Season ${String(index + 1).padStart(4, '0')}`,
    game_version: index === 6 ? '1.20.1' : index % 3 === 0 ? '1.21.1' : '1.21.4',
    loader: index % 3 === 0 ? 'fabric' : 'vanilla',
    loader_version: index % 3 === 0 ? '0.16.10' : '',
    game_directory: index === 1 ? 'C:\\Games\\Minecraft\\Community Servers\\Season 2026\\Create and Exploration\\High Resolution Resource Packs' : null,
    overrides: {},
  }));
}

interface DesktopBoundary {
  config: AppConfig;
  accounts: AccountsState;
}
interface StressWindow extends Window {
  foundationDesktop?: DesktopBoundary;
  uiStressFixture?: { setData(dataset: Dataset): Promise<void>; cleanup(): void };
}

function currentDataset(): Dataset {
  const value = new URLSearchParams(location.search).get('data');
  return datasets.find(item => item.id === value)?.id ?? 'demo';
}

/** Install plain dev chrome; no extra React root or business provider. */
export function installUiStressFixture(
  actions: LauncherActions,
  getSnapshot: () => DeepReadonly<LauncherSnapshot>,
): () => void {
  const fixtureWindow = window as StressWindow;
  fixtureWindow.uiStressFixture?.cleanup();
  const initial = getSnapshot().config.value;
  if (!initial) return () => {};
  const original = structuredClone(initial) as AppConfig;
  const boundary = fixtureWindow.foundationDesktop;
  const originalBoundaryConfig = boundary ? structuredClone(boundary.config) : null;
  const originalAccounts = boundary ? structuredClone(boundary.accounts) : null;
  let savedPreview: string | null = localStorage.getItem(previewKey);
  if (!boundary) {
    const backup = sessionStorage.getItem(backupKey);
    if (backup !== null) savedPreview = JSON.parse(backup) as string | null;
    else sessionStorage.setItem(backupKey, JSON.stringify(savedPreview));
  }
  let busy = false, disposed = false;
  const host = document.createElement('div');
  host.dataset.uiStress = 'true';
  host.style.cssText = 'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147483000;width:560px;max-width:calc(100vw - 16px);padding:4px;border:1px solid #aeb2b8;border-radius:8px;background:#e1e3e6;color:#25282d;box-shadow:0 2px 8px #0003;font:12px/1.4 system-ui;display:flex;flex-wrap:wrap;justify-content:center;gap:3px';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Development UI stress data');
  // Reserve a separate strip for fixture chrome, including its wrapped form at
  // 320px. The launch action can scroll fully into the remaining app viewport.
  const chromeStyle = document.createElement('style');
  chromeStyle.textContent = '#root > .app-shell, #root .app-shell { height:calc(100dvh - var(--ui-stress-space, 50px)) !important; } .immersive-launch-split, .current-launch-target { bottom:calc(var(--ui-stress-space, 50px) + 8px) !important; } .immersive-home, .immersive-launch-area, .immersive-shell.is-home .route-stage { min-height:calc(100dvh - var(--titlebar-height) - var(--ui-stress-space, 50px)); } [data-ui-stress] button:focus-visible { outline:2px solid #4357b4; outline-offset:0; }';
  document.head.append(chromeStyle);
  const reserveChrome = () => document.documentElement.style.setProperty('--ui-stress-space', `${Math.ceil(host.getBoundingClientRect().height) + 16}px`);
  const resize = new ResizeObserver(reserveChrome);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  const buttons: HTMLButtonElement[] = [];
  const setSelected = (dataset: Dataset) => {
    for (const button of buttons) {
      const selected = button.dataset.data === dataset;
      button.setAttribute('aria-pressed', String(selected));
      button.style.background = selected ? '#fff' : 'transparent';
      button.style.boxShadow = selected ? '0 1px 3px #0002' : 'none';
    }
  };
  const setData = async (dataset: Dataset) => {
    if (disposed || busy) return;
    busy = true;
    buttons.forEach(button => { button.disabled = true; });
    try {
      // Keep the user's selected theme/scale while changing only test content.
      const latest = getSnapshot().config.value ?? original;
      const config = structuredClone(latest) as AppConfig;
      config.profiles = profilesFor(dataset);
      config.active_profile = config.profiles[0]?.instance_key ?? null;
      config.settings.offline_username = dataset === 'worst' || dataset === '1000' ? 'CommunityPlayer1' : 'Player';
      if (boundary) {
        boundary.config = config;
        boundary.accounts = {
          client_id: '', active: dataset === 'empty' ? null : '9317a39b-0e2a-4b6a-949a-38e51cbd8d92',
          accounts: dataset === 'empty' ? [] : [{
            id: '9317a39b-0e2a-4b6a-949a-38e51cbd8d92',
            name: dataset === 'worst' || dataset === '1000' ? 'Christopher Alexander Montgomery III' : 'Alex',
            skin_url: null,
          }, ...(dataset === 'worst' ? [
            { id: 'd6c39de0-0698-43e3-8e09-d11abfb47d7d', name: '🦊 Fox', skin_url: null },
            { id: 'f35c07bd-0299-4de9-96b8-58db90a873bb', name: 'J', skin_url: null },
            { id: '136fab9c-4141-4b0a-a490-8ae8c4b1a8d9', name: 'Đặng Thị Ngọc Hân', skin_url: null },
          ] : [])],
        };
      } else localStorage.setItem(previewKey, JSON.stringify(config));
      await actions.config.reload();
      if (boundary) await actions.accounts.reload();
      await actions.profiles.scan();
      const url = new URL(location.href);
      url.searchParams.set('data', dataset);
      history.replaceState(null, '', url);
      setSelected(dataset);
      status.textContent = `${datasets.find(item => item.id === dataset)!.label}: ${config.profiles.length.toLocaleString()} instances`;
    } catch (error) {
      status.textContent = `Fixture data could not load: ${String(error)}`;
      console.error(error);
    } finally {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  };
  for (const item of datasets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.data = item.id;
    button.textContent = item.label;
    button.style.cssText = 'min-height:30px;padding:4px 8px;border:0;border-radius:5px;color:inherit;font:inherit;cursor:pointer';
    button.addEventListener('click', () => { void setData(item.id); });
    buttons.push(button);
    host.append(button);
  }
  const restore = () => {
    if (boundary && originalBoundaryConfig && originalAccounts) {
      boundary.config = originalBoundaryConfig;
      boundary.accounts = originalAccounts;
    } else {
      if (savedPreview === null) localStorage.removeItem(previewKey);
      else localStorage.setItem(previewKey, savedPreview);
      sessionStorage.removeItem(backupKey);
    }
  };
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.textContent = 'Exit preview';
  leave.style.cssText = 'min-height:30px;padding:4px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;cursor:pointer';
  leave.addEventListener('click', () => {
    restore();
    const url = new URL(location.href);
    url.searchParams.delete('uiStress');
    url.searchParams.delete('data');
    location.assign(url);
  });
  host.append(leave, status);
  document.body.append(host);
  reserveChrome();
  resize.observe(host);
  const cleanup = () => {
    disposed = true;
    restore();
    host.remove();
    resize.disconnect();
    chromeStyle.remove();
    document.documentElement.style.removeProperty('--ui-stress-space');
    window.removeEventListener('beforeunload', restore);
    delete fixtureWindow.uiStressFixture;
  };
  window.addEventListener('beforeunload', restore);
  fixtureWindow.uiStressFixture = { setData, cleanup };
  setSelected(currentDataset());
  void setData(currentDataset());
  return cleanup;
}

/** The ordinary DEV app installs controls under its existing provider. */
export default function UiStressFixture() {
  const actions = useLauncherActions();
  const snapshot = useLauncherSnapshot();
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const ready = snapshot.config.ready;
  useEffect(() => {
    if (!ready) return;
    return installUiStressFixture(actions, () => latest.current);
    // The installer owns the fixture lifecycle, not each config reload.
  }, [actions, ready]);
  return null;
}
