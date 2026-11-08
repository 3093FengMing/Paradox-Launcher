import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig, loadApp } from './lib/hook-test-host.mjs';

// Run this destination script only after root integrates and freezes Task10 sources.
const artifacts = resolve(import.meta.dirname, '../../.test-data/default-ui-task10', process.env.PARADOX_TASK10_EVIDENCE || 'current-default');
await mkdir(artifacts, { recursive: true });
const locales = Object.fromEntries(await Promise.all(['en-US', 'zh-CN'].map(async language => [language, JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))])));
let language = 'en-US';
const text = key => key.split('.').reduce((value, part) => value[part], locales[language]);
const config = structuredClone(initialConfig);
config.settings.language = language;
config.profiles[0].name = '很长的中文实例名 — A long English instance name with spaces — '.repeat(3);
config.settings.game_directory = 'C:/long directory with spaces/很长的中文路径/'.repeat(5);
const viewports = [{ width: 1240, height: 780 }, { width: 960, height: 640 }, { width: 800, height: 600 }, { width: 640, height: 480 }, { width: 320, height: 240 }];
const report = { startedAt: new Date().toISOString(), checks: [], screenshots: [], layouts: [], keyboard: [], contrast: [], reachability: [], appearance: [], savePersistence: [], languageTransitions: [], languageCoverage: [], provenance: {}, sourceHashes: {}, sourceOwnership: [], errors: [], cspErrors: [] };
const pass = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const editorNames = ['AssetManager.tsx', 'base.css', 'Editor.tsx', 'FileTree.tsx', 'SourceEditor.tsx', 'style.css', 'TargetCatalog.tsx', 'TargetDetails.tsx', 'TargetPreview.tsx'];
const editorHashes = Object.fromEntries(await Promise.all(editorNames.map(async name => [name, createHash('sha256').update(await readFile(new URL(`../src/ui-suite/builtins/common/editor/${name}`, import.meta.url))).digest('hex')])));

