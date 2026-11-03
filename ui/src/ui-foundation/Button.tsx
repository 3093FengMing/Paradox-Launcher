import type { ComponentPropsWithRef } from 'react';
import { foundationControl } from './environment';

export type UiButtonProps = ComponentPropsWithRef<'button'>;
function DefaultButton({ className = '', type = 'button', ...props }: UiButtonProps) {
  return <button {...props} type={type} className={`ui-button ${className}`} />;
}
function DefaultIconButton({ className = '', type = 'button', ...props }: UiButtonProps) {
  return <button {...props} type={type} className={`ui-button icon-button ${className}`} />;
}
export const Button = foundationControl('control.button', DefaultButton);
export const IconButton = foundationControl('control.icon-button', DefaultIconButton);
