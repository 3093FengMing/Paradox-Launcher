import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { accentForeground } from '../colors';
import type { Appearance } from '../types';

interface Props {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
}

const styles = [
  {
    id: 'immersive',
    title: 'appearance.styles.immersive.title',
    description: 'appearance.styles.immersive.description',
  },
  {
    id: 'modern',
    title: 'appearance.styles.modern.title',
    description: 'appearance.styles.modern.description',
  },
] as const;

const themes = [
  { id: 'dark', label: 'appearance.themes.dark', icon: Moon },
  { id: 'light', label: 'appearance.themes.light', icon: Sun },
  { id: 'system', label: 'appearance.themes.system', icon: Monitor },
] as const;

const accentPresets = [
  { color: '#6387f5', name: 'appearance.accents.blue' },
  { color: '#a78bfa', name: 'appearance.accents.purple' },
  { color: '#4cb99a', name: 'appearance.accents.teal' },
  { color: '#eaa55c', name: 'appearance.accents.orange' },
  { color: '#e979a7', name: 'appearance.accents.pink' },
  { color: '#a3e635', name: 'appearance.accents.lime' },
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

function RangeSetting({
  title,
  description,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: RangeSettingProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="setting-row">
      <div>
        <h3 id={`${id}-label`}>{title}</h3>
        <p id={`${id}-description`}>{description}</p>
      </div>
      <div className="range-control">
        <input
          id={`${id}-input`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
          aria-valuetext={unit === 'px' ? t('common.pixels', { value }) : `${value}%`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output htmlFor={`${id}-input`}>
          {value}
          {unit}
        </output>
      </div>
    </div>
  );
}

interface ToggleSettingProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleSetting({ title, description, checked, onChange }: ToggleSettingProps) {
  const id = useId();
  return (
    <div className="setting-row">
      <div>
        <h3 id={`${id}-label`}>{title}</h3>
        <p id={`${id}-description`}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export default function AppearanceSettings({ appearance, onChange }: Props) {
  const { t } = useTranslation();
  const styleLabelId = useId();
  const themeLabelId = useId();
  const patch = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    onChange({ ...appearance, [key]: value });

  return (
    <>
      <div className="settings-intro">
        <h2>{t('appearance.title')}</h2>
        <p>{t('appearance.description')}</p>
        <p>{t('appearance.placeholder')}</p>
      </div>

      <div className="field">
        <span id={styleLabelId}>{t('appearance.style')}</span>
        <div className="style-options" role="group" aria-labelledby={styleLabelId}>
          {styles.map((style) => (
            <button
              type="button"
              key={style.id}
              className={`style-option ${appearance.interface_style === style.id ? 'selected' : ''}`}
              aria-label={t(style.title)}
              aria-pressed={appearance.interface_style === style.id}
              onClick={() => patch('interface_style', style.id)}
            >
              <span
                className={`style-preview ${style.id === 'modern' ? 'modern-preview' : ''}`}
                aria-hidden="true"
              >
                {style.id === 'modern' && <b />}
                <i />
              </span>
              <span className="style-option-label">
                <span>
                  <strong>{t(style.title)}</strong>
                  <small>{t(style.description)}</small>
                </span>
                {appearance.interface_style === style.id && <Check size={17} aria-hidden="true" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span id={themeLabelId}>{t('appearance.theme')}</span>
        <div className="theme-options" role="group" aria-labelledby={themeLabelId}>
          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              className={appearance.theme === theme.id ? 'selected' : ''}
              aria-label={t(theme.label)}
              aria-pressed={appearance.theme === theme.id}
              onClick={() => patch('theme', theme.id)}
            >
              <theme.icon size={21} aria-hidden="true" />
              <span>{t(theme.label)}</span>
              {appearance.theme === theme.id && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <div>
          <h3>{t('appearance.accent')}</h3>
          <p>{t('appearance.accentDescription')}</p>
        </div>
        <div className="swatches" role="group" aria-label={t('appearance.accent')}>
          {accentPresets.map((preset) => (
            <button
              type="button"
              key={preset.color}
              aria-label={t('appearance.accentLabel', {
                name: t(preset.name),
                color: preset.color,
              })}
              aria-pressed={appearance.accent_color.toLowerCase() === preset.color}
              title={t(preset.name)}
              style={{ background: preset.color, color: accentForeground(preset.color) }}
              onClick={() => patch('accent_color', preset.color)}
            >
              {appearance.accent_color.toLowerCase() === preset.color && (
                <Check size={16} aria-hidden="true" />
              )}
            </button>
          ))}
          <input
            type="color"
            aria-label={t('appearance.customAccent')}
            title={t('appearance.customAccent')}
            value={appearance.accent_color}
            onChange={(event) => patch('accent_color', event.target.value)}
          />
        </div>
      </div>

      <RangeSetting
        title={t('appearance.scale')}
        description={t('appearance.scaleDescription')}
        min={85}
        max={120}
        step={5}
        unit="%"
        value={appearance.ui_scale}
        onChange={(value) => patch('ui_scale', value)}
      />
      <RangeSetting
        title={t('appearance.radius')}
        description={t('appearance.radiusDescription')}
        min={0}
        max={28}
        unit="px"
        value={appearance.border_radius}
        onChange={(value) => patch('border_radius', value)}
      />
      <ToggleSetting
        title={t('appearance.compact')}
        description={t('appearance.compactDescription')}
        checked={appearance.compact_sidebar}
        onChange={(value) => patch('compact_sidebar', value)}
      />
      <ToggleSetting
        title={t('appearance.background')}
        description={
          appearance.interface_style === 'immersive'
            ? t('appearance.backgroundImmersive')
            : t('appearance.backgroundModern')
        }
        checked={appearance.background_art}
        onChange={(value) => patch('background_art', value)}
      />

      {appearance.interface_style === 'immersive' && (
        <>
          <RangeSetting
            title={t('appearance.blur')}
            description={t('appearance.blurDescription')}
            min={0}
            max={16}
            unit="px"
            value={appearance.background_blur}
            onChange={(value) => patch('background_blur', value)}
          />
          <RangeSetting
            title={t('appearance.dim')}
            description={t('appearance.dimDescription')}
            min={0}
            max={60}
            unit="%"
            value={appearance.background_dim}
            onChange={(value) => patch('background_dim', value)}
          />
          <RangeSetting
            title={t('appearance.sidebarOpacity')}
            description={t('appearance.sidebarOpacityDescription')}
            min={25}
            max={85}
            unit="%"
            value={appearance.sidebar_opacity}
            onChange={(value) => patch('sidebar_opacity', value)}
          />
        </>
      )}

      <ToggleSetting
        title={t('appearance.reduceMotion')}
        description={t('appearance.reduceMotionDescription')}
        checked={appearance.reduce_motion}
        onChange={(value) => patch('reduce_motion', value)}
      />
    </>
  );
}
