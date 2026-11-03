import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { loadApp, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, library, record } from './lib/suite-test-fixtures.mjs';

const app = loadApp(new Map([[resolve(uiRoot, 'src/api.ts'), { desktop: false }]]), { isolateCustomization: false });
const registry = app('customization/ownership.ts');
const catalog = existsSync(resolve(uiRoot, 'src/customization/target-catalog.ts')) ? app('customization/target-catalog.ts') : {};
const i18n = app('i18n.ts').default;
const loc = (site, business = [], root = 'launcher.main') => ({ version: 1, renderRoot: root, calls: [{ site, key: 'one' }], business });
const element = (text, { hidden = false, offscreen = false, aria, label, title } = {}) => ({
  isConnected: true, tagName: 'BUTTON', textContent: text,
  getAttribute: (name) => ({ 'aria-label': aria, title, 'aria-labelledby': null })[name] ?? null,
  labels: label ? [{ textContent: label }] : [],
  ownerDocument: { defaultView: { innerWidth: 800, innerHeight: 600, getComputedStyle: () => ({ visibility: hidden ? 'hidden' : 'visible', opacity: '1' }) }, getElementById: () => null },
  getClientRects: () => [{ width: 30, height: 20, left: offscreen ? 900 : 10, right: offscreen ? 930 : 40, top: 10, bottom: 30 }], contains: () => false,
});
const owner = (id, target, locator, root, extra = {}) => ({ ownerId: id, parentOwnerId: null, target, site: locator.calls.at(-1).site, locator, stability: 'stable', roots: new Set(root ? [root] : []), metadata: { nameKey: null, type: 'control', sourcePath: 'views/Home.tsx', routeId: 'home' }, catalogPresentation: false, viewId: null, layerId: null, ...extra });
const position = (row) => ({ kind: 'position', target: row.target, locator: row.locator });
const need = () => assert.equal(typeof catalog.describeTarget, 'function', 'readable target descriptors are required');

await test('selection_override_captured_atomic_create_open_reset_and_collision', async () => {
  const selectors = app('customization/selectors.ts');
  const b = bundle(), stored = library([record(b)]);
  const prepared = () => ({ views: new Map(), routes: [], css: '', sourceDefinitions: [], viewMetadata: new Map(), targetBindings: [], styleUsages: [], styleGroups: new Map(), dispose() {} });
  const c = app('ui-editor/controller.tsx').createUiEditorController({ storage: { loadSuiteLibrary: async () => stored }, getBuiltinBundle: async () => b, createScope: () => ({}), compile: async () => prepared(), exportFile: async () => {}, acquireInteractionPublisher: () => ({ publish() {}, release() {} }), safe: false });
  const disconnect = c.connect();
  const first = { kind: 'position', target: 'component.override', locator: loc('source:first', [{ namespace: 'account', value: 'a' }]) };
  const second = { ...first, locator: loc('source:second', [{ namespace: 'account', value: 'a' }]) };
  try {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof c.actions.createSelectionOverride, 'function', 'public create/open override is required');
    assert.equal(typeof c.actions.setSourceKind, 'function', 'public source tabs are required');
    c.actions.selectTarget(first); c.actions.setSourceKind('html');
    assert.equal(c.getSnapshot().selection.filePath, null); assert.equal(c.getSnapshot().draft.manifest.overrides.length, 0, 'tabs do not create');
    const create = c.actions.createSelectionOverride('css');
    c.actions.selectTarget(second); c.actions.selectFile('Home.tsx'); c.actions.patchFile('Home.tsx', 'export default () => null; // concurrent source edit');
    assert.equal(await create, true);
    const path = `overrides/${selectors.selectorDigest(first)}/style.css`, binding = c.getSnapshot().draft.manifest.overrides[0];
    assert.deepEqual(binding.selector, first); assert.equal(binding.stylesheet, path); assert.equal(binding.entry, null);
    assert.deepEqual(c.getSnapshot().selection.selector, second); assert.equal(c.getSnapshot().selectedFile, 'Home.tsx');
    assert.match(c.getSnapshot().draft.files['Home.tsx'].text, /concurrent/);
    c.actions.selectTarget(first); c.actions.patchFile(path, 'button { color: red }');
    assert.equal(await c.actions.createSelectionOverride('css'), true); assert.equal(c.getSnapshot().draft.files[path].text, 'button { color: red }', 'open preserves edited content');
    assert.equal(await c.actions.createSelectionOverride('html'), true); const html = c.getSnapshot().selection.filePath;
    assert.equal(await c.actions.createSelectionOverride('tsx'), true); const tsx = c.getSnapshot().selection.filePath;
    assert.ok(c.getSnapshot().draft.files[html]); assert.ok(c.getSnapshot().draft.files[tsx]);
    c.actions.setSourceKind('css'); assert.equal(c.getSnapshot().selection.filePath, path); assert.equal(c.getSnapshot().selectedFile, path);
    c.actions.patchManifest({ overrides: [...c.getSnapshot().draft.manifest.overrides, { selector: second, enabled: true, entry: null, stylesheet: path }] });
    const pending = c.actions.createSelectionOverride('html'); c.actions.resetSelectionOverride();
    assert.equal(await pending, false, 'reset invalidates a pending create');
    assert.equal(c.getSnapshot().selection.filePath, null); assert.equal(c.getSnapshot().draft.manifest.overrides.length, 1);
    assert.deepEqual(c.getSnapshot().draft.manifest.overrides[0].selector, second);
    for (const retained of [path, html, tsx]) assert.ok(c.getSnapshot().draft.files[retained], 'shared and orphan ordinary files retained');
    c.actions.patchManifest({ overrides: [] });
    c.actions.selectTarget(first);
    assert.equal(await c.actions.createSelectionOverride('css'), true, 'orphan content can be rebound to its exact selector');
    assert.equal(c.getSnapshot().draft.files[path].text, 'button { color: red }');
    const collision = { kind: 'type', target: 'component.collision' };
    c.actions.patchManifest({ overrides: [{ selector: collision, enabled: true, entry: null, stylesheet: `overrides/${selectors.selectorDigest(first)}/unrelated.css` }] });
    c.actions.selectTarget(first);
    assert.equal(await c.actions.createSelectionOverride('css'), false, 'digest directory owned by another complete selector is refused');
    assert.deepEqual(c.getSnapshot().draft.manifest.overrides[0].selector, collision);
  } finally { disconnect(); }
});

