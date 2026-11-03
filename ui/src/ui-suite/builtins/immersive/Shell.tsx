import { useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus, Settings2 } from 'lucide-react';
import { UiView, UiRouteViewport } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { appVersion } from '../common/lib/version';
import './style.css';
export default function Shell() {
  const s = useLauncherSnapshot(),
    a = useLauncherActions(),
    { t } = useTranslation();
  const [keyboard, setKeyboard] = useState(false);
  const route = s.navigation.routes.find((r) => r.id === s.navigation.routeId);
  const name =
    s.accounts.state.accounts.find((x) => x.id === s.accounts.state.active)?.name ??
    s.config.value?.settings.offline_username ??
    '';
  const appearance = s.appearance.value;
  const title = route ? t(route.title, { defaultValue: route.title }) : '';
  return (
    <div
      data-ui-site="Shell-1"
      className={[
        'app-shell',
        'immersive-shell',
        'immersive',
        s.navigation.routeId === 'home' ? 'is-home' : '',
        s.navigation.routeId === 'home' ? 'immersive-landing' : '',
        appearance?.compact_sidebar ? 'compact' : '',
        appearance?.background_art ? 'has-background' : '',
        appearance?.reduce_motion ? 'reduce-motion' : '',
        keyboard ? 'keyboard-navigation' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-theme={s.appearance.theme}
      style={s.appearance.variables}
      onKeyDownCapture={() => setKeyboard(true)}
      onPointerDownCapture={() => setKeyboard(false)}
    >
      <UiView data-ui-site="Shell-2" id="component.window-bar" />
      <UiView data-ui-site="Shell-3" id="host.loading" />
      <UiView data-ui-site="Shell-4" id="host.error" />
      {s.config.value && (
        <Fragment data-ui-site="fragment-1">
          <UiView data-ui-site="Shell-5" id="component.app-sidebar" props={{ immersive: true }} />
          <div data-ui-site="Shell-6" className="workspace">
            <header data-ui-site="Shell-7" className="topbar">
              <div data-ui-site="Shell-8" className="breadcrumb">
                {t('app.workspace')}
                <ChevronRight data-ui-site="Shell-9" size={14} />
                <strong data-ui-site="Shell-10">{title}</strong>
              </div>
              <div data-ui-site="Shell-11" className="topbar-right">
                <span data-ui-site="Shell-12" className="version-tag">
                  {t('app.earlyAccess')} <b data-ui-site="Shell-13">{appVersion}</b>
                </span>
                <button
                  data-ui-site="Shell-14"
                  className="account-avatar-button"
                  aria-label={t('app.openAccount')}
                  onClick={() => a.navigation.navigate('accounts')}
                >
                  <UiView data-ui-site="Shell-15" id="component.account-avatar" props={{ name }} />
                </button>
              </div>
            </header>
            <main data-ui-site="Shell-16">
              <div data-ui-site="Shell-17" className="page-heading">
                <div data-ui-site="Shell-18">
                  <h1 data-ui-site="Shell-19">
                    {s.navigation.routeId === 'home' ? t('app.welcome', { name }) : title}
                  </h1>
                  <p data-ui-site="Shell-20">
                    {route ? t(route.description, { defaultValue: route.description }) : ''}
                  </p>
                </div>
                {['home', 'instances'].includes(s.navigation.routeId) && (
                  <button
                    data-ui-site="Shell-21"
                    className="secondary"
                    disabled={!!s.activity || s.downloads.active}
                    onClick={() => a.profileDraft.openCreate()}
                  >
                    <Plus data-ui-site="Shell-22" size={17} />
                    {t('app.createInstance')}
                  </button>
                )}
              </div>
              <UiView data-ui-site="Shell-23" id="component.activity-bar" />
              <UiRouteViewport data-ui-site="Shell-24" />
              <footer data-ui-site="Shell-25" className="app-footer">
                <span data-ui-site="Shell-26">
                  Paradox Launcher <i data-ui-site="Shell-27">·</i> v{appVersion}
                </span>
                <button
                  data-ui-site="Shell-28"
                  className="text-button"
                  onClick={() => {
                    a.settings.setTab('advanced');
                    a.navigation.navigate('settings');
                  }}
                >
                  <Settings2 data-ui-site="Shell-29" size={14} />
                  {t('app.aboutName')}
                </button>
              </footer>
            </main>
          </div>
          {s.profileDraft.editor && <UiView data-ui-site="Shell-30" id="dialog.profile" />}
          {s.instanceDraft.profile && <UiView data-ui-site="Shell-31" id="dialog.instance-settings" />}
          {s.importDraft.open && <UiView data-ui-site="Shell-32" id="dialog.import-instances" />}
          {s.removal.profileKey && <UiView data-ui-site="Shell-33" id="dialog.remove-profile" />}
          {s.window.request && <UiView data-ui-site="Shell-34" id="dialog.close-request" />}
          {s.launch.selection && <UiView data-ui-site="Shell-35" id="dialog.launch-account" />}
        </Fragment>
      )}
      <UiView data-ui-site="Shell-39" id="host.notifications" />
    </div>
  );
}