for (const suite of ['modern', 'immersive']) {
  const fixture = await createBrowserFixture({ url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}`, config, desktopBoundary: true });
  const { page } = fixture;
  const logs = () => page.locator(`.${suite}-logs`);
  const search = () => logs().getByRole('searchbox', { name: text('logDisplay.search'), exact: true });
  const action = (name, values = []) => page.evaluate(async ({ name, values }) => { let fn = window.suiteBuiltinsFixture.actions; for (const key of name.split('.')) fn = fn[key]; return await fn(...values); }, { name, values });
  const route = async (id, params) => { await action('navigation.navigate', params === undefined ? [id] : [id, params]); await page.waitForFunction(({ id, profileKey }) => { const navigation = window.suiteBuiltinsFixture.snapshot.navigation; return navigation.routeId === id && (profileKey === undefined || navigation.params.profileKey === profileKey); }, { id, profileKey: params?.profileKey }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  const emit = (level, message) => page.evaluate(({ level, message }) => { const state = window.task10Boundary; window.foundationDesktop.emit('launcher://log', { id: { session: 'task10-native-fixture', sequence: String(++state.sequence) }, level, message, time: 1731000000 + state.sequence }); }, { level, message });
  const screenshot = async (name, metadata) => { await page.screenshot({ path: resolve(artifacts, `${name}.png`) }); report.screenshots.push({ path: `${name}.png`, sourceMode: 'current-default', ...metadata }); };
  async function commitAppearance(field, value) {
    const previous = await page.evaluate(() => ({ id: window.suiteBuiltinsFixture.snapshot.navigation.routeId, params: structuredClone(window.suiteBuiltinsFixture.snapshot.navigation.params) }));
    await action('navigation.navigate', ['settings']); await action('settings.setTab', ['appearance']);
    await action('settings.patchAppearance', [field, value]);
    await page.waitForFunction(({ field, value }) => window.suiteBuiltinsFixture.snapshot.settings.draft.appearance[field] === value, { field, value });
    assert.equal(await action('settings.save'), true, 'Real settings owner commits appearance ' + field);
    await page.waitForFunction(({ field, value }) => window.foundationDesktop.config.settings.appearance[field] === value && window.suiteBuiltinsFixture.snapshot.appearance.value[field] === value && !window.suiteBuiltinsFixture.snapshot.settings.saving, { field, value });
    await action('navigation.navigate', [previous.id, previous.params]);
    await page.waitForFunction(() => document.querySelector('.app-shell')?.dataset.theme === window.suiteBuiltinsFixture.snapshot.appearance.theme);
    const actual = await page.locator('.app-shell').evaluate(element => ({ publicTheme: window.suiteBuiltinsFixture.snapshot.appearance.theme, domTheme: element.dataset.theme, committedTheme: window.foundationDesktop.config.settings.appearance.theme, committedScale: window.foundationDesktop.config.settings.appearance.ui_scale, publicScale: window.suiteBuiltinsFixture.snapshot.appearance.value.ui_scale, variable: window.suiteBuiltinsFixture.snapshot.appearance.variables.fontSize, rootStyle: element.style.fontSize, computedFont: parseFloat(getComputedStyle(element).fontSize) }));
    assert.equal(actual.domTheme, actual.publicTheme);
    assert.equal(actual.publicScale, actual.committedScale);
    assert.equal(actual.variable, `${actual.committedScale}%`);
    assert.equal(actual.rootStyle, actual.variable);
    assert.ok(Math.abs(actual.computedFont - 16 * actual.committedScale / 100) < .2, 'Scale applies once at actual root');
    if (field === 'theme') assert.equal(actual.domTheme, value);
    report.appearance.push({ suite, field, value, ...actual });
  }
  async function commitLanguage(value) {
    await route('settings'); await action('settings.setTab', ['appearance']);
    const before = await page.evaluate(() => ({ language: window.foundationDesktop.config.settings.language, saveCalls: window.foundationDesktop.calls.filter(call => call.command === 'save_config').length }));
    await action('settings.patch', ['language', value]);
    await page.waitForFunction(value => window.suiteBuiltinsFixture.snapshot.settings.draft.language === value && window.suiteBuiltinsFixture.snapshot.settings.dirty, value);
    assert.equal(await action('settings.save'), true, 'Original settings owner saves real language draft');
    const heading = locales[value].nav.settings;
    await page.waitForFunction(({ value, heading }) => { const s = window.suiteBuiltinsFixture.snapshot; return !s.settings.saving && !s.settings.dirty && window.foundationDesktop.config.settings.language === value && s.config.value.settings.language === value && s.settings.draft.language === value && document.documentElement.lang === value && document.querySelector('.settings-page h1')?.textContent.trim() === heading; }, { value, heading });
    language = value;
    const after = await page.evaluate(() => { const s = window.suiteBuiltinsFixture.snapshot; return { committedLanguage: window.foundationDesktop.config.settings.language, publicConfigLanguage: s.config.value.settings.language, publicDraftLanguage: s.settings.draft.language, documentLanguage: document.documentElement.lang, renderedSettingsHeading: document.querySelector('.settings-page h1').textContent.trim(), saveCalls: window.foundationDesktop.calls.filter(call => call.command === 'save_config').length }; });
    assert.equal(after.saveCalls - before.saveCalls, 1, 'One real language Save reaches original save_config boundary');
    report.languageTransitions.push({ suite, language: value, before, after, nativeSaveDelta: after.saveCalls - before.saveCalls });
  }
  async function dismissNotices() {
    await page.evaluate(() => { const f = window.suiteBuiltinsFixture; for (const notice of f.snapshot.notifications.items) f.actions.notifications.dismiss(notice.id); });
    await page.waitForFunction(() => !document.querySelector('.ui-notice'));
  }
  async function reachable(locator, metadata) {
    await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    const value = await locator.evaluate(element => {
      const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x, y);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fullyInside: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
    });
    assert.ok(value.fullyInside && value.hit, `Reachable ${JSON.stringify({ ...metadata, ...value })}`);
    report.reachability.push({ ...metadata, ...value });
  }
  async function keyboardTour(routeId, viewport, theme) {
    await dismissNotices();
    const expected = await page.evaluate(() => [...document.querySelectorAll('.app-shell button, .app-shell input, .app-shell textarea, .app-shell select, .app-shell a[href], .app-shell [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && !element.closest('[inert]') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.checked))
      .map((element, index) => { element.dataset.task10Keyboard = String(index); return element.dataset.task10Keyboard; }));
    const visited = new Set(), failures = [], controls = new Map();
    // Establish a real starting point, then reach controls through Tab/Shift+Tab.
    await page.locator('.window-controls button:enabled').first().focus();
    for (let i = 0; i < expected.length * 2 + 12; i++) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const element = document.activeElement, css = element && getComputedStyle(element);
        if (!element?.dataset.task10Keyboard) return null;
        const labelledByIds = (element.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/).filter(Boolean);
        const labelReferences = labelledByIds.map(id => ({ id, node: document.getElementById(id) }));
        const missingLabelReferences = labelReferences.filter(reference => !reference.node).map(reference => reference.id);
        const referencedName = labelReferences.map(reference => reference.node?.textContent.trim() ?? '').filter(Boolean).join(' ');
        const label = labelledByIds.length ? referencedName : element.getAttribute('aria-label') || element.textContent.trim() || element.labels?.[0]?.textContent.trim() || element.getAttribute('title');
        const rect = element.getBoundingClientRect();
        return { key: element.dataset.task10Keyboard, site: element.getAttribute('data-ui-site'), role: element.getAttribute('role'), label, labelledByIds, referencedName, missingLabelReferences, visibleFocus: parseFloat(css.outlineWidth) >= 2 && css.outlineStyle !== 'none', focusRatio: window.task10Boundary.contrast(element, css.outlineColor, css.outlineOffset).ratio, visible: rect.width > 0 && rect.height > 0 };
      });
      if (state) { visited.add(state.key); controls.set(state.key, state); if (!state.label || state.missingLabelReferences.length || !state.visibleFocus || state.focusRatio < 3 || !state.visible) failures.push(state); }
      if (expected.every(key => visited.has(key))) break;
    }
    assert.deepEqual(failures, [], `${suite}/${routeId} keyboard labels and visible focus`);
    assert.deepEqual(expected.filter(key => !visited.has(key)), [], `${suite}/${routeId} controls reachable by keyboard`);
    await page.keyboard.press('Shift+Tab');
    report.keyboard.push({ suite, routeId, viewport, theme, language, expected: expected.length, visited: visited.size, failures, controls: [...controls.values()] });
  }
  async function contrasts(routeId, theme) {
    const findings = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const composite = (fg, bg) => [0, 1, 2].map(index => fg[index] * fg[3] / 255 + bg[index] * (1 - fg[3] / 255)).concat(255);
      const background = element => {
        const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node);
        return chain.reduce((value, node) => composite(rgba(getComputedStyle(node).backgroundColor), value), [255, 255, 255, 255]);
      };
      const luminance = value => value.slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
      return [...document.querySelectorAll('.workspace p, .workspace span, .workspace small, .workspace strong, .workspace b, .workspace label, .workspace h1, .workspace h2, .workspace h3, .workspace button, .workspace input')]
        .filter(element => element.getClientRects().length && !element.disabled && !element.closest('button:disabled,[aria-disabled=true]') && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
        .map(element => {
          const css = getComputedStyle(element), bg = background(element), value = ratio(composite(rgba(css.color), bg), bg);
          const site = element.getAttribute('data-ui-site');
          // The existing aria-hidden avatar initial duplicates the separately
          // rendered account name. Only these exact source sites are graphics;
          // account names and every other visible text node retain 4.5:1.
          const avatarGraphic = element.matches('span.account-avatar[aria-hidden="true"]') && /^site:(?:modern|immersive)%2Fcomponents%2FAccountAvatar\.tsx:AccountAvatar-1$/.test(site ?? '');
          return { site, text: element.textContent.trim().slice(0, 80), ratio: value, classification: avatarGraphic ? 'decorative-avatar-graphic' : 'ordinary-text', threshold: avatarGraphic ? 3 : 4.5, ...(avatarGraphic ? { ariaHidden: element.getAttribute('aria-hidden'), tag: element.tagName } : {}) };
        });
    });
    report.contrast.push({ suite, routeId, theme, findings });
    assert.deepEqual(findings.filter(value => value.classification === 'ordinary-text' && value.ratio < 4.5), [], `${suite}/${routeId}/${theme}: ordinary text contrast >=4.5`);
    assert.deepEqual(findings.filter(value => value.classification === 'decorative-avatar-graphic' && value.ratio < 3), [], `${suite}/${routeId}/${theme}: decorative avatar graphic contrast >=3`);
    const boundaries = await page.locator('.workspace').locator('input:not([type=range]):not([type=color]), textarea, select, button.secondary, .ui-select-trigger').evaluateAll(elements => elements
      .filter(element => element.getClientRects().length && !element.disabled && parseFloat(getComputedStyle(element).borderTopWidth) > 0)
      .map(element => ({ site: element.getAttribute('data-ui-site'), ...window.task10Boundary.contrast(element, getComputedStyle(element).borderTopColor, '-1px') }))
      .filter(value => value.alpha > 0));
    report.contrast.push({ suite, routeId, theme, boundaries });
    assert.deepEqual(boundaries.filter(value => value.ratio < 3), [], `${suite}/${routeId}/${theme}: control boundary contrast >=3`);
  }
  try {
    await page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
    await page.evaluate(async suite => { if (!await window.suiteBuiltinsFixture.controller.actions.selectSuite(`builtin.${suite}`)) throw Error('Suite selection failed'); }, suite);
    await page.waitForFunction(() => !window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
    await page.evaluate(() => {
      const native = window.__TAURI_INTERNALS__, original = native.invoke;
      const state = window.task10Boundary = { sequence: 0, clear: 'normal', pending: [], exports: [] };
      state.contrast = (element, color, offset) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
        const composite = (fg, bg) => [0, 1, 2].map(index => fg[index] * fg[3] / 255 + bg[index] * (1 - fg[3] / 255)).concat(255);
        const chain = []; for (let node = parseFloat(offset) < 0 ? element : element.parentElement; node; node = node.parentElement) chain.unshift(node);
        const bg = chain.reduce((value, node) => composite(rgba(getComputedStyle(node).backgroundColor), value), [255, 255, 255, 255]);
        const luminance = value => value.slice(0, 3).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
        const raw = rgba(color), fg = composite(raw, bg), a = luminance(fg), b = luminance(bg);
        return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), alpha: raw[3] };
      };
      native.invoke = async (command, args) => {
        if (command !== 'clear_stored_logs') return original(command, args);
        window.foundationDesktop.calls.push({ command, args });
        if (state.clear === 'fail') { state.clear = 'normal'; throw Error('Task10 real storage clear failure'); }
        if (state.clear === 'hold') { state.clear = 'normal'; return new Promise(resolve => state.pending.push(resolve)); }
        return { session: 'task10-native-fixture', sequence: String(state.sequence) };
      };
      const create = URL.createObjectURL.bind(URL), blobs = new Map();
      URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); return url; };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download === 'paradox-launcher.log') { state.exports.push(blobs.get(this.href).text()); return; } return click.call(this); };
    });
    await route('logs'); await logs().waitFor();
    const provenance = await page.evaluate(() => { const draft = window.suiteBuiltinsFixture.controller.getSnapshot().draft; return { views: draft.manifest.views, routes: draft.manifest.routes, files: draft.manifest.files }; });
    report.provenance[suite] = provenance;
    const logPath = `${suite}/pages/LogsPage.tsx`, source = await readFile(new URL(`../src/ui-suite/builtins/${logPath}`, import.meta.url), 'utf8');
    const instrumented = loadApp()('customization/site-transform.ts').instrumentSites(source, logPath, 'tsx');
    const prefix = suite === 'modern' ? 'ModernLogs' : 'ImmersiveLogs';
    for (const site of ['search', 'follow', 'export', 'clear']) assert.ok([...instrumented.sites.keys()].some(value => value === `${prefix}-${site}` || value.endsWith(`:${prefix}-${site}`)), 'Actual source ownership call site ' + site);
    report.sourceOwnership.push({ suite, path: logPath, sites: [...instrumented.sites.keys()] });
    for (const [id, path] of Object.entries(provenance.views)) if (!id.startsWith('tool.editor')) assert.ok(path.startsWith(`${suite}/`), `${id} owns suite source`);
    assert.ok(provenance.files.every(file => !/^common\/(pages|components|dialogs|styles)\//.test(file.path) && !/^common\/(Loading|Error|Notifications|style)\./.test(file.path) && file.path !== 'common/lib/EnvironmentEditor.tsx'), 'No common player descriptors');
    for (const file of provenance.files) report.sourceHashes[`${suite}:${file.path}`] = createHash('sha256').update(await readFile(new URL(`../src/ui-suite/builtins/${file.path}`, import.meta.url))).digest('hex');
    pass(`${suite}:all_default_player_bindings_and_common_cleanup`);

    await action('logs.clear');
    await emit('info', 'INFO first line\n  preserved indentation');
    await emit('error', 'ERROR 中文路径 C:/long path/a=b');
    await emit('debug', 'DEBUG compatibility detail');
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.logs.lines.length === 3);
    const real = await page.evaluate(() => structuredClone(window.suiteBuiltinsFixture.snapshot.logs.lines));
    assert.deepEqual(await logs().locator('.logs-line time').allTextContents(), real.map(line => line.time));
    assert.deepEqual(await logs().locator('.logs-line > span').allTextContents(), real.map(line => line.message));
    await search().fill('a=b'); assert.equal(await logs().locator('.logs-line').count(), 1);
    await search().fill(real[0].time); assert.ok(await logs().locator('.logs-line').count() >= 1);
    await search().fill('');
    if (suite === 'modern') {
      await logs().getByRole('combobox', { name: text('logDisplay.level'), exact: true }).click();
      await page.getByRole('listbox').getByRole('option', { name: 'DEBUG', exact: true }).click();
    } else await logs().getByRole('button', { name: 'DEBUG', exact: true }).click();
    assert.equal(await logs().locator('.logs-line').count(), 1);
    await search().fill('no result'); assert.equal(await logs().locator('.logs-empty').count(), 1);
    await logs().getByRole('button', { name: text('common.export'), exact: true }).click();
    const exported = await page.evaluate(async () => await window.task10Boundary.exports.at(-1));
    assert.equal(exported, real.map(line => `[${line.time}] [${line.level}] ${line.message}`).join('\n'));
    if (suite === 'modern') { await logs().getByRole('combobox').click(); await page.getByRole('listbox').getByRole('option', { name: text('logDisplay.allLevels'), exact: true }).click(); }
    else await logs().getByRole('button', { name: text('logDisplay.allLevels'), exact: true }).click();
    await search().fill('');
    await logs().locator('.logs-line > span').first().evaluate(element => { const selection = getSelection(), range = document.createRange(); range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range); });
    assert.equal(await page.evaluate(() => getSelection().toString()), real[0].message);
    assert.equal(await logs().locator('.logs-console').evaluate(element => getComputedStyle(element).userSelect), 'text');
    assert.equal(await logs().locator('[data-tauri-drag-region]').count(), 0);
    await search().focus(); const activityBefore = await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'launch_instance').length);
    await page.keyboard.press('Control+Enter');
    assert.equal(await page.evaluate(() => window.foundationDesktop.calls.filter(call => call.command === 'launch_instance').length), activityBefore);
    pass(`${suite}:real_time_level_message_filter_full_export_selection_and_shortcut_guard`);

    await page.evaluate(() => { for (let index = 0; index < 160; index++) { const state = window.task10Boundary; window.foundationDesktop.emit('launcher://log', { id: { session: 'task10-native-fixture', sequence: String(++state.sequence) }, level: 'info', message: `Long entry ${index} 中文 ${'C:/a long path/'.repeat(6)}`, time: 1731000000 + state.sequence }); } });
    await logs().getByRole('switch', { name: text('logDisplay.follow'), exact: true }).click();
    await logs().locator('.logs-console').evaluate(element => element.scrollTop = 0);
    await emit('info', 'new entry while paused');
    assert.equal(await logs().locator('.logs-console').evaluate(element => element.scrollTop), 0);
    await logs().getByRole('switch', { name: text('logDisplay.follow'), exact: true }).click();
    await page.waitForFunction(selector => { const element = document.querySelector(selector); return element.scrollHeight - element.clientHeight - element.scrollTop < 2; }, `.${suite}-logs .logs-console`);
    await page.evaluate(() => window.task10Boundary.clear = 'fail');
    await logs().getByRole('button', { name: text('logs.clear'), exact: true }).click();
    await page.getByText('Task10 real storage clear failure', { exact: true }).first().waitFor();
    assert.ok(await logs().locator('.logs-line').count() > 160);
    await dismissNotices();
    await page.evaluate(() => window.task10Boundary.clear = 'hold');
    await logs().getByRole('button', { name: text('logs.clear'), exact: true }).click();
    await page.waitForFunction(() => window.task10Boundary.pending.length === 1);
    await emit('info', 'after retained clear boundary');
    await page.evaluate(() => window.task10Boundary.pending.shift()({ session: 'task10-native-fixture', sequence: String(window.task10Boundary.sequence - 1) }));
    await page.waitForFunction(() => window.suiteBuiltinsFixture.snapshot.logs.lines.length === 1);
    assert.equal(await logs().locator('.logs-line > span').textContent(), 'after retained clear boundary');
    pass(`${suite}:follow_pause_resume_storage_failure_retry_and_new_log_retention`);

    const routeIds = provenance.routes.filter(route => route.navigation).map(route => route.id);
    routeIds.push('custom.instance-details');
    for (const theme of ['dark', 'light']) {
      await commitAppearance('theme', theme);
      for (const scale of [85, 100, 120]) {
        await commitAppearance('ui_scale', scale);
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          for (const routeId of routeIds) {
            if (routeId === 'custom.instance-details') await route(routeId, { profileKey: 'original-instance' });
            else await route(routeId);
            await dismissNotices();
            const layout = await page.locator('.workspace').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }));
            report.layouts.push({ suite, theme, scale, viewport, routeId, ...layout });
            assert.ok(layout.scrollWidth <= layout.clientWidth + 2 && layout.documentWidth <= layout.viewportWidth + 2, `${suite}/${theme}/${scale}/${viewport.width}/${routeId} no horizontal clipping`);
            if (viewport.width === 320) {
              const workspace = page.locator('.workspace');
              const controls = { home: workspace.locator(suite === 'modern' ? '.launch-button' : '.immersive-launch-primary'), instances: workspace.getByRole('button', { name: text('common.createInstance'), exact: true }), 'custom.versions': workspace.getByRole('button', { name: text('common.createInstance'), exact: true }), downloads: workspace.getByRole('combobox', { name: text('versionDownloads.status'), exact: true }), accounts: workspace.getByRole('button', { name: text('accounts.save'), exact: true }), content: workspace.getByRole('button', { name: text('content.search'), exact: true }), 'custom.instance-details': workspace.getByRole('button', { name: text('common.launch'), exact: true }) };
              const control = controls[routeId];
              if (control) await reachable(control.first(), { suite, theme, scale, viewport, routeId, control: 'primary accessible role/label' });
            }
            if (routeId === 'logs') { await reachable(logs().getByRole('button', { name: text('logs.clear'), exact: true }), { suite, theme, scale, viewport, routeId, control: 'logs.clear' }); if (viewport.width === 1240 || viewport.width === 320) await screenshot(`${suite}-${theme}-${scale}-logs-${viewport.width}`, { suite, theme, scale, viewport, routeId }); }
            if (viewport.width === 320 && routeId === 'settings') {
              await action('settings.setTab', ['game']);
              const beforeSave = await page.evaluate(() => ({ memory: window.foundationDesktop.config.settings.memory_mb, saveCalls: window.foundationDesktop.calls.filter(call => call.command === 'save_config').length }));
              const nextMemory = beforeSave.memory === 6144 ? 8192 : 6144;
              await action('settings.patch', ['memory_mb', nextMemory]);
              await page.waitForFunction(memory => window.suiteBuiltinsFixture.snapshot.settings.dirty && window.suiteBuiltinsFixture.snapshot.settings.draft.memory_mb === memory, nextMemory);
              const save = page.locator('.settings-page').getByRole('button', { name: text('settings.save'), exact: true });
              assert.equal(await save.isEnabled(), true, '320 Save is enabled for a real changed draft');
              await reachable(save, { suite, theme, scale, viewport, routeId, control: 'settings.save' });
              const word = await save.evaluate(element => { const node = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Save')); if (!node) return []; const range = document.createRange(), start = node.textContent.indexOf('Save'); range.setStart(node, start); range.setEnd(node, start + 4); return [...range.getClientRects()].map(rect => ({ top: rect.top, width: rect.width })); });
              assert.equal(word.length, 1, 'English Save label stays intact');
              await save.focus();
              assert.equal(await save.evaluate(element => element === document.activeElement), true, '320 Save receives actual keyboard focus');
              await page.keyboard.press('Space');
              await page.waitForFunction(({ memory, saveCalls }) => !window.suiteBuiltinsFixture.snapshot.settings.saving && !window.suiteBuiltinsFixture.snapshot.settings.dirty && window.foundationDesktop.config.settings.memory_mb === memory && window.foundationDesktop.calls.filter(call => call.command === 'save_config').length > saveCalls, { memory: nextMemory, saveCalls: beforeSave.saveCalls });
              const afterSave = await page.evaluate(() => ({ memory: window.foundationDesktop.config.settings.memory_mb, saveCalls: window.foundationDesktop.calls.filter(call => call.command === 'save_config').length, dirty: window.suiteBuiltinsFixture.snapshot.settings.dirty }));
              assert.equal(afterSave.memory, nextMemory, '320 Save keyboard activation persists changed memory through original owner');
              assert.equal(afterSave.saveCalls - beforeSave.saveCalls, 1, 'One real Space activation reaches the original save_config boundary');
              report.savePersistence.push({ suite, theme, scale, viewport, routeId, before: beforeSave, after: afterSave, activation: 'Space', intactEnglishWordRects: word });
            }
            if (scale === 100 && (viewport.width === 1240 || viewport.width === 320)) await keyboardTour(routeId, viewport, theme);
            if (scale === 100 && viewport.width === 1240) await contrasts(routeId, theme);
          }
        }
      }
    }
    pass(`${suite}:all_pages_five_viewports_themes_scales_keyboard_and_text_contrast`);

    await page.setViewportSize({ width: 640, height: 480 }); await route('logs');
    const navigation = page.locator('.mobile-navigation').getByRole('button', { name: text('responsiveUi.navigation'), exact: true });
    await navigation.focus(); await page.keyboard.press('Enter');
    const menu = page.getByRole('menu'); await menu.waitFor(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await menu.waitFor({ state: 'hidden' });
    await navigation.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
    assert.equal(await navigation.evaluate(element => element === document.activeElement), true);
    await commitAppearance('reduce_motion', true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await page.locator('.app-shell').evaluate(element => [...element.querySelectorAll('*')].filter(node => node.getClientRects().length).filter(node => { const css = getComputedStyle(node); return css.animationName !== 'none' || css.transitionDuration.split(',').some(value => parseFloat(value) > 0); }).map(node => node.getAttribute('data-ui-site')));
    assert.deepEqual(motion, [], 'Reduced motion disables nonessential animation and transition');
    pass(`${suite}:mobile_menu_keyboard_return_focus_and_reduced_motion`);
    await commitLanguage('zh-CN');
    await page.setViewportSize({ width: 320, height: 240 });
    await commitAppearance('theme', 'light');
    await commitAppearance('ui_scale', 120);
    for (const routeId of routeIds) {
      if (routeId === 'custom.instance-details') await route(routeId, { profileKey: 'original-instance' });
      else await route(routeId);
      const expectedTitle = text(provenance.routes.find(route => route.id === routeId).title);
      await page.waitForFunction(title => { const s = window.suiteBuiltinsFixture.snapshot; return window.foundationDesktop.config.settings.language === 'zh-CN' && s.config.value.settings.language === 'zh-CN' && s.settings.draft.language === 'zh-CN' && document.documentElement.lang === 'zh-CN' && document.querySelector('.mobile-navigation-label')?.textContent.trim() === title; }, expectedTitle);
      const actual = await page.locator('.workspace').evaluate(element => { const s = window.suiteBuiltinsFixture.snapshot; return { actualRouteId: s.navigation.routeId, publicProfileKey: s.navigation.params.profileKey ?? null, renderedProfileKey: document.querySelector('.instance-detail-page .instance-detail')?.getAttribute('data-profile-key') ?? null, committedLanguage: window.foundationDesktop.config.settings.language, publicConfigLanguage: s.config.value.settings.language, publicDraftLanguage: s.settings.draft.language, documentLanguage: document.documentElement.lang, renderedRouteLabel: document.querySelector('.mobile-navigation-label').textContent.trim(), publicScale: s.appearance.value.ui_scale, committedScale: window.foundationDesktop.config.settings.appearance.ui_scale, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }; });
      assert.equal(actual.actualRouteId, routeId, 'Chinese capture uses the actual requested route');
      assert.equal(actual.publicScale, 120); assert.equal(actual.committedScale, 120);
      assert.equal(actual.renderedRouteLabel, expectedTitle, 'Chinese route label is actually rendered');
      assert.ok(actual.scrollWidth <= actual.clientWidth + 2 && actual.documentWidth <= actual.viewportWidth + 2, `${suite}/${routeId} Chinese320 no horizontal clipping`);
      if (routeId === 'custom.instance-details') { assert.equal(actual.publicProfileKey, 'original-instance'); assert.equal(actual.renderedProfileKey, 'original-instance'); }
      report.languageCoverage.push({ suite, language, scale: 120, viewport: { width: 320, height: 240 }, routeId, ...actual });
      await keyboardTour(routeId, { width: 320, height: 240 }, 'light');
      await screenshot(`${suite}-zh-CN-${routeId.replaceAll('.', '-')}-320`, { suite, language, scale: 120, viewport: { width: 320, height: 240 }, routeId, validatedLanguage: actual.documentLanguage, renderedRouteLabel: actual.renderedRouteLabel });
    }
    await commitLanguage('en-US');
    pass(`${suite}:Chinese_320_long_names_paths_and_keyboard`);
  } catch (error) {
    report.failure = { suite, message: error.message, stack: error.stack };
    throw error;
  } finally {
    report.errors.push(...fixture.observedPageErrors); report.cspErrors.push(...fixture.observedCspViolations);
    await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await fixture.close();
  }
}
for (const name of editorNames) assert.equal(createHash('sha256').update(await readFile(new URL(`../src/ui-suite/builtins/common/editor/${name}`, import.meta.url))).digest('hex'), editorHashes[name], `Ordinary editor bytes unchanged: ${name}`);
assert.deepEqual(report.errors, []); assert.deepEqual(report.cspErrors, []);
report.nativeBoundaries = ['DPI 100/125/150/200% requires the native Task11 gate; deviceScaleFactor is not OS DPI proof.', 'The boundary fixture injects real public launcher events; live game/native auth remain the final native gate.'];
report.finishedAt = new Date().toISOString();
await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS ${report.checks.length} Task10 groups; report ${resolve(artifacts, 'report.json')}`);
