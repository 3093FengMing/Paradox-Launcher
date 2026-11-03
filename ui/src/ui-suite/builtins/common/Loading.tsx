import { useLauncherSnapshot } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
export default function Loading() {
  const s = useLauncherSnapshot(),
    { t } = useTranslation();
  return s.config.ready ? null : (
    <div data-ui-site="Loading-1" className="boot-screen" role="status">
      <LoaderCircle data-ui-site="Loading-2" className="spin" />
      {t('app.loading')}
    </div>
  );
}
