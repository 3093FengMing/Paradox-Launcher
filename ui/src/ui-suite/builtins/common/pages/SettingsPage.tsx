import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Folder, Gamepad2, LoaderCircle, Palette, SlidersHorizontal } from 'lucide-react';
import DefaultAppearanceSettings from '../components/AppearanceSettings';
import DefaultPersonalizationSettings from '../components/PersonalizationSettings';
import DefaultArgumentTemplates from '../components/ArgumentTemplates';
import { Field, Panel, Toggle } from '@paradox/ui';
import type { Settings } from '@paradox/launcher';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { useUiEditorActions } from '@paradox/launcher';
import JavaSettings from '../components/JavaSettings';
import AppearancePresets from '../components/AppearancePresets';
import { sourceView } from '../lib/view';
const JavaPanel = sourceView('component.java-settings', JavaSettings),
  PresetsPanel = sourceView('component.appearance-presets', AppearancePresets);
const settingsTabs = [
  { id: 'appearance', label: 'settings.tabs.appearance', icon: Palette },
  { id: 'game', label: 'settings.tabs.game', icon: Gamepad2 },
  { id: 'advanced', label: 'settings.tabs.advanced', icon: SlidersHorizontal },
] as const;
function SettingsPage() {
  const { t } = useTranslation();
  const editor = useUiEditorActions();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    settingsActions = actions.settings;
  const { draft, tab: settingsTab, dirty, saving, choosingBackground } = snapshot.settings;
  const configPath = snapshot.config.path ?? '',
    desktop = snapshot.window.desktop;
  const busy =
    !!snapshot.activity || snapshot.downloads.active || snapshot.downloads.pending.length > 0;
  const onTabChange = settingsActions.setTab,
    onPatch = settingsActions.patch,
    onSave = () => {
      void settingsActions.save();
    },
    onChooseDirectory = () => {
      void settingsActions.chooseGameDirectory();
    };
  if (!draft) return null;
  return (
    <Fragment data-ui-site="SettingsPage-1">
      <div className="settings-tabs" data-ui-site="SettingsPage-2">
        {settingsTabs.map((tab) => (
          <button
            className={settingsTab === tab.id ? 'active' : ''}
            key={tab.id}
            disabled={saving || choosingBackground}
            onClick={() => onTabChange(tab.id)}
            data-ui-site="SettingsPage-3"
          >
            <tab.icon size={17} data-ui-site="SettingsPage-4" />
            {t(tab.label)}
          </button>
        ))}
      </div>
      <Panel className="settings-panel" data-ui-site="SettingsPage-5">
        {settingsTab === 'appearance' && (
          <Fragment data-ui-site="SettingsPage-6">
            <div className="field" data-ui-site="SettingsPage-7">
              <span data-ui-site="SettingsPage-8">{t('settings.language')}</span>
              <p data-ui-site="SettingsPage-9">{t('settings.languageDescription')}</p>
              <div
                className="theme-options"
                role="group"
                aria-label={t('settings.language')}
                data-ui-site="SettingsPage-10"
              >
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
                    data-ui-site="SettingsPage-11"
                  >
                    {language.label}
                  </button>
                ))}
              </div>
            </div>
            <PresetsPanel data-ui-site="SettingsPage-12" />
            <div className="settings-intro" data-ui-site="SettingsPage-13">
              <h2 data-ui-site="SettingsPage-14">{t('uiSuiteEditor.title')}</h2>
              <p data-ui-site="SettingsPage-15">{t('uiSuiteEditor.description')}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => editor.open()}
                data-ui-site="SettingsPage-16"
              >
                {t('uiSuiteEditor.open')}
              </button>
            </div>
            <AppearanceSettings data-ui-site="SettingsPage-17" />
            <PersonalizationSettings section="appearance" data-ui-site="SettingsPage-18" />
          </Fragment>
        )}
        {settingsTab === 'game' && (
          <Fragment data-ui-site="SettingsPage-19">
            <div className="settings-intro" data-ui-site="SettingsPage-20">
              <h2 data-ui-site="SettingsPage-21">{t('settings.gameTitle')}</h2>
              <p data-ui-site="SettingsPage-22">{t('settings.javaDescription')}</p>
            </div>
            <Field
              label={t('settings.gameDirectory')}
              description={t('settings.gameDirectoryDescription')}
              data-ui-site="SettingsPage-23"
            >
              <div className="input-with-icon" data-ui-site="SettingsPage-24">
                <Folder size={18} data-ui-site="SettingsPage-25" />
                <input
                  value={draft.game_directory}
                  onChange={(event) => onPatch('game_directory', event.target.value)}
                  data-ui-site="SettingsPage-26"
                />
              </div>
            </Field>
            <button
              type="button"
              className="secondary small"
              disabled={!desktop || busy || saving}
              onClick={onChooseDirectory}
              data-ui-site="SettingsPage-27"
            >
              <Folder size={16} data-ui-site="SettingsPage-28" />
              {t('settings.chooseGameDirectory')}
            </button>
            <Field
              label={t('settings.javaExecutable')}
              description={t('settings.javaExample')}
              data-ui-site="SettingsPage-29"
            >
              <input
                placeholder={t('settings.javaPlaceholder')}
                value={draft.java_executable}
                onChange={(event) => onPatch('java_executable', event.target.value)}
                data-ui-site="SettingsPage-30"
              />
            </Field>
            <JavaPanel data-ui-site="SettingsPage-31" />
            <div className="field-grid" data-ui-site="SettingsPage-32">
              <Field label={t('settings.minimumMemory')} data-ui-site="SettingsPage-33">
                <input
                  type="number"
                  min={256}
                  max={draft.memory_mb}
                  step={256}
                  value={draft.minimum_memory_mb}
                  onChange={(event) => onPatch('minimum_memory_mb', +event.target.value)}
                  data-ui-site="SettingsPage-34"
                />
              </Field>
              <Field label={t('settings.maximumMemory')} data-ui-site="SettingsPage-35">
                <input
                  type="number"
                  min={512}
                  max={32768}
                  step={512}
                  value={draft.memory_mb}
                  onChange={(event) => onPatch('memory_mb', +event.target.value)}
                  data-ui-site="SettingsPage-36"
                />
              </Field>
            </div>
            <div className="memory-presets" data-ui-site="SettingsPage-37">
              {[2048, 4096, 8192, 16384].map((memory) => (
                <button
                  className={draft.memory_mb === memory ? 'selected' : ''}
                  key={memory}
                  onClick={() => onPatch('memory_mb', memory)}
                  data-ui-site="SettingsPage-38"
                >
                  {memory / 1024} GB
                </button>
              ))}
            </div>
            <div className="field-grid" data-ui-site="SettingsPage-39">
              <Field label={t('settings.windowWidth')} data-ui-site="SettingsPage-40">
                <input
                  type="number"
                  min={640}
                  max={7680}
                  value={draft.resolution_width}
                  onChange={(event) => onPatch('resolution_width', +event.target.value)}
                  data-ui-site="SettingsPage-41"
                />
              </Field>
              <Field label={t('settings.windowHeight')} data-ui-site="SettingsPage-42">
                <input
                  type="number"
                  min={480}
                  max={4320}
                  value={draft.resolution_height}
                  onChange={(event) => onPatch('resolution_height', +event.target.value)}
                  data-ui-site="SettingsPage-43"
                />
              </Field>
            </div>
          </Fragment>
        )}
        {settingsTab === 'advanced' && (
          <Fragment data-ui-site="SettingsPage-44">
            <PersonalizationSettings section="behavior" data-ui-site="SettingsPage-45" />
            <ArgumentTemplates data-ui-site="SettingsPage-46" />
            <div className="settings-intro" data-ui-site="SettingsPage-47">
              <h2 data-ui-site="SettingsPage-48">{t('settings.advancedTitle')}</h2>
              <p data-ui-site="SettingsPage-49">{t('settings.argumentsDescription')}</p>
            </div>
            <Field
              label={t('settings.jvmArguments')}
              description={t('settings.jvmDescription')}
              data-ui-site="SettingsPage-50"
            >
              <textarea
                rows={3}
                placeholder={t('settings.jvmPlaceholder')}
                value={draft.extra_jvm_arguments}
                onChange={(event) => onPatch('extra_jvm_arguments', event.target.value)}
                data-ui-site="SettingsPage-51"
              />
            </Field>
            <Field
              label={t('settings.gameArguments')}
              description={t('settings.gameArgumentsDescription')}
              data-ui-site="SettingsPage-52"
            >
              <textarea
                rows={3}
                placeholder={t('settings.gameArgumentsPlaceholder')}
                value={draft.extra_game_arguments}
                onChange={(event) => onPatch('extra_game_arguments', event.target.value)}
                data-ui-site="SettingsPage-53"
              />
            </Field>
            <div className="setting-row" data-ui-site="SettingsPage-54">
              <div data-ui-site="SettingsPage-55">
                <h3 data-ui-site="SettingsPage-56">{t('downloads.showSnapshots')}</h3>
                <p data-ui-site="SettingsPage-57">{t('settings.snapshotsDescription')}</p>
              </div>
              <Toggle
                label={t('downloads.showSnapshots')}
                checked={draft.show_snapshots}
                onChange={(value) => onPatch('show_snapshots', value)}
                data-ui-site="SettingsPage-58"
              />
            </div>
            <div className="config-location" data-ui-site="SettingsPage-59">
              <h3 data-ui-site="SettingsPage-60">{t('settings.configFile')}</h3>
              <code data-ui-site="SettingsPage-61">{configPath}</code>
              <p data-ui-site="SettingsPage-62">{t('settings.configDescription')}</p>
            </div>
            <div className="settings-intro" data-ui-site="SettingsPage-63">
              <h2 data-ui-site="SettingsPage-64">{t('settings.networkTitle')}</h2>
              <p data-ui-site="SettingsPage-65">{t('settings.networkDescription')}</p>
            </div>
            <div className="field-grid" data-ui-site="SettingsPage-66">
              <Field label={t('settings.timeout')} data-ui-site="SettingsPage-67">
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
                  data-ui-site="SettingsPage-68"
                />
              </Field>
              <Field label={t('settings.concurrentDownloads')} data-ui-site="SettingsPage-69">
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
                  data-ui-site="SettingsPage-70"
                />
              </Field>
            </div>
            <Field label={t('settings.retries')} data-ui-site="SettingsPage-71">
              <input
                type="number"
                min={0}
                max={8}
                value={draft.network.max_retries}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, max_retries: Number(event.target.value) })
                }
                data-ui-site="SettingsPage-72"
              />
            </Field>
            <Field
              label={t('settings.proxy')}
              description={t('settings.proxyDescription')}
              data-ui-site="SettingsPage-73"
            >
              <input
                autoComplete="off"
                value={draft.network.proxy_url}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, proxy_url: event.target.value })
                }
                data-ui-site="SettingsPage-74"
              />
            </Field>
            <Field
              label={t('settings.mirror')}
              description={t('settings.mirrorDescription')}
              data-ui-site="SettingsPage-75"
            >
              <input
                value={draft.network.mirror_url}
                onChange={(event) =>
                  onPatch('network', { ...draft.network, mirror_url: event.target.value })
                }
                data-ui-site="SettingsPage-76"
              />
            </Field>
            <div className="settings-intro" data-ui-site="SettingsPage-77">
              <h2 data-ui-site="SettingsPage-78">{t('settings.closeTitle')}</h2>
              <p data-ui-site="SettingsPage-79">{t('settings.closeDescription')}</p>
            </div>
            <div
              className="theme-options"
              role="group"
              aria-label={t('settings.closeBehavior')}
              data-ui-site="SettingsPage-80"
            >
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
                  data-ui-site="SettingsPage-81"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </Fragment>
        )}
      </Panel>
      <div className="save-bar" data-ui-site="SettingsPage-82">
        <span data-ui-site="SettingsPage-83">
          {dirty ? (
            <Fragment data-ui-site="SettingsPage-84">
              <span className="status-dot" data-ui-site="SettingsPage-85" />
              {t('settings.unsaved')}
            </Fragment>
          ) : (
            <Fragment data-ui-site="SettingsPage-86">
              <Check size={15} data-ui-site="SettingsPage-87" />
              {t('settings.synced')}
            </Fragment>
          )}
        </span>
        <div data-ui-site="SettingsPage-88">
          <button
            className="secondary"
            disabled={saving || choosingBackground}
            onClick={settingsActions.reset}
            data-ui-site="SettingsPage-89"
          >
            {t('settings.reset')}
          </button>
          <button
            className="primary"
            disabled={!!busy || saving || choosingBackground || !dirty}
            onClick={() => onSave()}
            data-ui-site="SettingsPage-90"
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} data-ui-site="SettingsPage-91" />
            ) : (
              <Check size={16} data-ui-site="SettingsPage-92" />
            )}
            {t('settings.save')}
          </button>
        </div>
      </div>
    </Fragment>
  );
}
export default SettingsPage;
const AppearanceSettings = sourceView('component.appearance-settings', DefaultAppearanceSettings);
const PersonalizationSettings = sourceView(
  'component.personalization-settings',
  DefaultPersonalizationSettings,
);
const ArgumentTemplates = sourceView('component.argument-templates', DefaultArgumentTemplates);