await test('picker_public_service_and_canonical_controls', () => {
  assert.equal(existsSync(resolve(uiRoot,'src/customization/picker.ts')), true, 'fixed-host pointer picker service is required');
  const picker=app('customization/picker.ts');
  assert.equal(typeof picker.startPicker,'function');
});
await test('picker_cleanup_and_consumed_cancelled_pointer_tail', async () => {
  const previousWindow=globalThis.window, previousElement=globalThis.Element;
  class FakeWindow extends EventTarget {
    live=new Set();setTimeout=setTimeout;clearTimeout=clearTimeout;
    addEventListener(name,listener,options){if(options===true)this.live.add(listener);super.addEventListener(name,listener,options);}
    removeEventListener(name,listener,options){this.live.delete(listener);super.removeEventListener(name,listener,options);}
  }
  const view=new FakeWindow();globalThis.window=view;globalThis.Element=class {};
  let cancelled=0, unsubscribed=0,business=0;
  const options={onHover(){},onSelect(){throw Error('no target must not select');},onCancel(){cancelled++;},subscribeSelection(){return()=>unsubscribed++;}};
  const dispatch=(type)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'pointerId',{value:7});view.dispatchEvent(event);assert.equal(event.defaultPrevented,true);};
  try {
    const picker=app('customization/picker.ts');const stop=picker.startPicker(options);assert.ok(view.live.size>0);stop();stop();assert.equal(view.live.size,0);assert.equal(cancelled,1);assert.equal(unsubscribed,1);
    const pressed=picker.startPicker(options);for(const name of ['pointerdown','pointerup','mousedown','mouseup','click'])view.addEventListener(name,()=>business++);
    dispatch('pointerdown');dispatch('mousedown');pressed();assert.ok(view.live.size>0,'cancelled pressed gesture retains its consumed tail');dispatch('pointerup');dispatch('mouseup');dispatch('click');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(view.live.size,0);assert.equal(cancelled,2);assert.equal(unsubscribed,2);assert.equal(business,0);
  } finally {globalThis.window=previousWindow;globalThis.Element=previousElement;}
});

