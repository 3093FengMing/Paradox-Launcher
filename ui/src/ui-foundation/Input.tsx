import type { ComponentPropsWithRef } from 'react';
import { foundationControl } from './environment';
import { useFieldAssociation } from './Field';

export type UiInputProps = ComponentPropsWithRef<'input'>;
export type UiTextAreaProps = ComponentPropsWithRef<'textarea'>;
function DefaultInput({ className = '', ...props }: UiInputProps) {
  const field = useFieldAssociation();
  return (
    <input
      {...props}
      className={`ui-input ${className}`}
      aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
      aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
    />
  );
}
function DefaultTextArea({ className = '', ...props }: UiTextAreaProps) {
  const field = useFieldAssociation();
  return (
    <textarea
      {...props}
      className={`ui-textarea ${className}`}
      aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
      aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
    />
  );
}
export const Input = foundationControl('control.input', DefaultInput);
export const TextArea = foundationControl('control.textarea', DefaultTextArea);
