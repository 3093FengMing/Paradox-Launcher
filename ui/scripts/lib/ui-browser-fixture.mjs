import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { initialConfig } from './hook-test-host.mjs';

export async function applyFixtureConfig(page, config = initialConfig) {
  await page.evaluate((value) => {
    localStorage.setItem('paradox-launcher-preview-v1', JSON.stringify(value));
    sessionStorage.clear();
  }, config);
  await page.reload();
  await page.locator('.app-shell').waitFor();
}

export async function openEditor(page) {
  await page.waitForFunction(() => (window.suiteFinalFixture ?? window.suiteBuiltinsFixture)?.controller.getActivation());
  if (await page.evaluate(() => (window.suiteFinalFixture ?? window.suiteBuiltinsFixture).controller.getSnapshot().initialSelectionRequired)) {
    const choice = page.locator('[data-style-choice]');
    await choice.locator('input[type="radio"]:checked').check();
    await choice.getByRole('button', { name: /^(?:Use this interface|使用此界面)$/ }).click();
    await page.waitForFunction(() => !(window.suiteFinalFixture ?? window.suiteBuiltinsFixture).controller.getSnapshot().initialSelectionRequired);
  }
  await page.evaluate(async () => {
    const c = (window.suiteFinalFixture ?? window.suiteBuiltinsFixture).controller;
    if (c.getSnapshot().selectedSuiteId?.startsWith('builtin.')) {
      const id = c.getSnapshot().selectedSuiteId.slice('builtin.'.length);
      await c.actions.copyBuiltin(id, 'Browser editor draft');
      const draft = c.getSnapshot().draft, source = draft.manifest.views['tool.editor'];
      if (!source || draft.files[source]?.encoding !== 'utf8') throw Error('Editable tool.editor binding missing');
      const imported = draft.files[source].text.match(/import\s+['"]([^'"]+\.css)['"]/);
      if (!imported) throw Error('tool.editor stylesheet import missing');
      const path = new URL(imported[1], 'https://fixture.invalid/' + source).pathname.slice(1);
      if (draft.files[path]?.encoding !== 'utf8') throw Error('Editable tool.editor stylesheet missing: ' + path);
      c.actions.selectFile(path);
    }
  });
  const editor = page.getByRole('dialog', { name: /^(?:UI Suite Editor|UI 套件编辑器)$/ });
  if (!(await editor.count())) await page.keyboard.press('Control+Shift+F11');
  await editor.waitFor({ state: 'visible' });
  return editor;
}