await test('picker_cancelled_long_held_pointer_retains_capture_through_release_tail', async () => {
  const previousWindow = globalThis.window, previousElement = globalThis.Element;
  class FakeWindow extends EventTarget {
    live = new Map(); setTimeout = setTimeout; clearTimeout = clearTimeout;
    addEventListener(name, listener, options) {
      if (options === true) { const listeners = this.live.get(name) ?? new Set(); listeners.add(listener); this.live.set(name, listeners); }
      super.addEventListener(name, listener, options);
    }
    removeEventListener(name, listener, options) { this.live.get(name)?.delete(listener); super.removeEventListener(name, listener, options); }
    count() { return [...this.live.values()].reduce((total, listeners) => total + listeners.size, 0); }
  }
  const view = new FakeWindow(); globalThis.window = view; globalThis.Element = class {};
  let cancelled = 0, ended = 0, unsubscribed = 0;
  const business = [];
  const dispatch = (type, pointerId = 7) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { pointerId: { value: pointerId }, key: { value: 'Escape' } });
    view.dispatchEvent(event); return event.defaultPrevented;
  };
  try {
    app('customization/picker.ts').startPicker({ onHover() {}, onSelect() { assert.fail('cancelled gesture must not select'); }, onCancel() { cancelled++; }, onEnd() { ended++; }, subscribeSelection() { return () => unsubscribed++; } });
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu']) view.addEventListener(name, () => business.push(name));
    assert.equal(dispatch('pointerdown'), true); assert.equal(dispatch('mousedown'), true);
    assert.equal(dispatch('keydown'), true);
    assert.equal(cancelled, 1, 'visible cancellation is immediate');
    assert.equal(view.count(), 11);
    // Another pointer's release cannot retire the still-held selected pointer.
    assert.equal(dispatch('pointerup', 8), true);
    await new Promise(resolve => setTimeout(resolve, 1350));
    assert.equal(view.count(), 11, 'capture must remain while the cancelled pointer is held beyond the old 1200ms timeout');
    assert.equal(ended, 0); assert.equal(unsubscribed, 0);
    assert.equal(dispatch('pointerup'), true); assert.equal(dispatch('mouseup'), true);
    assert.equal(view.count(), 11, 'release retains capture for its click tail');
    for (const name of ['click', 'dblclick', 'auxclick', 'contextmenu']) assert.equal(dispatch(name), true);
    assert.equal(view.count(), 11, 'same-task compatibility events are consumed before cleanup');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(view.count(), 0); assert.equal(cancelled, 1); assert.equal(ended, 1); assert.equal(unsubscribed, 1);
    assert.deepEqual(business, []);
    assert.equal(dispatch('click'), false, 'capture ends after the completed gesture');
    assert.deepEqual(business, ['click']);
  } finally {
    dispatch('pointerup'); dispatch('click'); await new Promise(resolve => setTimeout(resolve, 10));
    globalThis.window = previousWindow; globalThis.Element = previousElement;
  }
});

await test('picker_released_without_click_and_pointercancel_cleanup', async () => {
  const previousWindow = globalThis.window, previousElement = globalThis.Element;
  class FakeWindow extends EventTarget {
    live = new Set(); setTimeout = setTimeout; clearTimeout = clearTimeout;
    addEventListener(name, listener, options) { if (options === true) this.live.add(listener); super.addEventListener(name, listener, options); }
    removeEventListener(name, listener, options) { this.live.delete(listener); super.removeEventListener(name, listener, options); }
  }
  const view = new FakeWindow(); globalThis.window = view; globalThis.Element = class {};
  let cancelled = 0, ended = 0, business = 0;
  const dispatch = type => { const event = new Event(type, { cancelable: true }); Object.defineProperty(event, 'pointerId', { value: 7 }); view.dispatchEvent(event); assert.equal(event.defaultPrevented, true); };
  const options = { onHover() {}, onSelect() { assert.fail('no completed selection'); }, onCancel() { cancelled++; }, onEnd() { ended++; } };
  try {
    const picker = app('customization/picker.ts');
    for (const alreadyCancelled of [false, true]) {
      const stop = picker.startPicker(options);
      dispatch('pointerdown'); if (alreadyCancelled) stop(); dispatch('pointerup'); dispatch('mouseup');
      assert.ok(view.live.size > 0, 'released gesture retains capture while awaiting its possible click');
      await new Promise(resolve => setTimeout(resolve, 1250));
      assert.equal(view.live.size, 0, 'observed release without click eventually ends the picker lease');
    }
    assert.equal(cancelled, 2); assert.equal(ended, 2);
    picker.startPicker(options);
    for (const name of ['pointercancel', 'mouseup', 'click']) view.addEventListener(name, () => business++);
    dispatch('pointerdown'); dispatch('pointercancel');
    assert.equal(cancelled, 3, 'pointer cancellation updates visible state immediately');
    assert.ok(view.live.size > 0, 'pointercancel retains capture through its same-task tail');
    dispatch('mouseup'); dispatch('click'); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(view.live.size, 0); assert.equal(ended, 3); assert.equal(business, 0);
  } finally { globalThis.window = previousWindow; globalThis.Element = previousElement; }
});

