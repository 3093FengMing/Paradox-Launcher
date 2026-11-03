/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { pauseNoticeForView, releaseNoticeView, resumeNoticeForView } from './notices';
import type { UiNoticeStore } from './notices';
import styles from './notices.css?inline';

export default function NoticeViewport({
  store,
  portalContainer,
}: {
  store: UiNoticeStore;
  portalContainer?: Element | DocumentFragment;
}): React.JSX.Element {
  const { t } = useTranslation();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const notices = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owner = useRef({});
  useEffect(() => {
    const lease = owner.current;
    return () => releaseNoticeView(store, lease);
  }, [store]);
  const view = (
    <>
      <style>{styles}</style>
      <div className="ui-notice-viewport" aria-label={t('notices.label')}>
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`ui-notice ui-notice-${notice.kind}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
            onPointerEnter={() => pauseNoticeForView(store, owner.current, notice.id, 'pointer')}
            onPointerLeave={() => resumeNoticeForView(store, owner.current, notice.id, 'pointer')}
            onFocus={() => pauseNoticeForView(store, owner.current, notice.id, 'focus')}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                resumeNoticeForView(store, owner.current, notice.id, 'focus');
            }}
          >
            <span>{notice.message}</span>
            <button
              type="button"
              aria-label={t('notices.dismiss')}
              onClick={() => store.dismiss(notice.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
  return portalContainer ? createPortal(view, portalContainer) : view;
}
