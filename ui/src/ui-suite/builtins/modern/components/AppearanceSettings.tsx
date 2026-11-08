import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot, useUiEditorActions, useUiEditorSnapshot } from '@paradox/launcher';
import { sourceView, viewProps } from '../../common/lib/view';
import { accentForeground } from '../../common/lib/colors';
import '../styles/settings.css';
interface RangeProps {
    title: string;
    description: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit: '%' | 'px';
    onChange: (value: number) => void;
}
function DefaultRange(input: RangeProps) {
    const { title, description, value, min, max, step = 1, unit, onChange } = viewProps<RangeProps>(input), id = useId(), { t } = useTranslation();
    return <div className="settings-row appearance-range" data-ui-site="Appearance-1">
    <div data-ui-site="Appearance-2">
    <h3 id={`${id}-label`} data-ui-site="Appearance-3">{title}</h3>
    <p id={`${id}-description`} data-ui-site="Appearance-4">{description}</p>
    </div>
    <div className="settings-range-control" data-ui-site="Appearance-5">
    <input id={`${id}-input`} type="range" min={min} max={max} step={step} value={value} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} aria-valuetext={unit === 'px' ? t('common.pixels', { value }) : `${value}%`} onChange={event => onChange(Number(event.target.value))} data-ui-site="Appearance-6"/>
    <output htmlFor={`${id}-input`} data-ui-site="Appearance-7">{value}{unit}</output>
    </div>
    </div>;
}
interface ToggleProps {
    title: string;
    description: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}
