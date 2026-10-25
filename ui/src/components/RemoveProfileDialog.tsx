import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import * as api from '../api';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import { Field } from './ui';
import type { GameProfile } from '../types';

interface Props extends DialogAppearance {
  profile: GameProfile;
  saving: boolean;
  onClose: () => void;
  onRemove: (key: string, deleteFiles: boolean) => Promise<boolean>;
}
export default function RemoveProfileDialog({
  profile,
  saving,
  onClose,
  onRemove,
  ...appearance
}: Props) {
  const { t } = useTranslation();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current || saving || (deleteFiles && confirmation !== profile.name)) return;
    pending.current = true;
    try {
      if (await onRemove(profile.instance_key, deleteFiles)) onClose();
    } finally {
      pending.current = false;
    }
  };
  return (
    <LauncherDialog
      {...appearance}
      pending={saving}
      onClose={onClose}
      title={t('removeDialog.title', { name: profile.name })}
      description={t('removeDialog.description')}
    >
      <label className="inline-check">
        <input
          type="checkbox"
          disabled={saving || !api.desktop}
          checked={deleteFiles}
          onChange={(event) => {
            setDeleteFiles(event.target.checked);
            setConfirmation('');
          }}
        />
        {t('removeDialog.deleteFiles')}
      </label>
      {deleteFiles && (
        <>
          <p>{t('removeDialog.fileWarning', { key: profile.instance_key })}</p>
          <Field label={t('removeDialog.confirmName')} description={profile.name}>
            <input
              required
              disabled={saving}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </Field>
        </>
      )}
      <div className="modal-buttons">
        <button className="secondary" disabled={saving} onClick={onClose}>
          {t('removeDialog.keep')}
        </button>
        <button
          className="primary"
          disabled={saving || (deleteFiles && confirmation !== profile.name)}
          onClick={() => {
            void submit();
          }}
        >
          {saving ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
          {deleteFiles ? t('removeDialog.deleteAndRemove') : t('removeDialog.removeRecord')}
        </button>
      </div>
    </LauncherDialog>
  );
}