await test('friendly_name_and_instance_metadata', async () => {
  need();
  await i18n.changeLanguage('zh-CN');
  const row = owner('launch', 'control.button', loc('launch', [{ namespace: 'profile', value: 'world' }]), element('启动'));
  const stop = registry.registerOwner(row);
  try {
    const d = catalog.describeTarget(position(row), { businessNames: [{ namespace: 'profile', value: 'world', name: 'Original world' }] });
    assert.equal(d.name, '启动 Original world'); assert.equal(d.sourcePath, 'views/Home.tsx');
    assert.equal(d.routeId, 'home'); assert.equal(d.ownerId, 'launch'); assert.equal(d.matchCount, 1);
    assert.equal(Object.isFrozen(d), true); assert.equal(Object.isFrozen(d.selector.locator), true);
    for (const [options, expected] of [[{ aria: 'ARIA', label: 'Label', title: 'Title' }, 'ARIA'], [{ label: 'Label', title: 'Title' }, 'Label'], [{ title: 'Title' }, 'Title'], [{}, 'Text']]) {
      const release = registry.registerOwner(owner('fallback', 'element.button', loc('fallback'), element('Text', options)));
      assert.equal(catalog.describeTarget({ kind: 'type', target: 'element.button' }).name, expected); release();
    }
  } finally { stop(); }
});
await test('missing_hidden_and_multiple_states', () => {
  need();
  const definitions = registry.publishUiDefinitions({ key: 'inspector-test', definitions: [{ target: 'dialog.never-opened', site: null, viewId: null, nameKey: null, type: 'component', sourcePath: 'dialogs/Never.tsx', routeId: 'accounts' }] });
  const hidden = owner('hidden', 'control.hidden', loc('hidden'), element('Hidden', { hidden: true }));
  const off = owner('off', 'control.off', loc('off'), element('Off', { offscreen: true }));
  const stops = [registry.registerOwner(hidden), registry.registerOwner(off)];
  try {
    assert.equal(catalog.describeTarget(position(hidden)).status, 'hidden');
    assert.equal(catalog.describeTarget(position(off)).visibility, 'offscreen');
    const known = catalog.describeTarget({ kind: 'type', target: 'dialog.never-opened' });
    assert.equal(known.status, 'unmounted'); assert.equal(known.sourcePath, 'dialogs/Never.tsx');
    const unknown = catalog.describeTarget({ kind: 'type', target: 'manual.missing' });
    assert.equal(unknown.status, 'unmounted'); assert.equal(unknown.sourcePath, null); assert.notEqual(unknown.reason, known.reason);
    for (let i = 0; i < 3; i++) stops.push(registry.registerOwner(owner('avatar-' + i, 'component.account-avatar', loc('avatar-' + i, [{ namespace: 'account', value: 'same' }]), element('Alex'))));
    const broad = catalog.describeTarget({ kind: 'business', target: 'component.account-avatar', identity: { namespace: 'account', value: 'same' } });
    assert.equal(broad.status, 'resolved'); assert.equal(broad.matchCount, 3); assert.equal(broad.ownerId, null);
    stops[0](); assert.equal(catalog.describeTarget(position(hidden)).status, 'unmounted');
    assert.equal(catalog.describeTarget(position(hidden)).ownerId, null);
  } finally { stops.forEach((stop) => stop()); definitions(); }
});
await test('ancestor_scope_count', () => {
  need();
  const parent = owner('parent', 'component.parent', loc('parent'), element('Parent'));
  const child = owner('child', 'component.account-avatar', loc('child', [{ namespace: 'account', value: 'same' }, { namespace: 'profile', value: 'world' }]), element('Alex'), { parentOwnerId: 'parent' });
  const stops = [registry.registerOwner(parent), registry.registerOwner(child)];
  try {
    assert.deepEqual(catalog.getTargetAncestors('child').map((d) => d.ownerId), ['parent']);
    const choices = catalog.getScopeChoices('child');
    assert.equal(choices[0].selector.kind, 'position');
    assert.deepEqual(choices.filter((d) => d.selector.kind === 'business').map((d) => d.selector.identity.namespace).sort(), ['account', 'profile']);
    assert.equal(choices.at(-1).selector.kind, 'type');
  } finally { stops.forEach((stop) => stop()); }
});
await test('plural_provenance_and_route_availability', () => {
  need();
  const stop = registry.publishUiDefinitions({ key: 'plural', definitions: ['a', 'b'].map((name) => ({ target: 'control.shared', site: name, viewId: null, nameKey: null, type: 'control', sourcePath: `${name}.tsx`, routeId: name === 'a' ? 'home' : 'settings' })) });
  const custom = registry.publishUiDefinitions({ key: 'custom', definitions: [{ target: 'custom.view', site: null, viewId: null, nameKey: null, type: 'component', sourcePath: 'Custom.tsx', routeId: 'custom.example' }, { target: 'bad.route', site: null, viewId: null, nameKey: null, type: 'component', sourcePath: 'Bad.tsx', routeId: 'custom.INVALID' }] });
  try {
    const broad = catalog.describeTarget({ kind: 'type', target: 'control.shared' });
    assert.equal(broad.sourcePath, null); assert.equal(broad.routeId, null); assert.ok(broad.reason);
    assert.equal(catalog.describeTarget({ kind: 'type', target: 'custom.view' }, { routes: ['home'] }).routeId, null);
    assert.equal(catalog.describeTarget({ kind: 'type', target: 'custom.view' }, { routes: ['home', 'custom.example'] }).routeId, 'custom.example');
    assert.equal(catalog.describeTarget({ kind: 'type', target: 'bad.route' }, { routes: ['custom.INVALID'] }).routeId, null);
  } finally { stop(); custom(); }
});
await test('nullable_provenance_preserves_known_values_and_rootless_safety', () => {
  need();
  for (const [name, known, expectedSource, expectedRoute] of [
    ['unknown', [[null, null]], null, null],
    ['plural', [['Known.tsx', 'home'], ['Other.tsx', 'settings']], null, null],
    ['single', [['Known.tsx', 'home']], 'Known.tsx', 'home'],
  ]) {
    const row = owner('nullable-' + name, 'control.nullable-' + name, loc('nullable-' + name), null, { metadata: { nameKey: null, type: 'control', sourcePath: null, routeId: null } });
    const stopOwner = registry.registerOwner(row);
    const stopDefinitions = registry.publishUiDefinitions({ key: 'nullable-' + name, definitions: known.map(([sourcePath, routeId]) => ({ target: row.target, site: row.site, viewId: null, nameKey: null, type: 'control', sourcePath, routeId })) });
    try {
      const selector = position(row), resolution = registry.resolveSelector(selector), d = catalog.describeTarget(selector);
      assert.deepEqual(registry.getTargetMetadata(selector).map((metadata) => [metadata.sourcePath, metadata.routeId]), [...new Map([[null, null], ...known].map((value) => [JSON.stringify(value), value])).values()]);
      assert.equal(resolution.status, 'unsupported'); assert.match(resolution.reason, /No instrumented DOM root/);
      assert.equal(d.status, resolution.status); assert.equal(d.visibility, 'none'); assert.equal(d.matchCount, 1);
      assert.equal(d.ownerId, row.ownerId); assert.equal(d.stability, 'stable'); assert.deepEqual(d.selector, selector);
      assert.ok(d.reason.startsWith(resolution.reason));
      assert.equal(d.sourcePath, expectedSource); assert.equal(d.routeId, expectedRoute);
      assert.equal(d.reason, resolution.reason + (name === 'plural' ? ' ' + i18n.t('uiInspector.multipleSources') : ''));
    } finally { stopOwner(); stopDefinitions(); }
  }
});
await test('controller_selects_known_source_despite_unknown_owner_provenance', async () => {
  const b = bundle({ 'View.tsx': { encoding: 'utf8', text: 'export default () => null' }, 'Known.tsx': { encoding: 'utf8', text: 'export default () => null' } });
  const stored = library([record(b)]);
  const prepared = () => ({ views: new Map(), routes: [], css: '', sourceDefinitions: [], viewMetadata: new Map(), targetBindings: [], styleUsages: [], styleGroups: new Map(), dispose() {} });
  const c = app('ui-editor/controller.tsx').createUiEditorController({ storage: { loadSuiteLibrary: async () => stored }, getBuiltinBundle: async () => b, createScope: () => ({}), compile: async () => prepared(), exportFile: async () => {}, acquireInteractionPublisher: () => ({ publish() {}, release() {} }), safe: false });
  const disconnect = c.connect();
  const row = owner('nullable-source', 'control.nullable-source', loc('nullable-source'), null, { metadata: { nameKey: null, type: 'control', sourcePath: null, routeId: null } });
  const stopOwner = registry.registerOwner(row);
  const stopDefinitions = registry.publishUiDefinitions({ key: 'nullable-source', definitions: [{ target: row.target, site: row.site, viewId: null, nameKey: null, type: 'control', sourcePath: 'Known.tsx', routeId: 'home' }] });
  try {
    for (let i = 0; i < 20; i++) await new Promise((yes) => setImmediate(yes));
    c.actions.selectFile('View.tsx'); c.actions.selectTarget(position(row));
    assert.equal(c.getSnapshot().selectedFile, 'Known.tsx'); assert.equal(c.getSnapshot().selection.filePath, null);
    assert.equal(c.getSnapshot().currentTarget.sourcePath, 'Known.tsx'); assert.equal(c.getSnapshot().currentTarget.routeId, 'home');
    assert.equal(c.getSnapshot().currentTarget.status, 'unsupported'); assert.equal(c.getSnapshot().currentTarget.reason, registry.resolveSelector(position(row)).reason);
  } finally { stopOwner(); stopDefinitions(); disconnect(); }
});
await test('catalog_complete_selectors_projection_exclusion_and_cache', async () => {
  need();
  const normal = owner('normal', 'control.input', loc('normal'), element('Search'));
  const projected = owner('projection', 'control.row', loc('projection'), element('Row'), { catalogPresentation: true });
  const stops = [registry.registerOwner(normal), registry.registerOwner(projected)];
  try {
    const explicit = position(projected), other = { ...explicit, locator: loc('other') };
    const one = catalog.listCurrentTargets([explicit, other, explicit]);
    assert.equal(one.filter((d) => d.selector.target === 'control.row').length, 2);
    assert.ok(one.some((d) => d.selector.kind === 'position' && d.ownerId === 'normal'));
    assert.ok(!catalog.listCurrentTargets().some((d) => d.selector.target === 'control.row'));
    assert.equal(catalog.describeTarget(explicit).ownerId, 'projection', 'presentation remains resolvable and pickable');
    assert.equal(catalog.listCurrentTargets([explicit, other, explicit]), one, 'equal catalog returns cached readonly snapshot');
    assert.equal(Object.isFrozen(one), true);
  } finally { stops.forEach((stop) => stop()); await Promise.resolve(); }
});
await test('controller_parent_anchor_multiple_business_choices_and_binding', async () => {
  const b = bundle({ 'View.tsx': { encoding: 'utf8', text: 'export default () => null' }, 'parent.css': { encoding: 'utf8', text: '' } });
  const parent = owner('anchor-parent', 'component.parent', loc('parent'), element('Parent'));
  const child = owner('anchor-child', 'component.avatar', loc('child', [{ namespace: 'account', value: 'same' }, { namespace: 'profile', value: 'world' }]), element('Child'), { parentOwnerId: parent.ownerId });
  b.manifest.overrides = [{ selector: position(parent), enabled: true, stylesheet: 'parent.css', entry: null }];
  const stored = library([record(b)]);
  const prepared = () => ({ views: new Map(), routes: [], css: '', sourceDefinitions: [], viewMetadata: new Map(), targetBindings: [], styleUsages: [], styleGroups: new Map(), dispose() {} });
  const c = app('ui-editor/controller.tsx').createUiEditorController({ storage: { loadSuiteLibrary: async () => stored }, getBuiltinBundle: async () => b, createScope: () => ({}), compile: async () => prepared(), exportFile: async () => {}, acquireInteractionPublisher: () => ({ publish() {}, release() {} }), safe: false });
  const disconnect = c.connect(), stops = [registry.registerOwner(parent), registry.registerOwner(child)];
  try {
    for (let i = 0; i < 20; i++) await new Promise((yes) => setImmediate(yes));
    c.actions.selectTarget(position(child));
    assert.equal(c.getSnapshot().currentTarget?.ownerId, 'anchor-child');
    c.actions.setScope('business');
    assert.equal(c.getSnapshot().selection.scope, 'position', 'unspecified multiple identities refuse arbitrary first choice');
    assert.ok(c.getSnapshot().diagnostics.length > 0);
    c.actions.selectTarget(c.getSnapshot().scopeChoices.find((d) => d.selector.kind === 'business' && d.selector.identity.namespace === 'profile').selector);
    c.actions.setScope('position'); assert.deepEqual(c.getSnapshot().selection.selector, position(child));
    c.actions.selectTarget(c.getSnapshot().targetAncestors[0].selector);
    assert.equal(c.getSnapshot().selection.filePath, 'parent.css'); assert.equal(c.getSnapshot().selectedFile, 'parent.css');
    c.actions.setScope('type'); c.actions.setScope('position'); assert.deepEqual(c.getSnapshot().selection.selector, position(parent));
    stops[0](); await Promise.resolve(); assert.equal(c.getSnapshot().currentTarget.ownerId, null);
    assert.equal(c.getSnapshot().targetAncestors.length, 0); assert.equal(c.getSnapshot().scopeChoices.length, 0);
    assert.deepEqual(c.getSnapshot().selection.selector, position(parent));
  } finally { stops.forEach((stop) => stop()); disconnect(); }
});
await test('public_descriptor_types_and_canonical_source_boundary', () => {
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  const config = ts.readConfigFile(resolve(uiRoot, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, uiRoot);
  const file = resolve(uiRoot, 'src/ui-tests/inspector-public-contract.ts');
  const source = `import type {UiTargetDescriptor,UiTargetStatus,UiSelector,UiPositionLocator,BusinessIdentity,UiEditorSnapshot,UiEditorSourceKind} from '@paradox/launcher';
import type {UiTargetDescriptor as PrivateBridge,UiTargetStatus as BridgeStatus,UiSelector as BridgeSelector,UiPositionLocator as BridgeLocator,BusinessIdentity as BridgeIdentity} from '../ui-editor/public';
declare const d: UiTargetDescriptor; declare const snapshot: UiEditorSnapshot;
const bridge:PrivateBridge=d; const status:UiTargetStatus=bridge.status; const same:BridgeStatus=status;
const selector:BridgeSelector=d.selector; const publicSelector:UiSelector=selector;
declare const locator:UiPositionLocator; const bridgeLocator:BridgeLocator=locator;
declare const business:BusinessIdentity; const bridgeBusiness:BridgeIdentity=business;
const targets:readonly UiTargetDescriptor[]=snapshot.targets; const current:UiTargetDescriptor|null=snapshot.currentTarget;
const ancestors:readonly UiTargetDescriptor[]=snapshot.targetAncestors; const scopes:readonly UiTargetDescriptor[]=snapshot.scopeChoices;
const kind:UiEditorSourceKind='tsx'; void [same,publicSelector,bridgeLocator,bridgeBusiness,targets,current,ancestors,scopes,kind];
// @ts-expect-error public owner is readonly
d.ownerId='mutated';
// @ts-expect-error selector values inside a descriptor are readonly
d.selector.target='mutated';
// @ts-expect-error catalog is readonly
snapshot.targets.push(d);
// @ts-expect-error statuses derive from the existing resolver union
const invalid:UiTargetStatus='missing'; void invalid;`;
  const host = ts.createCompilerHost(options), original = host.getSourceFile;
  const sameFile = (name) => name.replaceAll('\\', '/') === file.replaceAll('\\', '/');
  const exists = host.fileExists, read = host.readFile;
  host.fileExists = (name) => sameFile(name) || exists(name);
  host.readFile = (name) => sameFile(name) ? source : read(name);
  host.getSourceFile = (name, version, ...args) => sameFile(name) ? ts.createSourceFile(name, source, version, true) : original.call(host, name, version, ...args);
  const program = ts.createProgram([file, resolve(uiRoot, 'src/vite-env.d.ts')], { ...options, noEmit: true, noUnusedLocals: false, noUnusedParameters: false }, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
