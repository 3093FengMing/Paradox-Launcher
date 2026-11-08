import { useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { UiView, UiRouteViewport, UiIdentity } from '@paradox/ui';
import { useLauncherSnapshot, useUiEditorSnapshot } from '@paradox/launcher';
import { resolveActiveAccount } from '../common/lib/launcher-display';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/home.css';
import './styles/host-components.css';
import './style.css';
import './styles/responsive.css';
export default function Shell() {
  const s = useLauncherSnapshot(), editor = useUiEditorSnapshot(), { t } = useTranslation();
  const [keyboard, setKeyboard] = useState(false);
  const route = s.navigation.routes.find(r => r.id === s.navigation.routeId);
  const home = route?.id === 'home';
  const account = resolveActiveAccount(s);
  const title = route ? t(route.title, { defaultValue: route.title }) : '';
  return <div data-ui-site="Shell-1" className={[
    'app-shell modern-shell', home ? 'is-home' : '',
    s.appearance.value?.compact_sidebar ? 'compact' : '',
    s.appearance.value?.reduce_motion ? 'reduce-motion' : '', keyboard ? 'keyboard-navigation' : '',
  ].filter(Boolean).join(' ')} data-theme={s.appearance.theme} style={s.appearance.variables}
    onKeyDownCapture={() => setKeyboard(true)} onPointerDownCapture={() => setKeyboard(false)}>
    <UiView data-ui-site="Shell-2" id="component.window-bar" />
    <UiView data-ui-site="Shell-3" id="host.loading" />
    <UiView data-ui-site="Shell-4" id="host.error" />
    {editor.initialSelectionRequired && !editor.suspended && <UiView data-ui-site="Shell-choice" id="onboarding.style-choice" />}
    {s.config.value && editor.draft && !editor.initialSelectionRequired && !editor.suspended && <Fragment>
      <UiView data-ui-site="Shell-5" id="component.app-sidebar" />
      <div data-ui-site="Shell-6" className="workspace">
        <main data-ui-site="Shell-16">
          <header data-ui-site="Shell-17" className="page-heading">
            <div data-ui-site="Shell-18"><h1 data-ui-site="Shell-19">{home ? t('app.welcome', { name: account.name }) : title}</h1>
            <p data-ui-site="Shell-20">{route ? t(route.description, { defaultValue: route.description }) : ''}</p></div>
          </header>
          {!home && <UiView data-ui-site="Shell-23" id="component.activity-bar" />}
          <UiRouteViewport data-ui-site="Shell-24" />
        </main>
      </div>
      {s.profileDraft.editor && <UiIdentity namespace={s.profileDraft.editor.editKey ? "profile" : "profile-draft"} value={s.profileDraft.editor.editKey ?? "create"}><UiView data-ui-site="Shell-30" id="dialog.profile" /></UiIdentity>}
      {s.instanceDraft.profile && <UiIdentity namespace="profile" value={s.instanceDraft.profile.instance_key}><UiView data-ui-site="Shell-31" id="dialog.instance-settings" props={{ profileKey: s.instanceDraft.profile.instance_key }}/></UiIdentity>}
      {s.importDraft.open && <UiView data-ui-site="Shell-32" id="dialog.import-instances" />}
      {s.removal.profileKey && <UiIdentity namespace={s.removal.recovery ? "removal-token" : "profile"} value={s.removal.recovery?.token ?? s.removal.profileKey}><UiView data-ui-site="Shell-33" id="dialog.remove-profile" /></UiIdentity>}
      {s.window.request && <UiView data-ui-site="Shell-34" id="dialog.close-request" />}
      {s.launch.selection && <UiIdentity namespace="profile" value={s.launch.selection.profileKey}><UiView data-ui-site="Shell-35" id="dialog.launch-account" /></UiIdentity>}
    </Fragment>}
    <UiView data-ui-site="Shell-39" id="host.notifications" />
  </div>;
}
