import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, LoaderCircle, RotateCcw } from 'lucide-react';
import { Field, Select, Toggle } from '@paradox/ui';
import {
  useLauncherSnapshot,
  useLauncherActions,
  type Personalization,
  type UiRouteId,
} from '@paradox/launcher';
import { viewProps } from '../lib/view';
function PersonalizationSettings(input?: {
  props?: Readonly<Record<string, unknown>>;
  section?: 'appearance' | 'behavior';
}) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions().settings,
    value = snapshot.settings.draft?.personalization;
  const section =
      viewProps<{
        section?: 'appearance' | 'behavior';
      }>(input).section ?? 'appearance',
    desktop = snapshot.window.desktop,
    disabled =
      !!snapshot.activity ||
      snapshot.settings.saving ||
      snapshot.downloads.active ||
      snapshot.downloads.pending.length > 0,
    choosing = snapshot.settings.choosingBackground,
    background = snapshot.appearance.background,
    routes = snapshot.navigation.routes;
  const patch = actions.patchPersonalization,
    onChooseBackground = () => {
      void actions.chooseBackground();
    },
    onSetStartupRoute = actions.setStartupRoute;
  if (!value) return null;
  const startupOptions = (routes ?? [])
    .filter((route) => route.startupSelectable)
    .map((route) => ({
      value: route.id,
      label: t(route.title, { defaultValue: route.title }),
    }));
  return (
    <fieldset
      className="personalization-settings"
      disabled={disabled || choosing}
      data-ui-site="PersonalizationSettings-1"
    >
      <legend data-ui-site="PersonalizationSettings-2">
        {t(
          section === 'appearance'
            ? 'personalization.appearanceTitle'
            : 'personalization.behaviorTitle',
        )}
      </legend>
      {section === 'appearance' ? (
        <Fragment data-ui-site="PersonalizationSettings-3">
          <p data-ui-site="PersonalizationSettings-4">
            {t('personalization.appearanceDescription')}
          </p>
          <div
            className="background-preview"
            style={{
              backgroundImage: background ? `url("${background}")` : 'none',
              backgroundSize:
                value.background_fit === 'stretch' ? '100% 100%' : value.background_fit,
            }}
            role="img"
            aria-label={t('personalization.backgroundPreview')}
            data-ui-site="PersonalizationSettings-5"
          />
          <div className="button-group" data-ui-site="PersonalizationSettings-6">
            <button
              type="button"
              className="secondary"
              disabled={!desktop || choosing}
              onClick={onChooseBackground}
              data-ui-site="PersonalizationSettings-7"
            >
              {choosing ? (
                <LoaderCircle className="spin" size={16} data-ui-site="PersonalizationSettings-8" />
              ) : (
                <ImagePlus size={16} data-ui-site="PersonalizationSettings-9" />
              )}
              {t(choosing ? 'personalization.importing' : 'personalization.chooseBackground')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!value.background_file || choosing}
              onClick={actions.clearBackground}
              data-ui-site="PersonalizationSettings-10"
            >
              <RotateCcw size={16} data-ui-site="PersonalizationSettings-11" />
              {t('personalization.resetBackground')}
            </button>
          </div>
          <p data-ui-site="PersonalizationSettings-12">
            {t(desktop ? 'personalization.backgroundHelp' : 'personalization.backgroundDesktop')}
          </p>
          <div className="field-grid" data-ui-site="PersonalizationSettings-13">
            <Field
              label={t('personalization.backgroundFit')}
              data-ui-site="PersonalizationSettings-14"
            >
              <Select
                value={value.background_fit}
                disabled={disabled || choosing}
                onValueChange={(next) =>
                  patch('background_fit', next as Personalization['background_fit'])
                }
                options={[
                  { value: 'cover', label: t('personalization.fitCover') },
                  { value: 'contain', label: t('personalization.fitContain') },
                  { value: 'stretch', label: t('personalization.fitStretch') },
                ]}
                data-ui-site="PersonalizationSettings-15"
              />
            </Field>
            <Field label={t('personalization.font')} data-ui-site="PersonalizationSettings-16">
              <Select
                value={value.font}
                disabled={disabled || choosing}
                onValueChange={(next) => patch('font', next as Personalization['font'])}
                options={['system', 'yahei', 'arial', 'serif', 'monospace'].map((font) => ({
                  value: font,
                  label: t(`personalization.fonts.${font}`),
                }))}
                data-ui-site="PersonalizationSettings-17"
              />
            </Field>
          </div>
        </Fragment>
      ) : (
        <Fragment data-ui-site="PersonalizationSettings-18">
          <p data-ui-site="PersonalizationSettings-19">
            {t('personalization.behaviorDescription')}
          </p>
          <Field
            label={t('personalization.startupPage')}
            description={t('personalization.startupPageHelp')}
            data-ui-site="PersonalizationSettings-20"
          >
            <Select
              value={value.startup_page}
              disabled={disabled || choosing}
              onValueChange={(next) => onSetStartupRoute(next as UiRouteId)}
              options={startupOptions}
              placeholder={`${value.startup_page} (${t('personalization.startupUnavailable')})`}
              data-ui-site="PersonalizationSettings-21"
            />
          </Field>
          {(['notifications', 'retain_logs', 'shortcuts'] as const).map((key) => (
            <div className="setting-row" key={key} data-ui-site="PersonalizationSettings-22">
              <div data-ui-site="PersonalizationSettings-23">
                <h3 data-ui-site="PersonalizationSettings-24">
                  {t(`personalization.${key}.title`)}
                </h3>
                <p data-ui-site="PersonalizationSettings-25">
                  {t(`personalization.${key}.description`)}
                </p>
              </div>
              <Toggle
                label={t(`personalization.${key}.title`)}
                checked={value[key]}
                onChange={(next) => patch(key, next)}
                data-ui-site="PersonalizationSettings-26"
              />
            </div>
          ))}
          <Field
            label={t('personalization.launchShortcut')}
            description={t('personalization.shortcutHelp')}
            data-ui-site="PersonalizationSettings-27"
          >
            <Select
              disabled={disabled || choosing || !value.shortcuts}
              value={value.launch_shortcut}
              onValueChange={(next) =>
                patch('launch_shortcut', next as Personalization['launch_shortcut'])
              }
              options={['Ctrl+Enter', 'Ctrl+Shift+L', 'Alt+Enter'].map((shortcut) => ({
                value: shortcut,
                label: shortcut,
              }))}
              data-ui-site="PersonalizationSettings-28"
            />
          </Field>
        </Fragment>
      )}
    </fieldset>
  );
}
export default PersonalizationSettings;
