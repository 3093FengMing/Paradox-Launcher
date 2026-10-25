import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

export interface DialogAppearance {
  theme: 'light' | 'dark';
  variables: CSSProperties;
  reduceMotion: boolean;
  keyboardNavigation: boolean;
}
interface Props extends DialogAppearance {
  title: string;
  description: string;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
}
export default function LauncherDialog({
  title,
  description,
  pending = false,
  theme,
  variables,
  reduceMotion,
  keyboardNavigation,
  onClose,
  children,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          style={variables}
        >
          <Dialog.Backdrop className="modal-backdrop" />
          <Dialog.Popup className="modal">
            <div className="modal-heading">
              <Dialog.Title className="modal-title">{title}</Dialog.Title>
              <button
                type="button"
                className="icon-button"
                aria-label={t('common.closeDialog')}
                disabled={pending}
                onClick={onClose}
              >
                <X size={19} />
              </button>
            </div>
            <Dialog.Description className="modal-description">{description}</Dialog.Description>
            {children}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
