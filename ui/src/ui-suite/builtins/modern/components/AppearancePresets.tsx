import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Import, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { appearancePresetState } from '../../common/lib/settings-display';
import DefaultDialog from '../dialogs/AppearancePresetDialog';
import '../styles/appearance-presets.css';
const Dialog = sourceView('dialog.preset', DefaultDialog);
export default function AppearancePresets() {
    const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions().presets, id = useId();
    const { presets, blocked, capacity, maximum, currentIds } = appearancePresetState(s);
    const tools = <div className="settings-preset-tools" data-ui-site="Presets-1">
    <button type="button" className="secondary" disabled={blocked || capacity} onClick={() => a.openDialog({ kind: 'import' })} data-ui-site="Presets-2">
    <Import size={16} aria-hidden="true" data-ui-site="Presets-3"/>{t('presets.import')}</button>
    <button type="button" className="secondary" disabled={blocked || capacity} onClick={() => a.openDialog({ kind: 'save' })} data-ui-site="Presets-4">
    <Plus size={16} aria-hidden="true" data-ui-site="Presets-5"/>{t('presets.saveCurrent')}</button>
    </div>;
    const list = presets.length ? <div className="settings-preset-list" data-ui-site="Presets-6">{presets.map(preset => {
            const current = currentIds.includes(preset.id);
            return <UiIdentity key={preset.id} namespace="appearance-preset" value={preset.id}>
            <article className={`settings-preset ${current ? 'current' : ''}`} data-ui-site="Presets-7">
            <div className="settings-preset-info" data-ui-site="Presets-8">
            <Layers size={21} style={{ color: preset.appearance.accent_color }} aria-hidden="true" data-ui-site="Presets-9"/>
            <div data-ui-site="Presets-10">
            <h4 data-ui-site="Presets-11">{preset.name}</h4>
            <p data-ui-site="Presets-12">{t(`presets.style.${preset.appearance.interface_style}`)} · {t(`presets.theme.${preset.appearance.theme}`)} · {preset.appearance.ui_scale}%</p>
            </div>
            </div>
            <div className="settings-preset-actions" data-ui-site="Presets-13">
            <button type="button" className="secondary settings-preset-apply" disabled={blocked || current} onClick={() => a.apply(preset.id)} aria-label={t('presets.applyAria', { name: preset.name })} data-ui-site="Presets-14">{current && <Check size={15} aria-hidden="true" data-ui-site="Presets-15"/>}{t(current ? 'presets.current' : 'presets.apply')}</button>
            <button type="button" className="secondary" disabled={blocked} aria-label={t('presets.renameAria', { name: preset.name })} title={t('presets.rename')} onClick={() => a.openDialog({ kind: 'rename', id: preset.id })} data-ui-site="Presets-16">
            <Pencil size={15} aria-hidden="true" data-ui-site="Presets-17"/>
            </button>
            <button type="button" className="secondary" disabled={blocked} aria-label={t('presets.exportAria', { name: preset.name })} title={t('presets.export')} onClick={() => a.openDialog({ kind: 'export', id: preset.id })} data-ui-site="Presets-18">
            <Download size={15} aria-hidden="true" data-ui-site="Presets-19"/>
            </button>
            <button type="button" className="secondary" disabled={blocked} aria-label={t('presets.removeAria', { name: preset.name })} title={t('presets.remove')} onClick={() => a.openDialog({ kind: 'remove', id: preset.id })} data-ui-site="Presets-20">
            <Trash2 size={15} aria-hidden="true" data-ui-site="Presets-21"/>
            </button>
            </div>
            </article>
            </UiIdentity>;
        })}</div> : <div className="settings-preset-empty" data-ui-site="Presets-22">
    <Layers size={22} aria-hidden="true" data-ui-site="Presets-23"/>
    <p data-ui-site="Presets-24">{t('presets.empty')}</p>
    </div>;
    return <section className="settings-presets modern-presets" aria-labelledby={id} data-ui-site="Presets-25">
    <header className="settings-preset-heading" data-ui-site="Presets-26">
    <div data-ui-site="Presets-27">
    <h2 id={id} data-ui-site="Presets-28">{t('presets.title')}</h2>
    <p data-ui-site="Presets-29">{t('presets.description')}</p>
    </div>{tools}</header>{list}<p className="settings-preset-note" data-ui-site="Presets-30">{t(capacity ? 'presets.capacityReached' : 'presets.applyHint', { maximum })}</p>
    {s.drafts.preset ? <UiIdentity namespace="appearance-preset" value={"id" in s.drafts.preset.request ? s.drafts.preset.request.id : s.drafts.preset.request.kind}><Dialog data-ui-site="Presets-dialog-bound"/></UiIdentity> : <Dialog data-ui-site="Presets-31"/>}
    </section>;
}
