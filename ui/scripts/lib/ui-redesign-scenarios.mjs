import assert from 'node:assert/strict';

export const redesignScenarios = [
  'home-empty', 'home-idle', 'home-other-running', 'instances-installed-repair',
  'detail-settings', 'detail-local-loading-empty-error', 'versions-cache-error',
  'downloads-all-states', 'accounts-login-expired-error', 'discover-empty-error',
  'settings-dirty-saving', 'logs', 'style-choice-success-failure',
  'appearance-committed-theme-scale',
];
export const redesignViewports = [{ width: 1240, height: 780 }, { width: 640, height: 480 }, { width: 320, height: 240 }];
export const redesignScales = [85, 100, 120];
export const defaultRoutes = ['home', 'instances', 'custom.instance-details', 'custom.versions', 'downloads', 'accounts', 'content', 'settings', 'logs'];

export function redesignConfig(initialConfig, { theme, scale }) {
  const config = structuredClone(initialConfig);
  config.settings.language = 'en-US';
  config.settings.appearance.theme = theme;
  config.settings.appearance.ui_scale = scale;
  config.settings.java_executable = 'C:/fixture/java.exe';
  config.profiles[0].name = 'Alpha workshop with a deliberately long English instance name';
  config.profiles[0].game_directory = 'C:/fixture/' + 'long directory segment/'.repeat(12);
  config.profiles.push({ ...structuredClone(config.profiles[0]), instance_key: 'beta-instance', name: 'Beta repair workspace', loader: 'vanilla', loader_version: '' });
  return config;
}

export const sourceSite = (page, name) => page.locator('[data-ui-site="' + name + '"], [data-ui-site$=":' + name + '"]');
export async function launcherAction(page, path, args = [], awaitResult = true) {
  return page.evaluate(async ({ path, args, awaitResult }) => {
    let action = window.suiteBuiltinsFixture.actions;
    for (const key of path.split('.')) action = action[key];
    const result = action(...args);
    if (awaitResult) return result;
  }, { path, args, awaitResult });
}
export async function boundaryMode(page, command, mode) {
  await page.evaluate(({ command, mode }) => { window.foundationDesktop.redesign.modes[command] = mode; }, { command, mode });
}
export async function releaseBoundary(page, command, { error = null, value } = {}) {
  await page.evaluate(({ command, error, value }) => {
    const gate = window.foundationDesktop.redesign.held[command]?.shift();
    if (!gate) throw Error('No held native command: ' + command);
    if (error) gate.reject(Error(error));
    else gate.resolve(value === undefined ? gate.normal() : value);
  }, { command, error, value });
}
export async function waitHeld(page, command) {
  await page.waitForFunction(command => window.foundationDesktop.redesign.held[command]?.length, command);
}

export async function installRedesignBoundary(page) {
  await page.evaluate(() => {
    const f = window.suiteBuiltinsFixture, desktop = window.foundationDesktop;
    if (!f?.controller || !desktop) throw Error('Actual suite-builtins owner and native boundary are required');
    const native = window.__TAURI_INTERNALS__, original = native.invoke;
    const b = desktop.redesign = {
      owner: { controller: f.controller, actions: f.actions }, modes: {}, held: {}, calls: [],
      profiles: structuredClone(desktop.config.profiles), repairKeys: ['beta-instance'], tasks: [],
      listEmpty: false, searchEmpty: false, expired: false, login: null, cancelAcks: [],
      catalog: { versions: [{ id: '1.21.1', kind: 'release' }, { id: '24w14a', kind: 'snapshot' }], fetched_at: 1700000000, source: 'cache', stale: true, warning: 'Saved catalog cache; network refresh is pending', error_kind: 'network' },
    };
    const normal = async (command, args) => {
      if (command === 'inspect_instances') return desktop.config.profiles.map(profile => ({ ...profile,
        loader: b.repairKeys.includes(profile.instance_key) ? 'fabric' : profile.loader,
        loader_version: b.repairKeys.includes(profile.instance_key) ? '0.16.0' : profile.loader_version,
        root: `${profile.game_directory ?? desktop.config.settings.game_directory}/versions/${profile.instance_key}`,
      }));
      if (command === 'catalog') return structuredClone(b.catalog);
      if (command === 'download_tasks') return structuredClone(b.tasks);
      if (command === 'account_recovery') return ['orphaned-credential'];
      if (command === 'list_content') return b.listEmpty ? [] : [{ name: 'fixture-mod.jar', category: args.category, size: 2048, enabled: true, record: { project_id: 'fixture-project', version_id: 'fixture-version', title: args.key + ' local resource' } }];
      if (command === 'search_content') return { hits: b.searchEmpty ? [] : [{ project_id: 'fixture-project', title: 'Long English project title for a real native search response', description: 'A native boundary fixture response with a long description that wraps at the smallest supported viewport.', project_type: args.category, downloads: 12400 }], total_hits: b.searchEmpty ? 0 : 1, offset: args.offset, limit: 20 };
      if (command === 'begin_login') return { id: args.requestId, user_code: 'ABCD-EFGH', verification_uri: 'https://www.microsoft.com/link', expires_at: Math.floor(Date.now() / 1000) + (b.expired ? -1 : 600) };
      if (command === 'complete_login') return new Promise((resolve, reject) => { b.login = { resolve, reject, id: args.id }; });
      if (command === 'cancel_login') { b.cancelAcks.push(args.id); return; }
      if (command === 'choose_directory') return null;
      if (command.startsWith('plugin:window|')) return;
      return original(command, args);
    };
    native.invoke = async (command, args = {}) => {
      b.calls.push({ command, args: structuredClone(args) });
      const mode = b.modes[command]; delete b.modes[command];
      if (mode === 'fail') throw Error('Task11 ' + command + ' failed: ' + 'a long actionable English error description '.repeat(8));
      if (mode === 'hold') return new Promise((resolve, reject) => (b.held[command] ??= []).push({ resolve, reject, normal: () => normal(command, args), args: structuredClone(args) }));
      return normal(command, args);
    };
  });
}

