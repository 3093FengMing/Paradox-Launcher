import { noticeTime } from '../ui-runtime/notices';
import type { UiNoticeKind } from '../ui-runtime/notices';
import type { createNoticeStore } from '../ui-runtime/notices';
import { translateRuntimeMessage } from '../i18n';
import type { AppConfig } from '../types';

interface Cell<T> {
  current: T;
}
interface LastNotice {
  message: string;
  kind: UiNoticeKind;
  time: number;
  id: string;
}

/** Notification settings and duplicate windows use the current accepted config. */
export function publishOwnerNotice(
  notices: ReturnType<typeof createNoticeStore>,
  config: Cell<AppConfig | null>,
  previousNotice: Cell<LastNotice>,
  kind: UiNoticeKind,
  message: string,
): string {
  if (kind !== 'error' && config.current?.settings.personalization.notifications === false)
    return '';
  message = translateRuntimeMessage(message);
  const previous = previousNotice.current,
    time = noticeTime(notices);
  if (previous.message === message && previous.kind === kind && time - previous.time < 1000)
    return previous.id;
  const id = notices.publish(kind, message);
  previousNotice.current = { message, kind, time, id };
  return id;
}
