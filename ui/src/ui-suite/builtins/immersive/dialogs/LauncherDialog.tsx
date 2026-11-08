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
  onClose: () => void;
  children?: ReactNode;
  initialFocus?: PopupProps['initialFocus'];
  finalFocus?: PopupProps['finalFocus'];
  popupRef?: PopupProps['ref'];
  popupProps?: PopupProps;
  portalProps?: ComponentPropsWithRef<typeof Dialog.Portal>;
  rootProps?: Omit<ComponentPropsWithRef<typeof Dialog.Root>, 'open' | 'children'>;
}
export default function LauncherDialog(input: Props | { props?: Readonly<Record<string, unknown>>; children?: ReactNode }) {
  const p = viewProps<Props>(input), s = useLauncherSnapshot(), { t } = useTranslation();
  const pending = p.pending ?? false, extraClass = p.popupProps?.className;
  const popupClass: PopupProps['className'] = typeof extraClass === 'function'
    ? state => `modal immersive-business-dialog ${extraClass(state) ?? ''}`
    : `modal immersive-business-dialog ${extraClass ?? ''}`;
  return <Dialog.Root {...p.rootProps} open data-ui-modal-boundary data-ui-site="ImmersiveLauncherDialog-root"
    onOpenChange={(next, details) => {
      if (!next && pending) { details.cancel(); return; }
      p.rootProps?.onOpenChange?.(next, details);
      if (!next && !details.isCanceled) p.onClose();
    }}>
    <Dialog.Portal {...p.portalProps} data-ui-site="ImmersiveLauncherDialog-portal">
      <div className={`dialog-theme immersive-dialog-theme ${s.appearance.value?.reduce_motion ? 'reduce-motion' : ''} ${s.appearance.personalization.shortcuts ? 'keyboard-navigation' : ''}`} style={s.appearance.variables} data-theme={s.appearance.theme} data-ui-site="ImmersiveLauncherDialog-theme">
        <Dialog.Backdrop className="modal-backdrop" data-ui-site="ImmersiveLauncherDialog-backdrop"/>
        <Dialog.Popup {...p.popupProps} ref={p.popupRef ?? p.popupProps?.ref} className={popupClass}
          initialFocus={p.initialFocus ?? p.popupProps?.initialFocus} finalFocus={p.finalFocus ?? p.popupProps?.finalFocus} data-ui-site="ImmersiveLauncherDialog-popup">
          <header className="business-dialog-heading" data-ui-site="ImmersiveLauncherDialog-heading">
            <div className="business-dialog-heading-copy" data-ui-site="ImmersiveLauncherDialog-heading-copy">
              <Dialog.Title className="modal-title" data-ui-site="ImmersiveLauncherDialog-title">{p.title}</Dialog.Title>
              <Dialog.Description className="modal-description" data-ui-site="ImmersiveLauncherDialog-description">{p.description}</Dialog.Description>
            </div>
            <button type="button" className="icon-button" aria-label={t('common.closeDialog')} disabled={pending} onClick={() => { if (!pending) p.onClose(); }} data-ui-site="ImmersiveLauncherDialog-close"><X size={19} aria-hidden="true" data-ui-site="ImmersiveLauncherDialog-close-icon"/></button>
          </header>
          <div className="business-dialog-content" data-ui-site="ImmersiveLauncherDialog-content">{input.children ?? p.children}</div>
        </Dialog.Popup>
      </div>
    </Dialog.Portal>
  </Dialog.Root>;
}
