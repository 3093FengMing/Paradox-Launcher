import { readFile } from 'node:fs/promises';

const localeCache = new Map();
const downloadSites = { 'custom.versions': 'versions', content: 'content', downloads: 'tasks' };

export function globalNavigationTrigger(page, suite) {
  return page.locator(`[data-ui-site$=":${suite === 'immersive' ? 'WindowBar-menu-trigger' : 'ModernSidebarMenu-trigger'}"]:visible`);
}

// This is a locator only. Use prepareGlobalRouteControl before interacting with
// a route that may live in the real More/Navigation menu or download group.
export function globalRouteControl(page, suite, routeId, label) {
  if (routeId === 'accounts') {
    return page.locator(suite === 'immersive' ? 'button.immersive-account-link' : 'button.home-account');
  }
  if (routeId === 'content' || routeId === 'downloads') {
    return page.locator(`.download-navigation [data-ui-site$=":DownloadNavigation-${downloadSites[routeId]}"]`);
  }
  const itemSite = suite === 'immersive' ? 'WindowBar-menu-route' : 'ModernSidebarMenu-route';
  const menuItem = page.getByRole('menuitem', { name: label, exact: true })
    .and(page.locator(`[data-ui-site$=":${itemSite}"]:visible`));
  const direct = suite === 'immersive'
    ? page.locator('.window-navigation:visible').getByRole('button', { name: label, exact: true })
    : page.locator('.sidebar:visible').getByRole('button', { name: label, exact: true });
  return direct.or(menuItem);
}

async function publicRouteLabel(page, routeId) {
  const { language, title } = await page.evaluate(id => ({
    language: document.documentElement.lang,
    title: window.suiteBuiltinsFixture.snapshot.navigation.routes.find(route => route.id === id)?.title,
  }), routeId);
  if (!title) throw Error('Requested public route is not registered: ' + routeId);
  if (!localeCache.has(language)) {
    localeCache.set(language, JSON.parse(await readFile(new URL(`../../src/locales/${language}.json`, import.meta.url), 'utf8')));
  }
  return title.split('.').reduce((value, part) => value?.[part], localeCache.get(language)) ?? title;
}

export async function prepareGlobalRouteControl(page, suite, routeId, label) {
  if (routeId === 'accounts') {
    const account = globalRouteControl(page, suite, routeId, label);
    if (!await account.isVisible()) {
      const home = await prepareGlobalRouteControl(page, suite, 'home', await publicRouteLabel(page, 'home'));
      await home.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'home');
      await account.waitFor({ state: 'visible' });
    }
    return account;
  }
  if (routeId === 'content' || routeId === 'downloads') {
    const group = page.locator('.download-navigation');
    if (!await group.isVisible()) {
      const entry = await prepareGlobalRouteControl(page, suite, 'custom.versions', await publicRouteLabel(page, 'custom.versions'));
      await entry.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.navigation.routeId === 'custom.versions');
      await group.waitFor({ state: 'visible' });
    }
    return globalRouteControl(page, suite, routeId, label);
  }
  const control = globalRouteControl(page, suite, routeId, label);
  if (await control.isVisible()) return control;
  const trigger = globalNavigationTrigger(page, suite);
  const popup = page.locator(`[data-ui-site$=":${suite === 'immersive' ? 'WindowBar-menu-popup' : 'ModernSidebarMenu-popup'}"]`);
  if (!await popup.isVisible()) {
    await trigger.focus();
    await page.keyboard.press('Enter');
    await popup.waitFor({ state: 'visible' });
  }
  await control.waitFor({ state: 'visible' });
  return control;
}

export async function globalRouteFocusReturn(page, suite, control) {
  return await control.getAttribute('role') === 'menuitem' ? globalNavigationTrigger(page, suite) : control;
}

export function renderedRouteLabelSelector(suite, routeId) {
  if (suite === 'modern' || routeId === 'custom.instance-details') return '.mobile-navigation-label';
  if (routeId === 'home') return '.immersive-home';
  return '.workspace > main > .page-heading h1';
}

export function renderedRouteLabelAttribute(suite, routeId) {
  return suite === 'immersive' && routeId === 'home' ? 'aria-label' : null;
}

export function renderedRouteTitleKey(routeId, originalTitleKey) {
  return Object.hasOwn(downloadSites, routeId) ? 'nav.downloadCenter' : originalTitleKey;
}
