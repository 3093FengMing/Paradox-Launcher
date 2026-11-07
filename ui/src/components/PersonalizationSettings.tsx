import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { ImagePlus, LoaderCircle, RotateCcw } from 'lucide-react';
import { Field, Select, Toggle } from './ui';
import type {
  DeepReadonly,
  Personalization,
  LauncherActions,
  UiRouteDescriptor,
  UiRouteId,
} from '@paradox/launcher';

interface Props {
  value: DeepReadonly<Personalization>;
  section: 'appearance' | 'behavior';
  desktop: boolean;
  disabled: boolean;
  choosing: boolean;
  background: string | null;
  onPatch: LauncherActions['settings']['patchPersonalization'];
  onChooseBackground: () => void;
  routes: readonly DeepReadonly<UiRouteDescriptor>[];
  onSetStartupRoute: LauncherActions['settings']['setStartupRoute'];
}

function PersonalizationSettings({
  value,
  section,
  desktop,
  disabled,
  choosing,
  background,
  onPatch: patch,
  onChooseBackground,
  routes,
  onSetStartupRoute,
}: Props) {
  const { t } = useTranslation();
  const startupOptions = (routes ?? [])
    .filter((route) => route.startupSelectable)
    .map((route) => ({
      value: route.id,
      label: t(route.title, { defaultValue: route.title }),
    }));
  return (
    <fieldset className="personalization-settings" disabled={disabled || choosing}>
      <legend>
        {t(
          section === 'appearance'
            ? 'personalization.appearanceTitle'
            : 'personalization.behaviorTitle',
        )}
      </legend>
      {section === 'appearance' ? (
        <>
          <p>{t('personalization.appearanceDescription')}</p>
          <div
            className="background-preview"
            style={{
              backgroundImage: background ? `url("${background}")` : 'none',
              backgroundSize:
                value.background_fit === 'stretch' ? '100% 100%' : value.background_fit,
            }}
            role="img"
            aria-label={t('personalization.backgroundPreview')}
          />
          <div className="button-group">
            <button
              type="button"
              className="secondary"
              disabled={!desktop || choosing}
              onClick={onChooseBackground}
            >
              {choosing ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
              {t(choosing ? 'personalization.importing' : 'personalization.chooseBackground')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!value.background_file || choosing}
              onClick={() => patch('background_file', '')}
            >
              <RotateCcw size={16} />
              {t('personalization.resetBackground')}
            </button>
          </div>
          <p>
            {t(desktop ? 'personalization.backgroundHelp' : 'personalization.backgroundDesktop')}
          </p>
          <div className="field-grid">
            <Field label={t('personalization.backgroundFit')}>
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
              />
            </Field>
            <Field label={t('personalization.font')}>
              <Select
                value={value.font}
                disabled={disabled || choosing}
                onValueChange={(next) => patch('font', next as Personalization['font'])}
                options={['system', 'yahei', 'arial', 'serif', 'monospace'].map((font) => ({
                  value: font,
                  label: t(`personalization.fonts.${font}`),
                }))}
              />
            </Field>
          </div>
        </>
      ) : (
        <>
          <p>{t('personalization.behaviorDescription')}</p>
          <Field
            label={t('personalization.startupPage')}
            description={t('personalization.startupPageHelp')}
          >
            <Select
              value={value.startup_page}
              disabled={disabled || choosing}
              onValueChange={(next) => onSetStartupRoute(next as UiRouteId)}
              options={startupOptions}
              placeholder={`${value.startup_page} (${t('personalization.startupUnavailable')})`}
            />
          </Field>
          {(['notifications', 'retain_logs', 'shortcuts'] as const).map((key) => (
            <div className="setting-row" key={key}>
              <div>
                <h3>{t(`personalization.${key}.title`)}</h3>
                <p>{t(`personalization.${key}.description`)}</p>
              </div>
              <Toggle
                label={t(`personalization.${key}.title`)}
                checked={value[key]}
                onChange={(next) => patch(key, next)}
              />
            </div>
          ))}
          <Field
            label={t('personalization.launchShortcut')}
            description={t('personalization.shortcutHelp')}
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
            />
          </Field>
        </>
      )}
    </fieldset>
  );
}

const CustomizedPersonalizationSettings = customComponent(
  'component.personalization-settings',
  PersonalizationSettings,
);
export default CustomizedPersonalizationSettings;
