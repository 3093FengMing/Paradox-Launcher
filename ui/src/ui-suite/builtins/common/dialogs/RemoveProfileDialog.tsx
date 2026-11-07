import '../styles/common.css';
import { Fragment } from 'react';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import DefaultLauncherDialog from '../dialogs/LauncherDialog';
import { Field } from '@paradox/ui';
function RemoveProfileDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().removal;
  const { profileKey, deleteFiles, confirmation, pending, canSubmit, recovery } = snapshot.removal;
  const saving = snapshot.settings.saving || pending;
  const onClose = actions.cancel;
  const profile = snapshot.config.value?.profiles.find((item) => item.instance_key === profileKey);
  if (!profileKey) return null;
  const name = recovery?.name ?? profile?.name ?? profileKey;
  return (
    <LauncherDialog
      pending={saving}
      onClose={onClose}
      title={t('removeDialog.title', { name })}
      description={t(recovery ? 'removeDialog.partialDescription' : 'removeDialog.description')}
      data-ui-site="RemoveProfileDialog-1"
    >
      {recovery && (
        <div role="alert">
          <p>{recovery.error}</p>
          <code>{recovery.instanceRoot}</code>
          <p>{t('removeDialog.manualCleanup')}</p>
        </div>
      )}
      {!recovery && (
        <label className="inline-check" data-ui-site="RemoveProfileDialog-2">
          <input
            type="checkbox"
            disabled={saving || !snapshot.window.desktop}
            checked={deleteFiles}
            onChange={(event) => {
              actions.setDeleteFiles(event.target.checked);
            }}
            data-ui-site="RemoveProfileDialog-3"
          />
          {t('removeDialog.deleteFiles')}
        </label>
      )}
      {deleteFiles && !recovery && (
        <Fragment data-ui-site="RemoveProfileDialog-4">
          <p data-ui-site="RemoveProfileDialog-5">
            {t('removeDialog.fileWarning', { key: profileKey })}
          </p>
          <Field
            label={t('removeDialog.confirmName')}
            description={name}
            data-ui-site="RemoveProfileDialog-6"
          >
            <input
              required
              disabled={saving}
              value={confirmation}
              onChange={(event) => actions.setConfirmation(event.target.value)}
              autoComplete="off"
              data-ui-site="RemoveProfileDialog-7"
            />
          </Field>
        </Fragment>
      )}
      <div className="modal-buttons" data-ui-site="RemoveProfileDialog-8">
        <button
          className="secondary"
          disabled={saving}
          onClick={onClose}
          data-ui-site="RemoveProfileDialog-9"
        >
          {t(recovery ? 'removeDialog.close' : 'removeDialog.keep')}
        </button>
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() => {
            void actions.submit();
          }}
          data-ui-site="RemoveProfileDialog-10"
        >
          {saving ? (
            <LoaderCircle className="spin" size={16} data-ui-site="RemoveProfileDialog-11" />
          ) : (
            <Trash2 size={16} data-ui-site="RemoveProfileDialog-12" />
          )}
          {recovery
            ? t('removeDialog.retryFiles')
            : deleteFiles
              ? t('removeDialog.deleteAndRemove')
              : t('removeDialog.removeRecord')}
        </button>
      </div>
    </LauncherDialog>
  );
}
export default RemoveProfileDialog;
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
