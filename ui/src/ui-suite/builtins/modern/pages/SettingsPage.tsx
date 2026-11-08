import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Folder, Gamepad2, LoaderCircle, Palette, SlidersHorizontal } from 'lucide-react';
import { Field, Toggle, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot, useUiEditorActions } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { settingsPageState } from '../../common/lib/settings-display';
import DefaultAppearance from '../components/AppearanceSettings';
import DefaultPersonalization from '../components/PersonalizationSettings';
import DefaultJava from '../components/JavaSettings';
import DefaultTemplates from '../components/ArgumentTemplates';
import DefaultPresets from '../components/AppearancePresets';
import '../styles/settings.css';
const Appearance = sourceView<{
    section: 'layout' | 'style';
}>('component.appearance-settings', DefaultAppearance);
const Personalization = sourceView<{
    section: 'appearance' | 'behavior';
}>('component.personalization-settings', DefaultPersonalization);
const Java = sourceView('component.java-settings', DefaultJava), Templates = sourceView('component.argument-templates', DefaultTemplates), Presets = sourceView('component.appearance-presets', DefaultPresets);
const tabs = [{ id: 'appearance', label: 'settings.tabs.appearance', icon: Palette }, { id: 'game', label: 'settingsPages.gameTab', icon: Gamepad2 }, { id: 'advanced', label: 'settings.tabs.advanced', icon: SlidersHorizontal }] as const;
const groups = { appearance: ['layout', 'style', 'text', 'presets', 'editor'], game: ['java', 'folders', 'memory'], advanced: ['arguments', 'templates', 'network', 'behavior', 'about'] } as const;
const languages = [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }, { value: 'system', label: '' }] as const;
const networkNumbers = [{ key: 'timeout_seconds', label: 'settings.timeout', min: 1, max: 300 }, { key: 'max_concurrent_downloads', label: 'settings.concurrentDownloads', min: 1, max: 32 }, { key: 'max_retries', label: 'settings.retries', min: 0, max: 8 }] as const;
const closeOptions = [{ value: 'ask', label: 'settings.closeAsk' }, { value: 'stop', label: 'settings.closeStop' }, { value: 'background', label: 'settings.closeBackground' }] as const;
export default function SettingsPage() {
    const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions(), editor = useUiEditorActions(), prefix = useId();
    const { draft, tab, dirty, saving, choosingGameDirectory } = s.settings;
    const { busy, locked, reason } = settingsPageState(s);
    const patch = a.settings.patch;
    if (!draft)
        return null;
    return <div className="settings-page modern-settings" data-ui-site="Settings-1">
    <header className="settings-page-heading" data-ui-site="Settings-2">
    <h1 data-ui-site="Settings-3">{t('nav.settings')}</h1>
    <p data-ui-site="Settings-4">{t(`settingsPages.${tab}Intro`)}</p>
    </header>
    <nav className="settings-tabs" role="tablist" aria-label={t('settingsPages.navigation')} data-ui-site="Settings-5">{tabs.map(item => <UiIdentity key={item.id} namespace="settings-tab" value={item.id}>
        <button type="button" role="tab" aria-selected={tab === item.id} aria-controls={`${prefix}-panel`} tabIndex={tab === item.id ? 0 : -1} disabled={locked} className={tab === item.id ? 'selected' : ''} onClick={() => a.settings.setTab(item.id)} onKeyDown={event => { const index = tabs.findIndex(value => value.id === item.id); const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1; if (next >= 0) {
            event.preventDefault();
            a.settings.setTab(tabs[next].id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        } }} data-ui-site="Settings-6">
        <item.icon size={17} aria-hidden="true" data-ui-site="Settings-7"/>
        <span data-ui-site="Settings-8">{t(item.label)}</span>
        </button>
        </UiIdentity>)}</nav>
    <nav className="settings-section-links" aria-label={t('settingsPages.navigation')} data-ui-site="Settings-9">{groups[tab].map(section => <UiIdentity key={section} namespace="settings-section-link" value={section}>
        <a href={`#${prefix}-${section}`} data-ui-site="Settings-10">{t(`settingsPages.sections.${section}`)}</a>
        </UiIdentity>)}</nav>
    <div id={`${prefix}-panel`} className="settings-content" role="tabpanel" aria-label={t(tabs.find(item => item.id === tab)!.label)} data-ui-site="Settings-11">
        {tab === 'appearance' && <>
          <section id={`${prefix}-layout`} className="settings-section" data-ui-site="Settings-12">
        <UiIdentity namespace="appearance-section" value="layout">
        <Appearance section="layout" data-ui-site="Settings-13"/>
        </UiIdentity>
        </section>
          <section id={`${prefix}-style`} className="settings-section" data-ui-site="Settings-14">
        <UiIdentity namespace="appearance-section" value="style">
        <Appearance section="style" data-ui-site="Settings-15"/>
        </UiIdentity>
        </section>
          <section id={`${prefix}-text`} className="settings-section" data-ui-site="Settings-16">
        <h2 data-ui-site="Settings-17">{t('settingsPages.sections.text')}</h2>
        <Field label={t('settings.language')} description={t('settings.languageDescription')} data-ui-site="Settings-18">
        <div className="settings-options" role="group" aria-label={t('settings.language')} data-ui-site="Settings-19">{languages.map(language => <UiIdentity key={language.value} namespace="language" value={language.value}>
            <button type="button" aria-label={language.value === 'system' ? t('settings.systemLanguage') : language.label} aria-pressed={draft.language === language.value} className={draft.language === language.value ? 'selected' : ''} onClick={() => patch('language', language.value)} data-ui-site="Settings-20">{language.value === 'system' ? t('settings.systemLanguage') : language.label}</button>
            </UiIdentity>)}</div>
        </Field>
        <Personalization section="appearance" data-ui-site="Settings-21"/>
        </section>
          <section id={`${prefix}-presets`} className="settings-section" data-ui-site="Settings-22">
        <Presets data-ui-site="Settings-23"/>
        </section>
          <section id={`${prefix}-editor`} className="settings-section settings-editor-section" data-ui-site="Settings-24">
        <div data-ui-site="Settings-25">
        <h2 data-ui-site="Settings-26">{t('uiSuiteEditor.title')}</h2>
        <p data-ui-site="Settings-27">{t('settingsPages.editorHint')}</p>
        </div>
        <button type="button" className="secondary" onClick={() => editor.open()} data-ui-site="Settings-28">{t('uiSuiteEditor.open')}</button>
        </section>
        </>}
        {tab === 'game' && <>
          <section id={`${prefix}-java`} className="settings-section" data-ui-site="Settings-29">
        <Field label={t('settings.javaExecutable')} description={t('settings.javaExample')} data-ui-site="Settings-30">
        <input aria-label={t('settings.javaExecutable')} placeholder={t('settings.javaPlaceholder')} value={draft.java_executable} onChange={event => patch('java_executable', event.target.value)} data-ui-site="Settings-31"/>
        </Field>
        <Java data-ui-site="Settings-32"/>
        </section>
          <section id={`${prefix}-folders`} className="settings-section" data-ui-site="Settings-33">
        <h2 data-ui-site="Settings-34">{t('settingsPages.sections.folders')}</h2>
        <Field label={t('settings.gameDirectory')} description={t('settings.gameDirectoryDescription')} data-ui-site="Settings-35">
        <div className="settings-directory" data-ui-site="Settings-36">
        <input aria-label={t('settings.gameDirectory')} disabled={choosingGameDirectory} value={draft.game_directory} onChange={event => patch('game_directory', event.target.value)} data-ui-site="Settings-37"/>
        <button type="button" className="secondary" disabled={!s.window.desktop || busy || saving || choosingGameDirectory} onClick={() => void a.settings.chooseGameDirectory()} data-ui-site="Settings-38">
        <Folder size={16} aria-hidden="true" data-ui-site="Settings-39"/>{t('settings.chooseGameDirectory')}</button>
        </div>
        </Field>
        </section>
          <section id={`${prefix}-memory`} className="settings-section" data-ui-site="Settings-40">
        <h2 data-ui-site="Settings-41">{t('settingsPages.sections.memory')}</h2>
        <div className="settings-field-grid" data-ui-site="Settings-42">
            <Field label={t('settings.minimumMemory')} data-ui-site="Settings-43">
        <input aria-label={t('settings.minimumMemory')} type="number" min={256} max={draft.memory_mb} step={256} value={draft.minimum_memory_mb} onChange={event => patch('minimum_memory_mb', Number(event.target.value))} data-ui-site="Settings-44"/>
        </Field>
            <Field label={t('settings.maximumMemory')} data-ui-site="Settings-45">
        <input aria-label={t('settings.maximumMemory')} type="number" min={512} max={32768} step={512} value={draft.memory_mb} onChange={event => patch('memory_mb', Number(event.target.value))} data-ui-site="Settings-46"/>
        </Field>
          </div>
        <div className="settings-options" role="group" aria-label={t('settings.maximumMemory')} data-ui-site="Settings-47">{[2048, 4096, 8192, 16384].map(memory => <UiIdentity key={memory} namespace="memory-preset" value={String(memory)}>
            <button type="button" aria-pressed={draft.memory_mb === memory} className={draft.memory_mb === memory ? 'selected' : ''} onClick={() => patch('memory_mb', memory)} data-ui-site="Settings-48">{memory / 1024} GiB</button>
            </UiIdentity>)}</div>
        <div className="settings-field-grid" data-ui-site="Settings-49">
            <Field label={t('settings.windowWidth')} data-ui-site="Settings-50">
        <input aria-label={t('settings.windowWidth')} type="number" min={640} max={7680} step={1} value={draft.resolution_width} onChange={event => patch('resolution_width', Number(event.target.value))} data-ui-site="Settings-51"/>
        </Field>
            <Field label={t('settings.windowHeight')} data-ui-site="Settings-52">
        <input aria-label={t('settings.windowHeight')} type="number" min={480} max={4320} step={1} value={draft.resolution_height} onChange={event => patch('resolution_height', Number(event.target.value))} data-ui-site="Settings-53"/>
        </Field>
          </div>
        </section>
        </>}
        {tab === 'advanced' && <>
          <section id={`${prefix}-arguments`} className="settings-section" data-ui-site="Settings-54">
        <h2 data-ui-site="Settings-55">{t('settingsPages.sections.arguments')}</h2>
        <p data-ui-site="Settings-56">{t('settings.argumentsDescription')}</p>
        <Field label={t('settings.jvmArguments')} description={t('settings.jvmDescription')} data-ui-site="Settings-57">
        <textarea aria-label={t('settings.jvmArguments')} rows={3} placeholder={t('settings.jvmPlaceholder')} value={draft.extra_jvm_arguments} onChange={event => patch('extra_jvm_arguments', event.target.value)} data-ui-site="Settings-58"/>
        </Field>
        <Field label={t('settings.gameArguments')} description={t('settings.gameArgumentsDescription')} data-ui-site="Settings-59">
        <textarea aria-label={t('settings.gameArguments')} rows={3} placeholder={t('settings.gameArgumentsPlaceholder')} value={draft.extra_game_arguments} onChange={event => patch('extra_game_arguments', event.target.value)} data-ui-site="Settings-60"/>
        </Field>
        <div className="settings-row" data-ui-site="Settings-61">
        <div data-ui-site="Settings-62">
        <h3 data-ui-site="Settings-63">{t('downloads.showSnapshots')}</h3>
        <p data-ui-site="Settings-64">{t('settings.snapshotsDescription')}</p>
        </div>
        <Toggle label={t('downloads.showSnapshots')} checked={draft.show_snapshots} onChange={value => patch('show_snapshots', value)} data-ui-site="Settings-65"/>
        </div>
        </section>
          <section id={`${prefix}-templates`} className="settings-section" data-ui-site="Settings-66">
        <Templates data-ui-site="Settings-67"/>
        </section>
          <section id={`${prefix}-network`} className="settings-section" data-ui-site="Settings-68">
        <h2 data-ui-site="Settings-69">{t('settings.networkTitle')}</h2>
        <p data-ui-site="Settings-70">{t('settings.networkDescription')}</p>
        <div className="settings-field-grid" data-ui-site="Settings-71">{networkNumbers.map(item => <UiIdentity key={item.key} namespace="network-field" value={item.key}>
            <Field label={t(item.label)} data-ui-site="Settings-72">
            <input aria-label={t(item.label)} type="number" min={item.min} max={item.max} step={1} value={draft.network[item.key]} onChange={event => patch('network', { ...draft.network, [item.key]: Number(event.target.value) })} data-ui-site="Settings-73"/>
            </Field>
            </UiIdentity>)}</div>
        <Field label={t('settings.proxy')} description={t('settings.proxyDescription')} data-ui-site="Settings-74">
        <input aria-label={t('settings.proxy')} autoComplete="off" value={draft.network.proxy_url} onChange={event => patch('network', { ...draft.network, proxy_url: event.target.value })} data-ui-site="Settings-75"/>
        </Field>
        <Field label={t('settings.mirror')} description={t('settings.mirrorDescription')} data-ui-site="Settings-76">
        <input aria-label={t('settings.mirror')} value={draft.network.mirror_url} onChange={event => patch('network', { ...draft.network, mirror_url: event.target.value })} data-ui-site="Settings-77"/>
        </Field>
        </section>
          <section id={`${prefix}-behavior`} className="settings-section" data-ui-site="Settings-78">
        <Personalization section="behavior" data-ui-site="Settings-79"/>
        <Field label={t('settings.closeBehavior')} description={t('settings.closeDescription')} data-ui-site="Settings-80">
        <div className="settings-options" role="group" aria-label={t('settings.closeBehavior')} data-ui-site="Settings-81">{closeOptions.map(item => <UiIdentity key={item.value} namespace="close-behavior" value={item.value}>
            <button type="button" aria-pressed={draft.close_behavior === item.value} className={draft.close_behavior === item.value ? 'selected' : ''} onClick={() => patch('close_behavior', item.value)} data-ui-site="Settings-82">{t(item.label)}</button>
            </UiIdentity>)}</div>
        </Field>
        </section>
          <section id={`${prefix}-about`} className="settings-section" data-ui-site="Settings-83">
        <h2 data-ui-site="Settings-84">{t('settingsPages.sections.about')}</h2>
        <h3 data-ui-site="Settings-85">{t('settings.configFile')}</h3>
        <code className="settings-config-path" data-ui-site="Settings-86">{s.config.path ?? ''}</code>
        <p data-ui-site="Settings-87">{t('settings.configDescription')}</p>
        </section>
        </>}
      </div>
    <footer className="settings-save-bar" data-ui-site="Settings-88">
    <div className="settings-save-status" role="status" aria-live="polite" data-ui-site="Settings-89">
    <strong data-ui-site="Settings-90">{dirty ? t('settings.unsaved') : t('settings.synced')}</strong>
    <p data-ui-site="Settings-91">{reason ? t(`settingsPages.saveBlocked.${reason}`) : t('settingsPages.savedValues')}</p>
    </div>
    <div className="settings-save-actions" data-ui-site="Settings-92">
    <button type="button" className="secondary" disabled={locked} onClick={a.settings.reset} data-ui-site="Settings-93">{t('settings.reset')}</button>
    <button type="button" className="primary" disabled={Boolean(reason)} onClick={() => void a.settings.save()} data-ui-site="Settings-94">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="Settings-95"/> : <Check size={16} aria-hidden="true" data-ui-site="Settings-96"/>}{t('settings.save')}</button>
    </div>
    </footer>
    </div>;
}
