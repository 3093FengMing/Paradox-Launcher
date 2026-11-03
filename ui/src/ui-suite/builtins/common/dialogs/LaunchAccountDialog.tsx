import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { Select } from '@paradox/ui';
import DefaultLauncherDialog from './LauncherDialog';
export default function LaunchAccountDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    launchSelection = snapshot.launch.selection,
    config = snapshot.config.value;
  if (!launchSelection || !config) return null;
  return (
    <LauncherDialog
      title={t('auth.launchTitle')}
      description={t('auth.launchDescription', {
        name:
          config.profiles.find((profile) => profile.instance_key === launchSelection.profileKey)
            ?.name ?? launchSelection.profileKey,
      })}
      pending={launchSelection.submitting}
      onClose={actions.launch.cancelSelection}
      data-ui-site="LaunchAccountDialog-1"
    >
      <Select
        aria-label={t('auth.select')}
        value={launchSelection.accountId ?? ''}
        disabled={
          launchSelection.submitting ||
          snapshot.accounts.pending ||
          !snapshot.accounts.ready ||
          snapshot.accounts.loading
        }
        onValueChange={(id) => actions.launch.chooseAccount(id || null)}
        options={[
          {
            value: '',
            label: t('auth.offlineOption', { name: config.settings.offline_username }),
          },
          ...snapshot.accounts.state.accounts.map((account) => ({
            value: account.id,
            label: account.name,
          })),
        ]}
        data-ui-site="LaunchAccountDialog-2"
      />
      <div className="modal-buttons" data-ui-site="LaunchAccountDialog-3">
        <button
          className="secondary"
          disabled={launchSelection.submitting}
          onClick={actions.launch.cancelSelection}
          data-ui-site="LaunchAccountDialog-4"
        >
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          disabled={!launchSelection.canSubmit}
          onClick={() => {
            void actions.launch.confirmAccount();
          }}
          data-ui-site="LaunchAccountDialog-5"
        >
          {t('auth.launch')}
        </button>
      </div>
    </LauncherDialog>
  );
}
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
