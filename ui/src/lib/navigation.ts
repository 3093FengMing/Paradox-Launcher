import { Download, Home, Layers, UserRound, type LucideIcon } from 'lucide-react';
import type { Page } from '../types';

interface NavigationItem {
  id: Page;
  label: string;
  icon: LucideIcon;
}

export const navigation: NavigationItem[] = [
  { id: 'home', label: '开始游戏', icon: Home },
  { id: 'instances', label: '我的实例', icon: Layers },
  { id: 'downloads', label: '版本下载', icon: Download },
  { id: 'accounts', label: '账户管理', icon: UserRound },
];

export const pageNames: Record<Page, string> = {
  home: '概览',
  instances: '我的实例',
  downloads: '版本下载',
  accounts: '账户管理',
  settings: '启动器设置',
  logs: '运行日志',
};

export const pageDescriptions: Record<Page, string> = {
  home: '选择一个世界，开始今天的游戏。',
  instances: '独立配置，有序管理。为每个世界保留自己的空间。',
  downloads: '查找 Minecraft 版本，创建属于你的游戏实例。',
  accounts: '管理你的游戏身份，让下一次出发更简单。',
  settings: '从界面到游戏，把每一个细节调整为你喜欢的样子。',
  logs: '查看任务状态和游戏输出，快速定位启动问题。',
};
