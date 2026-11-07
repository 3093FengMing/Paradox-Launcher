import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { deferred, initialConfig, loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, library, record } from './lib/suite-test-fixtures.mjs';

const app = loadApp(new Map([[resolve(uiRoot, 'src/api.ts'), { desktop: false }]]));
const { createUiEditorController } = app('ui-editor/controller.tsx');
const tick = () => new Promise((yes) => setImmediate(yes));
async function waitFor(predicate, controller, label) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `${label}: ${JSON.stringify(controller.getSnapshot())}`);
    await tick();
  }
}
async function initialize(controller) {
  let timer;
  try {
    await Promise.race([controller.whenInitialized(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`initialization: ${JSON.stringify(controller.getSnapshot())}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
const cases = [];
const test = (name, run) => cases.push([name, run]);
test('builtin_source_equals_copied_export: real canonical source trees exist', () => {
  for (const id of ['modern', 'immersive'])
    for (const file of ['suite.json', 'Shell.tsx', 'Home.tsx', 'style.css'])
      assert.ok(existsSync(resolve(uiRoot, `src/ui-suite/builtins/${id}/${file}`)), `${id}/${file}: actual builtin source missing`);
  for (const file of ['Editor.tsx', 'FileTree.tsx', 'SourceEditor.tsx', 'AssetManager.tsx', 'style.css'])
    assert.ok(existsSync(resolve(uiRoot, `src/ui-suite/builtins/common/editor/${file}`)), file);
});
async function owner({ stored = { ...library([]), revision: 0 }, configFirst = false, failure = false, actualAck = null, saveGate = null, disableBeforeSource = false, defaultBuiltin = 'immersive', builtinBundles = {}, builtinNames = null } = {}) {
  const config = deferred(), read = deferred(), source = deferred();
  const writes = [], sources = [];
  const b = bundle();
  const controller = createUiEditorController({
    storage: {
      loadSuiteLibrary: () => read.promise,
      saveSuiteLibrary: async (candidate, revision) => {
        writes.push({ candidate: structuredClone(candidate), revision });
        assert.equal(revision, stored.revision);
        if (saveGate) await saveGate.promise;
        if (failure) throw Error('Suite CAS conflict / failed acknowledgement');
        stored = actualAck ?? { ...structuredClone(candidate), revision: revision + 1 };
        return structuredClone(stored);
      },
    },
    waitForConfiguration: () => config.promise,
    getDefaultBuiltin: () => defaultBuiltin,
    getBuiltinBundle: async (id) => { sources.push(id); await source.promise; return structuredClone(builtinBundles[id] ?? b); },
    getBuiltinName: builtinNames ? async id => builtinNames[id] : undefined,
    createScope: () => ({}),
    compile: async () => ({ views: new Map(), routes: [], css: '', sourceDefinitions: [], viewMetadata: new Map(), dispose() {} }),
    exportFile: async () => {},
    acquireInteractionPublisher: () => ({ publish() {}, release() {} }), safe: false,
  });
  const disconnect = controller.connect();
  if (configFirst) config.resolve(); else read.resolve(structuredClone(stored));
  if (configFirst) await tick();
  else await waitFor(() => controller.getSnapshot().loaded, controller, 'library load');
  assert.equal(writes.length, 0, 'no initial write before configuration/library/source readiness');
  if (configFirst) read.resolve(structuredClone(stored)); else config.resolve();
  await waitFor(() => sources.length > 0, controller, 'source request');
  assert.equal(writes.length, 0, 'no initial write before actual source readiness');
  if (disableBeforeSource) controller.recovery.disable();
  source.resolve();
  if (saveGate) await waitFor(() => writes.length > 0, controller, 'default save');
  else await initialize(controller);
  return { controller, writes, sources, stored, disconnect };
}
for (const configFirst of [false, true]) test(`durable_default_${configFirst ? 'config_first' : 'library_first'}_actual_commit_reload`, async () => {
  const f = await owner({ configFirst });
  assert.equal(f.writes.length, 1, 'first builtin default must commit through existing CAS owner');
  assert.equal(f.writes[0].candidate.active_suite_id, 'builtin.immersive');
  assert.equal(f.controller.getLibrary().revision, 1);
  assert.equal(f.controller.getSnapshot().selectedSuiteId, 'builtin.immersive');
  f.disconnect();
  const reload = await owner({ stored: f.stored, configFirst: !configFirst, defaultBuiltin:'modern' });
  assert.equal(reload.writes.length, 0, 'persisted choice survives process reload');
  assert.equal(reload.controller.getSnapshot().selectedSuiteId, 'builtin.immersive'); reload.disconnect();
});
test('default_failed_ack_preserves_library_authority', async () => {
  const f = await owner({ failure: true });
  assert.equal(f.writes.length, 1);
  assert.equal(f.controller.getLibrary().revision, 0);
  assert.equal(f.controller.getLibrary().active_suite_id, null);
  assert.equal(f.controller.getSnapshot().suspended, true);
  assert.match(f.controller.getSnapshot().diagnostics.join(), /CAS conflict/); f.disconnect();
});
test('default_consumes_actual_ack_choice_and_revision', async () => {
  const actualAck = { ...library([]), revision: 7, active_suite_id: 'builtin.modern' };
  const f = await owner({ actualAck });
  assert.equal(f.controller.getLibrary().revision, 7);
  assert.equal(f.controller.getSnapshot().selectedSuiteId, 'builtin.modern'); f.disconnect();
});
test('default_ack_keeps_newer_source_draft', async () => {
  const saveGate=deferred();const f=await owner({saveGate});
  assert.equal(f.writes.length,1);
  await f.controller.actions.copyBuiltin('modern','Newer unsaved copy');
  f.controller.actions.patchFile('Home.tsx','export default()=>null; // newer edit');
  const selected=f.controller.getSnapshot().selectedSuiteId;
  saveGate.resolve();await initialize(f.controller);
  assert.equal(f.controller.getLibrary().active_suite_id,'builtin.immersive');
  assert.equal(f.controller.getSnapshot().selectedSuiteId,selected);
  assert.match(f.controller.getSnapshot().draft.files['Home.tsx'].text,/newer edit/);
  assert.equal(f.controller.getSnapshot().dirty,true);f.disconnect();
});
test('F12_before_sources_cannot_reactivate_late_initialization', async()=>{
  const f=await owner({disableBeforeSource:true});
  assert.equal(f.controller.getSnapshot().suspended,true);
  assert.equal(f.controller.getActivation().primary,f.controller.getActivation().trusted);
  assert.equal(f.writes.length,1);f.disconnect();
});
test('catalog_is_checked_detached_and_failed_save_not_optimistic',async()=>{
  const stored=library([record()]);const f=await owner({stored,failure:true});
  const before=f.controller.getSnapshot().suites;
  assert.equal(before.filter(x=>x.builtin).length,2);
  assert.equal(before.find(x=>!x.builtin).id,stored.suites[0].instance_id);
  assert.ok(Object.isFrozen(before)&&before.every(Object.isFrozen));
  stored.suites[0].manifest.name='outside mutation';
  assert.notEqual(f.controller.getSnapshot().suites.find(x=>!x.builtin).name,'outside mutation');
  await f.controller.actions.copyBuiltin('modern','Unacknowledged user');
  assert.equal(f.controller.getSnapshot().suites,before);
  assert.equal(await f.controller.actions.save(),false);
  assert.equal(f.controller.getSnapshot().suites,before);
  assert.equal(f.controller.getSnapshot().dirty,true);f.disconnect();
});
test('catalog_caption_does_not_load_an_unselected_builtin_source_tree', async () => {
  const f = await owner({ defaultBuiltin: 'modern', builtinNames: { modern: 'Modern', immersive: 'Immersive' } });
  try {
    assert.ok(f.sources.every(id => id === 'modern'), 'trusted runtime and selected source need only modern');
    assert.equal(f.controller.getSnapshot().suites.find(suite => suite.id === 'builtin.immersive').name, 'Immersive');
    await f.controller.actions.copyBuiltin('immersive', 'Requested copy');
    assert.ok(f.sources.includes('immersive'), 'explicit copying loads its full source tree');
  } finally { f.disconnect(); }
});
test('lazy_builtin_sources_load_only_the_requested_tree_and_preserve_export_bytes', async () => {
  const calls = [];
  const input = bundle({ 'Home.tsx': { encoding: 'utf8', text: 'export default()=>null; // 精确\r\n' } });
  const raw = input.files['Home.tsx'].text;
  const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url));
  const loaders = {
    sources: {
      './builtins/modern/suite.json': async () => { calls.push('manifest'); return JSON.stringify(input.manifest); },
      './builtins/common/Home.tsx': async () => { calls.push('common'); return raw; },
      './builtins/modern/Home.tsx': async () => { calls.push('modern'); return raw; },
      './builtins/immersive/Home.tsx': async () => { throw Error('Unrequested source loaded'); },
      './builtins/immersive/suite.json': async () => { throw Error('Unrequested manifest loaded'); },
    }, raster: { './builtins/common/assets/art.png': async () => 'data:image/png;base64,' + png.toString('base64') }, vectors: {},
  };
  input.manifest.views = Object.fromEntries(Object.keys(input.manifest.views).map(view => [view, 'common/Home.tsx']));
  input.manifest.routes.forEach(route => { route.entry = 'common/Home.tsx'; });
  const { readBuiltinBundle, readBuiltinName } = app('ui-suite/builtin-files.ts');
  assert.equal(await readBuiltinName('modern', loaders.sources), input.manifest.name);
  assert.deepEqual(calls, ['manifest']); calls.length = 0;
  const decoder = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async blob => {
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
    return { width: 1, height: 1, close() {} };
  };
  try {
    const loaded = await readBuiltinBundle('modern', loaders);
    assert.deepEqual(calls.sort(), ['common', 'manifest', 'modern']);
    assert.equal(loaded.files['common/Home.tsx'].text, raw);
    assert.deepEqual(Buffer.from(loaded.files['common/assets/art.png'].data, 'base64'), png);
    assert.ok(!Object.keys(loaded.files).some(path => path.startsWith('immersive/')));
    loaders.raster['./builtins/common/assets/bad.png'] = async () => '/assets/bad.png';
    await assert.rejects(readBuiltinBundle('modern', loaders), /artwork encoding unavailable/);
  } finally { globalThis.createImageBitmap = decoder; }
});
test('immersive_copy_keeps_appearance_controls_from_its_layout_source', async () => {
  const immersive = bundle({ 'immersive/Shell.tsx': { encoding: 'utf8', text: 'export default()=>null;' } });
  immersive.manifest.views['layout.shell'] = 'immersive/Shell.tsx';
  const f = await owner({ builtinBundles: { immersive } });
  try {
    await f.controller.actions.copyBuiltin('immersive', 'Copied immersive');
    const copy = f.controller.getSnapshot();
    assert.notEqual(copy.selectedSuiteId, 'builtin.immersive');
    assert.notEqual(copy.draft.manifest.id, immersive.manifest.id);
    const require = createRequire(new URL('../package.json', import.meta.url));
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    let snapshot = copy;
    const viewApp = loadApp(new Map([
      ['@paradox/launcher', {
        useLauncherSnapshot: () => ({ settings: { draft: initialConfig.settings } }),
        useLauncherActions: () => ({ settings: { patchAppearance() {} } }),
        useUiEditorSnapshot: () => snapshot, useUiEditorActions: () => ({}),
      }],
      ['react-i18next', { useTranslation: () => ({ t: key => key }) }],
    ]));
    const view = viewApp('ui-suite/builtins/common/components/AppearanceSettings.tsx').default;
    const render = () => renderToStaticMarkup(React.createElement(view));
    for (const key of ['blur', 'dim', 'sidebarOpacity', 'backgroundImmersive'])
      assert.ok(render().includes(`appearance.${key}`), key);
    snapshot = { ...copy, selectedSuiteId: 'builtin.immersive', draft: bundle() };
    assert.ok(!render().includes('appearance.blur'), 'reserved ID does not grant absent layout capabilities');
    const legacyView = viewApp('components/AppearanceSettings.tsx').default;
    const { UiEditorSnapshotContext } = viewApp('ui-editor/public.ts');
    const legacy = () => renderToStaticMarkup(React.createElement(UiEditorSnapshotContext.Provider,
      { value: snapshot }, React.createElement(legacyView, {
        appearance: initialConfig.settings.appearance, onPatch() {},
      })));
    assert.ok(!legacy().includes('appearance.blur'), 'compatibility view uses the same active layout source');
    snapshot = copy;
    assert.ok(legacy().includes('appearance.blur'), 'compatibility view keeps copied layout controls');
  } finally { f.disconnect(); }
});
let failures = 0;
for (const [name, run] of cases) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); } }
if (failures) process.exitCode = 1;
