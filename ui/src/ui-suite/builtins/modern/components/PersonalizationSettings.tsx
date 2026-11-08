import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select, Toggle, UiIdentity } from '@paradox/ui';
import { useLauncherSnapshot, useLauncherActions, type Personalization, type UiRouteId } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import { personalizationSettingsState } from '../../common/lib/settings-display';
import '../styles/settings.css';
export default function PersonalizationSettings(input?: {
    props?: Readonly<Record<string, unknown>>;
    section?: 'appearance' | 'behavior';
}) {
    const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions().settings, id = useId();
    const section = viewProps<{
        section?: 'appearance' | 'behavior';
    }>(input).section ?? 'appearance', value = s.settings.draft?.personalization;
    const { disabled } = personalizationSettingsState(s);
    if (!value)
        return null;
    const startupOptions = s.navigation.routes.filter(route => route.startupSelectable).map(route => ({ value: route.id, label: t(route.title, { defaultValue: route.title }) }));
    const font = <Field label={t('personalization.font')} description={t('settingsPages.fontHint')} data-ui-site="Personalization-1">
    <Select aria-label={t('personalization.font')} value={value.font} disabled={disabled} onValueChange={next => a.patchPersonalization('font', next as Personalization['font'])} options={['system', 'yahei', 'arial', 'serif', 'monospace'].map(font => ({ value: font, label: t(`personalization.fonts.${font}`) }))} data-ui-site="Personalization-2"/>
    </Field>;
    const startup = <Field label={t('personalization.startupPage')} description={t('personalization.startupPageHelp')} data-ui-site="Personalization-3">
    <Select aria-label={t('personalization.startupPage')} value={value.startup_page} disabled={disabled} onValueChange={next => a.setStartupRoute(next as UiRouteId)} options={startupOptions} placeholder={`${value.startup_page} (${t('personalization.startupUnavailable')})`} data-ui-site="Personalization-4"/>
    </Field>;
    const toggles = <div className="personalization-toggles" data-ui-site="Personalization-5">{(['notifications', 'retain_logs', 'shortcuts'] as const).map(key => <UiIdentity key={key} namespace="personalization-field" value={key}>
        <div className="settings-row" data-ui-site="Personalization-6">
        <div data-ui-site="Personalization-7">
        <h3 data-ui-site="Personalization-8">{t(`personalization.${key}.title`)}</h3>
        <p data-ui-site="Personalization-9">{t(`personalization.${key}.description`)}</p>
        </div>
        <Toggle disabled={disabled} label={t(`personalization.${key}.title`)} checked={value[key]} onChange={next => a.patchPersonalization(key, next)} data-ui-site="Personalization-10"/>
        </div>
        </UiIdentity>)}</div>;
    const shortcut = <Field label={t('personalization.launchShortcut')} description={t('personalization.shortcutHelp')} data-ui-site="Personalization-11">
    <Select aria-label={t('personalization.launchShortcut')} disabled={disabled || !value.shortcuts} value={value.launch_shortcut} onValueChange={next => a.patchPersonalization('launch_shortcut', next as Personalization['launch_shortcut'])} options={['Ctrl+Enter', 'Ctrl+Shift+L', 'Alt+Enter'].map(value => ({ value, label: value }))} data-ui-site="Personalization-12"/>
    </Field>;
    return <section className="settings-personalization modern-personalization" aria-labelledby={id} data-ui-site="Personalization-13">
    <h3 id={id} data-ui-site="Personalization-14">{t(section === 'appearance' ? 'personalization.font' : 'personalization.behaviorTitle')}</h3>{section === 'appearance' ? font : <>
        <p data-ui-site="Personalization-15">{t('personalization.behaviorDescription')}</p>
        <div className="personalization-selects" data-ui-site="Personalization-16">{startup}{shortcut}</div>{toggles}</>}</section>;
}