export async function cancelRedesignLogin(page) {
  const id = await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.accounts.prompt?.id);
  assert.ok(id, 'a real login prompt precedes cancellation');
  await page.waitForFunction(id => window.foundationDesktop.redesign.login?.id === id, id);
  await launcherAction(page, 'accounts.cancelLogin');
  const acknowledged = await page.evaluate(id => {
    const accounts = window.suiteBuiltinsFixture.snapshot.accounts;
    return { acknowledged: window.foundationDesktop.redesign.cancelAcks.includes(id),
      id: accounts.prompt?.id, pending: accounts.pending };
  }, id);
  assert.deepEqual(acknowledged, { acknowledged: true, id, pending: true }, 'cancel ACK retains the real prompt until complete_login reaches a terminal result');
  await page.evaluate(id => {
    const b = window.foundationDesktop.redesign, gate = b.login;
    if (!gate || gate.id !== id) throw Error('No actual complete_login request awaits this cancelled terminal result');
    b.login = null;
    gate.reject('auth.errors.cancelled');
  }, id);
  await page.waitForFunction(() => {
    const accounts = window.suiteBuiltinsFixture.snapshot.accounts;
    return !accounts.prompt && !accounts.pending && !accounts.loginPending && !accounts.cancelling;
  });
  await assertSameOwner(page);
}

export async function assertSameOwner(page) {
  assert.equal(await page.evaluate(() => {
    const f = window.suiteBuiltinsFixture, owner = window.foundationDesktop.redesign.owner;
    return f.controller === owner.controller && f.actions === owner.actions;
  }), true, 'current suite uses the same captured public actions and controller');
}
export async function assertReachable(page, control, name) {
  await control.scrollIntoViewIfNeeded();
  const geometry = await control.evaluate(element => {
    const r = element.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      hit: hit === element || element.contains(hit),
    };
  });
  assert.ok(geometry.inside && geometry.hit, name + ': ' + JSON.stringify(geometry));
  await control.focus();
  assert.equal(await control.evaluate(element => (element.getRootNode().activeElement ?? document.activeElement) === element), true, name + ' accepts keyboard focus');
  return { name, ...geometry };
}

export async function captureDefaultSurface(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const elements = [document.body, ...document.body.querySelectorAll('*')];
    return {
      images: elements.filter(node => node.tagName === 'IMG').map(node => node.getAttribute('src')),
      backgroundImages: elements.flatMap(node => ['', '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo || null).backgroundImage)).filter(image => /url\(/i.test(image)),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      theme: shell.dataset.theme,
      activation: window.suiteBuiltinsFixture.controller.getActivation().primary.bundle.manifest.views,
    };
  });
}

