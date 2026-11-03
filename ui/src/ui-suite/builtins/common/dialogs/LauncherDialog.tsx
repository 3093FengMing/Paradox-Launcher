import '../styles/common.css';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import { useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../lib/view';
import { Dialog } from '@paradox/ui';
import { X } from 'lucide-react';
export interface DialogAppearance {
  theme: 'light' | 'dark';
  variables: CSSProperties;
  reduceMotion: boolean;
  keyboardNavigation: boolean;
}
export interface Props {
  title: string;
  description: string;
  pending?: boolean;
  onClose: () => void;
  children?: ReactNode;
}
function LauncherDialog(
  input:
    | Props
    | {
        props?: Readonly<Record<string, unknown>>;
        children?: ReactNode;
      },
) {
  const snapshot = useLauncherSnapshot();
  const { theme, variables } = snapshot.appearance,
    reduceMotion = snapshot.appearance.value?.reduce_motion ?? false,
    keyboardNavigation = snapshot.appearance.personalization.shortcuts;
  const {
    title,
    description,
    pending = false,
    onClose,
    children,
  } = { ...viewProps<Props>(input), children: input.children ?? viewProps<Props>(input).children };
  const { t } = useTranslation();
  return (
    <Dialog.Root
      data-ui-modal-boundary
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      data-ui-site="LauncherDialog-1"
    >
      <Dialog.Portal data-ui-site="LauncherDialog-2">
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          style={variables}
          data-ui-site="LauncherDialog-3"
        >
          <Dialog.Backdrop className="modal-backdrop" data-ui-site="LauncherDialog-4" />
          <Dialog.Popup className="modal" data-ui-site="LauncherDialog-5">
            <div className="modal-heading" data-ui-site="LauncherDialog-6">
              <Dialog.Title className="modal-title" data-ui-site="LauncherDialog-7">
                {title}
              </Dialog.Title>
              <button
                type="button"
                className="icon-button"
                aria-label={t('common.closeDialog')}
                disabled={pending}
                onClick={onClose}
                data-ui-site="LauncherDialog-8"
              >
                <X size={19} data-ui-site="LauncherDialog-9" />
              </button>
            </div>
            <Dialog.Description className="modal-description" data-ui-site="LauncherDialog-10">
              {description}
            </Dialog.Description>
            {children}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export default LauncherDialog;
