import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Field } from './ui';

function RemoveProfileDialog({
  profile: identity,
  ...appearance
}: DialogAppearance & { profile?: { instance_key: string } }) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot();
  const actions = useLauncherActions().removal;
  const { profileKey, deleteFiles, confirmation, pending, canSubmit, recovery } = snapshot.removal;
  const saving = snapshot.settings.saving || pending;
  const onClose = actions.cancel;
  const profile = snapshot.config.value?.profiles.find((item) => item.instance_key === profileKey);
  if (!profileKey || (identity && profileKey !== identity.instance_key)) return null;
  const name = recovery?.name ?? profile?.name ?? profileKey;
  return (
    <LauncherDialog
      {...appearance}
      pending={saving}
      onClose={onClose}
      title={t('removeDialog.title', { name })}
      description={t(recovery ? 'removeDialog.partialDescription' : 'removeDialog.description')}
    >
      {recovery && (
        <div role="alert">
          <p>{recovery.error}</p>
          <code>{recovery.instanceRoot}</code>
          <p>{t('removeDialog.manualCleanup')}</p>
        </div>
      )}
      {!recovery && (
        <label className="inline-check">
          <input
            type="checkbox"
            disabled={saving || !snapshot.window.desktop}
            checked={deleteFiles}
            onChange={(event) => {
              actions.setDeleteFiles(event.target.checked);
            }}
          />
          {t('removeDialog.deleteFiles')}
        </label>
      )}
      {deleteFiles && !recovery && (
        <>
          <p>{t('removeDialog.fileWarning', { key: profileKey })}</p>
          <Field label={t('removeDialog.confirmName')} description={name}>
            <input
              required
              disabled={saving}
              value={confirmation}
              onChange={(event) => actions.setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </Field>
        </>
      )}
      <div className="modal-buttons">
        <button className="secondary" disabled={saving} onClick={onClose}>
          {t(recovery ? 'removeDialog.close' : 'removeDialog.keep')}
        </button>
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={() => {
            void actions.submit();
          }}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
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

const CustomizedRemoveProfileDialog = customComponent(
  'component.remove-profile-dialog',
  RemoveProfileDialog,
);
export default CustomizedRemoveProfileDialog;
