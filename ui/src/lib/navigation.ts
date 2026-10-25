import { Download, Home, Layers, UserRound, type LucideIcon } from 'lucide-react';
import type { Page } from '../types';

interface NavigationItem {
  id: Page;
  label: string;
  icon: LucideIcon;
}

export const navigation: NavigationItem[] = [
  { id: 'home', label: 'nav.home', icon: Home },
  { id: 'instances', label: 'nav.instances', icon: Layers },
  { id: 'downloads', label: 'nav.downloads', icon: Download },
  { id: 'accounts', label: 'nav.accounts', icon: UserRound },
];

export const pageNames: Record<Page, string> = {
  home: 'pages.home.title',
  instances: 'pages.instances.title',
  downloads: 'pages.downloads.title',
  accounts: 'pages.accounts.title',
  settings: 'pages.settings.title',
  logs: 'pages.logs.title',
};

export const pageDescriptions: Record<Page, string> = {
  home: 'pages.home.description',
  instances: 'pages.instances.description',
  downloads: 'pages.downloads.description',
  accounts: 'pages.accounts.description',
  settings: 'pages.settings.description',
  logs: 'pages.logs.description',
};
