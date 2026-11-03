import type { Personalization } from '../types';

type ShortcutEvent = Pick<
  KeyboardEvent,
  | 'key'
  | 'ctrlKey'
  | 'shiftKey'
  | 'altKey'
  | 'metaKey'
  | 'repeat'
  | 'isComposing'
  | 'defaultPrevented'
>;

export function matchesLaunchShortcut(
  event: ShortcutEvent,
  shortcut: Personalization['launch_shortcut'],
): boolean {
  if (event.repeat || event.isComposing || event.defaultPrevented || event.metaKey) return false;
  if (shortcut === 'Ctrl+Shift+L')
    return event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l';
  if (shortcut === 'Alt+Enter')
    return event.altKey && !event.ctrlKey && !event.shiftKey && event.key === 'Enter';
  return event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'Enter';
}

export function isShortcutInput(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"], [role="listbox"]',
    )
  );
}
