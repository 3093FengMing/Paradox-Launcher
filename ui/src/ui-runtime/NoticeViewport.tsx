/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Ref, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { pauseNoticeForView, releaseNoticeView, resumeNoticeForView } from './notices';
import type { UiNotice, UiNoticeStore } from './notices';
import type { UiNoticeElementProps, UiNotificationsProps } from '../ui-foundation/Notifications';
import styles from './notices.css?inline';
import { useRegisteredRef } from '../customization/runtime';

function Notice({
  store,
  owner,
  notice,
  renderNotice,
}: {
  store: UiNoticeStore;
  owner: RefObject<object>;
  notice: Readonly<UiNotice>;
} & Pick<UiNotificationsProps, 'renderNotice'>): React.JSX.Element {
  const { t } = useTranslation();
  const root = useRef<HTMLElement | null>(null);
  const id = notice.id;
  const attachRoot = useCallback((element: HTMLElement | null) => {
    if (root.current && root.current !== element) {
      resumeNoticeForView(store, owner.current, id, 'pointer');
      resumeNoticeForView(store, owner.current, id, 'focus');
    }
    root.current = element;
  }, [store, owner, id]);
  const noticeProps = Object.freeze<UiNoticeElementProps>({
    ref: attachRoot,
    role: notice.kind === 'error' ? 'alert' : 'status',
    'aria-atomic': true,
    onPointerEnter: () => pauseNoticeForView(store, owner.current, id, 'pointer'),
    onPointerLeave: () => resumeNoticeForView(store, owner.current, id, 'pointer'),
    onFocus: () => pauseNoticeForView(store, owner.current, id, 'focus'),
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        resumeNoticeForView(store, owner.current, id, 'focus');
    },
  });
  const dismiss = () => store.dismiss(id);
  const dismissLabel = t('notices.dismiss');
  return (
    <>
      {renderNotice ? (
        renderNotice(Object.freeze({ notice, noticeProps, dismiss, dismissLabel }))
      ) : (
        <div className={`ui-notice ui-notice-${notice.kind}`} {...noticeProps}>
          <span>{notice.message}</span>
          <button type="button" aria-label={dismissLabel} onClick={dismiss}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

export default function NoticeViewport({
  store,
  portalContainer,
  className,
  renderNotice,
}: {
  store: UiNoticeStore;
  portalContainer?: Element | DocumentFragment;
} & UiNotificationsProps): React.JSX.Element {
  const { t } = useTranslation();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notices = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owner = useRef({});
  const viewportRef = useRegisteredRef(undefined) as Ref<HTMLDivElement>;
  useEffect(() => {
    const lease = owner.current;
    return () => releaseNoticeView(store, lease);
  }, [store]);
  const view = (
    <>
      <style>{styles}</style>
      <div
        ref={viewportRef}
        className={['ui-notice-viewport', className].filter(Boolean).join(' ')}
        aria-label={t('notices.label')}
      >
        {notices.map((notice) => (
          <Notice key={notice.id} store={store} owner={owner} notice={notice} renderNotice={renderNotice} />
        ))}
      </div>
    </>
  );
  return portalContainer ? createPortal(view, portalContainer) : view;
}
