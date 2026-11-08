import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import { initialConfig } from './lib/hook-test-host.mjs';

const out = resolve('.test-data/default-ui-task5', process.env.PARADOX_INSTANCES_EVIDENCE || 'focused');
await mkdir(out, { recursive: true });
const report = { rows: [], sourceHashes: {} };
for (const suite of ['modern', 'immersive']) for (const file of ['pages/InstancesPage.tsx', 'pages/InstanceDetailPage.tsx', 'components/ProfileCard.tsx', 'components/InstanceDetail.tsx', 'components/LocalContent.tsx', 'styles/instances.css', 'styles/instance-detail.css', 'components/AppSidebar.tsx', 'Shell.tsx']) {
  const path = 'src/ui-suite/builtins/' + suite + '/' + file;
  report.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
}
for (const path of ['src/ui-suite/builtins/common/lib/instance-display.ts', 'scripts/check-ui-instances-browser.mjs']) {
  report.sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
}
const config = structuredClone(initialConfig);
config.settings.language = 'en-US';
config.settings.argument_templates = [{ id: 'instance-template', name: 'Instance template', jvm: '-Dtemplate=yes', game: '--template-game', environment: { TEMPLATE: 'yes', BOTH: 'template' } }];
config.profiles[0].name = 'Alpha world';
config.profiles[0].overrides = { ...config.profiles[0].overrides, argument_template: 'instance-template', extra_game_arguments: '', environment: { BOTH: 'instance' } };
config.profiles.push({ ...structuredClone(config.profiles[0]), instance_key: 'beta-instance', name: 'Beta world', game_directory: 'D:/BetaRoot', overrides: { memory_mb: 6144, environment: {} } });
for (const suite of ['immersive', 'modern']) {
  const fixture = await createBrowserFixture({ desktopBoundary: true, config, url: `${process.env.PARADOX_UI_URL || 'http://127.0.0.1:1434'}?shellHome=${suite}` });
  const { page } = fixture, checks = [];
  const act = (fn, arg) => page.evaluate(fn, arg);
  const wait = fn => page.waitForFunction(fn);
  const site = name => page.locator(`[data-ui-site$=":${name}"]`);
  const pass = name => { checks.push(name); console.log(`PASS ${suite}: ${name}`); };
  const navigate = async key => {
    await act(key => window.suiteBuiltinsFixture.actions.navigation.navigate('custom.instance-details', key === null ? {} : { profileKey: key }), key);
    await site(key ? 'InstanceDetail-name' : 'InstanceDetail-missing-title').waitFor();
  };
  const section = async name => { const label = ({ Settings: 'Game settings', 'Shader packs': 'Shaders', Saves: 'Worlds' })[name] ?? name; await site('InstanceDetailPage-tabs').getByRole('button', { name: label, exact: true }).click(); };
  const settled = () => act(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await wait(() => window.suiteBuiltinsFixture?.ready);
    await act(async suite => window.suiteBuiltinsFixture.controller.actions.selectSuite('builtin.' + suite), suite);
    await page.locator('.' + suite + '-shell').waitFor();
    await act(() => {
      const native = window.__TAURI_INTERNALS__, invoke = native.invoke;
      const boundary = window.instanceBoundary = { hold: false, held: [], fail: false, empty: false, repair: true, toggled: [], removed: [], exportResult: true, packPath: 'C:/packs/fixture.mrpack', residual: false, retryCount: 0 };
      const files = args => [{ name: 'same-name.jar', category: args.category, size: 2048, enabled: true, record: { project_id: 'same', version_id: 'v1', title: args.key === 'beta-instance' ? 'Beta local file' : 'Alpha local file' } }];
      native.invoke = async (command, args = {}) => {
        if (['inspect_instances','list_content','toggle_mod','remove_content','open_content_directory','export_instance','choose_pack','enqueue_pack','scan_import','import_instances','remove_profile','retry_profile_files'].includes(command)) {
          window.foundationDesktop.calls.push({ command, args: structuredClone(args) });
          if (command === 'inspect_instances') return window.foundationDesktop.config.profiles.map(p => ({ ...p, loader: boundary.repair && p.instance_key === 'beta-instance' ? 'fabric' : p.loader, loader_version: boundary.repair && p.instance_key === 'beta-instance' ? '0.16.0' : p.loader_version, root: `${p.game_directory ?? window.foundationDesktop.config.settings.game_directory}/versions/${p.instance_key}` }));
          if (command === 'list_content') {
            if (boundary.hold) return new Promise((resolve, reject) => boundary.held.push({ args, resolve, reject, value: files(args) }));
            if (boundary.fail) throw Error('Task 5 persistent list failure');
            return boundary.empty ? [] : files(args);
          }
          if (command === 'toggle_mod') { boundary.toggled.push(args); return; }
          if (command === 'remove_content') { boundary.removed.push(args); return; }
          if (command === 'export_instance') return boundary.exportResult;
          if (command === 'choose_pack') return boundary.packPath;
          if (command === 'enqueue_pack') return { id: 'pack-' + boundary.packPath, kind: 'pack', name: 'Imported pack', status: 'completed', message: '', profile_key: null, progress: null };
          if (command === 'scan_import') return [{ instance_key: 'vanilla-import', game_version: '1.21.1', loader: 'vanilla', loader_version: '', root: args.directory + '/versions/vanilla-import' }, { instance_key: 'forge-import', game_version: '1.21.1', loader: 'forge', loader_version: '1', root: args.directory + '/versions/forge-import' }];
          if (command === 'import_instances') return structuredClone(window.foundationDesktop.config);
          if (command === 'remove_profile') {
            window.foundationDesktop.config.profiles = window.foundationDesktop.config.profiles.filter(p => p.instance_key !== args.key);
            return { config: structuredClone(window.foundationDesktop.config), file_removal: null, file_removal_error: boundary.residual ? 'Locked residual file' : null, file_removal_retry: boundary.residual ? 'original-token' : null, instance_root: 'D:/BetaRoot/versions/beta-instance' };
          }
          if (command === 'retry_profile_files') {
            boundary.retryCount++;
            return { config: structuredClone(window.foundationDesktop.config), file_removal: null, file_removal_error: boundary.retryCount === 1 ? 'Still locked' : null, file_removal_retry: boundary.retryCount === 1 ? 'replacement-token' : null, instance_root: 'D:/BetaRoot/versions/beta-instance' };
          }
          return;
        }
        return invoke(command, args);
      };
    });
    await act(async () => { await window.suiteBuiltinsFixture.actions.profiles.scan(); window.suiteBuiltinsFixture.actions.navigation.navigate('instances'); });
    await site('InstancesPage-root').waitFor();
    assert.equal(await site('ProfileCard-root').count(), 2);
    assert.match(await page.locator('[data-profile-key="beta-instance"].instance-row').innerText(), /Needs repair|repair/i);
    await site('InstancesPage-search').fill('Beta');
    assert.equal(await site('ProfileCard-root').count(), 1);
    await site('InstancesPage-clear').click();
    await site('InstancesPage-loader-filter').selectOption('fabric');
    assert.equal(await site('ProfileCard-root').count(), 1);
    await site('InstancesPage-clear').click();
    const before = await act(() => window.foundationDesktop.calls.filter(c => c.command === 'save_config').length);
    await page.locator('.instance-row[data-profile-key="beta-instance"] [data-ui-site$=":ProfileCard-view"]').click();
    if (suite === 'modern') {
      assert.equal(await page.locator('.instances-inspector .instance-detail').getAttribute('data-profile-key'), 'beta-instance');
      await site('InstanceDetail-open-full').click();
    }
    await site('InstanceDetail-name').waitFor();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey), 'original-instance');
    assert.equal(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'save_config').length), before);
    pass('actual_loader_filters_repair_and_viewing_does_not_select');
    // At a narrow viewport all six tabs are explicit visible controls in both suites.
    await page.setViewportSize({ width: 800, height: 700 });
    await navigate('original-instance');
    await section('Settings');
    assert.match(await site('InstanceDetail-settings-list').innerText(), /Instance template/);
    assert.match(await page.locator('[data-setting="game"]').innerText(), /Empty value/);
    await act(() => window.suiteBuiltinsFixture.actions.settings.patch('memory_mb', 12345));
    assert.doesNotMatch(await page.locator('[data-setting="maximum-memory"]').innerText(), /12345/);
    await site('InstanceDetail-edit-settings').click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.instanceDraft.profile.instance_key), 'original-instance');
    await page.keyboard.press('Escape');
    await act(() => window.suiteBuiltinsFixture.actions.settings.reset());
    await act(async () => { window.foundationDesktop.config.profiles[0].overrides.argument_template = 'missing-template'; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await site('InstanceDetail-invalid-template').waitFor();
    assert.match(await page.locator('[data-setting="jvm"]').innerText(), /Unavailable/);
    await act(async () => { window.foundationDesktop.config.profiles[0].overrides.argument_template = 'instance-template'; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await page.locator('.workspace > main').evaluate(e => { e.scrollTop = 0; });
    await page.screenshot({ path: resolve(out, `current-default-${suite}-settings-800.png`) });
    pass('committed_effective_settings_empty_overrides_invalid_templates_existing_editor');
    await section('Mods');
    await site('LocalContent-row').waitFor();
    assert.match(await site('LocalContent-list').innerText(), /Alpha local file/);
    await site('LocalContent-remove').click();
    assert.equal(await site('LocalContent-confirm').count(), 1);
    await act(() => { window.instanceBoundary.hold = true; void window.suiteBuiltinsFixture.actions.content.refresh(); });
    await wait(() => window.instanceBoundary.held.some(r => r.args.key === 'original-instance'));
    await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('custom.instance-details', { profileKey: 'beta-instance' }));
    await section('Mods');
    await site('LocalContent-loading').waitFor();
    assert.equal(await site('LocalContent-row').count(), 0);
    await wait(() => window.instanceBoundary.held.some(r => r.args.key === 'beta-instance'));
    await act(() => { const b = window.instanceBoundary; b.hold = false; for (const held of b.held.splice(0).reverse()) held.resolve(held.value); });
    await site('LocalContent-row').waitFor();
    assert.match(await site('LocalContent-list').innerText(), /Beta local file/);
    assert.equal(await site('LocalContent-confirm').count(), 0);
    await site('LocalContent-toggle').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.instanceBoundary.toggled.at(-1)), { key: 'beta-instance', name: 'same-name.jar' });
    await site('LocalContent-remove').click(); await site('LocalContent-confirm').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.instanceBoundary.removed.at(-1)), { key: 'beta-instance', category: 'mods', name: 'same-name.jar' });
    await act(() => { window.instanceBoundary.fail = true; });
    await site('LocalContent-refresh').click(); await site('LocalContent-error').waitFor();
    assert.equal(await site('LocalContent-row').count(), 0);
    await settled();
    assert.match(await site('LocalContent-error').innerText(), /persistent list failure/);
    await act(() => { window.instanceBoundary.fail = false; window.instanceBoundary.empty = true; });
    await site('LocalContent-retry').click(); await site('LocalContent-empty').waitFor();
    await act(() => { window.instanceBoundary.empty = false; window.instanceBoundary.hold = true; });
    await section('Resource packs');
    await site('LocalContent-loading').waitFor();
    await section('Shader packs');
    await wait(() => window.instanceBoundary.held.some(r => r.args.category === 'shaderpacks'));
    await act(() => { const b = window.instanceBoundary; b.hold = false; for (const held of b.held.splice(0).reverse()) held.resolve(held.value); });
    await site('LocalContent-row').waitFor();
    assert.equal(await site('LocalContent-root').getAttribute('data-category'), 'shaderpacks');
    assert.equal(await site('LocalContent-toggle').count(), 0);
    await section('Saves'); await site('LocalContent-row').waitFor();
    assert.equal(await site('LocalContent-remove').count(), 0);
    assert.equal(await site('LocalContent-toggle').count(), 0);
    await site('LocalContent-folder').click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.deepEqual(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'open_content_directory').at(-1).args), { key: 'beta-instance', category: 'saves' });
    await act(async () => { window.foundationDesktop.config.profiles[1].game_directory = 'E:/NewBase'; await window.suiteBuiltinsFixture.actions.config.reload(); });
    await wait(() => window.suiteBuiltinsFixture.snapshot.content.list?.directory === 'E:/NewBase');
    assert.match(await site('LocalContent-directory').innerText(), /E:\/NewBase\/versions\/beta-instance\/saves/);
    pass('same_name_profile_category_directory_identity_slow_error_empty_saves_folder');
    await section('Overview');
    await site('InstanceDetail-include-saves').check();
    for (const success of [true, false]) {
      await act(success => { window.instanceBoundary.exportResult = success; }, success);
      await site('InstanceDetail-export').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
      assert.deepEqual(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'export_instance').at(-1).args), { key: 'beta-instance', includeSaves: true });
      assert.equal(await site('InstanceDetail-include-saves').isChecked(), true);
    }
    assert.match(await site('InstanceDetail-export-help').innerText(), /mrpack.*zip/);
    await act(() => window.foundationDesktop.emit('launcher://downloads', [{ id: 'own-task', name: 'Beta task', kind: 'content', status: 'completed', profile_key: 'beta-instance', message: 'Done', progress: null }, { id: 'java-global', name: 'Global Java', kind: 'java', status: 'completed', profile_key: null, message: 'Done', progress: null }]));
    assert.match(await site('InstanceDetail-tasks').innerText(), /Beta task/);
    assert.doesNotMatch(await site('InstanceDetail-tasks').innerText(), /Global Java/);
    await site('InstanceDetail-tools-trigger').click();
    assert.match(await site('InstanceDetail-logs').innerText(), /global current logs/);
    await page.keyboard.press('Escape');
    assert.equal(await site('InstanceDetail-tools-trigger').evaluate(e => e === document.activeElement), true);
    pass('export_include_saves_cancellation_native_formats_task_ownership_global_log_menu');
    await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('instances'));
    for (const format of ['mrpack', 'zip']) {
      await act(format => { window.instanceBoundary.packPath = 'C:/packs/input.' + format; }, format);
      await site('InstancesPage-pack-import').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
      assert.deepEqual(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'enqueue_pack').at(-1).args), { source: 'C:/packs/input.' + format, remote: false });
    }
    await site('InstancesPage-import').click(); await page.getByRole('dialog').waitFor();
    await act(async () => { const a = window.suiteBuiltinsFixture.actions.importDraft; a.setDirectory('C:/Import'); await a.scan(); });
    assert.deepEqual(await act(() => window.suiteBuiltinsFixture.snapshot.importDraft.selected), ['vanilla-import']);
    const importDialog = page.getByRole('dialog', { name: 'Import existing instances', exact: true });
    const unsupportedCandidate = importDialog.getByRole('checkbox', { name: /^forge-import\s/ });
    assert.equal(await unsupportedCandidate.count(), 1);
    assert.equal(await unsupportedCandidate.isDisabled(), true);
    assert.equal(await importDialog.getByRole('checkbox').evaluateAll(inputs => inputs.filter(input => input.disabled).length), 1);
    const importSubmit = importDialog.getByRole('button', { name: 'Import 1 instance', exact: true });
    assert.equal(await importSubmit.count(), 1);
    await importSubmit.click();
    await wait(() => !window.suiteBuiltinsFixture.snapshot.importDraft.open);
    assert.deepEqual(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'import_instances').at(-1).args), { directory: 'C:/Import', keys: ['vanilla-import'] });
    await site('InstancesPage-import').click();
    await act(async () => { const a = window.suiteBuiltinsFixture.actions.importDraft; a.setDirectory('C:/Import'); await a.scan(); });
    await act(() => window.suiteBuiltinsFixture.actions.importDraft.setDirectory('C:/Changed'));
    await wait(() => window.suiteBuiltinsFixture.snapshot.importDraft.directory === 'C:/Changed');
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.importDraft.canSubmit), false);
    await page.keyboard.press('Escape');
    pass('pack_formats_existing_scan_eligibility_and_directory_invalidation');
    await navigate('beta-instance');
    await site('InstanceDetail-set-current').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey === 'beta-instance');
    await navigate('original-instance');
    await site('InstanceDetail-set-current').click();
    await wait(() => window.suiteBuiltinsFixture.snapshot.profiles.activeKey === 'original-instance');
    await act(async () => { window.instanceBoundary.repair = false; await window.suiteBuiltinsFixture.actions.profiles.scan(); await window.suiteBuiltinsFixture.actions.launch.request('beta-instance'); });
    await wait(() => !!window.suiteBuiltinsFixture.snapshot.launch.selection);
    await act(async () => window.suiteBuiltinsFixture.actions.launch.confirmAccount());
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.profileKey === 'beta-instance');
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Beta is running' }));
    assert.match(await site('InstanceDetail-status').innerText(), /Installed/);
    assert.doesNotMatch(await site('InstanceDetail-status').innerText(), /Running|Launching/);
    await navigate('beta-instance');
    assert.match(await site('InstanceDetail-status').innerText(), /Running/);
    await site('InstanceDetail-stop').click();
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Finished' }));
    await wait(() => window.suiteBuiltinsFixture.snapshot.launch.phase === 'idle');
    await act(() => window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'running', message: 'Unknown native runtime' }));
    await site('InstanceDetail-global-runtime').waitFor();
    assert.doesNotMatch(await site('InstanceDetail-status').innerText(), /Running|Launching/);
    await act(async () => { window.foundationDesktop.emit('launcher://activity', { action: 'launch', status: 'finished', message: 'Finished' }); window.instanceBoundary.repair = true; await window.suiteBuiltinsFixture.actions.profiles.scan(); });
    pass('explicit_current_selection_and_A_selected_B_running_unknown_runtime_attribution');
    for (const theme of ['dark','light']) {
      await act(async theme => { window.foundationDesktop.config.settings.appearance.theme = theme; await window.suiteBuiltinsFixture.actions.config.reload(); }, theme);
      await act(() => { const f = window.suiteBuiltinsFixture; for (const notice of f.snapshot.notifications.items) f.actions.notifications.dismiss(notice.id); });
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: width === 320 ? 240 : 900 });
        await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('instances'));
        await site('InstancesPage-search').fill('Beta'); await site('InstancesPage-clear').click();
        await site('InstancesPage-pack-import').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true);
        if (width === 1440) {
          await page.locator('.workspace > main').evaluate(e => { e.scrollTop = 0; });
          if (suite === 'immersive') for (const height of await site('ProfileCard-root').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))) assert.ok(height >= 60 && height <= 68, 'compact normal and repair rows stay 60–68px');
          if (suite === 'modern') {
            const columns = await page.evaluate(() => ({
              headings: Array.from(document.querySelector('.instances-table-heading').children, cell => cell.getBoundingClientRect().left),
              row: Array.from(document.querySelector('.modern-instance-row').children, cell => cell.getBoundingClientRect().left),
            }));
            assert.equal(columns.headings.length, columns.row.length);
            for (let index = 0; index < columns.row.length; index++) assert.ok(Math.abs(columns.headings[index] - columns.row[index]) <= 1, 'table headers align with their row columns');
          }
        }
        await page.screenshot({ path: resolve(out, `current-default-${suite}-${theme}-instances-${width}.png`) });
        await navigate('beta-instance');
        if (width === 1440 && theme === 'dark') {
          await page.locator('.workspace > main').evaluate(e => { e.scrollTop = 0; });
          await page.screenshot({ path: resolve(out, `current-default-${suite}-overview-1440.png`) });
        }
        if (suite === 'immersive' && width > 959) await site('AppSidebar-section').filter({ hasText: /^Mods$/ }).click(); else await section('Mods');
        await site('LocalContent-row').waitFor(); await site('LocalContent-remove').scrollIntoViewIfNeeded();
        await site('LocalContent-remove').click(); await site('LocalContent-cancel').click();
        const box = await site('LocalContent-folder').boundingBox();
        assert.ok(box.width <= width && box.x >= 0);
        await page.screenshot({ path: resolve(out, `current-default-${suite}-${theme}-local-${width}.png`) });
      }
    }
    pass('default_source_two_themes_1440_and_320x240_reachable_local_operations');
    await page.setViewportSize({ width: 800, height: 700 });
    await navigate(null); assert.equal(await site('LocalContent-root').count(), 0);
    await act(() => window.suiteBuiltinsFixture.actions.navigation.navigate('custom.instance-details', { profileKey: 'deleted-key' }));
    await site('InstanceDetail-missing-title').waitFor();
    assert.equal(await site('InstanceDetail-launch').count(), 0);
    await navigate('beta-instance');
    await act(async () => { const a = window.suiteBuiltinsFixture.actions; window.instanceBoundary.residual = true; a.removal.open('beta-instance'); a.removal.setDeleteFiles(true); a.removal.setConfirmation('Beta world'); await a.removal.submit(); a.removal.cancel(); });
    await site('InstanceDetail-missing-title').waitFor();
    assert.equal(await site('LocalContent-root').count(), 0);
    await site('InstanceDetail-missing-back').click(); await site('InstancesPage-residual').waitFor();
    await site('InstancesPage-search').fill('nothing-matches');
    await site('InstancesPage-residual-retry').click();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.removal.recovery.token), 'original-token');
    await act(async () => { await window.suiteBuiltinsFixture.actions.removal.submit(); window.suiteBuiltinsFixture.actions.removal.cancel(); });
    await site('InstancesPage-residual-retry').click();
    assert.equal(await act(() => window.suiteBuiltinsFixture.snapshot.removal.recovery.token), 'replacement-token');
    await act(async () => window.suiteBuiltinsFixture.actions.removal.submit());
    assert.deepEqual(await act(() => window.foundationDesktop.calls.filter(c => c.command === 'retry_profile_files').map(c => c.args.token)), ['original-token','replacement-token']);
    pass('missing_deleted_detail_no_actions_residual_retries_keep_original_then_replacement_token');
    await act(async suite => {
      const c = window.suiteBuiltinsFixture.controller;
      await c.actions.copyBuiltin(suite, 'Task 5 source identity fixture');
      for (const [id, name] of [['component.profile-card','ProfileCard'],['component.instance-detail','InstanceDetail'],['component.local-content','LocalContent']]) {
        const path = `${suite}/components/${name}.tsx`;
        c.actions.createFile(`${name}Wrapper.tsx`, 'tsx');
        c.actions.patchFile(`${name}Wrapper.tsx`, `export default function Wrapper({props,Original}) { return <div data-ui-site="task5-wrapper" data-task5-view="${id}" data-task5-key={props.profileKey}><Original {...props}/></div>; }`);
        const manifest = c.getSnapshot().draft.manifest;
        if (manifest.views[id] !== path) throw Error('Task 5 view is not suite-owned');
        c.actions.patchManifest({ views: { ...manifest.views, [id]: `${name}Wrapper.tsx` } });
      }
      if (!await c.actions.preview()) throw Error('Task 5 custom Original preview failed');
      c.actions.close();
      window.suiteBuiltinsFixture.actions.navigation.navigate('instances');
    }, suite);
    await site('InstancesPage-clear').click().catch(() => {});
    await page.locator('[data-task5-view="component.profile-card"]').waitFor();
    assert.equal(await page.locator('[data-task5-view="component.profile-card"]').getAttribute('data-task5-key'), 'original-instance');
    await navigate('original-instance');
    assert.equal(await page.locator('[data-task5-view="component.instance-detail"]').getAttribute('data-task5-key'), 'original-instance');
    // Original deliberately enters its parent layer. Check a descendant override
    // after returning the detail component to this customized layer.
    await act(async suite => {
      const c = window.suiteBuiltinsFixture.controller;
      c.actions.patchManifest({ views: { ...c.getSnapshot().draft.manifest.views, 'component.instance-detail': suite + '/components/InstanceDetail.tsx' } });
      if (!await c.actions.preview()) throw Error('Local Original preview failed');
      c.actions.close();
    }, suite);
    await section('Mods'); await site('LocalContent-row').waitFor();
    assert.equal(await page.locator('[data-task5-view="component.local-content"]').getAttribute('data-task5-key'), 'original-instance');
    await site('LocalContent-toggle').click(); await wait(() => !window.suiteBuiltinsFixture.snapshot.content.pending);
    assert.equal(await act(() => window.instanceBoundary.toggled.at(-1).key), 'original-instance');
    await page.screenshot({ path: resolve(out, `source-customized-fixture-${suite}-Original-identity.png`) });
    pass('custom_sources_original_props_profile_key_and_local_actions_remain_exact');
    assert.deepEqual(fixture.observedPageErrors, []);
    report.rows.push({ suite, checks, errors: fixture.observedPageErrors });
  } catch (error) {
    await page.screenshot({ path: resolve(out, `failure-${suite}.png`) });
    report.rows.push({ suite, checks, error: String(error), pageErrors: fixture.observedPageErrors });
    throw error;
  } finally {
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
    await fixture.close();
  }
}
