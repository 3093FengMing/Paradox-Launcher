import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { deferred, loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, descriptors, library, record, zipBundle } from './lib/suite-test-fixtures.mjs';
import { fixture as launcherFixture } from './lib/launcher-provider-fixture.mjs';

// Removing the permanent owner must fail here, before any fixture substitutes it.
assert.ok(existsSync(resolve(uiRoot, 'src/ui-editor/controller.tsx')),
  'editor_self_replace_keeps_draft_and_operation: permanent controller is required');
const app = loadApp(new Map([[resolve(uiRoot, 'src/api.ts'), { desktop: false }]]));
const { createUiEditorController, draftToSuiteRecord } = app('ui-editor/controller.tsx');
const tick = () => new Promise((yes) => setImmediate(yes));
// Native WebCrypto jobs need completion signals, not a fixed number of event-loop turns.
async function boundary(work, controller, label) {
  let timeout;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(
        `${label} timed out: ${JSON.stringify(controller.getSnapshot().diagnostics)}`,
      )), 10_000);
    })]);
  } finally { clearTimeout(timeout); }
}
function holdSaveAcknowledgement(f) {
  const submitted = deferred(), held = deferred(), save = f.storage.saveSuiteLibrary;
  f.storage.saveSuiteLibrary = async (...args) => {
    const ack = await save(...args);
    submitted.resolve();
    await held.promise;
    return ack;
  };
  return {
    release: held.resolve,
    whenSubmitted(work) {
      return boundary(Promise.race([submitted.promise, work.then((result) => {
        throw new Error(`Save completed (${result}) before submission: ${JSON.stringify(f.snapshot().diagnostics)}`);
      })]), f.controller, 'Save submitted-write boundary');
    },
  };
}
function prepared() {
  return { digest: 'fixture', views: new Map(), routes: [], css: '', sourceDefinitions: [],
    viewMetadata: new Map(), targetBindings: [], styleUsages: [], styleGroups: new Map(),
    disposed: false, dispose() { this.disposed = true; } };
}
async function editor(options = {}) {
  const b = bundle({ 'Editor.tsx': { encoding: 'utf8', text: 'export default () => null' },
    'a.tsx': { encoding: 'utf8', text: 'a' }, 'b.tsx': { encoding: 'utf8', text: 'b' } });
  b.manifest.views['tool.editor'] = 'Editor.tsx';
  let stored = options.library ?? library([record(b)]);
  const writes = [], exports = [], compiles = [], leases = [];
  const storage = {
    loadSuiteLibrary: async () => structuredClone(stored),
    saveSuiteLibrary: async (candidate, revision) => {
      assert.equal(revision, stored.revision);
      const ack = { ...structuredClone(candidate), revision: revision + 1 };
      writes.push(ack); stored = ack; return structuredClone(ack);
    },
    resetSuiteLibrary: async (revision) => {
      assert.equal(revision, stored.revision);
      stored = { ...library([]), revision: revision + 1 }; return structuredClone(stored);
    },
    inspectSuiteRecovery: async () => ({ raw: new Uint8Array([255, 0, 65]), token: { kind: 'raw', sha256: 'a'.repeat(64) } }),
    readRecoverableLibrary: async () => new Uint8Array([255, 0, 65]),
    resetRecoverableSuiteLibrary: async () => ({ ...library([]), revision: 1 }),
    ...options.storage,
  };
  const controller = createUiEditorController({ storage,
    getBuiltinBundle: async () => structuredClone(b),
    waitForConfiguration: options.waitForConfiguration,
    getDefaultBuiltin: () => options.defaultBuiltin ?? 'immersive',
    createScope: () => ({}),
    compile: async (value, scope, ownership) => {
      compiles.push({ value, scope, ownership });
      if (!ownership.isCurrent()) throw new DOMException('stale', 'AbortError');
      return options.compile ? options.compile(value, scope, ownership) : prepared();
    },
    exportFile: async (name, bytes) => exports.push({ name, bytes }),
    acquireInteractionPublisher: () => {
      const lease = { patches: [], publish(p) { this.patches.push(p); }, release() { this.released = true; } };
      leases.push(lease); return lease;
    }, safe: options.safe ?? false,
  });
  const disconnect = controller.connect();
  if (options.deferInitialization) await tick();
  else await boundary(controller.whenInitialized(), controller, 'Editor initialization');
  return { controller, actions: controller.actions, recovery: controller.recovery,
    snapshot: controller.getSnapshot, writes, exports, compiles, leases, disconnect, storage };
}
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const pristine = () => ({ ...library([]), revision: 0, active_suite_id: null });
const onboarding = (options = {}) => editor({ library: pristine(), waitForConfiguration: async () => {}, ...options });
for (const first of ['library', 'source']) test(`pristine_${first}_first`, async () => {
  const data = deferred(), config = deferred();
  const f = await onboarding({ deferInitialization: true, storage: { loadSuiteLibrary: () => data.promise }, waitForConfiguration: () => config.promise });
  assert.equal(f.snapshot().initialSelectionRequired, false);
  if (first === 'library') data.resolve(pristine()); else config.resolve();
  await tick(); assert.equal(f.writes.length, 0); assert.equal(f.snapshot().initialSelectionRequired, false);
  if (first === 'library') config.resolve(); else data.resolve(pristine());
  await boundary(f.controller.whenInitialized(), f.controller, 'Onboarding readiness');
  assert.equal(f.snapshot().initialSelectionRequired, true); assert.equal(f.writes.length, 0);
  assert.equal(await f.actions.selectSuite('builtin.immersive'), true);
  assert.equal(f.controller.getLibrary().revision, 1); assert.equal(f.snapshot().initialSelectionRequired, false);
  const saved = f.controller.getLibrary(); f.disconnect();
  const restart = await onboarding({ library: saved });
  assert.equal(restart.snapshot().initialSelectionRequired, false); assert.equal(restart.writes.length, 0);
  assert.equal(restart.snapshot().selectedSuiteId, 'builtin.immersive'); restart.disconnect();
});
test('pristine_safe_reset_and_corrupt_are_not_first_choice', async () => {
  for (const options of [{ safe: true }, { library: { ...pristine(), revision: 1 } }, { storage: { loadSuiteLibrary: async () => { throw Error('corrupt DATA'); } } }]) {
    const f = await onboarding(options);
    assert.equal(f.snapshot().initialSelectionRequired, false);
    assert.equal(f.writes.length, options.library ? 1 : 0); f.disconnect();
  }
});
test('F12_before_queued_write', async () => {
  const f = await onboarding(), queue = deferred(), queued = deferred(), candidates = [];
  const serialize = f.controller.serialize.bind(f.controller);
  f.controller.persistence = queue.promise;
  f.controller.serialize = (run) => { queued.resolve(); return serialize(run); };
  const prepare = f.controller.prepareActivation.bind(f.controller);
  f.controller.prepareActivation = async (...args) => { const c = await prepare(...args); candidates.push(c); return c; };
  const work = f.actions.selectSuite('builtin.immersive');
  await boundary(queued.promise, f.controller, 'Prepared queued selection'); f.recovery.disable(); queue.resolve();
  assert.equal(await work, false); assert.equal(f.writes.length, 0);
  assert.equal(f.snapshot().initialSelectionRequired, true); assert.equal(f.snapshot().suspended, true);
  assert.equal(candidates.length, 1); assert.equal(candidates[0].retired, true); f.disconnect();
});
test('F12_after_saved_ack', async () => {
  const f = await onboarding(), held = holdSaveAcknowledgement(f), originalDraft = f.snapshot().draft;
  const work = f.actions.selectSuite('builtin.immersive'); await held.whenSubmitted(work);
  assert.equal(f.snapshot().initialSelectionRequired, true); f.recovery.disable(); held.release();
  assert.equal(await work, true); assert.equal(f.controller.getLibrary().revision, 1);
  assert.equal(f.snapshot().draft, originalDraft); assert.equal(f.snapshot().initialSelectionRequired, true);
  assert.equal(f.snapshot().suspended, true); assert.equal(f.controller.getActivation().primary.layerId, 'trusted.modern');
  const saved = f.controller.getLibrary(); f.disconnect();
  const restart = await onboarding({ library: saved }); assert.equal(restart.snapshot().initialSelectionRequired, false);
  assert.equal(restart.snapshot().selectedSuiteId, 'builtin.immersive'); restart.disconnect();
});
test('ack_then_install_failure_keeps_choice', async () => {
  let fail = false, candidate;
  const f = await onboarding({ compile: async () => {
    const result = prepared();
    if (fail) { fail = false; candidate = result; Object.defineProperty(result, 'sourceDefinitions', { get() { throw Error('install definitions failed'); } }); }
    return result;
  } });
  const before = f.controller.getActivation(); fail = true;
  assert.equal(await f.actions.selectSuite('builtin.immersive'), false);
  assert.equal(f.controller.getLibrary().revision, 1); assert.equal(f.snapshot().initialSelectionRequired, true);
  assert.equal(f.controller.getActivation(), before); assert.equal(before.retired, false); assert.equal(candidate.disposed, true);
  assert.equal(f.snapshot().pending, null); assert.match(f.snapshot().diagnostics.at(-1), /install definitions failed/);
  assert.equal(await f.actions.selectSuite('builtin.immersive'), true); assert.equal(f.controller.getLibrary().revision, 2);
  assert.equal(f.snapshot().initialSelectionRequired, false); f.disconnect();
});
test('cas_conflict_reload_authority', async () => {
  for (const active of [null, 'builtin.modern']) {
    const f = await onboarding(), fresh = { ...pristine(), revision: 3, active_suite_id: active }, seen = [];
    f.storage.loadSuiteLibrary = async () => structuredClone(fresh);
    f.storage.saveSuiteLibrary = async (candidate, revision) => {
      seen.push(revision); if (seen.length === 1) throw Error('Suite revision conflict');
      assert.equal(revision, 3); return { ...candidate, revision: 4 };
    };
    assert.equal(await f.actions.selectSuite('builtin.immersive'), active !== null);
    assert.equal(f.controller.getLibrary().revision, 3); assert.equal(f.snapshot().initialSelectionRequired, active === null);
    assert.match(f.snapshot().diagnostics.at(-1), /revision conflict/);
    if (active) assert.equal(f.snapshot().selectedSuiteId, active);
    else { assert.equal(await f.actions.selectSuite('builtin.immersive'), true); assert.deepEqual(seen, [0, 3]); }
    f.disconnect();
  }
});
test('initial_choice_strict_reconnect_and_disconnected_completion', async () => {
  const f = await onboarding(); f.disconnect(); const cleanup = f.controller.connect();
  await boundary(f.controller.whenInitialized(), f.controller, 'Choice reconnect');
  assert.equal(f.snapshot().initialSelectionRequired, true); assert.equal(f.writes.length, 0);
  const held = holdSaveAcknowledgement(f), work = f.actions.selectSuite('builtin.immersive'); await held.whenSubmitted(work);
  cleanup(); let updates = 0; f.controller.subscribe(() => updates++); held.release();
  assert.equal(await work, false); assert.equal(updates, 0);
});
test('editor_self_replace_keeps_draft_and_operation', async () => {
  const f = await editor();
  f.actions.open(); f.actions.patchFile('Editor.tsx', 'export default () => null; // replaced');
  const work = f.actions.preview();
  assert.equal(f.snapshot().pending, 'preview');
  f.actions.close(); f.actions.open();
  assert.equal(await work, true);
  assert.match(f.snapshot().draft.files['Editor.tsx'].text, /replaced/);
  assert.equal(f.snapshot().dirty, true); f.disconnect();
});
test('disable_fences_late_compile_save_load', async () => {
  const held = deferred(), compiling = deferred(); let delay = false; let afterDisable = 0;
  const f = await editor({ compile: async (_b, _s, o) => {
    if (delay) { compiling.resolve(); await held.promise; if (!o.isCurrent()) throw new DOMException('stale', 'AbortError'); afterDisable++; }
    return prepared();
  } });
  delay = true; f.actions.patchFile('Editor.tsx', 'export default () => null; // late');
  const work = f.actions.preview();
  await boundary(compiling.promise, f.controller, 'Preview compilation');
  f.recovery.disable(); held.resolve();
  assert.equal(await work, false); assert.equal(afterDisable, 0);
    assert.equal(f.snapshot().suspended, true); assert.equal(f.controller.getActivation().primary.layerId, 'trusted.modern');
  f.disconnect();
});
test('file_read_owned_by_original_selection', async () => {
  const f = await editor(), read = deferred();
  f.actions.selectFile('a.tsx'); const work = f.actions.importSource({ name: 'a.tsx', size: 3, text: () => read.promise });
  f.actions.selectFile('b.tsx'); read.resolve('textA'); assert.equal(await work, true);
  assert.equal(f.snapshot().draft.files['a.tsx'].text, 'textA');
  assert.equal(f.snapshot().draft.files['b.tsx'].text, 'b'); f.disconnect();
});
test('corrupt_raw_export_in_recovery', async () => {
  const f = await editor({ storage: { loadSuiteLibrary: async () => { throw Error('corrupt'); } } });
  assert.equal(f.snapshot().suspended, true); await f.recovery.exportRecoverable();
  assert.deepEqual([...f.exports[0].bytes], [255, 0, 65]); f.disconnect();
});
test('saved_ack_retains_post_submit_draft_and_suspension', async () => {
  const f = await editor(), held = holdSaveAcknowledgement(f);
  f.actions.patchFile('a.tsx', 'submitted'); const work = f.actions.save();
  await held.whenSubmitted(work);
  assert.equal(f.writes.length, 1, 'Save must reach the submitted-write boundary');
  f.actions.patchFile('a.tsx', 'later'); f.recovery.disable(); held.release();
  assert.equal(await work, true, JSON.stringify(f.snapshot().diagnostics)); assert.equal(f.controller.getLibrary().revision, 8);
  assert.equal(f.snapshot().draft.files['a.tsx'].text, 'later');
  assert.equal(f.snapshot().dirty, true); assert.equal(f.snapshot().suspended, true); f.disconnect();
});
test('editor_interaction_current_and_observable', async () => {
  const f = await launcherFixture(); const initial = await f.current();
  assert.equal(typeof initial.services.acquireInteractionPublisher, 'function');
  const acquire = initial.services.acquireInteractionPublisher;
  const publisher = acquire(); publisher.publish({ editorOpen: true });
  assert.equal(initial.services.getInteractionState().editorOpen, true);
  await initial.actions.launch.request('original-instance'); assert.equal(f.counts.launch, 0);
  for (const listener of window.listeners.get('keydown') ?? []) listener({ key: 'Enter', ctrlKey: true, shiftKey: false,
    altKey: false, metaKey: false, target: { tagName: 'BODY' }, defaultPrevented: false, preventDefault() {} });
  await tick(); assert.equal(f.counts.launch, 0, 'Same-turn permanent shortcut uses the publisher ref');
  const rendered = await f.current();
  assert.equal(rendered.snapshot.profiles.items.find((item) => item.profile.instance_key === 'original-instance').capabilities.launch.allowed, false);
  assert.equal(rendered.services.acquireInteractionPublisher, acquire);
  const count = f.snapshotHistory.length;
  for (let i = 0; i < 10; i++) { publisher.publish({ editorOpen: true }); await f.current(); }
  assert.equal(f.snapshotHistory.length, count); publisher.release(); f.host.unmount();
});
test('stale_interaction_release_cannot_unlock_new_editor', async () => {
  const f = await launcherFixture(), { services } = await f.current();
  const old = services.acquireInteractionPublisher(); old.publish({ editorOpen: true });
  const current = services.acquireInteractionPublisher(); current.publish({ editorOpen: true, picking: true });
  old.release(); old.release(); old.publish({ editorOpen: false, picking: false });
  assert.equal(services.getInteractionState().editorOpen, true); assert.equal(services.getInteractionState().picking, true);
  current.release(); assert.equal(services.getInteractionState().editorOpen, false); f.host.unmount();
});
test('interaction_publisher_cannot_publish_after_launcher_unmount', async () => {
  const f = await launcherFixture(), { services } = await f.current();
  const publisher = services.acquireInteractionPublisher(); f.host.unmount();
  publisher.publish({ editorOpen: true });
  assert.equal(f.host.updatesAfterUnmount, 0);
});
test('safe_startup_prepares_only_trusted_and_builtin_editor_retains_draft', async () => {
  const f = await editor({ safe: true });
  assert.equal(f.compiles.length, 1); assert.equal(f.snapshot().suspended, true);
  const draft = f.snapshot().draft; f.recovery.openBuiltinEditor();
  assert.equal(f.snapshot().mode, 'builtin'); assert.equal(f.snapshot().draft, draft);
  assert.equal(f.controller.getActivation().primary.layerId, 'trusted.modern'); f.disconnect();
});
test('strictmode_stale_read_finally_and_late_compile_are_fenced', async () => {
  const first = deferred(); let reads = 0;
  const f = await editor({ deferInitialization: true, storage: { loadSuiteLibrary: () => ++reads === 1 ? first.promise : Promise.resolve(library()) } });
  assert.equal(f.snapshot().loaded, false); f.disconnect(); const cleanup = f.controller.connect();
  await boundary(f.controller.whenInitialized(), f.controller, 'Reconnected editor initialization');
  const current = f.snapshot(); first.reject(Error('stale load failure')); await tick();
  assert.equal(f.snapshot().loaded, true); assert.deepEqual(f.snapshot().diagnostics, current.diagnostics);
  assert.equal(f.leases.length, 2); assert.equal(f.leases[0].released, true); cleanup();
});
test('save_reset_serialization_rejection_recovery_and_actual_revision', async () => {
  const f = await editor(), held = holdSaveAcknowledgement(f);
  f.actions.patchFile('a.tsx', 'first'); const saving = f.actions.save();
  await held.whenSubmitted(saving); assert.equal(f.writes.length, 1);
  f.actions.requestReset(); const resetting = f.actions.confirmReset(); held.release();
  assert.equal(await saving, true); assert.equal(await resetting, true);
  assert.equal(f.controller.getLibrary().revision, 9); assert.deepEqual(f.controller.getLibrary().suites, []); f.disconnect();
  const g = await editor(); let rejected = false;
  const nextSave = g.storage.saveSuiteLibrary;
  g.storage.saveSuiteLibrary = (...args) => { if (!rejected) { rejected = true; return Promise.reject(Error('write failed')); } return nextSave(...args); };
  assert.equal(await g.actions.save(), false); assert.equal(await g.actions.save(), true);
  assert.equal(g.controller.getLibrary().revision, 8); assert.ok(g.snapshot().diagnostics.includes('write failed')); g.disconnect();
});
test('pending_reset_ack_after_disable_retains_saved_revision_and_draft', async () => {
  const f = await editor(), held = deferred(); const reset = f.storage.resetSuiteLibrary;
  f.storage.resetSuiteLibrary = async (...args) => { const ack = await reset(...args); await held.promise; return ack; };
  f.actions.patchFile('a.tsx', 'preserved'); f.actions.requestReset(); const work = f.actions.confirmReset();
  await tick(); f.recovery.disable(); held.resolve(); assert.equal(await work, true);
  assert.equal(f.controller.getLibrary().revision, 8); assert.equal(f.snapshot().suspended, true);
  assert.equal(f.snapshot().draft.files['a.tsx'].text, 'preserved'); f.disconnect();
});
test('unmount_late_file_write_and_load_do_not_publish', async () => {
  const f = await editor(), read = deferred(); f.actions.selectFile('a.tsx');
  const work = f.actions.importSource({ name: 'a.tsx', size: 1, text: () => read.promise });
  let publications = 0; f.controller.subscribe(() => publications++); f.disconnect();
  const count = publications; read.resolve('late'); assert.equal(await work, false);
  assert.equal(publications, count); assert.equal(f.snapshot().draft.files['a.tsx'].text, 'a');
});
test('data_valid_decode_failure_keeps_revision_and_normal_reset_authority', async () => {
  let rawReset = 0, expected = null;
  const f = await editor({ compile: async (b) => {
    if (b.files['a.tsx']?.text === 'a') throw Error('decode failure'); return prepared();
  }, storage: {
    resetSuiteLibrary: async (revision) => { expected = revision; return { ...library([]), revision: revision + 1 }; },
    resetRecoverableSuiteLibrary: async () => { rawReset++; throw Error('wrong authority'); },
  } });
  assert.equal(f.controller.getLibrary().revision, 7); f.actions.requestReset();
  await f.actions.confirmReset(); assert.equal(expected, 7); assert.equal(rawReset, 0); f.disconnect();
});
test('exact_parent_tombstones_restore_child_only_delete_and_case_rename', async () => {
  const parent = bundle({ 'Editor.tsx': { encoding: 'utf8', text: 'parent' } });
  const draft = structuredClone(parent); draft.files['Child.tsx'] = { encoding: 'utf8', text: 'child' };
  delete draft.files['Editor.tsx']; draft.files['editor.tsx'] = { encoding: 'utf8', text: 'renamed' }; descriptors(draft);
  const snapshot = { digest: await app('ui-suite/bundle.ts').bundleDigest(parent), bundle: parent };
  let value = draftToSuiteRecord(draft, 'fd910be2-a6bc-4976-a397-137ace486aa8', snapshot);
  assert.deepEqual(value.deleted, ['Editor.tsx']); assert.ok(value.overlay['editor.tsx']);
  assert.equal(value.overlay['Editor.tsx'], undefined);
  delete draft.files['Child.tsx']; draft.files['Editor.tsx'] = parent.files['Editor.tsx']; delete draft.files['editor.tsx']; descriptors(draft);
  value = draftToSuiteRecord(draft, value.instance_id, snapshot);
  assert.deepEqual(value.deleted, []); assert.deepEqual(Object.keys(value.overlay), []);
});
test('import_does_not_execute_or_overwrite_new_suite_and_export_captures_input', async () => {
  const f = await editor(), read = deferred(); const imported = bundle();
  const work = f.actions.importBundle({ name: 'bundle.paradox-ui', size: 100, arrayBuffer: () => read.promise });
  f.actions.patchFile('a.tsx', 'newer'); read.resolve(zipBundle(imported)); assert.equal(await work, false);
  const before = f.compiles.length; assert.equal(await f.actions.importBundle(new File([zipBundle(imported)], 'bundle.paradox-ui')), true);
  assert.equal(f.compiles.length, before); f.actions.selectFile('Home.tsx');
  const exporting = f.actions.exportDraft(); f.actions.patchFile('Home.tsx', 'changed after export'); await exporting;
  const output = await app('ui-suite/archive.ts').decodeSuiteArchive(f.exports.at(-1).bytes);
  assert.equal(output.files['Home.tsx'].text, imported.files['Home.tsx'].text); f.disconnect();
});
test('diagnostics_retained_bounded_and_public_snapshot_deep_readonly', async () => {
  const f = await editor();
  let diagnostic = 0; f.storage.saveSuiteLibrary = () => Promise.reject(Error(`failure ${diagnostic++}`));
  for (let i = 0; i < 25; i++) await f.actions.save();
  assert.equal(f.snapshot().diagnostics.length, 20); assert.ok(Object.isFrozen(f.snapshot().draft.files));
  assert.throws(() => { f.snapshot().draft.files['a.tsx'].text = 'unauthorized'; });
  await f.actions.preview(); assert.equal(f.snapshot().diagnostics.length, 20);
  f.disconnect(); const cleanup = f.controller.connect();
  await boundary(f.controller.whenInitialized(), f.controller, 'Reconnected editor initialization');
  assert.equal(f.snapshot().diagnostics.length, 20); cleanup();
});
test('reconnect_replays_accepted_source_and_equivalent_actions_keep_snapshot', async () => {
  const f = await editor();
  const accepted = f.controller.getActivation().primary.bundle.files['Editor.tsx'].text;
  f.actions.patchFile('Editor.tsx', 'unsubmitted draft source');
  f.disconnect(); const cleanup = f.controller.connect();
  await boundary(f.controller.whenInitialized(), f.controller, 'Reconnected editor initialization');
  assert.equal(f.controller.getActivation().primary.bundle.files['Editor.tsx'].text, accepted);
  assert.equal(f.snapshot().draft.files['Editor.tsx'].text, 'unsubmitted draft source');
  const snapshot = f.snapshot(), leases = f.leases.length;
  for (let i = 0; i < 10; i++) f.actions.cancelPick();
  assert.equal(f.snapshot(), snapshot); assert.equal(f.leases.length, leases); cleanup();
});
test('same_path_rename_preserves_snapshot_and_pending_save_ack', async () => {
  const f = await editor(), held = holdSaveAcknowledgement(f);
  f.actions.selectFile('a.tsx');
  let publications = 0; const unsubscribe = f.controller.subscribe(() => { publications++; });
  const before = f.snapshot();
  f.actions.renameFile('a.tsx', 'a.tsx');
  assert.equal(f.snapshot().draft.files['a.tsx']?.text, 'a', 'Unchanged-name confirmation must retain the original file');
  assert.equal(f.snapshot(), before, 'Unchanged rename must preserve draft, descriptors, selection and clean state');
  assert.equal(publications, 0, 'Unchanged rename must not publish an edit');
  f.actions.patchFile('a.tsx', 'submitted'); const work = f.actions.save();
  await held.whenSubmitted(work);
  assert.equal(f.writes.length, 1, 'Save must reach the submitted-write boundary');
  const pending = f.snapshot(), beforePendingRename = publications;
  f.actions.renameFile('a.tsx', 'a.tsx');
  assert.equal(f.snapshot(), pending, 'Unchanged rename must preserve the pending submitted draft');
  assert.equal(publications, beforePendingRename);
  held.release(); assert.equal(await work, true);
  assert.equal(f.snapshot().dirty, false, 'Unchanged rename must not advance edit revision and block save acknowledgement');
  assert.equal(f.snapshot().draft.files['a.tsx'].text, 'submitted');
  assert.equal(f.controller.getLibrary().revision, 8);
  await f.actions.copyBuiltin('modern', 'Inherited');
  const inherited = f.snapshot();
  f.actions.renameFile('Editor.tsx', 'Editor.tsx');
  assert.equal(f.snapshot(), inherited, 'Unchanged inherited path must retain its file and descriptor');
  assert.equal(await f.actions.save(), true);
  assert.deepEqual(f.controller.getLibrary().suites.at(-1).deleted, [], 'Unchanged inherited path must not persist a tombstone');
  unsubscribe(); f.disconnect();
});
test('parent_restore_rename_and_explicit_reparent_commit_valid_exact_records', async () => {
  const f = await editor(); await f.actions.copyBuiltin('modern', 'Inherited');
  f.actions.removeFile('a.tsx'); f.controller.restoreFile('a.tsx');
  f.actions.renameFile('Editor.tsx', 'editor.tsx');
  const views = structuredClone(f.snapshot().draft.manifest.views); views['tool.editor'] = 'editor.tsx';
  f.actions.patchManifest({ views }); assert.equal(await f.actions.save(), true);
  const saved = f.controller.getLibrary().suites.at(-1);
  assert.deepEqual(saved.deleted, ['Editor.tsx']); assert.ok(saved.overlay['editor.tsx']); assert.equal(saved.overlay['a.tsx'], undefined);
  f.actions.removeFile('b.tsx');
  const nextParent = bundle({ 'Editor.tsx': { encoding: 'utf8', text: 'export default () => null;' } });
  assert.equal(await f.controller.replaceParent(nextParent), true);
  assert.equal(await f.actions.save(), true);
  const reparented = f.controller.getLibrary().suites.at(-1);
  assert.equal(reparented.deleted.includes('b.tsx'), false);
  assert.ok(reparented.deleted.includes('Editor.tsx')); f.disconnect();
});
test('asset_read_owned_by_original_suite_and_invalid_import_never_executes', async () => {
  const f = await editor(), read = deferred();
  const adding = f.actions.addAsset({ name: 'asset.png', size: 4, type: 'image/png', arrayBuffer: () => read.promise });
  await f.actions.copyBuiltin('modern', 'Different draft'); read.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
  assert.equal(await adding, false); assert.equal(f.snapshot().draft.files['asset.png'], undefined);
  const count = f.compiles.length;
  assert.equal(await f.actions.importBundle(new File([new Uint8Array([1, 2, 3])], 'invalid.paradox-ui')), false);
  assert.equal(f.compiles.length, count); f.disconnect();
});
test('draft_explicit_targets_reconcile_without_waiting_for_runtime_mount', async () => {
  const f = await editor();
  f.actions.open();
  f.actions.patchManifest({ overrides: [{ selector: { kind: 'type', target: 'control.future' }, enabled: false, stylesheet: null, entry: null }] });
  assert.ok(f.snapshot().targets.some((descriptor) => descriptor.selector.target === 'control.future'));
  f.actions.patchManifest({ overrides: [] });
  assert.ok(!f.snapshot().targets.some((descriptor) => descriptor.selector.target === 'control.future')); f.disconnect();
});
test('safe_fixed_parent_is_data_materialized_without_parent_factory_initialization', async () => {
  const parent = bundle(), child = record(parent);
  child.parent_snapshot = { digest: await app('ui-suite/bundle.ts').bundleDigest(parent), bundle: parent };
  child.overlay = {};
  const f = await editor({ safe: true, library: library([child]) });
  assert.equal(f.compiles.length, 1, 'Safe mode may prepare trusted code only');
  assert.equal(f.snapshot().draft.manifest.id, child.manifest.id); assert.equal(f.snapshot().suspended, true); f.disconnect();
});
test('disable_during_startup_read_keeps_checked_editable_data_and_blocks_user_compile', async () => {
  const read = deferred(), f = await editor({ deferInitialization: true, storage: { loadSuiteLibrary: () => read.promise } });
  f.recovery.disable(); read.resolve(library());
  await boundary(f.controller.whenInitialized(), f.controller, 'Disabled startup initialization');
  assert.equal(f.snapshot().loaded, true); assert.ok(f.snapshot().draft);
  assert.equal(f.compiles.length, 1); assert.equal(f.snapshot().suspended, true); f.disconnect();
});
test('duplicate_asset_reports_false_retains_original_bytes_and_diagnostic', async () => {
  const f = await editor();
  const asset = (bytes) => ({ name: 'duplicate.png', size: bytes.length, type: 'image/png', arrayBuffer: async () => Uint8Array.from(bytes).buffer });
  try {
    assert.equal(await f.actions.addAsset(asset([1,2,3])), true);
    const original = structuredClone(f.snapshot().draft.files['duplicate.png']);
    assert.equal(await f.actions.addAsset(asset([4,5,6])), false);
    assert.deepEqual(f.snapshot().draft.files['duplicate.png'], original);
    assert.ok(f.snapshot().diagnostics.includes('File already exists'));
  } finally { f.disconnect(); }
});
for (const [name, fn] of cases.filter(([name]) => !process.env.UI_LIFECYCLE_CASE || new RegExp(process.env.UI_LIFECYCLE_CASE).test(name))) { await fn(); console.log(`PASS ${name}`); }
console.log(`PASS ${cases.length} permanent editor lifecycle cases`);
