import { useTranslation } from 'react-i18next';
import { useState } from 'react';
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
import type { JavaDiscovery } from '../types';

interface JavaSettingsProps {
  discovery: JavaDiscovery | null;
  busy: boolean;
  desktop: boolean;
  gameRunning: boolean;
  onDiscover: () => void;
  onChoose: () => void;
  onInspect: () => void;
  onSelect: (path: string) => void;
  onDownload: (major: number) => void;
}

function architectureLabel(architecture: string): string {
  if (['amd64', 'x86_64', 'x64'].includes(architecture.toLowerCase())) return 'java.architecture64';
  if (['aarch64', 'arm64'].includes(architecture.toLowerCase())) return 'ARM64';
  if (['x86', 'i386', 'i486', 'i586', 'i686'].includes(architecture.toLowerCase()))
    return 'java.architecture32';
  return architecture;
}

export default function JavaSettings({
  discovery,
  busy,
  desktop,
  gameRunning,
  onDiscover,
  onChoose,
  onInspect,
  onSelect,
  onDownload,
}: JavaSettingsProps) {
  const { t } = useTranslation();
  const [otherMajor, setOtherMajor] = useState('');
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
            onClick={onDiscover}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
            {busy ? t('java.checking') : t('java.discover')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={onChoose}
          >
            <FolderOpen size={15} />
            {t('java.chooseFile')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!desktop || busy}
            onClick={onInspect}
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
                    onClick={() => onSelect(installation.executable)}
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
              onClick={() => onDownload(version)}
            >
              <Download size={15} />
              Java {version}
            </button>
          ))}
        </div>
      </div>
      <Field label={t('java.otherMajor')} description={t('java.otherMajorDescription')}>
        <input
          type="number"
          min={8}
          max={99}
          step={1}
          placeholder={t('java.majorPlaceholder')}
          value={otherMajor}
          disabled={!canDownload}
          onChange={(event) => setOtherMajor(event.target.value)}
        />
      </Field>
      <button
        type="button"
        className="secondary small"
        disabled={!canDownload || !validMajor}
        onClick={() => onDownload(major)}
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
