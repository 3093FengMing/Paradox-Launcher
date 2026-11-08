import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const artifacts = resolve(import.meta.dirname, '../../.test-data/launcher-routes-browser/task-5');
await mkdir(artifacts, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
const production = process.env.PARADOX_TEST_NATIVE_CSP === '1';
const mode = production ? 'production-csp' : 'dev';
const report = {
  checks: [],
  cases: [],
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
};
const messages = Object.fromEntries(
  await Promise.all(
    ['zh-CN', 'en-US'].map(async (locale) => [
      locale,
      JSON.parse(await readFile(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')),
    ]),
  ),
);
const help = {
  id: 'custom.help',
  entry: 'help.tsx',
  title: 'Help from suite',
  description: 'Suite help description',
  navigation: true,
  startupSelectable: true,
  order: 8,
  icon: 'CircleHelp',
};
const hidden = {
  ...help,
  id: 'custom.hidden',
  title: 'Hidden custom page',
  navigation: false,
  startupSelectable: false,
  order: 9,
  icon: null,
};
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
const settled = () =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const confirmInitialChoice = async () => {
  const chooser = page.locator('[data-style-choice]');
  await page.locator('[data-style-choice], .page-heading').first().waitFor();
  if (await chooser.count()) {
    assert.equal(await chooser.locator('input[type="radio"]:checked').count(), 1);
    await chooser.locator('button[type="submit"]').click();
    await chooser.waitFor({ state: 'detached' });
  }
};
try {
  await confirmInitialChoice();
  if (!production)
    await page.evaluate(async () => {
      const entry = document.querySelector('script[type="module"][src*="/src/main.tsx"]');
      const { root } = await import(entry.src);
      const { installLauncherFixture } = await import('/src/ui-tests/launcher-view-fixture.tsx');
      installLauncherFixture(root);
    });
  await page.waitForFunction(() => typeof window.mountLauncherRouteFixture === 'function');
  await page.evaluate(() => {
    const native = window.__TAURI_INTERNALS__,
      invoke = native.invoke;
    window.routeTask = { holdConfig: false, held: [], holdSource: false, heldSource: [] };
    native.invoke = async (command, args) => {
      const value = await invoke(command, args);
      if (command === 'get_config' && window.routeTask.holdConfig)
        return new Promise((resolve) => window.routeTask.held.push(() => resolve(value)));
      if (command === 'get_ui_suite_library' && window.routeTask.holdSource)
        return new Promise((resolve) => window.routeTask.heldSource.push(() => resolve(value)));
      return value;
    };
  });
  await page.evaluate(async (custom) => {
    const controller = window.suiteFinalFixture.controller;
    await controller.whenInitialized();
    const selected = controller.getSnapshot().selectedSuiteId;
    if (selected?.startsWith('builtin.')) {
      await controller.actions.copyBuiltin(selected.slice('builtin.'.length), 'Route source fixture');
      if (controller.getSnapshot().selectedSuiteId === selected)
        throw Error(controller.getSnapshot().diagnostics.join('\n') || 'Actual route fixture source copy failed');
    }
    const draft = controller.getSnapshot().draft;
    if (!draft) throw Error('Actual route fixture source draft is missing');
    const views = { ...draft.manifest.views };
    for (const route of custom) {
      if (!controller.getSnapshot().draft.files[route.entry]) controller.actions.createFile(route.entry, 'tsx');
      controller.actions.patchFile(route.entry, 'export default function FixtureRoute(){return <section data-route-fixture="actual-source">Actual fixture custom route</section>}');
      views['page.' + route.id] = route.entry;
    }
    controller.actions.patchManifest({ views, routes: [...draft.manifest.routes, ...custom] });
    if (!await controller.actions.save()) throw Error(controller.getSnapshot().diagnostics.join('\n') || 'Actual route fixture source save failed');
    const prepared = controller.getActivation()?.primary.bundle.manifest.routes;
    if (!prepared) throw Error('Actual route fixture source activation is missing');
    window.routeTask.sourceRoutes = structuredClone(prepared);
  }, [help, hidden]);
  for (const [locale, width, order, strict] of [
    ['zh-CN', 1240, 'config-first', false],
    ['en-US', 1240, 'registry-first', false],
    ['zh-CN', 320, 'registry-first', true],
    ['en-US', 320, 'config-first', true],
  ]) {
    const text = (key) => key.split('.').reduce((value, part) => value[part], messages[locale]);
    await page.setViewportSize({ width, height: width === 320 ? 240 : 720 });
    await page.evaluate(
      ({ locale, strict }) => {
        window.foundationDesktop.config.settings.language = locale;
        window.foundationDesktop.config.settings.personalization.startup_page = 'custom.help';
        window.foundationDesktop.calls = [];
        window.routeTask.holdConfig = true;
        window.routeTask.held = [];
        window.routeTask.holdSource = true;
        window.routeTask.heldSource = [];
        window.mountLauncherRouteFixture(strict);
      },
      { locale, strict },
    );
    await page.waitForFunction(
      () => window.launcherFixture.setRoutes && window.routeTask.held.length > 0 && window.routeTask.heldSource.length > 0,
    );
    let before = await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation);
    assert.equal(before.requestedStartupRouteId, null);
    assert.equal(before.routesReady, false);
    const publish = (custom) =>
      page.evaluate((routes) => {
        window.routeTask.holdSource = false;
        window.routeTask.heldSource.splice(0).forEach((release) => release());
        return window.launcherFixture.setRoutes(routes);
      }, custom);
    const releaseConfig = () =>
      page.evaluate(() => {
        window.routeTask.holdConfig = false;
        window.routeTask.held.splice(0).forEach((release) => release());
      });
    if (order === 'config-first') {
      await releaseConfig();
      await page.waitForFunction(
        () =>
          window.launcherFixture.views.a.snapshot.navigation.requestedStartupRouteId ===
          'custom.help',
      );
      before = await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation);
      assert.equal(before.routeId, 'home');
      assert.equal(before.routesReady, false);
      await publish([help, hidden]);
    } else {
      await publish([help, hidden]);
      await page.waitForFunction(
        () => window.launcherFixture.views.a.snapshot.navigation.routesReady,
      );
      before = await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation);
      assert.equal(before.routeId, 'home');
      assert.equal(before.requestedStartupRouteId, null);
      await releaseConfig();
    }
    await page.waitForFunction(
      () => window.launcherFixture.views.a.snapshot.navigation.routeId === 'custom.help',
    );
    await page.locator('.page-heading h1').filter({ hasText: help.title }).waitFor();
    assert.equal(
      await page.locator('.sidebar .nav-item[aria-current="page"]').getAttribute('title'),
      help.title,
    );
    assert.equal(await page.locator('.page-heading p').innerText(), help.description);
    assert.equal(
      await page
        .locator('.sidebar')
        .getByRole('button', { name: hidden.title, exact: true })
        .count(),
      0,
    );
    assert.deepEqual(
      await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation),
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.navigation),
    );
    assert.equal(
      await page.evaluate(() =>
        Object.isFrozen(window.launcherFixture.views.a.snapshot.navigation.routes.at(-1)),
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.aliasRuntime.privateRouteContext),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        window.launcherFixture
          .targets()
          .some((x) =>
            /RouteContext|RouteHost|routeRegistry|BusinessHost|LauncherProvider/.test(x),
          ),
      ),
      false,
    );
    await page.evaluate(() => {
      window.routeTask.actions = window.launcherFixture.views.a.actions;
      window.routeTask.channel = window.launcherFixture.setRoutes;
      window.routeTask.actions.navigation.navigate('custom.help', {
        profileKey: 'original-instance',
      });
      window.routeTask.actions.navigation.setSearch('unfinished custom search');
    });
    await settled();
    assert.equal(
      await page.evaluate(
        () => window.launcherFixture.views.b.snapshot.navigation.params.profileKey,
      ),
      'original-instance',
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.foundationDesktop.calls.filter((x) =>
          ['catalog', 'list_content', 'save_config'].includes(x.command),
        ),
      ),
      [],
    );
    await page.evaluate(() => {
      window.routeTask.ownerCalls = window.foundationDesktop.calls.length;
    });
    await page.evaluate(() => window.launcherFixture.replaceApp());
    await page.locator('[data-app-replacement]').waitFor();
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.navigation.routeId),
      'custom.help',
    );
    assert.equal(
      await page.evaluate(
        () => window.launcherFixture.views.b.actions === window.routeTask.actions,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.setRoutes === window.routeTask.channel),
      true,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.foundationDesktop.calls
          .slice(window.routeTask.ownerCalls)
          .filter((x) =>
            ['get_config', 'account_state', 'plugin:event|listen'].includes(x.command),
          ),
      ),
      [],
    );
    await page.evaluate(() => window.launcherFixture.restore());
    await page.locator('.app-shell').waitFor();
    await publish([]);
    await page.waitForFunction(
      () => window.launcherFixture.views.a.snapshot.navigation.routeId === 'home',
    );
    assert.deepEqual(
      await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation.params),
      {},
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation.search),
      '',
    );
    await publish([help, hidden]);
    await settled();
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation.routeId),
      'home',
    );
    await publish([]);
    await page.evaluate(() => {
      const a = window.routeTask.actions;
      a.navigation.navigate('settings');
      a.settings.setTab('advanced');
      a.settings.patchPersonalization('font', 'serif');
    });
    const select = page.getByRole('combobox', {
      name: text('personalization.startupPage'),
      exact: true,
    });
    await page.evaluate(() => {
      const { snapshot, actions } = window.launcherFixture.views.a;
      snapshot.notifications.items.forEach((notice) => actions.notifications.dismiss(notice.id));
    });
    await select.waitFor();
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('.settings-personalization [role="combobox"]')
          ?.textContent.includes(expected),
      text('personalization.startupUnavailable'),
    );
    assert.equal(
      await select.locator('.ui-select-value').innerText(),
      `custom.help (${text('personalization.startupUnavailable')})`,
    );
    await select.scrollIntoViewIfNeeded();
    await select.click();
    await page.getByRole('listbox').waitFor();
    assert.equal(
      await page.getByRole('option', { name: /custom.help|Help from suite/ }).count(),
      0,
    );
    await page.keyboard.press('Escape');
    await publish([help, hidden]);
    await settled();
    assert.equal(await select.locator('.ui-select-value').innerText(), help.title);
    await select.click();
    const list = page.getByRole('listbox');
    await list.waitFor();
    assert.equal(await list.getByRole('option', { name: hidden.title, exact: true }).count(), 0);
    await settled();
    const bounds = await page.locator('.ui-select-popup').boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
    assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= (width === 320 ? 240 : 720) + 1);
    await page.screenshot({
      path: resolve(artifacts, `${mode}-${locale}-${width}-startup-options.png`),
    });
    await list.getByRole('option', { name: help.title, exact: true }).click();
    await settled();
    assert.equal(
      await page.evaluate(
        () => window.launcherFixture.views.a.snapshot.settings.draft.personalization.font,
      ),
      'serif',
    );
    assert.equal(
      await page.evaluate(
        () => window.foundationDesktop.config.settings.personalization.startup_page,
      ),
      'custom.help',
    );
    assert.equal(
      await page.evaluate(
        () => window.foundationDesktop.calls.filter((x) => x.command === 'save_config').length,
      ),
      0,
    );
    await page.evaluate(async () => {
      const a = window.routeTask.actions;
      a.settings.setStartupRoute('logs');
      await a.settings.save();
      await a.config.reload();
    });
    await settled();
    assert.equal(
      await page.evaluate(
        () => window.launcherFixture.views.b.snapshot.navigation.requestedStartupRouteId,
      ),
      'custom.help',
    );
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.b.snapshot.navigation.routeId),
      'settings',
    );
    assert.equal(
      await page.evaluate(
        () => window.foundationDesktop.calls.filter((x) => x.command === 'save_config').length,
      ),
      1,
    );
    if (width === 320) {
      const trigger = page.locator('.mobile-navigation').getByRole('button', {
        name: text('responsiveUi.navigation'),
        exact: true,
      });
      await trigger.click();
      const item = page.getByRole('menuitem', { name: help.title, exact: true });
      await item.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
    } else {
      await page.locator('.sidebar').getByRole('button', { name: help.title, exact: true }).click();
    }
    await page.locator('.page-heading h1').filter({ hasText: help.title }).waitFor();
    assert.equal(
      await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation.routeId),
      'custom.help',
    );
    report.cases.push({
      locale,
      width,
      order,
      strict,
      before,
      bounds,
      final: await page.evaluate(() => window.launcherFixture.views.a.snapshot.navigation),
    });
    pass(
      `route_startup_descriptor_consumers_once_no_repairwrite:${locale}:${width}:${order}:${strict}`,
    );
  }
  assert.deepEqual(report.errors, []);
  if (production) {
    assert.ok(report.csp);
    assert.deepEqual(report.sourceRequests, []);
  }
} catch (error) {
  report.failure = error.stack;
  report.failureState = await page.evaluate(() => ({
    navigation: window.launcherFixture?.views.a?.snapshot.navigation,
    config: window.launcherFixture?.views.a?.snapshot.config,
    editor: window.suiteFinalFixture?.controller.getSnapshot(),
    activationRoutes: window.suiteFinalFixture?.controller.getActivation()?.primary.bundle.manifest.routes,
    heldConfig: window.routeTask?.held.length,
    heldSource: window.routeTask?.heldSource.length,
    liveHeading: [...document.querySelectorAll('.page-heading')].map((element) => ({ text: element.textContent, visible: element.getBoundingClientRect().width > 0 })),
  })).catch((snapshotError) => ({ error: String(snapshotError) }));
  await page.screenshot({ path: resolve(artifacts, `${mode}-failure.png`) });
  await writeFile(
    resolve(artifacts, `${mode}-failure-body.txt`),
    await page.locator('body').innerText(),
  );
  throw error;
} finally {
  await writeFile(resolve(artifacts, `report-${mode}.json`), JSON.stringify(report, null, 2));
  await fixture.close();
}
