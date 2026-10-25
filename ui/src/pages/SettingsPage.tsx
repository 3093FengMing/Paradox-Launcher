import { useTranslation } from 'react-i18next';
import { Check, Folder, Gamepad2, LoaderCircle, Palette, SlidersHorizontal } from 'lucide-react';
import AppearanceSettings from '../components/AppearanceSettings';
import { Field, Panel, Toggle } from '../components/ui';
import type { PatchSettings, SettingsTab } from '../lib/forms';
import type { Settings } from '../types';
import type { ReactNode } from 'react';
import * as api from '../api';

interface SettingsPageProps {
  draft: Settings;
  configPath: string;
  tab: SettingsTab;
  dirty: boolean;
  busy: boolean;
  saving: boolean;
  onTabChange: (tab: SettingsTab) => void;
  onPatch: PatchSettings;
  onSave: () => void;
  onReset: () => void;
  javaPanel: ReactNode;
  presetsPanel: ReactNode;
  onChooseDirectory: () => void;
}

const settingsTabs = [
  { id: 'appearance', label: 'settings.tabs.appearance', icon: Palette },
  { id: 'game', label: 'settings.tabs.game', icon: Gamepad2 },
  { id: 'advanced', label: 'settings.tabs.advanced', icon: SlidersHorizontal },
] as const;