export async function createBrowserFixture({
  url,
  config,
  nativeCsp,
  desktopBoundary = false,
  oldNamespaceBytes,
  sourceFailure = null,
} = {}) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PARADOX_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({
    headless: process.env.PARADOX_BROWSER_HEADFUL !== '1',
    executablePath: process.env.PARADOX_BROWSER_EXECUTABLE,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1240, height: 720 },
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    if (oldNamespaceBytes) await page.addInitScript((bytes) => {
      for (const [key, value] of Object.entries(bytes)) localStorage.setItem(key, value);
      sessionStorage.setItem('paradox.ui-customization.safe', 'opaque legacy safe bytes');
    }, oldNamespaceBytes);
    // Observe startup as well as subsequent interactions. Callers keep live arrays.
    const observedPageErrors = [];
    const observedSourceModuleRequests = [];
    const observedCspViolations = [];
    page.on('pageerror', (error) => observedPageErrors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /content.security.policy|violates.*directive|refused.*(?:load|execute)/i.test(
          message.text(),
        )
      )
        observedCspViolations.push(message.text());
    });
    page.on('request', (request) => {
      if (/\/src\/|\/node_modules\//.test(request.url()))
        observedSourceModuleRequests.push(request.url());
    });
    if (desktopBoundary) {
      await page.addInitScript((initial) => {
        const state = {
          config: structuredClone(initial.config),
          sourceFailure: initial.sourceFailure,
          accounts: {
            client_id: '',
            active: 'account-a',
            accounts: [
              { id: 'account-a', name: 'Alex', skin_url: null },
              { id: 'account-b', name: 'Steve', skin_url: null },
            ],
          },
          suiteLibrary: {
            kind: 'paradox-ui-suite-library',
            schema_version: 1,
            revision: 0,
            active_suite_id: null,
            suites: [],
          },
          suiteRaw: null,
          suiteBackups: [],
          calls: [],
          loaderVersions: [
            { version: 'test-loader-1', stable: true },
            { version: 'test-loader-2', stable: false },
          ],
          accountFailure: false,
          backgroundPending: false,
          releaseBackground: null,
        };
        window.foundationDesktop = state;
        const suiteBytes = () =>
          (state.suiteRaw = new TextEncoder().encode(JSON.stringify(state.suiteLibrary)));
        const suiteDefaults = (revision) => ({
          kind: 'paradox-ui-suite-library',
          schema_version: 1,
          revision,
          active_suite_id: null,
          suites: [],
        });
        const rawBase64 = () => {
          let text = '';
          for (const b of state.suiteRaw ?? []) text += String.fromCharCode(b);
          return btoa(text);
        };
        const rawHash = async () =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', state.suiteRaw)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
        window.isTauri = true;
        const callbacks = new Map();
        const eventListeners = new Map();
        state.emit = (event, payload) => {
          for (const [id, entry] of eventListeners)
            if (entry.event === event) callbacks.get(entry.handler)?.({ event, id, payload });
        };
        let next = 0;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        window.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          transformCallback(callback) {
            callbacks.set(++next, callback);
            return next;
          },
          unregisterCallback(id) {
            callbacks.delete(id);
          },
          async invoke(command, args = {}) {
            state.calls.push({ command, args: structuredClone(args) });
            if (command === 'plugin:event|listen') {
              const id = ++next;
              eventListeners.set(id, args);
              return id;
            }
            if (command === 'plugin:event|unlisten') {
              eventListeners.delete(args.eventId);
              return;
            }
            if (command === 'get_config')
              return {
                config: structuredClone(state.config),
                config_path: 'Foundation fixture config',
              };
            if (command === 'save_config') {
              state.config = structuredClone(args.config);
              return structuredClone(state.config);
            }
            if (command === 'catalog')
              return {
                versions: [{ id: '1.21.1', kind: 'release' }],
                fetched_at: 0,
                source: 'cache',
                stale: false,
                warning: null,
                error_kind: null,
              };
            if (command === 'inspect_instances')
              return state.config.profiles.map((profile) => ({
                ...profile,
                root: `${profile.game_directory ?? state.config.settings.game_directory}/versions/${profile.instance_key}`,
              }));
            if (
              ['download_tasks', 'stored_logs', 'account_recovery', 'list_content'].includes(
                command,
              )
            )
              return [];
            if (command === 'account_state') return structuredClone(state.accounts);
            if (command === 'account_skin') return null;
            if (command === 'select_account') {
              if (state.accountFailure) throw new Error('Fixture select account failed');
              state.accounts.active = args.id;
              return structuredClone(state.accounts);
            }
            if (command === 'loader_versions') return structuredClone(state.loaderVersions);
            if (command === 'update_profile') {
              state.config.profiles = state.config.profiles.map((profile) =>
                profile.instance_key === args.profile.instance_key ? args.profile : profile,
              );
              return structuredClone(state.config);
            }
            if (command === 'create_profile') {
              const profile = {
                instance_key: 'created-fixture',
                name: args.name,
                game_version: args.version,
                loader: args.loader,
                loader_version: args.loaderVersion,
                game_directory: null,
                overrides: {},
              };
              state.config.profiles.push(profile);
              return structuredClone(state.config);
            }
            if (command === 'choose_background') {
              if (state.backgroundPending)
                return new Promise((resolve) => {
                  state.releaseBackground = resolve;
                });
              return null;
            }
            if (command === 'discover_java')
              return { installations: [], warnings: [], download_supported: false };
            if (command === 'search_content')
              return { hits: [], total_hits: 0, offset: args.offset, limit: 10 };
            if (
              ['launch_instance', 'close_launcher', 'stop_game', 'enqueue_install'].includes(
                command,
              )
            )
              return;
            if (command === 'get_ui_suite_library') {
              if (!state.suiteLibrary) throw new Error('Invalid native suite bytes');
              return structuredClone(state.suiteLibrary);
            }
            if (command === 'save_ui_suite_library') {
              if (!state.suiteLibrary || state.suiteLibrary.revision !== args.expectedRevision)
                throw new Error('Suite revision conflict');
              state.suiteLibrary = {
                ...structuredClone(args.library),
                revision: args.expectedRevision + 1,
              };
              suiteBytes();
              return structuredClone(state.suiteLibrary);
            }
            if (command === 'reset_ui_suite_library') {
              if (!state.suiteLibrary || state.suiteLibrary.revision !== args.expectedRevision)
                throw new Error('Suite revision conflict');
              if (state.suiteRaw) state.suiteBackups.push(Array.from(state.suiteRaw));
              state.suiteLibrary = suiteDefaults(args.expectedRevision + 1);
              suiteBytes();
              return structuredClone(state.suiteLibrary);
            }
            if (command === 'read_ui_suite_recoverable') return rawBase64();
            if (command === 'inspect_ui_suite_recovery')
              return {
                raw: rawBase64(),
                token:
                  state.suiteRaw === null
                    ? { kind: 'missing' }
                    : { kind: 'raw', sha256: await rawHash() },
              };
            if (command === 'reset_recoverable_ui_suite_library') {
              if (state.suiteLibrary) throw new Error('Valid library requires revision reset');
              const expected = args.expectedToken;
              if (
                state.suiteRaw === null
                  ? expected.kind !== 'missing'
                  : expected.kind !== 'raw' || expected.sha256 !== (await rawHash())
              )
                throw new Error('Recovery conflict');
              if (state.suiteRaw) state.suiteBackups.push(Array.from(state.suiteRaw));
              state.suiteLibrary = suiteDefaults(1);
              suiteBytes();
              return structuredClone(state.suiteLibrary);
            }
            throw new Error(`Unimplemented foundation fixture boundary: ${command}`);
          },
        };
      }, { config: config || initialConfig, sourceFailure });
    }
    if (nativeCsp ?? process.env.PARADOX_TEST_NATIVE_CSP === '1') {
      const csp = JSON.parse(
        await readFile(new URL('../../../apps/desktop/tauri.conf.json', import.meta.url), 'utf8'),
      ).app.security.csp;
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        const response = await route.fetch();
        return route.fulfill({
          response,
          headers: { ...response.headers(), 'content-security-policy': csp },
        });
      });
    }
    const versionManifestFixture = {
      latest: { release: '1.21.1', snapshot: '1.21.1' },
      versions: [],
    };
    await page.addInitScript((payload) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json' &&
            typeof method === 'string' && method.toUpperCase() === 'GET')
          return Promise.resolve(new Response(JSON.stringify(payload), {
            status: 200, headers: { 'content-type': 'application/json' },
          }));
        return originalFetch(input, init);
      };
    }, versionManifestFixture);
    await page.route('**/mojang/**', (route) =>
      route.fulfill({
        json: versionManifestFixture,
      }),
    );
    const navigation = await page.goto(
      url || process.env.PARADOX_UI_URL || 'http://127.0.0.1:1420',
    );
    if (sourceFailure) await page.locator('#paradox-suite-recovery').getByRole('dialog').waitFor();
    else await page.locator('.app-shell').waitFor();
    if (!desktopBoundary) await applyFixtureConfig(page, config || initialConfig);
    return {
      browser,
      context,
      page,
      observedPageErrors,
      observedSourceModuleRequests,
      observedCspViolations,
      contentSecurityPolicy: navigation.headers()['content-security-policy'] ?? null,
      async close() {
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
