import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { sourceView } from '../lib/view';
import { accentForeground } from '../lib/colors';
import { useLauncherActions, useLauncherSnapshot, useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
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
function DefaultRangeSetting({
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
    <div className="setting-row" data-ui-site="AppearanceSettings-1">
      <div data-ui-site="AppearanceSettings-2">
        <h3 id={`${id}-label`} data-ui-site="AppearanceSettings-3">
          {title}
        </h3>
        <p id={`${id}-description`} data-ui-site="AppearanceSettings-4">
          {description}
        </p>
      </div>
      <div className="range-control" data-ui-site="AppearanceSettings-5">
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
          data-ui-site="AppearanceSettings-6"
        />
        <output htmlFor={`${id}-input`} data-ui-site="AppearanceSettings-7">
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
function DefaultToggleSetting({ title, description, checked, onChange }: ToggleSettingProps) {
  const id = useId();
  return (
    <div className="setting-row" data-ui-site="AppearanceSettings-8">
      <div data-ui-site="AppearanceSettings-9">
        <h3 id={`${id}-label`} data-ui-site="AppearanceSettings-10">
          {title}
        </h3>
        <p id={`${id}-description`} data-ui-site="AppearanceSettings-11">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        data-ui-site="AppearanceSettings-12"
      >
        <span data-ui-site="AppearanceSettings-13" />
      </button>
    </div>
  );
}
function AppearanceSettings() {
  const snapshot = useLauncherSnapshot(),
    patch = useLauncherActions().settings.patchAppearance;
  const suite = useUiEditorSnapshot(), suiteActions = useUiEditorActions();
  const appearance = snapshot.settings.draft?.appearance;
  const { t } = useTranslation();
  const styleLabelId = useId();
  const themeLabelId = useId();
  if (!appearance) return null;
  return (
    <Fragment data-ui-site="AppearanceSettings-14">
      <div className="settings-intro" data-ui-site="AppearanceSettings-15">
        <h2 data-ui-site="AppearanceSettings-16">{t('appearance.title')}</h2>
        <p data-ui-site="AppearanceSettings-17">{t('appearance.description')}</p>
        <p data-ui-site="AppearanceSettings-18">{t('appearance.placeholder')}</p>
      </div>

      <div className="field" data-ui-site="AppearanceSettings-19">
        <span id={styleLabelId} data-ui-site="AppearanceSettings-20">
          {t('appearance.style')}
        </span>
        <div
          className="style-options"
          role="group"
          aria-labelledby={styleLabelId}
          data-ui-site="AppearanceSettings-21"
        >
          {styles.map((style) => (
            <button
              type="button"
              key={style.id}
              className={`style-option ${suite.selectedSuiteId === 'builtin.' + style.id ? 'selected' : ''}`}
              aria-label={t(style.title)}
              aria-pressed={suite.selectedSuiteId === 'builtin.' + style.id}
              onClick={() => void suiteActions.selectSuite('builtin.' + style.id)}
              data-ui-site="AppearanceSettings-22"
            >
              <span
                className={`style-preview ${style.id === 'modern' ? 'modern-preview' : ''}`}
                aria-hidden="true"
                data-ui-site="AppearanceSettings-23"
              >
                {style.id === 'modern' && <b data-ui-site="AppearanceSettings-24" />}
                <i data-ui-site="AppearanceSettings-25" />
              </span>
              <span className="style-option-label" data-ui-site="AppearanceSettings-26">
                <span data-ui-site="AppearanceSettings-27">
                  <strong data-ui-site="AppearanceSettings-28">{t(style.title)}</strong>
                  <small data-ui-site="AppearanceSettings-29">{t(style.description)}</small>
                </span>
                {suite.selectedSuiteId === 'builtin.' + style.id && (
                  <Check size={17} aria-hidden="true" data-ui-site="AppearanceSettings-30" />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

<div className="field" data-ui-site="AppearanceSettings-user-suites">{suite.suites.filter(item=>!item.builtin).map(item=><button data-ui-site="AppearanceSettings-user-suite" key={item.id} aria-pressed={suite.selectedSuiteId===item.id} onClick={()=>void suiteActions.selectSuite(item.id)}>{item.name}</button>)}</div>
      <div className="field" data-ui-site="AppearanceSettings-31">
        <span id={themeLabelId} data-ui-site="AppearanceSettings-32">
          {t('appearance.theme')}
        </span>
        <div
          className="theme-options"
          role="group"
          aria-labelledby={themeLabelId}
          data-ui-site="AppearanceSettings-33"
        >
          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              className={appearance.theme === theme.id ? 'selected' : ''}
              aria-label={t(theme.label)}
              aria-pressed={appearance.theme === theme.id}
              onClick={() => patch('theme', theme.id)}
              data-ui-site="AppearanceSettings-34"
            >
              <theme.icon size={21} aria-hidden="true" data-ui-site="AppearanceSettings-35" />
              <span data-ui-site="AppearanceSettings-36">{t(theme.label)}</span>
              {appearance.theme === theme.id && (
                <Check size={15} aria-hidden="true" data-ui-site="AppearanceSettings-37" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="setting-row" data-ui-site="AppearanceSettings-38">
        <div data-ui-site="AppearanceSettings-39">
          <h3 data-ui-site="AppearanceSettings-40">{t('appearance.accent')}</h3>
          <p data-ui-site="AppearanceSettings-41">{t('appearance.accentDescription')}</p>
        </div>
        <div
          className="swatches"
          role="group"
          aria-label={t('appearance.accent')}
          data-ui-site="AppearanceSettings-42"
        >
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
              data-ui-site="AppearanceSettings-43"
            >
              {appearance.accent_color.toLowerCase() === preset.color && (
                <Check size={16} aria-hidden="true" data-ui-site="AppearanceSettings-44" />
              )}
            </button>
          ))}
          <input
            type="color"
            aria-label={t('appearance.customAccent')}
            title={t('appearance.customAccent')}
            value={appearance.accent_color}
            onChange={(event) => patch('accent_color', event.target.value)}
            data-ui-site="AppearanceSettings-45"
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
        data-ui-site="AppearanceSettings-46"
      />
      <RangeSetting
        title={t('appearance.radius')}
        description={t('appearance.radiusDescription')}
        min={0}
        max={28}
        unit="px"
        value={appearance.border_radius}
        onChange={(value) => patch('border_radius', value)}
        data-ui-site="AppearanceSettings-47"
      />
      <ToggleSetting
        title={t('appearance.compact')}
        description={t('appearance.compactDescription')}
        checked={appearance.compact_sidebar}
        onChange={(value) => patch('compact_sidebar', value)}
        data-ui-site="AppearanceSettings-48"
      />
      <ToggleSetting
        title={t('appearance.background')}
        description={
          suite.selectedSuiteId === 'builtin.immersive'
            ? t('appearance.backgroundImmersive')
            : t('appearance.backgroundModern')
        }
        checked={appearance.background_art}
        onChange={(value) => patch('background_art', value)}
        data-ui-site="AppearanceSettings-49"
      />

      {suite.selectedSuiteId === 'builtin.immersive' && (
        <Fragment data-ui-site="AppearanceSettings-50">
          <RangeSetting
            title={t('appearance.blur')}
            description={t('appearance.blurDescription')}
            min={0}
            max={16}
            unit="px"
            value={appearance.background_blur}
            onChange={(value) => patch('background_blur', value)}
            data-ui-site="AppearanceSettings-51"
          />
          <RangeSetting
            title={t('appearance.dim')}
            description={t('appearance.dimDescription')}
            min={0}
            max={60}
            unit="%"
            value={appearance.background_dim}
            onChange={(value) => patch('background_dim', value)}
            data-ui-site="AppearanceSettings-52"
          />
          <RangeSetting
            title={t('appearance.sidebarOpacity')}
            description={t('appearance.sidebarOpacityDescription')}
            min={25}
            max={85}
            unit="%"
            value={appearance.sidebar_opacity}
            onChange={(value) => patch('sidebar_opacity', value)}
            data-ui-site="AppearanceSettings-53"
          />
        </Fragment>
      )}

      <ToggleSetting
        title={t('appearance.reduceMotion')}
        description={t('appearance.reduceMotionDescription')}
        checked={appearance.reduce_motion}
        onChange={(value) => patch('reduce_motion', value)}
        data-ui-site="AppearanceSettings-54"
      />
    </Fragment>
  );
}
const RangeSetting = sourceView<RangeSettingProps>('control.range-setting', DefaultRangeSetting);
const ToggleSetting = sourceView<ToggleSettingProps>(
  'control.toggle-setting',
  DefaultToggleSetting,
);
export default AppearanceSettings;
