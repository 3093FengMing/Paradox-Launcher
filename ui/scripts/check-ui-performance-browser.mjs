import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname, relative } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

// Ordinary production entry only: no test build, fixture installers or application edits.
// Optional environment: PARADOX_UI_DIST, PARADOX_PERFORMANCE_LABEL,
// PARADOX_PERFORMANCE_RUNS, PARADOX_PLAYWRIGHT_MODULE, PARADOX_BROWSER_EXECUTABLE.
const root = resolve(import.meta.dirname, '../..');
const dist = resolve(process.env.PARADOX_UI_DIST || resolve(root, 'ui/dist'));
const label = process.env.PARADOX_PERFORMANCE_LABEL || 'baseline';
assert.match(label, /^[a-zA-Z0-9_-]+$/);
const count = Number(process.env.PARADOX_PERFORMANCE_RUNS || 3);
const requirePrecompiled = process.env.PARADOX_REQUIRE_PRECOMPILED === '1';
assert.ok(Number.isInteger(count) && count >= 3 && count <= 20);
const out = resolve(root, '.test-data/ui-performance', label);
await mkdir(out, { recursive: true });
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
assert.ok(!/foundation-test|ui-tests|\/src\/main/.test(html));
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
    await context.addInitScript(() => {
      const data = window.uiPerformance = { longTasks: [], measurements: [], startup: null, armed: null };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) data.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name, attribution: entry.attribution.map((a) => ({ name: a.name, containerType: a.containerType, containerName: a.containerName, containerSrc: a.containerSrc })) });
      }).observe({ type: 'longtask', buffered: true });
      const visible = (element) => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
      const routeReady = (route) => {
        const labels = { home: '开始游戏', instances: '我的实例', accounts: '账户管理', settings: '设置与个性化' };
        const active = document.querySelector(`.sidebar button[title="${labels[route]}"]`);
        if (!visible(active) || !active.classList.contains('active') || active.disabled) return false;
        if (route === 'home') return visible(document.querySelector('.immersive-home, .home-page'));
        const titles = { instances: '我的实例', accounts: '账户管理', settings: '设置与个性化' };
        return [...document.querySelectorAll('h1')].some((h) => visible(h) && h.textContent.trim() === titles[route]);
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
          const button = [...document.querySelectorAll('.theme-options button')].find((b) => b.textContent.trim() === measurement.control);
          return visible(button) && !button.disabled && button.getAttribute('aria-pressed') === 'true';
        };
        painted(ready, (end) => data.measurements.push({ ...measurement, start, end, duration: end - start }));
      }, true);
    });
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
        const target = action.route ? page.locator(`.sidebar button[title="${action.title}"]`) : page.getByRole('button', { name: action.control, exact: true });
        await target.click({ timeout: 30_000 });
        await page.waitForFunction((length) => window.uiPerformance.measurements.length > length, before, { timeout: 30_000 });
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
          fixtureInstallersPresent: !!(window.suiteFinalFixture || window.mountLauncherRouteFixture),
        };
      });
      const result = { run, ...data, pageErrors: fixture.observedPageErrors, cspViolations: fixture.observedCspViolations, sourceModuleRequests: fixture.observedSourceModuleRequests, externalRequests: activeInstrumentation.externalRequests, contentSecurityPolicy: fixture.contentSecurityPolicy };
      runs.push(result);
      await writeFile(resolve(out, `run-${run}.json`), JSON.stringify(result, null, 2));
      assert.equal(result.fixtureInstallersPresent, false);
      assert.deepEqual(result.pageErrors, []);
      assert.deepEqual(result.cspViolations, []);
      assert.deepEqual(result.sourceModuleRequests, []);
      assert.deepEqual(result.externalRequests, []);
      if (requirePrecompiled) assert.ok(!result.resources.some(resource => /\/assets\/typescript-[^/]+\.js/.test(resource.name)), 'unchanged builtins use prepared plans without loading TypeScript');
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
  const report = { label, timestamp: new Date().toISOString(), dist, assets, requirePrecompiled, viewport: { width: 1240, height: 720 }, initialConfig, browser: runs[0].browser, csp, scenarios, longTasks: runs.map((run) => ({ run: run.run, count: run.longTasks.length, totalMs: run.longTasks.reduce((total, task) => total + task.duration, 0), maxMs: Math.max(0, ...run.longTasks.map((task) => task.duration)) })), runs };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS ${label}: ${count} fresh ordinary-production contexts; strict errors/CSP/source/network guards; evidence ${out}`);
} finally {
  chromium.launch = launch;
  await new Promise((done) => server.close(done));
}