export async function assertIndependentReducedMotion(page, { navigate, text }) {
  const original = await page.evaluate(() => ({
    app: window.suiteBuiltinsFixture.snapshot.config.value.settings.appearance.reduce_motion,
    os: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference',
  }));
  const cases = [];
  const commit = async value => {
    await navigate('settings');
    await launcherAction(page, 'settings.patchAppearance', ['reduce_motion', value]);
    await page.waitForFunction(value => window.suiteBuiltinsFixture.snapshot.settings.draft.appearance.reduce_motion === value, value);
    assert.equal(await launcherAction(page, 'settings.save'), true, 'real settings owner commits independent app motion preference');
    await page.waitForFunction(value => window.foundationDesktop.config.settings.appearance.reduce_motion === value && !window.suiteBuiltinsFixture.snapshot.settings.saving && !window.suiteBuiltinsFixture.snapshot.settings.dirty, value);
    await navigate('home');
  };
  try {
    for (const [app, os] of [[true, 'no-preference'], [false, 'reduce']]) {
      await page.emulateMedia({ reducedMotion: os }); await commit(app);
      await launcherAction(page, 'profileDraft.openCreate', ['1.21.1']);
      const dialog = page.getByRole('dialog', { name: text('profileDialog.createTitle'), exact: true }); await dialog.waitFor();
      const observed = await page.evaluate(popup => {
        const shell = document.querySelector('.app-shell'), portal = popup.closest('.dialog-theme');
        if (!portal || shell.contains(popup)) throw Error('Real business dialog must use its existing external Portal');
        const scan = root => [root, ...root.querySelectorAll('*')].filter(element => element.getClientRects().length).flatMap(element => ['', '::before', '::after'].map(pseudo => {
          const css = getComputedStyle(element, pseudo || null);
          return { site: element.getAttribute('data-ui-site'), tag: element.tagName, pseudo, animationName: css.animationName, animationDuration: css.animationDuration, transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration, scrollBehavior: css.scrollBehavior };
        }));
        return {
          committedPreference: window.foundationDesktop.config.settings.appearance.reduce_motion,
          resolvedPreference: window.suiteBuiltinsFixture.snapshot.appearance.value.reduce_motion,
          osQuery: matchMedia('(prefers-reduced-motion: reduce)').matches,
          shellClasses: shell.className, portalClasses: portal.className,
          player: scan(shell), dialogPortal: scan(portal),
        };
      }, await dialog.elementHandle());
      assert.equal(observed.committedPreference, app); assert.equal(observed.resolvedPreference, app); assert.equal(observed.osQuery, os === 'reduce');
      for (const surface of ['player', 'dialogPortal']) {
        assert.ok(observed[surface].length > 0, 'actual visible ' + surface + ' has computed motion samples');
        const motion = observed[surface].filter(css => css.animationName !== 'none' || css.transitionDuration.split(',').some(value => parseFloat(value) > 0));
        assert.deepEqual(motion, [], surface + ' independently honors app=' + app + ', OS=' + os);
      }
      cases.push({ app, os, ...observed });
      await launcherAction(page, 'profileDraft.cancel'); await dialog.waitFor({ state: 'hidden' }); await assertSameOwner(page);
    }
    return cases;
  } finally {
    await launcherAction(page, 'profileDraft.cancel');
    await page.emulateMedia({ reducedMotion: original.os }); await commit(original.app);
  }
}