export default function SettingsPage({
  draft,
  configPath,
  tab: settingsTab,
  dirty,
  busy,
  saving,
  onTabChange,
  onPatch,
  onSave,
  onReset,
  javaPanel,
  presetsPanel,
  onChooseDirectory,
}: SettingsPageProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-tabs">
        {settingsTabs.map((tab) => (
          <button
            className={settingsTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
          >
            <tab.icon size={17} />
            {t(tab.label)}
          </button>
        ))}
      </div>
      <Panel className="settings-panel">
        {settingsTab === 'appearance' && (
          <>
            <div className="field">
              <span>{t('settings.language')}</span>
              <p>{t('settings.languageDescription')}</p>
              <div className="theme-options" role="group" aria-label={t('settings.language')}>
                {[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en-US', label: 'English' },
                  { value: 'system', label: t('settings.systemLanguage') },
                ].map((language) => (
                  <button
                    type="button"
                    key={language.value}
                    className={draft.language === language.value ? 'selected' : ''}
                    aria-pressed={draft.language === language.value}
                    onClick={() => onPatch('language', language.value as Settings['language'])}
                  >
                    {language.label}
                  </button>
                ))}
              </div>
            </div>
            {presetsPanel}
            <AppearanceSettings
              appearance={draft.appearance}
              onChange={(next) => onPatch('appearance', next)}
            />
          </>
        )}
        {settingsTab === 'game' && (
          <>
            <div className="settings-intro">
              <h2>{t('settings.gameTitle')}</h2>
              <p>{t('settings.javaDescription')}</p>
            </div>
            <Field
              label={t('settings.gameDirectory')}
              description={t('settings.gameDirectoryDescription')}
            >
              <div className="input-with-icon">
                <Folder size={18} />
                <input
                  value={draft.game_directory}
                  onChange={(event) => onPatch('game_directory', event.target.value)}
                />
              </div>
            </Field>
            <button
              type="button"
              className="secondary small"
              disabled={!api.desktop || busy || saving}
              onClick={onChooseDirectory}
            >
              <Folder size={16} />
              {t('settings.chooseGameDirectory')}
            </button>
            <Field label={t('settings.javaExecutable')} description={t('settings.javaExample')}>
              <input
                placeholder={t('settings.javaPlaceholder')}
                value={draft.java_executable}
                onChange={(event) => onPatch('java_executable', event.target.value)}
              />
            </Field>
            {javaPanel}
            <div className="field-grid">
              <Field label={t('settings.minimumMemory')}>
                <input
                  type="number"
                  min={256}
                  max={draft.memory_mb}
                  step={256}
                  value={draft.minimum_memory_mb}
                  onChange={(event) => onPatch('minimum_memory_mb', +event.target.value)}
                />
              </Field>
              <Field label={t('settings.maximumMemory')}>
                <input
                  type="number"
                  min={512}
                  max={32768}
                  step={512}
                  value={draft.memory_mb}
                  onChange={(event) => onPatch('memory_mb', +event.target.value)}
                />
              </Field>
            </div>
            <div className="memory-presets">
              {[2048, 4096, 8192, 16384].map((memory) => (
                <button
                  className={draft.memory_mb === memory ? 'selected' : ''}
                  key={memory}
                  onClick={() => onPatch('memory_mb', memory)}
                >
                  {memory / 1024} GB
                </button>
              ))}
            </div>
            <div className="field-grid">
              <Field label={t('settings.windowWidth')}>
                <input
                  type="number"
                  min={640}
                  max={7680}
                  value={draft.resolution_width}
                  onChange={(event) => onPatch('resolution_width', +event.target.value)}
                />
              </Field>
              <Field label={t('settings.windowHeight')}>
                <input
                  type="number"
                  min={480}
                  max={4320}
                  value={draft.resolution_height}
                  onChange={(event) => onPatch('resolution_height', +event.target.value)}
                />
              </Field>
            </div>
          </>
        )}
        {settingsTab === 'advanced' && (
          <>
            <div className="settings-intro">
              <h2>{t('settings.advancedTitle')}</h2>
              <p>{t('settings.argumentsDescription')}</p>
            </div>
            <Field label={t('settings.jvmArguments')} description={t('settings.jvmDescription')}>
              <textarea
                rows={3}
                placeholder={t('settings.jvmPlaceholder')}
                value={draft.extra_jvm_arguments}
                onChange={(event) => onPatch('extra_jvm_arguments', event.target.value)}
              />
            </Field>
            <Field
              label={t('settings.gameArguments')}
              description={t('settings.gameArgumentsDescription')}
            >
              <textarea
                rows={3}
                placeholder={t('settings.gameArgumentsPlaceholder')}
                value={draft.extra_game_arguments}
                onChange={(event) => onPatch('extra_game_arguments', event.target.value)}
              />
            </Field>
            <div className="setting-row">
              <div>
                <h3>{t('downloads.showSnapshots')}</h3>
                <p>{t('settings.snapshotsDescription')}</p>
              </div>
              <Toggle
                label={t('downloads.showSnapshots')}
                checked={draft.show_snapshots}
                onChange={(value) => onPatch('show_snapshots', value)}
              />
            </div>
            <div className="config-location">
              <h3>{t('settings.configFile')}</h3>
              <code>{configPath}</code>
              <p>{t('settings.configDescription')}</p>
            </div>
            <div className="settings-intro">
              <h2>{t('settings.networkTitle')}</h2>
              <p>{t('settings.networkDescription')}</p>
            </div>
            <div className="field-grid">
              <Field label={t('settings.timeout')}>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={draft.network.timeout_seconds}
                  onChange={(event) =>
                    onPatch('network', {
                      ...draft.network,
                      timeout_seconds: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label={t('settings.concurrentDownloads')}>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={draft.network.max_concurrent_downloads}
                  onChange={(event) =>
                    onPatch('network', {
                      ...draft.network,
                      max_concurrent_downloads: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <Field label={t('settings.retries')}>
              <input
                type="number"
                min={0}
                max={8}
                value={draft.network.max_retries}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, max_retries: Number(event.target.value) })
                }
              />
            </Field>
            <Field label={t('settings.proxy')} description={t('settings.proxyDescription')}>
              <input
                autoComplete="off"
                value={draft.network.proxy_url}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, proxy_url: event.target.value })
                }
              />
            </Field>
            <Field label={t('settings.mirror')} description={t('settings.mirrorDescription')}>
              <input
                value={draft.network.mirror_url}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, mirror_url: event.target.value })
                }
              />
            </Field>
            <div className="settings-intro">
              <h2>{t('settings.closeTitle')}</h2>
              <p>{t('settings.closeDescription')}</p>
            </div>
            <div className="theme-options" role="group" aria-label={t('settings.closeBehavior')}>
              {[
                { value: 'ask', label: t('settings.closeAsk') },
                { value: 'stop', label: t('settings.closeStop') },
                { value: 'background', label: t('settings.closeBackground') },
              ].map((item) => (
                <button
                  type="button"
                  className={draft.close_behavior === item.value ? 'selected' : ''}
                  aria-pressed={draft.close_behavior === item.value}
                  key={item.value}
                  onClick={() =>
                    onPatch('close_behavior', item.value as Settings['close_behavior'])
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </Panel>
      <div className="save-bar">
        <span>
          {dirty ? (
            <>
              <span className="status-dot" />
              {t('settings.unsaved')}
            </>
          ) : (
            <>
              <Check size={15} />
              {t('settings.synced')}
            </>
          )}
        </span>
        <div>
          <button className="secondary" onClick={() => onReset()}>
            {t('settings.reset')}
          </button>
          <button
            className="primary"
            disabled={!!busy || saving || !dirty}
            onClick={() => onSave()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {t('settings.save')}
          </button>
        </div>
      </div>
    </>
  );
}
