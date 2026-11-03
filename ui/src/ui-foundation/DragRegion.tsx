/** @jsxImportSource react */
import type React from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { startNativeWindowDrag } from '../ui-runtime/window';

const interactiveRoles = new Set([
  'button',
  'checkbox',
  'combobox',
  'grid',
  'gridcell',
  'link',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treegrid',
  'treeitem',
]);

function eventPath(event: React.MouseEvent<HTMLDivElement>): Element[] | null {
  const path = event.nativeEvent.composedPath();
  const boundary = path.indexOf(event.currentTarget);
  if (boundary < 0) return null;
  const elements = path
    .slice(0, boundary + 1)
    .filter((node): node is Element => node instanceof Element);
  if (
    elements.some(
      (element) =>
        element.matches(
          'button,input,select,textarea,a,summary,label,[tabindex]:not([tabindex="-1"])',
        ) ||
        (element instanceof HTMLElement && element.isContentEditable) ||
        element
          .getAttribute('role')
          ?.split(/\s+/)
          .some((role) => interactiveRoles.has(role)),
    )
  )
    return null;
  return elements;
}

function hasSelection(element: HTMLElement): boolean {
  const root = element.getRootNode() as
    Document | (ShadowRoot & { getSelection?: () => Selection | null });
  let focused = root.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  // Input/textarea selections are not necessarily exposed as DOM Selection ranges.
  if (
    (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) &&
    focused.selectionStart !== null &&
    focused.selectionEnd !== null &&
    focused.selectionStart !== focused.selectionEnd
  )
    return true;
  // Chromium exposes ShadowRoot.getSelection; other engines use the document selection.
  return [root.getSelection?.(), element.ownerDocument.getSelection()].some(
    (selection) => selection && !selection.isCollapsed && selection.toString().length > 0,
  );
}

function hitsSelectableText(event: React.MouseEvent<HTMLDivElement>, origin: Element): boolean {
  const document = origin.ownerDocument;
  const walker = document.createTreeWalker(origin, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      !node.textContent?.trim() ||
      !node.parentElement ||
      document.defaultView?.getComputedStyle(node.parentElement).userSelect === 'none'
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if (
      [...range.getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    )
      return true;
  }
  return false;
}

function permitsWindowGesture(event: React.MouseEvent<HTMLDivElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  const path = eventPath(event);
  if (!path?.length) return false;
  if (hasSelection(event.currentTarget)) {
    // Preserve an existing selection when pressing blank title space.
    if (!hitsSelectableText(event, path[0])) event.preventDefault();
    return false;
  }
  return !hitsSelectableText(event, path[0]);
}

export function DragRegion({
  onMouseDown,
  onDoubleClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      {...props}
      onMouseDown={(event) => {
        onMouseDown?.(event);
        if (!permitsWindowGesture(event) || event.detail > 1) return;
        void startNativeWindowDrag().catch((error: unknown) =>
          console.error('Window drag failed', error),
        );
      }}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        if (!permitsWindowGesture(event) || !isTauri()) return;
        // Replaces the native drag-attribute listener's deliberate double-click maximize.
        void getCurrentWindow()
          .toggleMaximize()
          .catch((error: unknown) => console.error('Window maximize failed', error));
      }}
    />
  );
}
