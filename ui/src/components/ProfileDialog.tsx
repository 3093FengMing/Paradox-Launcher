import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Box, LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { Badge, Field } from './ui';
import type { ProfileEditor } from '../lib/forms';

interface ProfileDialogProps {
  editor: ProfileEditor | null;
  saving: boolean;
  theme: 'light' | 'dark';
  variables: CSSProperties;
  reduceMotion: boolean;
  keyboardNavigation: boolean;
  onChange: (patch: Partial<ProfileEditor>) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function ProfileDialog({
  editor,
  saving,
  theme,
  variables,
  reduceMotion,
  keyboardNavigation,
  onChange,
  onClose,
  onSave,
}: ProfileDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          style={variables}
        >
          <Dialog.Backdrop className="modal-backdrop" />
          <Dialog.Popup
            className="modal"
            initialFocus={() => document.getElementById('profile-name')}
          >
            {editor && (
              <>
                <div className="modal-heading">
                  <div className="metric-icon">
                    <Box size={23} />
                  </div>
                  <button
                    className="icon-button"
                    aria-label={t('common.closeDialog')}
                    disabled={saving}
                    onClick={onClose}
                  >
                    <X size={19} />
                  </button>
                </div>
                <Dialog.Title className="modal-title">
                  {editor.editKey ? t('instances.rename') : t('profileDialog.createTitle')}
                </Dialog.Title>
                <Dialog.Description className="modal-description">
                  {editor.editKey
                    ? t('profileDialog.renameDescription')
                    : t('profileDialog.createDescription')}
                </Dialog.Description>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSave();
                  }}
                >
                  <Field label={t('instances.name')}>
                    <input
                      id="profile-name"
                      required
                      disabled={saving}
                      placeholder={t('profileDialog.namePlaceholder')}
                      maxLength={64}
                      value={editor.name}
                      onChange={(event) => onChange({ name: event.target.value })}
                    />
                  </Field>
                  <Field label={t('common.minecraftVersion')}>
                    <input
                      required
                      disabled={saving || !!editor.editKey}
                      value={editor.version}
                      onChange={(event) => onChange({ version: event.target.value })}
                    />
                  </Field>
                  <div className="modal-type">
                    <LayoutGrid size={17} />
                    <span>{t('common.vanilla')}</span>
                    <Badge>{t('common.supported')}</Badge>
                  </div>
                  <div className="modal-buttons">
                    <button type="button" className="secondary" disabled={saving} onClick={onClose}>
                      {t('common.cancel')}
                    </button>
                    <button type="submit" className="primary" disabled={saving}>
                      {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                      {editor.editKey ? t('profileDialog.saveName') : t('common.createInstance')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