// Each phase reaches the permanently mounted business owner through its public
// action and the captured native invoke/event boundary. No snapshot is assigned.
export async function runRedesignScenario(page, name, { navigate, capture, text, theme, scale }) {
  const a = (path, args, awaitResult) => launcherAction(page, path, args, awaitResult);
  const wait = check => page.waitForFunction(check);
  const b = mutate => page.evaluate(mutate);
  const shot = phase => capture(name, phase);
  switch (name) {
    case 'appearance-committed-theme-scale': {
      await navigate('settings');
      await a('settings.setTab', ['appearance']);
      for (const [committedTheme, committedScale] of [[theme === 'dark' ? 'light' : 'dark', scale === 100 ? 85 : 100], [theme, scale]]) {
        await a('settings.patchAppearance', ['theme', committedTheme]);
        await a('settings.patchAppearance', ['ui_scale', committedScale]);
        await wait(() => window.suiteBuiltinsFixture.snapshot.settings.dirty);
        const readSaveState = () => page.evaluate(() => ({
          draft: window.suiteBuiltinsFixture.snapshot.settings.draft,
          dirty: window.suiteBuiltinsFixture.snapshot.settings.dirty,
          saving: window.suiteBuiltinsFixture.snapshot.settings.saving,
          committed: window.foundationDesktop.config.settings,
        }));
        const prior = await readSaveState();
        assert.equal(prior.dirty, true); assert.equal(prior.saving, false);
        assert.equal(prior.draft.appearance.theme, committedTheme);
        assert.equal(prior.draft.appearance.ui_scale, committedScale);
        await b(() => {
          const f = window.suiteBuiltinsFixture;
          f.snapshot.notifications.items.forEach(notice => f.actions.notifications.dismiss(notice.id));
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await readSaveState(), prior, 'public notice dismissal preserves unfinished settings and committed native config');
        const save = page.locator('.settings-page').getByRole('button', { name: text('settings.save'), exact: true });
        await assertReachable(page, save, 'commit theme and legal scale');
        await page.keyboard.press('Enter');
        await page.waitForFunction(({ theme, scale }) => {
          const f = window.suiteBuiltinsFixture, shell = document.querySelector('.app-shell');
          return !f.snapshot.settings.saving && !f.snapshot.settings.dirty &&
            window.foundationDesktop.config.settings.appearance.theme === theme &&
            window.foundationDesktop.config.settings.appearance.ui_scale === scale &&
            f.snapshot.appearance.theme === theme && f.snapshot.appearance.value.ui_scale === scale &&
            shell?.dataset.theme === theme && shell.style.fontSize === scale + '%';
        }, { theme: committedTheme, scale: committedScale });
        const resolved = await page.evaluate(() => {
          const shell = document.querySelector('.app-shell');
          return { fontSize: parseFloat(getComputedStyle(shell).fontSize), parentFontSize: parseFloat(getComputedStyle(shell.parentElement).fontSize) };
        });
        assert.ok(Math.abs(resolved.fontSize / resolved.parentFontSize - committedScale / 100) < 0.01, 'resolved root applies committed scale once');
      }
      await shot('saved-resolved-root');
      break;
    }
    case 'home-empty':
      await b(() => { window.foundationDesktop.config.profiles = []; window.foundationDesktop.config.active_profile = null; });
      await a('config.reload'); await navigate('home'); await shot('empty');
      await assertReachable(page, page.locator('.launch-button, .immersive-launch-primary'), name);
      await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
      await b(() => { const d = window.foundationDesktop; d.config.profiles = structuredClone(d.redesign.profiles); d.config.active_profile = 'original-instance'; });
      await a('config.reload'); break;
    case 'home-idle':
      await navigate('home'); await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'idle'); await shot('installed'); break;
    case 'home-other-running':
      await b(() => { window.foundationDesktop.redesign.repairKeys = []; }); await a('profiles.scan');
      await navigate('home'); await a('launch.request', ['beta-instance']); await a('launch.confirmAccount');
      await b(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Beta is running while Alpha remains current' }));
      await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'running');
      assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.launch.profileKey), 'beta-instance');
      assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey), 'original-instance');
      await shot('B-running-A-selected');
      await assertReachable(page, page.getByRole('button', { name: text('common.stopGame'), exact: true }), 'running stop');
      await page.keyboard.press('Enter');
      await b(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Stopped' }));
      await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'idle');
      await b(() => { window.foundationDesktop.redesign.repairKeys = ['beta-instance']; }); break;
    case 'instances-installed-repair':
      await a('profiles.scan'); await navigate('instances'); await shot('installed-repair');
      assert.equal(await page.locator('.instance-row').count(), 2); break;
    case 'detail-settings':
      await navigate('custom.instance-details');
      await page.locator('#root .instance-detail-tabs:visible, #root .instance-context-sidebar .detail-sections:visible').getByRole('button', { name: text('shellHome.sections.settings'), exact: true }).click();
      await shot('committed-settings'); break;
    case 'detail-local-loading-empty-error': {
      await navigate('custom.instance-details');
      await page.locator('#root .instance-detail-tabs:visible, #root .instance-context-sidebar .detail-sections:visible').getByRole('button', { name: text('shellHome.sections.mods'), exact: true }).click();
      await wait(() => {
        const f = window.suiteBuiltinsFixture, content = f.snapshot.content, request = content.listRequest;
        const profile = f.snapshot.config.value.profiles.find(profile => profile.instance_key === 'original-instance');
        return content.selectedProfileKey === 'original-instance' && content.category === 'mods' &&
          request?.profileKey === 'original-instance' && request.category === 'mods' && !request.loading &&
          request.directory === (profile?.game_directory ?? f.snapshot.config.value.settings.game_directory);
      });
      await boundaryMode(page, 'list_content', 'hold'); await a('content.refresh', [], false);
      await waitHeld(page, 'list_content');
      const loading = await page.evaluate(() => {
        const f = window.suiteBuiltinsFixture, profile = f.snapshot.config.value.profiles.find(profile => profile.instance_key === 'original-instance');
        return { args: window.foundationDesktop.redesign.held.list_content[0].args, request: f.snapshot.content.listRequest,
          directory: profile.game_directory ?? f.snapshot.config.value.settings.game_directory };
      });
      assert.deepEqual(loading.args, { key: 'original-instance', category: 'mods' });
      assert.deepEqual(loading.request, { profileKey: 'original-instance', directory: loading.directory, category: 'mods', loading: true, error: null });
      await shot('loading');
      await releaseBoundary(page, 'list_content', { value: [] });
      await wait(() => !window.suiteBuiltinsFixture.snapshot.content.listRequest?.loading); await shot('empty');
      await boundaryMode(page, 'list_content', 'fail'); await a('content.refresh');
      await wait(() => !!window.suiteBuiltinsFixture.snapshot.content.listRequest?.error); await shot('error');
      await a('content.refresh'); break;
    }
    case 'versions-cache-error':
      await navigate('custom.versions'); await a('catalog.refresh'); await shot('cache');
      await boundaryMode(page, 'catalog', 'fail'); await a('catalog.refresh', [true]);
      await wait(() => !!window.suiteBuiltinsFixture.snapshot.catalog.error); await shot('error-with-cache');
      await a('catalog.refresh', [true]); break;
    case 'downloads-all-states':
      await b(() => {
        const d = window.foundationDesktop;
        d.redesign.tasks = ['queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed'].map((status, index) => ({ id: 'task11-' + status, kind: index % 2 ? 'content' : 'install', name: 'Task ' + status, profile_key: index === 1 ? 'beta-instance' : null, java_major: null, status, message: status === 'failed' ? 'Failed files remain retryable: ' + 'long reason '.repeat(20) : status, progress: status === 'running' ? { total_files: 10, completed_files: 2, downloaded_files: 2, reused_files: 0, failed_files: 1, transferred_bytes: 1024, completed_bytes: 768, active_bytes: 256, total_bytes: null, bytes_per_second: 512, current_file: 'unknown-total-file.jar' } : null }));
        d.emit('launcher://downloads', structuredClone(d.redesign.tasks));
      });
      await navigate('downloads'); await shot('all-six-states-unknown-total');
      assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.downloads.tasks.length), 6);
      await b(() => { window.foundationDesktop.redesign.tasks = []; window.foundationDesktop.emit('launcher://downloads', []); }); break;
    case 'accounts-login-expired-error':
      await navigate('accounts'); await boundaryMode(page, 'account_state', 'fail'); await a('accounts.reload');
      await wait(() => !!window.suiteBuiltinsFixture.snapshot.accounts.loadError); await shot('load-error');
      await a('accounts.reload');
      await b(() => { window.foundationDesktop.accounts.client_id = '11111111-1111-1111-1111-111111111111'; window.foundationDesktop.redesign.expired = true; });
      await a('accounts.reload'); await a('accounts.login', [], false);
      await wait(() => window.suiteBuiltinsFixture.snapshot.accounts.promptExpired); await shot('expired-device-code');
      await cancelRedesignLogin(page); break;
    case 'discover-empty-error':
      await navigate('content'); await b(() => { window.foundationDesktop.redesign.searchEmpty = true; });
      await a('content.search'); await shot('empty');
      await boundaryMode(page, 'search_content', 'fail'); await a('content.search');
      await wait(() => !!window.suiteBuiltinsFixture.snapshot.content.searchError); await shot('error');
      await b(() => { window.foundationDesktop.redesign.searchEmpty = false; }); await a('content.search'); break;
    case 'settings-dirty-saving':
      await navigate('settings'); await a('settings.patch', ['memory_mb', 6144]); await shot('dirty');
      await boundaryMode(page, 'save_config', 'hold'); await a('settings.save', [], false);
      await waitHeld(page, 'save_config'); await shot('saving'); await releaseBoundary(page, 'save_config');
      await wait(() => !window.suiteBuiltinsFixture.snapshot.settings.saving); break;
    case 'logs':
      await b(() => { ['info', 'warning', 'error', 'debug'].forEach((level, index) => window.foundationDesktop.emit('launcher://log', { id: { session: 'task11', sequence: String(index + 1) }, time: 1700000000 + index, level, message: 'Selectable log line\n' + 'long English log path/'.repeat(18) })); });
      await navigate('logs'); await shot('four-levels-multiline'); break;
    default: throw Error('Unknown named redesign scenario: ' + name);
  }
  await assertSameOwner(page);
}
