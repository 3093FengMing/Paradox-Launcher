import i18n, { translateRuntimeMessage } from '../i18n';

export function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'key' in error &&
    typeof error.key === 'string' &&
    i18n.exists(error.key)
  )
    return i18n.t(error.key);
  if (error instanceof Error) return translateRuntimeMessage(error.message);
  if (typeof error === 'string') return translateRuntimeMessage(error);
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return translateRuntimeMessage(error.message);
  return i18n.t('errors.generic');
}
