/** @jsxImportSource react */
import type { FocusEventHandler, PointerEventHandler, ReactNode, RefCallback } from 'react';
import { useLauncherCompatibility } from '../launcher/compatibility';
import NoticeViewport from '../ui-runtime/NoticeViewport';
import type { UiNotice } from '../ui-runtime/notices';
import { useUiFoundation } from './environment';

export interface UiNoticeElementProps {
  /** Stable outer-element ref; retain it so detached markup releases this notice's pauses. */
  readonly ref: RefCallback<HTMLElement>;
  readonly role: 'alert' | 'status';
  readonly 'aria-atomic': true;
  readonly onPointerEnter: PointerEventHandler<HTMLElement>;
  readonly onPointerLeave: PointerEventHandler<HTMLElement>;
  readonly onFocus: FocusEventHandler<HTMLElement>;
  readonly onBlur: FocusEventHandler<HTMLElement>;
}
export interface UiNoticePresentation {
  readonly notice: Readonly<UiNotice>;
  /** Spread on the notice's outer element to retain accessibility and pause behavior. */
  readonly noticeProps: UiNoticeElementProps;
  readonly dismiss: () => void;
  readonly dismissLabel: string;
}
export interface UiNotificationsProps {
  /** Adds a source-owned class to the existing viewport. */
  className?: string;
  /** Authors visible notice markup while the viewport retains store and Portal ownership. */
  renderNotice?: (presentation: UiNoticePresentation) => ReactNode;
}

// Reuse the permanent store and its independent per-viewport pause leases.
export function UiNotifications({ className, renderNotice }: UiNotificationsProps = {}): React.JSX.Element {
  const { services } = useLauncherCompatibility();
  const { portalContainer } = useUiFoundation();
  return (
    <NoticeViewport
      store={services.launcher.notices}
      portalContainer={portalContainer ?? undefined}
      className={className}
      renderNotice={renderNotice}
    />
  );
}
