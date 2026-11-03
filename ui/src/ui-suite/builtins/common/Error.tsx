import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { useTranslation } from 'react-i18next';
import { Button } from '@paradox/ui';
export default function Error() {
  const s = useLauncherSnapshot(),
    a = useLauncherActions(),
    { t } = useTranslation();
  return s.config.fatal ? (
    <section data-ui-site="Error-1" className="boot-screen" role="alert">
      <p data-ui-site="Error-2">{s.config.fatal}</p>
      <Button data-ui-site="Error-3" onClick={() => void a.config.reload()}>
        {t('common.retry')}
      </Button>
    </section>
  ) : null;
}
