import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import { Dialog } from './ui';
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
function LauncherDialog({
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
      data-ui-modal-boundary
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          data-ui-root
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

const CustomizedLauncherDialog = customComponent('component.launcher-dialog', LauncherDialog);
export default CustomizedLauncherDialog;
