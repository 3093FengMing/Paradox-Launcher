import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export async function startNativeWindowDrag(): Promise<void> {
  if (!isTauri()) return;
  await getCurrentWindow().startDragging();
}
export async function minimizeNativeWindow(): Promise<void> {
  if (isTauri()) await getCurrentWindow().minimize();
}
export async function maximizeNativeWindow(): Promise<void> {
  if (isTauri()) await getCurrentWindow().toggleMaximize();
}
export async function requestNativeWindowClose(): Promise<void> {
  if (isTauri()) await getCurrentWindow().close();
}
