import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { deferred, loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, library, record } from './lib/suite-test-fixtures.mjs';

const app = loadApp(new Map([[resolve(uiRoot, 'src/api.ts'), { desktop: false }]]));
const { createUiEditorController } = app('ui-editor/controller.tsx');
const tick = () => new Promise((yes) => setImmediate(yes));
const settle = async () => { for (let i = 0; i < 35; i++) await tick(); };
const cases = [];
const test = (name, run) => cases.push([name, run]);
test('builtin_source_equals_copied_export: real canonical source trees exist', () => {
  for (const id of ['modern', 'immersive'])
    for (const file of ['suite.json', 'Shell.tsx', 'Home.tsx', 'style.css'])
      assert.ok(existsSync(resolve(uiRoot, `src/ui-suite/builtins/${id}/${file}`)), `${id}/${file}: actual builtin source missing`);
  for (const file of ['Editor.tsx', 'FileTree.tsx', 'SourceEditor.tsx', 'AssetManager.tsx', 'style.css'])
    assert.ok(existsSync(resolve(uiRoot, `src/ui-suite/builtins/common/editor/${file}`)), file);
});
async function owner({ stored = { ...library([]), revision: 0 }, configFirst = false, failure = false, actualAck = null, saveGate = null, disableBeforeSource = false, defaultBuiltin = 'immersive' } = {}) {
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
    getBuiltinBundle: async (id) => { sources.push(id); await source.promise; return structuredClone(b); },
    createScope: () => ({}),
    compile: async () => ({ views: new Map(), routes: [], css: '', sourceDefinitions: [], viewMetadata: new Map(), dispose() {} }),
    exportFile: async () => {},
    acquireInteractionPublisher: () => ({ publish() {}, release() {} }), safe: false,
  });
  const disconnect = controller.connect();
  if (configFirst) config.resolve(); else read.resolve(structuredClone(stored));
  await settle();
  assert.equal(writes.length, 0, 'no initial write before configuration/library/source readiness');
  if (configFirst) read.resolve(structuredClone(stored)); else config.resolve();
  await settle();
  assert.equal(writes.length, 0, 'no initial write before actual source readiness');
  if (disableBeforeSource) controller.recovery.disable();
  source.resolve(); await settle();
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
  saveGate.resolve();await settle();
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
let failures = 0;
for (const [name, run] of cases) { try { await run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); } }
if (failures) process.exitCode = 1;
