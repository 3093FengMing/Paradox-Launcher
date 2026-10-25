import { useId } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { accentForeground } from '../colors';
import type { Appearance } from '../types';

interface Props {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
}

const styles = [
  { id: 'immersive', title: '沉浸主页', description: '全窗背景 · 透明侧栏' },
  { id: 'modern', title: '现代工作台', description: '卡片概览 · 清晰分区' },
] as const;

const themes = [
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'system', label: '跟随系统', icon: Monitor },
] as const;

const accentPresets = [
  { color: '#6387f5', name: '蓝色' },
  { color: '#a78bfa', name: '紫色' },
  { color: '#4cb99a', name: '青绿色' },
  { color: '#eaa55c', name: '橙色' },
  { color: '#e979a7', name: '粉色' },
  { color: '#a3e635', name: '青柠色' },
] as const;

interface RangeSettingProps {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: '%' | 'px';
  onChange: (value: number) => void;
}

function RangeSetting({ title, description, value, min, max, step = 1, unit, onChange }: RangeSettingProps) {
  const id = useId();
  return <div className="setting-row">
    <div><h3 id={`${id}-label`}>{title}</h3><p id={`${id}-description`}>{description}</p></div>
    <div className="range-control"><input id={`${id}-input`} type="range" min={min} max={max} step={step} value={value} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} aria-valuetext={`${value}${unit === 'px' ? ' 像素' : '%'}`} onChange={event => onChange(Number(event.target.value))} /><output htmlFor={`${id}-input`}>{value}{unit}</output></div>
  </div>;
}

interface ToggleSettingProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleSetting({ title, description, checked, onChange }: ToggleSettingProps) {
  const id = useId();
  return <div className="setting-row">
    <div><h3 id={`${id}-label`}>{title}</h3><p id={`${id}-description`}>{description}</p></div>
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}

export default function AppearanceSettings({ appearance, onChange }: Props) {
  const styleLabelId = useId();
  const themeLabelId = useId();
  const patch = <K extends keyof Appearance>(key: K, value: Appearance[K]) => onChange({ ...appearance, [key]: value });

  return <>
    <div className="settings-intro"><h2>让启动器更像你</h2><p>修改会即时预览，保存后在下次启动时继续生效。</p><p>当前背景使用占位图，正式背景图后续可替换。</p></div>

    <div className="field"><span id={styleLabelId}>界面风格</span><div className="style-options" role="group" aria-labelledby={styleLabelId}>
      {styles.map(style => <button type="button" key={style.id} className={`style-option ${appearance.interface_style === style.id ? 'selected' : ''}`} aria-label={style.title} aria-pressed={appearance.interface_style === style.id} onClick={() => patch('interface_style', style.id)}>
        <span className={`style-preview ${style.id === 'modern' ? 'modern-preview' : ''}`} aria-hidden="true">{style.id === 'modern' && <b />}<i /></span>
        <span className="style-option-label"><span><strong>{style.title}</strong><small>{style.description}</small></span>{appearance.interface_style === style.id && <Check size={17} aria-hidden="true" />}</span>
      </button>)}
    </div></div>

    <div className="field"><span id={themeLabelId}>界面主题</span><div className="theme-options" role="group" aria-labelledby={themeLabelId}>
      {themes.map(theme => <button type="button" key={theme.id} className={appearance.theme === theme.id ? 'selected' : ''} aria-label={theme.label} aria-pressed={appearance.theme === theme.id} onClick={() => patch('theme', theme.id)}><theme.icon size={21} aria-hidden="true" /><span>{theme.label}</span>{appearance.theme === theme.id && <Check size={15} aria-hidden="true" />}</button>)}
    </div></div>

    <div className="setting-row"><div><h3>强调色</h3><p>用于按钮、选中状态和关键提示。</p></div><div className="swatches" role="group" aria-label="强调色">
      {accentPresets.map(preset => <button type="button" key={preset.color} aria-label={`${preset.name}强调色 ${preset.color}`} aria-pressed={appearance.accent_color.toLowerCase() === preset.color} title={preset.name} style={{ background: preset.color, color: accentForeground(preset.color) }} onClick={() => patch('accent_color', preset.color)}>{appearance.accent_color.toLowerCase() === preset.color && <Check size={16} aria-hidden="true" />}</button>)}
      <input type="color" aria-label="自定义强调色" title="自定义强调色" value={appearance.accent_color} onChange={event => patch('accent_color', event.target.value)} />
    </div></div>

    <RangeSetting title="界面缩放" description="调整文字与控件的视觉尺寸。" min={85} max={120} step={5} unit="%" value={appearance.ui_scale} onChange={value => patch('ui_scale', value)} />
    <RangeSetting title="卡片圆角" description="从简洁直角到柔和圆角。" min={0} max={28} unit="px" value={appearance.border_radius} onChange={value => patch('border_radius', value)} />
    <ToggleSetting title="紧凑侧栏" description="只显示导航图标，为内容留出更多空间。" checked={appearance.compact_sidebar} onChange={value => patch('compact_sidebar', value)} />
    <ToggleSetting title="背景图" description={appearance.interface_style === 'immersive' ? '显示全窗口背景占位图，关闭后使用纯色背景。' : '在首页卡片中显示背景占位图。'} checked={appearance.background_art} onChange={value => patch('background_art', value)} />

    {appearance.interface_style === 'immersive' && <>
      <RangeSetting title="背景模糊" description="柔化背景，让前景内容更突出。" min={0} max={16} unit="px" value={appearance.background_blur} onChange={value => patch('background_blur', value)} />
      <RangeSetting title="背景遮罩" description="数值越高，背景越暗。" min={0} max={60} unit="%" value={appearance.background_dim} onChange={value => patch('background_dim', value)} />
      <RangeSetting title="侧栏不透明度" description="数值越低，侧栏越通透。" min={25} max={85} unit="%" value={appearance.sidebar_opacity} onChange={value => patch('sidebar_opacity', value)} />
    </>}

    <ToggleSetting title="减少动效" description="关闭非必要的界面过渡与动画。" checked={appearance.reduce_motion} onChange={value => patch('reduce_motion', value)} />
  </>;
}
