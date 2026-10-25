import { Box, CircleHelp, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { desktop } from '../api';

interface Props { onHelp: () => void; onError: (message: string) => void }

export default function WindowBar({ onHelp, onError }: Props) {
  const action = (operation: 'minimize' | 'toggleMaximize' | 'close') => {
    if (desktop) void getCurrentWindow()[operation]().catch(error => onError(String(error)));
  };
  return <header className="window-bar" data-tauri-drag-region>
    <div className="window-title" data-tauri-drag-region><Box size={19} /><span data-tauri-drag-region>Paradox Launcher <small data-tauri-drag-region>v0.1.0</small></span></div>
    <div className="window-controls"><button aria-label="帮助与设置" title="帮助与设置" onClick={onHelp}><CircleHelp size={18} /></button>
      <button aria-label="最小化窗口" title="最小化" disabled={!desktop} onClick={() => action('minimize')}><Minus size={18} /></button>
      <button aria-label="最大化或还原窗口" title="最大化 / 还原" disabled={!desktop} onClick={() => action('toggleMaximize')}><Square size={13} /></button>
      <button className="window-close" aria-label="关闭启动器" title="关闭" disabled={!desktop} onClick={() => action('close')}><X size={20} /></button></div>
  </header>;
}
