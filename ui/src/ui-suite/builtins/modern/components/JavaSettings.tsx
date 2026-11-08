import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Coffee, Download, FolderOpen, LoaderCircle, Search } from 'lucide-react';
import { Badge, Field, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import '../styles/java-settings.css';
import { javaSettingsState, javaArchitectureLabel } from '../../common/lib/settings-display';
export default function JavaSettings() {
    const { t } = useTranslation(), s = useLauncherSnapshot(), a = useLauncherActions(), id = useId();
    const { discovery, busy, downloadMajorDraft } = s.java, desktop = s.window.desktop;
    const { gameRunning, validMajor, canDownload } = javaSettingsState(s);
    const tools = <div className="java-tools" data-ui-site="Java-1">
    <button type="button" className="secondary" disabled={!desktop || busy} onClick={() => void a.java.discover()} data-ui-site="Java-2">{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="Java-3"/> : <Search size={16} aria-hidden="true" data-ui-site="Java-4"/>}{t(busy ? 'java.checking' : 'java.discover')}</button>
    <button type="button" className="secondary" disabled={!desktop || busy} onClick={() => void a.java.chooseForSettings()} data-ui-site="Java-5">
    <FolderOpen size={16} aria-hidden="true" data-ui-site="Java-6"/>{t('java.chooseFile')}</button>
    <button type="button" className="secondary" disabled={!desktop || busy} onClick={() => void a.java.inspect(s.settings.draft?.java_executable ?? '')} data-ui-site="Java-7">
    <Check size={16} aria-hidden="true" data-ui-site="Java-8"/>{t('java.checkPath')}</button>
    </div>;
    const results = discovery && <div className="java-discovery" data-ui-site="Java-9">
    <h3 data-ui-site="Java-10">{t('java.results')} <span className="java-count" data-ui-site="Java-11">{discovery.installations.length}</span>
    </h3>{discovery.installations.length ? <div className="java-installations" data-ui-site="Java-12">{discovery.installations.map(installation => <UiIdentity key={installation.executable} namespace="java-runtime" value={installation.executable}>
            <article className={`java-runtime ${s.settings.draft?.java_executable === installation.executable ? 'selected' : ''}`} data-ui-site="Java-13">
            <div className="java-runtime-summary" data-ui-site="Java-14">
            <Coffee size={21} aria-hidden="true" data-ui-site="Java-15"/>
            <div data-ui-site="Java-16">
            <h4 data-ui-site="Java-17">Java {installation.major_version}</h4>
            <p data-ui-site="Java-18">{installation.version} · {installation.vendor}</p>
            </div>
            <Badge muted data-ui-site="Java-19">{t(javaArchitectureLabel(installation.architecture), { defaultValue: installation.architecture })}</Badge>
            </div>
            <p className="java-source" data-ui-site="Java-20">{t(`java.sources.${installation.source}`, { defaultValue: t('java.otherSource') })}</p>
            <code className="java-path" data-ui-site="Java-21">{installation.executable}</code>
            <button type="button" className="secondary" disabled={!desktop || busy} aria-label={t('java.useLabel', { major: installation.major_version, path: installation.executable })} onClick={() => a.java.selectForSettings(installation.executable)} data-ui-site="Java-22">{t(s.settings.draft?.java_executable === installation.executable ? 'settingsPages.selectedJava' : 'java.useRuntime')}</button>
            </article>
            </UiIdentity>)}</div> : <div className="java-empty" data-ui-site="Java-23">
        <Coffee size={24} aria-hidden="true" data-ui-site="Java-24"/>
        <div data-ui-site="Java-25">
        <h4 data-ui-site="Java-26">{t('java.emptyTitle')}</h4>
        <p data-ui-site="Java-27">{t('java.emptyDescription')}</p>
        </div>
        </div>}{discovery.warnings.length > 0 && <div className="java-warnings" role="status" data-ui-site="Java-28">
        <AlertCircle size={19} aria-hidden="true" data-ui-site="Java-29"/>
        <div data-ui-site="Java-30">
        <h4 data-ui-site="Java-31">{t('java.warningTitle')}</h4>{discovery.warnings.map(warning => <UiIdentity key={`${warning.path}:${warning.message}`} namespace="java-warning" value={`${warning.path}:${warning.message}`}>
            <div data-ui-site="Java-32">{warning.path && <code className="java-path" data-ui-site="Java-33">{warning.path}</code>}<p data-ui-site="Java-34">{warning.message}</p>
            </div>
            </UiIdentity>)}</div>
        </div>}</div>;
    const downloads = <div className="java-downloads" data-ui-site="Java-35">
    <header data-ui-site="Java-36">
    <h3 data-ui-site="Java-37">{t('java.download')}</h3>
    <p data-ui-site="Java-38">{t('java.downloadDescription')}</p>
    </header>
    <div className="java-download-versions" data-ui-site="Java-39">{[8, 17, 21].map(version => <UiIdentity key={version} namespace="java-download" value={String(version)}>
        <button type="button" className="secondary" disabled={!canDownload} onClick={() => void a.downloads.java(version)} data-ui-site="Java-40">
        <Download size={16} aria-hidden="true" data-ui-site="Java-41"/>Java {version}</button>
        </UiIdentity>)}</div>
    <div className="java-entered-download" data-ui-site="Java-42">
    <Field label={t('java.otherMajor')} description={t('java.otherMajorDescription')} data-ui-site="Java-43">
    <input aria-label={t('java.otherMajor')} type="text" inputMode="numeric" placeholder={t('java.majorPlaceholder')} value={downloadMajorDraft} disabled={!canDownload} onChange={event => a.java.patchDownloadMajor(event.target.value)} data-ui-site="Java-44"/>
    </Field>
    <button type="button" className="secondary" disabled={!canDownload || !validMajor} onClick={() => void a.java.downloadEnteredMajor()} data-ui-site="Java-45">
    <Download size={16} aria-hidden="true" data-ui-site="Java-46"/>{t('java.downloadVersion')}</button>
    </div>{gameRunning && <p className="java-help" data-ui-site="Java-47">{t('java.gameRunning')}</p>}{desktop && discovery?.download_supported === false && <p className="java-help" data-ui-site="Java-48">{t('java.downloadUnsupported')}</p>}</div>;
    return <section className="settings-java modern-java" aria-labelledby={id} data-ui-site="Java-49">
    <header className="java-heading" data-ui-site="Java-50">
    <h2 id={id} data-ui-site="Java-51">{t('java.runtime')}</h2>
    <p data-ui-site="Java-52">{t('java.description')}</p>
    </header>{tools}{results}{downloads}{!desktop && <p className="java-help" data-ui-site="Java-53">{t('java.desktopRequired')}</p>}</section>;
}
