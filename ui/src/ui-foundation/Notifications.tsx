/** @jsxImportSource react */
import { useLauncherCompatibility } from '../launcher/compatibility';
import NoticeViewport from '../ui-runtime/NoticeViewport';
import { useUiFoundation } from './environment';

// Reuse the permanent store and its independent per-viewport pause leases.
export function UiNotifications(): React.JSX.Element {
  const { services } = useLauncherCompatibility();
  const { portalContainer } = useUiFoundation();
  return (
    <NoticeViewport
      store={services.launcher.notices}
      portalContainer={portalContainer ?? undefined}
    />
  );
}
