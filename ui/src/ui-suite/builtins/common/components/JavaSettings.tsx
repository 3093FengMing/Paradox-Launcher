import '../styles/common.css';
import { Fragment } from 'react';
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
import { Badge, Field, Panel } from '@paradox/ui';
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
    <section aria-label={t('java.management')} data-ui-site="JavaSettings-1">
      <div className="settings-intro" data-ui-site="JavaSettings-2">
        <h2 data-ui-site="JavaSettings-3">{t('java.runtime')}</h2>
        <p data-ui-site="JavaSettings-4">{t('java.description')}</p>
      </div>
      <div className="toolbar" data-ui-site="JavaSettings-5">
        <div className="button-group" data-ui-site="JavaSettings-6">
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.discover();
            }}
            data-ui-site="JavaSettings-7"
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" data-ui-site="JavaSettings-8" />
            ) : (
              <Search size={15} data-ui-site="JavaSettings-9" />
            )}
            {busy ? t('java.checking') : t('java.discover')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.chooseForSettings();
            }}
            data-ui-site="JavaSettings-10"
          >
            <FolderOpen size={15} data-ui-site="JavaSettings-11" />
            {t('java.chooseFile')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={() => {
              void actions.java.inspect(snapshot.settings.draft?.java_executable ?? '');
            }}
            data-ui-site="JavaSettings-12"
          >
            <Check size={15} data-ui-site="JavaSettings-13" />
            {t('java.checkPath')}
          </button>
        </div>
      </div>
      {!desktop && (
        <p className="help-text" data-ui-site="JavaSettings-14">
          {t('java.desktopRequired')}
        </p>
      )}
      {discovery && (
        <Fragment data-ui-site="JavaSettings-15">
          <div className="section-heading" data-ui-site="JavaSettings-16">
            <h2 data-ui-site="JavaSettings-17">
              {t('java.results')}
              <span data-ui-site="JavaSettings-18">{discovery.installations.length}</span>
            </h2>
          </div>
          {discovery.installations.length > 0 ? (
            <div className="profile-list" data-ui-site="JavaSettings-19">
              {discovery.installations.map((installation) => (
                <Panel
                  className="profile-card"
                  key={installation.executable}
                  data-ui-site="JavaSettings-20"
                >
                  <div className="profile-icon" data-ui-site="JavaSettings-21">
                    <Coffee size={23} data-ui-site="JavaSettings-22" />
                  </div>
                  <div className="profile-info" data-ui-site="JavaSettings-23">
                    <h3 data-ui-site="JavaSettings-24">Java {installation.major_version}</h3>
                    <p data-ui-site="JavaSettings-25">
                      {installation.version} · {installation.vendor}
                    </p>
                    <p data-ui-site="JavaSettings-26">
                      {t(`java.sources.${installation.source}`, {
                        defaultValue: t('java.otherSource'),
                      })}
                    </p>
                    <code data-ui-site="JavaSettings-27">{installation.executable}</code>
                  </div>
                  <Badge muted data-ui-site="JavaSettings-28">
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
                    data-ui-site="JavaSettings-29"
                  >
                    {t('java.useRuntime')}
                  </button>
                </Panel>
              ))}
            </div>
          ) : (
            <Panel className="empty-state compact-empty" data-ui-site="JavaSettings-30">
              <Coffee size={25} data-ui-site="JavaSettings-31" />
              <div data-ui-site="JavaSettings-32">
                <h3 data-ui-site="JavaSettings-33">{t('java.emptyTitle')}</h3>
                <p data-ui-site="JavaSettings-34">{t('java.emptyDescription')}</p>
              </div>
            </Panel>
          )}
          {discovery.warnings.length > 0 && (
            <Panel className="info-panel" data-ui-site="JavaSettings-35">
              <AlertCircle size={20} data-ui-site="JavaSettings-36" />
              <div data-ui-site="JavaSettings-37">
                <strong data-ui-site="JavaSettings-38">{t('java.warningTitle')}</strong>
                {discovery.warnings.map((warning) => (
                  <div key={`${warning.path}:${warning.message}`} data-ui-site="JavaSettings-39">
                    {warning.path && <code data-ui-site="JavaSettings-40">{warning.path}</code>}
                    <p data-ui-site="JavaSettings-41">{warning.message}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </Fragment>
      )}
      <div className="settings-intro" data-ui-site="JavaSettings-42">
        <h2 data-ui-site="JavaSettings-43">{t('java.download')}</h2>
        <p data-ui-site="JavaSettings-44">{t('java.downloadDescription')}</p>
      </div>
      <div className="toolbar" data-ui-site="JavaSettings-45">
        <div className="button-group" data-ui-site="JavaSettings-46">
          {[8, 17, 21].map((version) => (
            <button
              type="button"
              className="secondary small"
              key={version}
              disabled={!canDownload}
              onClick={() => {
                void actions.downloads.java(version);
              }}
              data-ui-site="JavaSettings-47"
            >
              <Download size={15} data-ui-site="JavaSettings-48" />
              Java {version}
            </button>
          ))}
        </div>
      </div>
      <Field
        label={t('java.otherMajor')}
        description={t('java.otherMajorDescription')}
        data-ui-site="JavaSettings-49"
      >
        <input
          type="text"
          inputMode="numeric"
          placeholder={t('java.majorPlaceholder')}
          value={otherMajor}
          disabled={!canDownload}
          onChange={(event) => actions.java.patchDownloadMajor(event.target.value)}
          data-ui-site="JavaSettings-50"
        />
      </Field>
      <button
        type="button"
        className="secondary small"
        disabled={!canDownload || !validMajor}
        onClick={() => {
          void actions.java.downloadEnteredMajor();
        }}
        data-ui-site="JavaSettings-51"
      >
        <Download size={15} data-ui-site="JavaSettings-52" />
        {t('java.downloadVersion')}
      </button>
      {gameRunning && (
        <p className="help-text" data-ui-site="JavaSettings-53">
          {t('java.gameRunning')}
        </p>
      )}
      {desktop && discovery?.download_supported === false && (
        <p className="help-text" data-ui-site="JavaSettings-54">
          {t('java.downloadUnsupported')}
        </p>
      )}
    </section>
  );
}
export default JavaSettings;