function DefaultToggle(input: ToggleProps) {
    const { title, description, checked, onChange } = viewProps<ToggleProps>(input), id = useId();
    return <div className="settings-row appearance-toggle" data-ui-site="Appearance-8">
    <div data-ui-site="Appearance-9">
    <h3 id={`${id}-label`} data-ui-site="Appearance-10">{title}</h3>
    <p id={`${id}-description`} data-ui-site="Appearance-11">{description}</p>
    </div>
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} data-ui-site="Appearance-12">
    <span data-ui-site="Appearance-13"/>
    </button>
    </div>;
}
const Range = sourceView<RangeProps>('control.range-setting', DefaultRange), Switch = sourceView<ToggleProps>('control.toggle-setting', DefaultToggle);
const styles = [{ id: 'modern', title: 'appearance.styles.modern.title', description: 'appearance.styles.modern.description' }, { id: 'immersive', title: 'appearance.styles.immersive.title', description: 'appearance.styles.immersive.description' }] as const;
const themes = [{ id: 'dark', label: 'appearance.themes.dark', icon: Moon }, { id: 'light', label: 'appearance.themes.light', icon: Sun }, { id: 'system', label: 'appearance.themes.system', icon: Monitor }] as const;
const accents = [{ color: '#6387f5', name: 'appearance.accents.blue' }, { color: '#a78bfa', name: 'appearance.accents.purple' }, { color: '#4cb99a', name: 'appearance.accents.teal' }, { color: '#eaa55c', name: 'appearance.accents.orange' }, { color: '#e979a7', name: 'appearance.accents.pink' }, { color: '#a3e635', name: 'appearance.accents.lime' }] as const;
export default function AppearanceSettings(input?: {
    props?: Readonly<Record<string, unknown>>;
    section?: 'layout' | 'style';
}) {
    const { t } = useTranslation(), s = useLauncherSnapshot(), suite = useUiEditorSnapshot(), suiteActions = useUiEditorActions(), patch = useLauncherActions().settings.patchAppearance, id = useId();
    const section = viewProps<{
        section?: 'layout' | 'style';
    }>(input).section, appearance = s.settings.draft?.appearance;
    if (!appearance)
        return null;
    const layout = <div className="appearance-layout" data-ui-site="Appearance-14">
    <header data-ui-site="Appearance-15">
    <h2 data-ui-site="Appearance-16">{t('settingsPages.sections.layout')}</h2>
    <p data-ui-site="Appearance-17">{t('settingsPages.draftPreview')}</p>
    </header>
    <div className="appearance-layout-choices" data-ui-site="Appearance-18">
    <h3 id={`${id}-styles`} data-ui-site="Appearance-19">{t('settingsPages.builtins')}</h3>
    <div className="settings-style-options" role="group" aria-labelledby={`${id}-styles`} data-ui-site="Appearance-20">{styles.map(style => <UiIdentity key={style.id} namespace="suite" value={`builtin.${style.id}`}>
        <button type="button" disabled={Boolean(suite.pending)} className={`settings-style-option ${suite.selectedSuiteId === `builtin.${style.id}` ? 'selected' : ''}`} aria-pressed={suite.selectedSuiteId === `builtin.${style.id}`} onClick={() => void suiteActions.selectSuite(`builtin.${style.id}`)} data-ui-site="Appearance-21">
        <span className={`settings-style-preview ${style.id}`} aria-hidden="true" data-ui-site="Appearance-22">
        <i data-ui-site="Appearance-23"/>
        <b data-ui-site="Appearance-24"/>
        </span>
        <span data-ui-site="Appearance-25">
        <strong data-ui-site="Appearance-26">{t(style.title)}</strong>
        <small data-ui-site="Appearance-27">{t(style.description)}</small>
        </span>{suite.selectedSuiteId === `builtin.${style.id}` && <Check size={16} aria-hidden="true" data-ui-site="Appearance-28"/>}</button>
        </UiIdentity>)}</div>
    </div>{suite.suites.some(item => !item.builtin) && <div className="appearance-user-suites" data-ui-site="Appearance-29">
        <h3 data-ui-site="Appearance-30">{t('settingsPages.customSuites')}</h3>
        <div className="settings-options" data-ui-site="Appearance-31">{suite.suites.filter(item => !item.builtin).map(item => <UiIdentity key={item.id} namespace="suite" value={item.id}>
            <button type="button" disabled={Boolean(suite.pending)} aria-pressed={suite.selectedSuiteId === item.id} className={suite.selectedSuiteId === item.id ? 'selected' : ''} onClick={() => void suiteActions.selectSuite(item.id)} data-ui-site="Appearance-32">{item.name}</button>
            </UiIdentity>)}</div>
        </div>}<div className="appearance-themes" data-ui-site="Appearance-33">
    <h3 id={`${id}-themes`} data-ui-site="Appearance-34">{t('appearance.theme')}</h3>
    <div className="settings-options" role="group" aria-labelledby={`${id}-themes`} data-ui-site="Appearance-35">{themes.map(theme => <UiIdentity key={theme.id} namespace="theme" value={theme.id}>
        <button type="button" className={appearance.theme === theme.id ? 'selected' : ''} aria-pressed={appearance.theme === theme.id} onClick={() => patch('theme', theme.id)} data-ui-site="Appearance-36">
        <theme.icon size={18} aria-hidden="true" data-ui-site="Appearance-37"/>{t(theme.label)}</button>
        </UiIdentity>)}</div>
    </div>
    </div>;
    const spacing = <div className="appearance-spacing" data-ui-site="Appearance-38">
    <h2 data-ui-site="Appearance-39">{t('settingsPages.sections.style')}</h2>
    <div className="settings-row appearance-colors" data-ui-site="Appearance-40">
    <div data-ui-site="Appearance-41">
    <h3 data-ui-site="Appearance-42">{t('appearance.accent')}</h3>
    <p data-ui-site="Appearance-43">{t('appearance.accentDescription')}</p>
    </div>
    <div className="settings-swatches" role="group" aria-label={t('appearance.accent')} data-ui-site="Appearance-44">{accents.map(accent => <UiIdentity key={accent.color} namespace="accent" value={accent.color}>
        <button type="button" aria-label={t('appearance.accentLabel', { name: t(accent.name), color: accent.color })} title={t(accent.name)} aria-pressed={appearance.accent_color.toLowerCase() === accent.color} style={{ background: accent.color, color: accentForeground(accent.color) }} onClick={() => patch('accent_color', accent.color)} data-ui-site="Appearance-45">{appearance.accent_color.toLowerCase() === accent.color && <Check size={16} aria-hidden="true" data-ui-site="Appearance-46"/>}</button>
        </UiIdentity>)}<input type="color" aria-label={t('appearance.customAccent')} title={t('appearance.customAccent')} value={appearance.accent_color} onChange={event => patch('accent_color', event.target.value)} data-ui-site="Appearance-47"/>
    </div>
    </div>
    <div className="appearance-measures" data-ui-site="Appearance-48">
    <UiIdentity namespace="appearance-field" value="ui_scale">
    <Range title={t('appearance.scale')} description={t('appearance.scaleDescription')} min={85} max={120} step={5} unit="%" value={appearance.ui_scale} onChange={value => patch('ui_scale', value)} data-ui-site="Appearance-49"/>
    </UiIdentity>
    <UiIdentity namespace="appearance-field" value="border_radius">
    <Range title={t('appearance.radius')} description={t('appearance.radiusDescription')} min={0} max={28} unit="px" value={appearance.border_radius} onChange={value => patch('border_radius', value)} data-ui-site="Appearance-50"/>
    </UiIdentity>
    <UiIdentity namespace="appearance-field" value="sidebar_opacity">
    <Range title={t('appearance.sidebarOpacity')} description={t('appearance.sidebarOpacityDescription')} min={25} max={85} unit="%" value={appearance.sidebar_opacity} onChange={value => patch('sidebar_opacity', value)} data-ui-site="Appearance-51"/>
    </UiIdentity>
    </div>
    <div className="appearance-switches" data-ui-site="Appearance-52">
    <UiIdentity namespace="appearance-field" value="compact_sidebar">
    <Switch title={t('appearance.compact')} description={t('appearance.compactDescription')} checked={appearance.compact_sidebar} onChange={value => patch('compact_sidebar', value)} data-ui-site="Appearance-53"/>
    </UiIdentity>
    <UiIdentity namespace="appearance-field" value="reduce_motion">
    <Switch title={t('appearance.reduceMotion')} description={t('appearance.reduceMotionDescription')} checked={appearance.reduce_motion} onChange={value => patch('reduce_motion', value)} data-ui-site="Appearance-54"/>
    </UiIdentity>
    </div>
    </div>;
    return <div className="settings-appearance modern-appearance" data-ui-site="Appearance-55">{section !== 'style' && layout}{section !== 'layout' && spacing}</div>;
}
