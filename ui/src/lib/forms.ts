import type { Settings } from '../types';

export type SettingsTab = 'appearance' | 'game' | 'advanced';
export type PatchSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export interface ProfileEditor {
  name: string;
  version: string;
  editKey?: string;
}

const absolutePath = /^([A-Za-z]:[\\/]|\/)/;

export function validateUsername(username: string): void {
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
    throw new Error('离线用户名应为 3–16 位英文字母、数字或下划线');
}

export function validateProfileName(name: string): void {
  if (!name.trim() || Array.from(name.trim()).length > 64)
    throw new Error('实例名称应为 1–64 个字符');
}

export function validateSettings(settings: Settings): void {
  validateUsername(settings.offline_username);
  const numbers = [
    settings.memory_mb,
    settings.minimum_memory_mb,
    settings.resolution_width,
    settings.resolution_height,
  ];
  if (numbers.some((value) => !Number.isInteger(value)))
    throw new Error('内存和分辨率应为有效整数');
  if (
    settings.memory_mb < 512 ||
    settings.memory_mb > 32768 ||
    settings.minimum_memory_mb < 256 ||
    settings.minimum_memory_mb > settings.memory_mb
  )
    throw new Error('请检查最小和最大内存范围');
  if (!absolutePath.test(settings.game_directory)) throw new Error('游戏目录必须是绝对路径');
  if (settings.java_executable.trim() && !absolutePath.test(settings.java_executable.trim()))
    throw new Error('Java 路径必须是绝对路径');
  if (
    settings.resolution_width < 640 ||
    settings.resolution_width > 7680 ||
    settings.resolution_height < 480 ||
    settings.resolution_height > 4320
  )
    throw new Error('游戏窗口分辨率超出支持范围');
}
