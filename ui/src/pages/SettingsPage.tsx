import { Check, Folder, Gamepad2, LoaderCircle, Palette, SlidersHorizontal } from 'lucide-react';
import AppearanceSettings from '../components/AppearanceSettings';
import { Field, Panel, Toggle } from '../components/ui';
import type { PatchSettings, SettingsTab } from '../lib/forms';
import type { Settings } from '../types';

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
}

const settingsTabs = [
  { id: 'appearance', label: '外观与体验', icon: Palette },
  { id: 'game', label: '游戏与 Java', icon: Gamepad2 },
  { id: 'advanced', label: '高级设置', icon: SlidersHorizontal },
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
}: SettingsPageProps) {
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
            {tab.label}
          </button>
        ))}
      </div>
      <Panel className="settings-panel">
        {settingsTab === 'appearance' && (
          <AppearanceSettings
            appearance={draft.appearance}
            onChange={(next) => onPatch('appearance', next)}
          />
        )}
        {settingsTab === 'game' && (
          <>
            <div className="settings-intro">
              <h2>为世界准备合适的环境</h2>
              <p>Java 留空时，Elemental 会寻找与游戏版本匹配的本地运行时。</p>
            </div>
            <Field
              label="游戏文件目录"
              description="使用绝对路径。改变目录会切换本地资源库，已有文件不会自动迁移。"
            >
              <div className="input-with-icon">
                <Folder size={18} />
                <input
                  value={draft.game_directory}
                  onChange={(event) => onPatch('game_directory', event.target.value)}
                />
              </div>
            </Field>
            <Field
              label="Java 可执行文件"
              description="例如 C:\Program Files\Java\jdk-21\bin\java.exe"
            >
              <input
                placeholder="自动检测兼容的 Java"
                value={draft.java_executable}
                onChange={(event) => onPatch('java_executable', event.target.value)}
              />
            </Field>
            <div className="field-grid">
              <Field label="最小内存 (MB)">
                <input
                  type="number"
                  min={256}
                  max={draft.memory_mb}
                  step={256}
                  value={draft.minimum_memory_mb}
                  onChange={(event) => onPatch('minimum_memory_mb', +event.target.value)}
                />
              </Field>
              <Field label="最大内存 (MB)">
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
              <Field label="游戏窗口宽度">
                <input
                  type="number"
                  min={640}
                  max={7680}
                  value={draft.resolution_width}
                  onChange={(event) => onPatch('resolution_width', +event.target.value)}
                />
              </Field>
              <Field label="游戏窗口高度">
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
              <h2>精细控制每次启动</h2>
              <p>参数由 Elemental 解析，支持带引号的参数值。</p>
            </div>
            <Field
              label="额外 JVM 参数"
              description="内存请在“游戏与 Java”中设置，避免重复传入 -Xmx / -Xms。"
            >
              <textarea
                rows={3}
                placeholder="例如 -XX:+UseG1GC"
                value={draft.extra_jvm_arguments}
                onChange={(event) => onPatch('extra_jvm_arguments', event.target.value)}
              />
            </Field>
            <Field label="额外游戏参数" description="传递给 Minecraft 主程序的参数。">
              <textarea
                rows={3}
                placeholder="例如 --fullscreen"
                value={draft.extra_game_arguments}
                onChange={(event) => onPatch('extra_game_arguments', event.target.value)}
              />
            </Field>
            <div className="setting-row">
              <div>
                <h3>显示快照与历史版本</h3>
                <p>在下载页中显示所有可用版本。</p>
              </div>
              <Toggle
                label="显示快照与历史版本"
                checked={draft.show_snapshots}
                onChange={(value) => onPatch('show_snapshots', value)}
              />
            </div>
            <div className="config-location">
              <h3>配置文件</h3>
              <code>{configPath}</code>
              <p>配置采用版本化 JSON，保存时执行校验与原子替换。</p>
            </div>
          </>
        )}
      </Panel>
      <div className="save-bar">
        <span>
          {dirty ? (
            <>
              <span className="status-dot" />
              有未保存的修改
            </>
          ) : (
            <>
              <Check size={15} />
              设置已同步
            </>
          )}
        </span>
        <div>
          <button className="secondary" onClick={() => onReset()}>
            还原修改
          </button>
          <button
            className="primary"
            disabled={!!busy || saving || !dirty}
            onClick={() => onSave()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存设置
          </button>
        </div>
      </div>
    </>
  );
}
