// Builtin navigation follows the approved fold layout: Immersive exposes the
// global routes in its title bar; Modern keeps the global vertical rail.
export function globalRouteControl(page, suite, routeId, label) {
  if (suite === 'immersive') return page.locator('.window-navigation').getByRole('button', { name: label, exact: true });
  if (routeId === 'accounts') return page.locator('.sidebar-account');
  return page.locator('.sidebar').getByRole('button', { name: label, exact: true });
}

export function renderedRouteLabelSelector(suite, routeId) {
  if (suite === 'modern' || routeId === 'custom.instance-details') return '.mobile-navigation-label';
  return '.window-navigation .window-route[aria-current="page"] [data-ui-site$=":WindowBar-route-label"]';
}
