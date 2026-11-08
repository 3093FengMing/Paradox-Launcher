import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Dialog } from '@paradox/ui';
import { useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import '../styles/business-dialogs.css';
import '../styles/responsive.css';

type PopupProps = ComponentPropsWithRef<typeof Dialog.Popup>;
export interface Props {
  title: string;
  description: string;
  pending?: boolean;
  children?: ReactNode;
  onClose: () => void;
  initialFocus?: PopupProps['initialFocus'];
  finalFocus?: PopupProps['finalFocus'];
  popupRef?: PopupProps['ref'];
  popupProps?: PopupProps;
  portalProps?: ComponentPropsWithRef<typeof Dialog.Portal>;
  rootProps?: Omit<ComponentPropsWithRef<typeof Dialog.Root>, 'children' | 'open'>;
}
export default function LauncherDialog(input: Props | { props?: Readonly<Record<string, unknown>>; children?: ReactNode }) {
  const props = viewProps<Props>(input);
  const { title, description, pending = false, onClose, initialFocus, finalFocus, popupRef, popupProps, portalProps, rootProps } = props;
  const children = input.children ?? props.children;
  const s = useLauncherSnapshot(), { t } = useTranslation();
  const extraClass = popupProps?.className;
  const className: PopupProps['className'] = typeof extraClass === 'function'
    ? state => `modal modern-business-dialog ${extraClass(state) ?? ''}`
    : `modal modern-business-dialog ${extraClass ?? ''}`;
  return <Dialog.Root {...rootProps} open data-ui-modal-boundary data-ui-site="ModernLauncherDialog-root"
    onOpenChange={(open, details) => {
      if (!open && pending) { details.cancel(); return; }
      rootProps?.onOpenChange?.(open, details);
      if (!open && !details.isCanceled) onClose();
    }}>
    <Dialog.Portal {...portalProps} data-ui-site="ModernLauncherDialog-portal">
      <div className={`dialog-theme modern-dialog-theme ${s.appearance.value?.reduce_motion ? 'reduce-motion' : ''} ${s.appearance.personalization.shortcuts ? 'keyboard-navigation' : ''}`} data-theme={s.appearance.theme} style={s.appearance.variables} data-ui-site="ModernLauncherDialog-theme">
        <Dialog.Backdrop className="modal-backdrop" data-ui-site="ModernLauncherDialog-backdrop"/>
        <Dialog.Popup {...popupProps} className={className} ref={popupRef ?? popupProps?.ref}
          initialFocus={initialFocus ?? popupProps?.initialFocus} finalFocus={finalFocus ?? popupProps?.finalFocus} data-ui-site="ModernLauncherDialog-popup">
          <header className="business-dialog-heading" data-ui-site="ModernLauncherDialog-heading">
            <Dialog.Title className="modal-title" data-ui-site="ModernLauncherDialog-title">{title}</Dialog.Title>
            <button type="button" className="icon-button" aria-label={t('common.closeDialog')} disabled={pending} onClick={() => { if (!pending) onClose(); }} data-ui-site="ModernLauncherDialog-close"><X size={19} aria-hidden="true" data-ui-site="ModernLauncherDialog-close-icon"/></button>
          </header>
          <Dialog.Description className="modal-description" data-ui-site="ModernLauncherDialog-description">{description}</Dialog.Description>
          <div className="business-dialog-content" data-ui-site="ModernLauncherDialog-content">{children}</div>
        </Dialog.Popup>
      </div>
    </Dialog.Portal>
  </Dialog.Root>;
}
