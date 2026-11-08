import { useLauncherSnapshot } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
export default function Loading() {
  const s = useLauncherSnapshot(), { t } = useTranslation();
  return s.config.ready || s.config.fatal ? null : <section data-ui-site="Loading-1" className="source-host-state source-loading" role="status">
    <LoaderCircle data-ui-site="Loading-2" className="spin" size={24} /><p data-ui-site="Loading-3">{t('app.loading')}</p>
  </section>;
}
