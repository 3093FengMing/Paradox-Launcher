import '../styles/common.css';
import { sourceView } from '../lib/view';
import DefaultPresetDialog from '../dialogs/AppearancePresetDialog';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { Check, Download, Import, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appearancesEqual, MAX_APPEARANCE_PRESETS } from '../lib/appearance-presets';
import '../styles/presets.css';
function AppearancePresets() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const { presets: actions } = useLauncherActions();
  const presets = snapshot.config.value?.appearance_presets ?? [];
  const currentAppearance = snapshot.settings.draft?.appearance;
  const pending = snapshot.drafts.presetPending || !!snapshot.drafts.preset?.pending;
  const blocked =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0 ||
    pending;
  const atCapacity = presets.length >= MAX_APPEARANCE_PRESETS;
  const open = actions.openDialog;
  return (
    <section
      className="appearance-presets"
      aria-labelledby="appearance-presets-title"
      data-ui-site="AppearancePresets-1"
    >
      <div className="preset-heading" data-ui-site="AppearancePresets-2">
        <div data-ui-site="AppearancePresets-3">
          <h3 id="appearance-presets-title" data-ui-site="AppearancePresets-4">
            {t('presets.title')}
          </h3>
          <p data-ui-site="AppearancePresets-5">{t('presets.description')}</p>
        </div>
        <div className="button-group" data-ui-site="AppearancePresets-6">
          <button
            type="button"
            className="secondary small"
            disabled={blocked || atCapacity}
            onClick={() => open({ kind: 'import' })}
            data-ui-site="AppearancePresets-7"
          >
            <Import size={15} data-ui-site="AppearancePresets-8" />
            {t('presets.import')}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={blocked || atCapacity}
            onClick={() => open({ kind: 'save' })}
            data-ui-site="AppearancePresets-9"
          >
            <Plus size={15} data-ui-site="AppearancePresets-10" />
            {t('presets.saveCurrent')}
          </button>
        </div>
      </div>
      {presets.length ? (
        <div className="preset-list" data-ui-site="AppearancePresets-11">
          {presets.map((preset) => {
            const current = currentAppearance
              ? appearancesEqual(currentAppearance, preset.appearance)
              : false;
            return (
              <div className="preset-card" key={preset.id} data-ui-site="AppearancePresets-12">
                <span
                  className="preset-swatch"
                  style={{ color: preset.appearance.accent_color }}
                  aria-hidden="true"
                  data-ui-site="AppearancePresets-13"
                >
                  <Layers size={20} data-ui-site="AppearancePresets-14" />
                </span>
                <div className="preset-info" data-ui-site="AppearancePresets-15">
                  <h4 data-ui-site="AppearancePresets-16">{preset.name}</h4>
                  <p data-ui-site="AppearancePresets-17">
                    {t(`presets.style.${preset.appearance.interface_style}`)}
                    <span data-ui-site="AppearancePresets-18"> · </span>
                    {t(`presets.theme.${preset.appearance.theme}`)}
                    <span data-ui-site="AppearancePresets-19"> · </span>
                    {preset.appearance.ui_scale}%
                  </p>
                </div>
                <div className="preset-actions" data-ui-site="AppearancePresets-20">
                  <button
                    type="button"
                    className="text-button preset-apply"
                    disabled={blocked || current}
                    onClick={() => actions.apply(preset.id)}
                    aria-label={t('presets.applyAria', { name: preset.name })}
                    data-ui-site="AppearancePresets-21"
                  >
                    {current && <Check size={14} data-ui-site="AppearancePresets-22" />}
                    {t(current ? 'presets.current' : 'presets.apply')}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.renameAria', { name: preset.name })}
                    title={t('presets.rename')}
                    onClick={() => open({ kind: 'rename', id: preset.id })}
                    data-ui-site="AppearancePresets-23"
                  >
                    <Pencil size={15} data-ui-site="AppearancePresets-24" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.exportAria', { name: preset.name })}
                    title={t('presets.export')}
                    onClick={() => open({ kind: 'export', id: preset.id })}
                    data-ui-site="AppearancePresets-25"
                  >
                    <Download size={15} data-ui-site="AppearancePresets-26" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={blocked}
                    aria-label={t('presets.removeAria', { name: preset.name })}
                    title={t('presets.remove')}
                    onClick={() => open({ kind: 'remove', id: preset.id })}
                    data-ui-site="AppearancePresets-27"
                  >
                    <Trash2 size={15} data-ui-site="AppearancePresets-28" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="preset-empty" data-ui-site="AppearancePresets-29">
          <Layers size={18} data-ui-site="AppearancePresets-30" />
          <p data-ui-site="AppearancePresets-31">{t('presets.empty')}</p>
        </div>
      )}
      <p className="preset-note" data-ui-site="AppearancePresets-32">
        {t(atCapacity ? 'presets.capacityReached' : 'presets.applyHint', {
          maximum: MAX_APPEARANCE_PRESETS,
        })}
      </p>

      <PresetDialog data-ui-site="AppearancePresets-33" />
    </section>
  );
}
export default AppearancePresets;
const PresetDialog = sourceView('dialog.preset', DefaultPresetDialog);
