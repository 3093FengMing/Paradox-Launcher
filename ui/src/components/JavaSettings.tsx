import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import {
  AlertCircle,
  Check,
  Coffee,
  Download,
  FolderOpen,
  LoaderCircle,
  Search,
} from 'lucide-react';
import { Badge, Field, Panel } from './ui';

function architectureLabel(architecture: string): string {
  if (['amd64', 'x86_64', 'x64'].includes(architecture.toLowerCase())) return 'java.architecture64';
  if (['aarch64', 'arm64'].includes(architecture.toLowerCase())) return 'ARM64';
  if (['x86', 'i386', 'i486', 'i586', 'i686'].includes(architecture.toLowerCase()))
    return 'java.architecture32';
  return architecture;
}

function JavaSettings() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions();
  const { discovery, busy, downloadMajorDraft: otherMajor } = snapshot.java;
  const desktop = snapshot.window.desktop;
  const gameRunning = snapshot.activity !== null;
  const major = Number(otherMajor);
  const validMajor = Number.isInteger(major) && major >= 8 && major <= 99;
  const canDownload = desktop && !gameRunning && discovery?.download_supported !== false;

  return (
    <section aria-label={t('java.management')}>
      <div className="settings-intro">
        <h2>{t('java.runtime')}</h2>
        <p>{t('java.description')}</p>
      </div>
      <div className="toolbar">
        <div className="button-group">
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.discover();
            }}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
            {busy ? t('java.checking') : t('java.discover')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.chooseForSettings();
            }}
          >
            <FolderOpen size={15} />
            {t('java.chooseFile')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.inspect(snapshot.settings.draft?.java_executable ?? '');
            }}
          >
            <Check size={15} />
            {t('java.checkPath')}
          </button>
        </div>
      </div>
      {!desktop && <p className="help-text">{t('java.desktopRequired')}</p>}
      {discovery && (
        <>
          <div className="section-heading">
            <h2>
              {t('java.results')}
              <span>{discovery.installations.length}</span>
            </h2>
          </div>
          {discovery.installations.length > 0 ? (
            <div className="profile-list">
              {discovery.installations.map((installation) => (
                <Panel className="profile-card" key={installation.executable}>
                  <div className="profile-icon">
                    <Coffee size={23} />
                  </div>
                  <div className="profile-info">
                    <h3>Java {installation.major_version}</h3>
                    <p>
                      {installation.version} · {installation.vendor}
                    </p>
                    <p>
                      {t(`java.sources.${installation.source}`, {
                        defaultValue: t('java.otherSource'),
                      })}
                    </p>
                    <code>{installation.executable}</code>
                  </div>
                  <Badge muted>
                    {t(architectureLabel(installation.architecture), {
                      defaultValue: installation.architecture,
                    })}
                  </Badge>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={!desktop || busy}
                    aria-label={t('java.useLabel', {
                      major: installation.major_version,
                      path: installation.executable,
                    })}
                    onClick={() => actions.java.selectForSettings(installation.executable)}
                  >
                    {t('java.useRuntime')}
                  </button>
                </Panel>
              ))}
            </div>
          ) : (
            <Panel className="empty-state compact-empty">
              <Coffee size={25} />
              <div>
                <h3>{t('java.emptyTitle')}</h3>
                <p>{t('java.emptyDescription')}</p>
              </div>
            </Panel>
          )}
          {discovery.warnings.length > 0 && (
            <Panel className="info-panel">
              <AlertCircle size={20} />
              <div>
                <strong>{t('java.warningTitle')}</strong>
                {discovery.warnings.map((warning) => (
                  <div key={`${warning.path}:${warning.message}`}>
                    {warning.path && <code>{warning.path}</code>}
                    <p>{warning.message}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
      <div className="settings-intro">
        <h2>{t('java.download')}</h2>
        <p>{t('java.downloadDescription')}</p>
      </div>
      <div className="toolbar">
        <div className="button-group">
          {[8, 17, 21].map((version) => (
            <button
              type="button"
              className="secondary small"
              key={version}
              disabled={!canDownload}
              onClick={() => {
                void actions.downloads.java(version);
              }}
            >
              <Download size={15} />
              Java {version}
            </button>
          ))}
        </div>
      </div>
      <Field label={t('java.otherMajor')} description={t('java.otherMajorDescription')}>
        <input
          type="text"
          inputMode="numeric"
          placeholder={t('java.majorPlaceholder')}
          value={otherMajor}
          disabled={!canDownload}
          onChange={(event) => actions.java.patchDownloadMajor(event.target.value)}
        />
      </Field>
      <button
        type="button"
        className="secondary small"
        disabled={!canDownload || !validMajor}
        onClick={() => {
          void actions.java.downloadEnteredMajor();
        }}
      >
        <Download size={15} />
        {t('java.downloadVersion')}
      </button>
      {gameRunning && <p className="help-text">{t('java.gameRunning')}</p>}
      {desktop && discovery?.download_supported === false && (
        <p className="help-text">{t('java.downloadUnsupported')}</p>
      )}
    </section>
  );
}

const CustomizedJavaSettings = customComponent('component.java-settings', JavaSettings);
export default CustomizedJavaSettings;
