import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { Button } from '@paradox/ui';
import { CircleAlert } from 'lucide-react';
export default function Error() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  return !s.config.fatal ? null : <section data-ui-site="Error-1" className="source-host-state source-error" role="alert">
    <CircleAlert data-ui-site="Error-icon" size={26} /><h1 data-ui-site="Error-title">{t('shellHome.configError')}</h1>
    <p data-ui-site="Error-2">{s.config.fatal}</p><Button data-ui-site="Error-3" onClick={() => void a.config.reload()}>{t('common.retry')}</Button>
  </section>;
}
