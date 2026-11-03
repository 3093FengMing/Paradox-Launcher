import type { Page } from '../types';
import { validateRouteRegistry, type UiRouteDescriptor } from '../ui-suite/routes';
export { routeIcon } from '../ui-suite/routes';

export const pageNames: Record<Page, string> = {
  home: 'pages.home.title',
  instances: 'pages.instances.title',
  downloads: 'pages.downloads.title',
  accounts: 'pages.accounts.title',
  settings: 'pages.settings.title',
  logs: 'pages.logs.title',
  content: 'content.title',
};

export const pageDescriptions: Record<Page, string> = {
  home: 'pages.home.description',
  instances: 'pages.instances.description',
  downloads: 'pages.downloads.description',
  accounts: 'pages.accounts.description',
  settings: 'pages.settings.description',
  logs: 'pages.logs.description',
  content: 'content.description',
};

export const builtinRoutes: readonly UiRouteDescriptor[] = validateRouteRegistry(
  (['home', 'instances', 'downloads', 'content', 'accounts', 'settings', 'logs'] as const).map(
    (id, order) => ({
      id,
      entry: (
        {
          home: 'components/HomePage.tsx',
          instances: 'pages/InstancesPage.tsx',
          downloads: 'pages/DownloadsPage.tsx',
          content: 'pages/ContentPage.tsx',
          accounts: 'pages/AccountsPage.tsx',
          settings: 'pages/SettingsPage.tsx',
          logs: 'pages/LogsPage.tsx',
        } as const
      )[id],
      title: pageNames[id],
      description: pageDescriptions[id],
      navigation: true,
      startupSelectable: true,
      order,
      icon: (
        {
          home: 'Home',
          instances: 'Layers',
          downloads: 'Download',
          content: 'Package',
          accounts: 'UserRound',
          settings: 'Settings2',
          logs: 'Terminal',
        } as const
      )[id],
    }),
  ),
);
