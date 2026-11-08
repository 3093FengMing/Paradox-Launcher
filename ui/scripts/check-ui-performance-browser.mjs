import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, relative } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

// Ordinary production entry only: no test build, fixture installers or application edits.
// Optional environment: PARADOX_UI_DIST, PARADOX_PERFORMANCE_LABEL,
// PARADOX_PERFORMANCE_RUNS, PARADOX_UI_REDESIGN_EVIDENCE,
// PARADOX_PLAYWRIGHT_MODULE, PARADOX_BROWSER_EXECUTABLE.
const root = resolve(import.meta.dirname, '../..');
const locale = JSON.parse(await readFile(resolve(root, 'ui/src/locales/zh-CN.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'ui/src/ui-suite/builtins/modern/suite.json'), 'utf8'));
const routeLabels = Object.fromEntries(manifest.routes.map(route => [route.id, route.title.split('.').reduce((value, part) => value?.[part], locale) || route.title]));
const dist = resolve(process.env.PARADOX_UI_DIST || resolve(root, 'ui/dist'));
const label = process.env.PARADOX_PERFORMANCE_LABEL || 'baseline';
assert.match(label, /^[a-zA-Z0-9_-]+$/);
const count = Number(process.env.PARADOX_PERFORMANCE_RUNS || 3);
assert.ok(Number.isInteger(count) && count >= 3 && count <= 20);
const out = resolve(process.env.PARADOX_UI_REDESIGN_EVIDENCE || resolve(root, '.test-data/ui-redesign'), 'production', label);
await mkdir(out, { recursive: true });
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
assert.ok(!/foundation-test|ui-tests|\/src\/main/.test(html));
const fixturePattern = /suiteBuiltinsFixture|suiteFinalFixture|mount(?:Foundation|Launcher|Notice|Drag|Ownership).*Fixture|ui-tests\/|Task11 mode-only trusted source preparation failure/;
const inspectChunks = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await inspectChunks(path);
    else if (entry.name.endsWith('.js')) assert.equal(fixturePattern.test(await readFile(path, 'utf8')), false, 'ordinary production chunk excludes test imports/installers: ' + path);
  }
};
await inspectChunks(dist);
const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((m) => m[1]);
const assets = await Promise.all(assetPaths.map(async (url) => {
  const bytes = await readFile(resolve(dist, `.${url}`));
  return { url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const csp = JSON.parse(await readFile(resolve(root, 'apps/desktop/tauri.conf.json'), 'utf8')).app.security.csp;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const file = resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    assert.ok(!relative(dist, file).startsWith('..'));
    const bytes = await readFile(file);
    response.writeHead(200, {
      'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream',
      'content-security-policy': csp,
      'cache-control': 'no-store',
    });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PARADOX_PLAYWRIGHT_MODULE || 'playwright');
const launch = chromium.launch.bind(chromium);
const runs = [];
let activeInstrumentation;

// The shared fixture owns browser creation/navigation. Install this observer on its
// fresh context before its first page is created, without modifying the fixture.
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...contextArgs) => {
    const context = await newContext(...contextArgs);
    await context.addInitScript((labels) => {
      const data = window.uiPerformance = { longTasks: [], measurements: [], startup: null, armed: null };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) data.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name, attribution: entry.attribution.map((a) => ({ name: a.name, containerType: a.containerType, containerName: a.containerName, containerSrc: a.containerSrc })) });
      }).observe({ type: 'longtask', buffered: true });
      const visible = (element) => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
      const routeReady = (route) => {
        const active = route === 'accounts' ? document.querySelector('.sidebar-account.active') : [...document.querySelectorAll('.sidebar button')].find(button => button.getAttribute('aria-label') === labels[route] && button.getAttribute('aria-current') === 'page');
        if (!visible(active) || !active.classList.contains('active') || active.disabled) return false;
        if (route === 'home') return visible(document.querySelector('.immersive-home, .home-page'));
        return visible(document.querySelector(({ instances: '.instances-page', accounts: '.accounts-page', settings: '.settings-page' })[route]));
      };
      const painted = (ready, done) => {
        const check = () => {
          if (!ready()) return requestAnimationFrame(check);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (ready()) done(performance.now());
            else check();
          }));
        };
        requestAnimationFrame(check);
      };
      painted(() => routeReady('home') && [...document.querySelectorAll('.sidebar button')].filter(visible).every((b) => !b.disabled), (end) => { data.startup = { scenario: 'startup-home', start: 0, end, duration: end }; });
      document.addEventListener('click', () => {
        const measurement = data.armed;
        if (!measurement) return;
        data.armed = null;
        const start = performance.now();
        const ready = measurement.route ? () => routeReady(measurement.route) : () => {
          const button = [...document.querySelectorAll('.settings-options button')].find((b) => b.textContent.trim() === measurement.control);
          return visible(button) && !button.disabled && button.getAttribute('aria-pressed') === 'true';
        };
        painted(ready, (end) => data.measurements.push({ ...measurement, start, end, duration: end - start }));
      }, true);
    }, routeLabels);
    const newPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await newPage(...pageArgs);
      const externalRequests = [];
      await page.route('**/*', (route) => {
        const requestUrl = route.request().url();
        if (new URL(requestUrl).origin === new URL(url).origin || requestUrl.startsWith('blob:') || requestUrl.startsWith('data:')) return route.fallback();
        externalRequests.push(requestUrl);
        return route.abort('blockedbyclient');
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.start');
      activeInstrumentation = { cdp, externalRequests };
      return page;
    };
    return context;
  };
  return browser;
};
try {
  for (let run = 1; run <= count; run++) {
    let fixture;
    try {
      fixture = await createBrowserFixture({ url, desktopBoundary: true, config: initialConfig, nativeCsp: true });
      const { page } = fixture;
      const choice = page.locator('[data-style-choice]');
      await choice.waitFor();
      assert.equal(await page.evaluate(() => window.foundationDesktop.suiteLibrary.revision), 0);
      assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'save_ui_suite_library').length), 0);
      await choice.locator('input[value="immersive"]').check();
      await choice.getByRole('button', { name: /Use this interface|使用此界面/ }).click();
      await choice.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => ({ active: window.foundationDesktop.suiteLibrary.active_suite_id, revision: window.foundationDesktop.suiteLibrary.revision })), { active: 'builtin.immersive', revision: 1 });
      await page.waitForFunction(() => window.uiPerformance?.startup, undefined, { timeout: 120_000 });
      const startupProfile = (await activeInstrumentation.cdp.send('Profiler.stop')).profile;
      await writeFile(resolve(out, `run-${run}-startup.cpuprofile`), JSON.stringify(startupProfile));
      const actions = [
        { scenario: 'home-to-instances', route: 'instances', title: '我的实例' },
        { scenario: 'instances-to-accounts', route: 'accounts', title: '账户管理' },
        { scenario: 'accounts-to-settings', route: 'settings', title: '设置与个性化' },
        { scenario: 'settings-language-draft', control: 'English' },
        { scenario: 'settings-language-restore', control: '简体中文' },
        { scenario: 'settings-to-home', route: 'home', title: '开始游戏' },
        { scenario: 'home-to-settings-repeat', route: 'settings', title: '设置与个性化' },
        { scenario: 'settings-to-home-repeat', route: 'home', title: '开始游戏' },
      ];
      await activeInstrumentation.cdp.send('Profiler.start');
      for (const action of actions) {
        const before = await page.evaluate((value) => { window.uiPerformance.armed = value; return window.uiPerformance.measurements.length; }, action);
        const target = action.route === 'accounts' ? page.locator('.sidebar-account') : action.route ? page.locator('.sidebar').getByRole('button', { name: routeLabels[action.route], exact: true }) : page.getByRole('button', { name: action.control, exact: true });
        try {
          await target.click({ timeout: 30_000 });
          await page.waitForFunction((length) => window.uiPerformance.measurements.length > length, before, { timeout: 30_000 });
        } catch (error) {
          const observed = await page.evaluate(() => ({
            language: document.documentElement.lang,
            routeLabels: [...document.querySelectorAll('.sidebar .active, .mobile-navigation-label')].map(element => ({ text: element.textContent, current: element.getAttribute('aria-current') })),
            controls: [...document.querySelectorAll('button,[role="button"],[role="combobox"]')].filter(element => element.getClientRects().length).map(element => ({ role: element.getAttribute('role'), text: element.textContent, ariaLabel: element.getAttribute('aria-label'), labelledBy: element.getAttribute('aria-labelledby'), pressed: element.getAttribute('aria-pressed'), disabled: element.disabled, site: element.getAttribute('data-ui-site') })),
            performance: window.uiPerformance,
          }));
          await writeFile(resolve(out, `run-${run}-${action.scenario}-failure.json`), JSON.stringify({ action, error: String(error.stack || error), observed, pageErrors: fixture.observedPageErrors, cspViolations: fixture.observedCspViolations, sourceRequests: fixture.observedSourceModuleRequests }, null, 2));
          await page.screenshot({ path: resolve(out, `run-${run}-${action.scenario}-failure.png`) });
          throw error;
        }
      }
      const interactionProfile = (await activeInstrumentation.cdp.send('Profiler.stop')).profile;
      await writeFile(resolve(out, `run-${run}-interactions.cpuprofile`), JSON.stringify(interactionProfile));
      // One rAF lets the Long Tasks observer deliver the last completed event.
      const data = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        return {
          ...window.uiPerformance,
          navigation: performance.getEntriesByType('navigation').map((x) => x.toJSON()),
          resources: performance.getEntriesByType('resource').map((x) => ({ name: x.name, duration: x.duration, transferSize: x.transferSize, encodedBodySize: x.encodedBodySize, decodedBodySize: x.decodedBodySize })),
          paints: performance.getEntriesByType('paint').map((x) => x.toJSON()),
          commands: window.foundationDesktop.calls,
          browser: navigator.userAgent,
          fixtureGlobals: Object.getOwnPropertyNames(window).filter(name => /(?:Fixture$|^mount.*Fixture$|^install.*Fixture$|^suiteBuiltinsFixture$|^suiteFinalFixture$|^redesign)/i.test(name)),
        };
      });
      const result = { run, ...data, pageErrors: fixture.observedPageErrors, cspViolations: fixture.observedCspViolations, sourceModuleRequests: fixture.observedSourceModuleRequests, externalRequests: activeInstrumentation.externalRequests, contentSecurityPolicy: fixture.contentSecurityPolicy };
      runs.push(result);
      await writeFile(resolve(out, `run-${run}.json`), JSON.stringify(result, null, 2));
      assert.deepEqual(result.fixtureGlobals, []);
      assert.deepEqual(result.pageErrors, []);
      assert.deepEqual(result.cspViolations, []);
      assert.deepEqual(result.sourceModuleRequests, []);
      assert.deepEqual(result.externalRequests, []);
      assert.equal(result.contentSecurityPolicy, csp);
      assert.ok(!result.commands.some((x) => ['launch_instance', 'enqueue_install', 'select_account', 'save_config'].includes(x.command)));
      console.log(`${label} run ${run}: startup=${result.startup.duration.toFixed(1)}ms; routes=${result.measurements.filter((m) => m.route).map((m) => m.duration.toFixed(1)).join(',')}ms; longTasks=${result.longTasks.length}`);
    } finally { await fixture?.close(); }
  }
  const percentile = (sorted, percent) => sorted[Math.ceil((sorted.length - 1) * percent)];
  const summarize = (values) => {
    const durations = values.toSorted((a, b) => a - b);
    return { n: durations.length, durations, p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: durations.at(-1) };
  };
  const scenarios = Object.fromEntries([runs[0].startup.scenario, ...runs[0].measurements.map((m) => m.scenario)].map((scenario) => [scenario, summarize(runs.flatMap((run) => [run.startup, ...run.measurements].filter((m) => m.scenario === scenario).map((m) => m.duration)))]));
  const report = { label, timestamp: new Date().toISOString(), dist, assets, compilerResources: runs.map(run => ({ run: run.run, requests: run.resources.filter(resource => /\/assets\/typescript-[^/]+\.js/.test(resource.name)) })), viewport: { width: 1240, height: 720 }, initialConfig, browser: runs[0].browser, csp, scenarios, longTasks: runs.map((run) => ({ run: run.run, count: run.longTasks.length, totalMs: run.longTasks.reduce((total, task) => total + task.duration, 0), maxMs: Math.max(0, ...run.longTasks.map((task) => task.duration)) })), runs };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS ${label}: ${count} fresh ordinary-production contexts; strict errors/CSP/source/network guards; evidence ${out}`);
} finally {
  chromium.launch = launch;
  await new Promise((done) => server.close(done));
}
