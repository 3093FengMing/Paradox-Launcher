// Compound objects intentionally expose Base UI's parts as a single public API.
/* eslint-disable react-refresh/only-export-components */
import { createElement, useCallback, useState } from 'react';
import type { ComponentPropsWithRef, CSSProperties, ElementType } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { DialogRootProps } from '@base-ui/react/dialog';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import {
  foundationStyle,
  UiFoundationProvider,
  useUiFoundation,
  useOverlayLayer,
} from './environment';

// Keep Base UI's refs, render callbacks, state callbacks and focus API intact.
function themedPart<T extends ElementType>(Part: T, baseClass: string) {
  return function ThemedPart(props: ComponentPropsWithRef<T>) {
    const environment = useUiFoundation();
    const variables = foundationStyle(environment.variables);
    const { className, style, ...rest } = props as {
      className?: string | ((state: never) => string | undefined);
      style?: CSSProperties | ((state: never) => CSSProperties | undefined);
    };
    return createElement(Part, {
      ...rest,
      'data-ui-dom-boundary': true,
      'data-theme': environment.theme,
      'data-ui-theme': environment.theme,
      className:
        typeof className === 'function'
          ? (state: never) => `${baseClass} ${className(state) ?? ''}`
          : `${baseClass} ${className ?? ''}`,
      style:
        typeof style === 'function'
          ? (state: never) => ({ ...variables, ...style(state) })
          : { ...variables, ...style },
    });
  };
}
function portal<T extends ElementType>(Part: T) {
  return function ThemedPortal(props: ComponentPropsWithRef<T>) {
    const environment = useUiFoundation();
    const { container } = props as { container?: HTMLElement | ShadowRoot | null };
    return createElement(Part, {
      ...props,
      container: container === undefined ? environment.portalContainer : container,
    });
  };
}

function DialogRoot<Payload>(props: DialogRootProps<Payload>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? false);
  const open = props.open ?? uncontrolledOpen;
  const layer = useOverlayLayer('dialog', open);
  return (
    <BaseDialog.Root
      {...props}
      data-ui-modal-boundary
      modal={open && !layer.modalActive ? false : props.modal}
      onOpenChange={(next, details) => {
        if (
          !next &&
          (((details.reason === 'outside-press' || details.reason === 'focus-out') &&
            !layer.topmost) ||
            (details.reason === 'escape-key' && !layer.ownsDismissal(details.event)))
        ) {
          details.cancel();
          return;
        }
        props.onOpenChange?.(next, details);
        if (!details.isCanceled) setUncontrolledOpen(next);
      }}
    />
  );
}
const ThemedDialogPortal = themedPart(BaseDialog.Portal, 'ui-dialog-portal');
function DialogPortal({
  children,
  ref,
  container,
  ...props
}: ComponentPropsWithRef<typeof BaseDialog.Portal>) {
  const environment = useUiFoundation();
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
  const portalRef = useCallback(
    (element: HTMLDivElement | null) => {
      setPortalElement(element);
      if (typeof ref === 'function') return ref(element);
      if (ref) ref.current = element;
    },
    [ref],
  );
  return (
    <ThemedDialogPortal
      {...props}
      ref={portalRef}
      container={container === undefined ? environment.portalContainer : container}
    >
      <UiFoundationProvider
        value={{ ...environment, portalContainer: portalElement ?? environment.portalContainer }}
      >
        {children}
      </UiFoundationProvider>
    </ThemedDialogPortal>
  );
}
export const Dialog = {
  ...BaseDialog,
  Root: DialogRoot,
  Portal: DialogPortal,
  Popup: themedPart(BaseDialog.Popup, 'ui-dialog-popup'),
  Backdrop: themedPart(BaseDialog.Backdrop, 'ui-dialog-backdrop'),
};
export const Menu = {
  ...BaseMenu,
  Portal: portal(BaseMenu.Portal),
  Positioner: themedPart(BaseMenu.Positioner, 'ui-menu-positioner'),
  Popup: themedPart(BaseMenu.Popup, 'ui-menu-popup'),
  Item: themedPart(BaseMenu.Item, 'ui-menu-item'),
};
export const Tabs = {
  ...BaseTabs,
  Root: themedPart(BaseTabs.Root, 'ui-tabs'),
  List: themedPart(BaseTabs.List, 'ui-tabs-list'),
  Tab: themedPart(BaseTabs.Tab, 'ui-tab'),
  Panel: themedPart(BaseTabs.Panel, 'ui-tab-panel'),
};
export const Tooltip = {
  ...BaseTooltip,
  Portal: portal(BaseTooltip.Portal),
  Positioner: themedPart(BaseTooltip.Positioner, 'ui-tooltip-positioner'),
  Popup: themedPart(BaseTooltip.Popup, 'ui-tooltip-popup'),
};
