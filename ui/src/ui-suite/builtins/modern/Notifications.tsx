import { UiIdentity, UiNotifications } from '@paradox/ui';
import { useLauncherSnapshot } from '@paradox/launcher';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import './styles/notifications.css';
export default function Notifications() {
  const s = useLauncherSnapshot();
  return <UiNotifications className="modern-notice-viewport" renderNotice={({ notice, noticeProps, dismiss, dismissLabel }) =>
    <UiIdentity namespace="notice" value={notice.id}><div {...noticeProps} data-theme={s.appearance.theme} style={{ ...s.appearance.variables, fontSize: `${Math.max(13,14 * (s.appearance.value?.ui_scale ?? 100) / 100)}px` }} data-ui-site="Notifications-notice" data-kind={notice.kind} className={`ui-notice modern-notice`}>
      {notice.kind === 'success' ? <CircleCheck data-ui-site="Notifications-success" size={18}  aria-hidden="true"/> : notice.kind === 'error' || notice.kind === 'warning' ? <CircleAlert data-ui-site="Notifications-error" size={18}  aria-hidden="true"/> : <Info data-ui-site="Notifications-info" size={18}  aria-hidden="true"/>}
      <span data-ui-site="Notifications-message">{notice.message}</span>
      <button data-ui-site="Notifications-dismiss" type="button" aria-label={dismissLabel} onClick={dismiss}><X data-ui-site="Notifications-close" size={16}  aria-hidden="true"/></button>
    </div></UiIdentity>}/>;
}
