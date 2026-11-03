import { useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import {
  foundationControl,
  foundationStyle,
  useUiFoundation,
  useOverlayLayer,
} from './environment';
import { useFieldAssociation } from './Field';

export interface UiSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
export interface UiSelectProps {
  value: string;
  options: readonly UiSelectOption[];
  onValueChange(value: string): void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  ref?: Ref<HTMLButtonElement>;
}
function DefaultSelect(props: UiSelectProps): React.JSX.Element {
  const environment = useUiFoundation();
  const field = useFieldAssociation();
  const selected = props.options.find((option) => option.value === props.value);
  const [open, setOpen] = useState(false);
  // Disabling is a stored close, so restoring availability waits for a new action.
  if (props.disabled && open) setOpen(false);
  const layer = useOverlayLayer('select', open && !props.disabled);
  const { ref: forwardedRef } = props;
  const trigger = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useCallback(
    (element: HTMLButtonElement | null) => {
      trigger.current = element;
      if (typeof forwardedRef === 'function') return forwardedRef(element);
      if (forwardedRef) forwardedRef.current = element;
    },
    [forwardedRef],
  );
  const popupStyle = foundationStyle(environment.variables);
  if (open && trigger.current) {
    popupStyle.fontSize = trigger.current.ownerDocument.defaultView?.getComputedStyle(
      trigger.current,
    ).fontSize;
  }
  return (
    <BaseSelect.Root<string>
      value={props.value}
      open={open && !props.disabled}
      onOpenChange={(next, details) => {
        if (!next && details.reason === 'escape-key' && !layer.ownsDismissal(details.event)) {
          details.cancel();
          return;
        }
        setOpen(next && !props.disabled);
      }}
      items={props.options}
      onValueChange={(value) => {
        if (value !== null && !props.disabled) props.onValueChange(value);
      }}
      name={props.name}
      id={props.id}
      disabled={props.disabled}
      required={props.required}
    >
      <BaseSelect.Trigger
        ref={triggerRef}
        className={`ui-select-trigger ${props.className ?? ''}`}
        data-ui-theme={environment.theme}
        style={foundationStyle(environment.variables, false)}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
        aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
      >
        <BaseSelect.Value className="ui-select-value">
          {selected ? selected.label : props.placeholder}
        </BaseSelect.Value>
        <BaseSelect.Icon className="ui-select-icon" aria-hidden="true">
          ▾
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={environment.portalContainer}>
        <BaseSelect.Positioner
          className="ui-select-positioner"
          data-ui-theme={environment.theme}
          style={popupStyle}
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="ui-select-popup">
            <BaseSelect.List className="ui-select-list">
              {props.options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="ui-select-option"
                >
                  <BaseSelect.ItemIndicator className="ui-select-indicator" aria-hidden="true">
                    ✓
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
export const Select = foundationControl('control.select', DefaultSelect);
