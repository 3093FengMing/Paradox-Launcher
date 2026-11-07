import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadApp, suiteRenderHost, uiRoot } from './lib/hook-test-host.mjs';
import { bundle, descriptors } from './lib/suite-test-fixtures.mjs';

const source = text => ({ encoding: 'utf8', text });
const canonical = loadApp()('ui-suite/canonical.ts');

await test('canonical base64 decoding never re-encodes bytes and rejects every nonzero padding bit', () => {
  const encode = globalThis.btoa;
  globalThis.btoa = () => { throw Error('Canonical decoder re-encoded the complete asset'); };
  try {
    for (const [value, bytes] of [['', []], ['AA==', [0]], ['/w==', [255]], ['//8=', [255, 255]], ['////', [255, 255, 255]]])
      assert.deepEqual([...canonical.decodeBase64(value)], bytes);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let bits = 0; bits < 64; bits++) {
      const one = `A${alphabet[bits]}==`, two = `AA${alphabet[bits]}=`;
      if (bits % 16) assert.throws(() => canonical.decodeBase64(one), /Noncanonical base64/);
      else assert.deepEqual(Buffer.from(canonical.decodeBase64(one)), Buffer.from(one, 'base64'));
      if (bits % 4) assert.throws(() => canonical.decodeBase64(two), /Noncanonical base64/);
      else assert.deepEqual(Buffer.from(canonical.decodeBase64(two)), Buffer.from(two, 'base64'));
    }
    for (const value of ['A', 'AAA', 'A===', '====', 'AA=A', 'AA==\n', 'AA-_', 'éAAA', '\u0000AAA'])
      assert.throws(() => canonical.decodeBase64(value), /Invalid base64/);
    const bytes = Uint8Array.from({ length: 65537 }, (_, i) => i % 256);
    assert.deepEqual(canonical.decodeBase64(Buffer.from(bytes).toString('base64')), bytes);
  } finally { globalThis.btoa = encode; }
});

await test('duplicate stylesheet imports prepare each path twice and keep one source identity', async () => {
  const css = loadApp()('customization/css.ts');
  const paths = [];
  const host = suiteRenderHost(new Map([[resolve(uiRoot, 'src/customization/css.ts'), {
    ...css,
    prepareSuiteCss(text, options) { paths.push(options.sourcePath); return css.prepareSuiteCss(text, options); },
  }]]));
  const candidate = bundle({ 'Home.tsx': source("import './a.css'; export default()=>null"), 'a.css': source('p{color:red}') });
  candidate.manifest.styles = ['a.css'];
  let prepared;
  try {
    prepared = await host.compile(candidate);
    assert.deepEqual(paths, ['a.css', 'a.css'], 'one discovery and one URL-aware preparation per unique path');
    assert.equal(new Set(prepared.styleUsages.map(usage => usage.source)).size, 1);
    assert.ok(prepared.css.includes('color:red'));
  } finally { prepared?.dispose(); host.dispose(); }
});

await test('precompiled exact graph bypasses TypeScript, stale source/topology/compiler signatures and custom transforms fall back', async () => {
  assert.ok(existsSync(resolve(uiRoot, 'src/ui-suite/graph-cache.ts')), 'startup needs a validated-source graph plan cache');
  const app = loadApp();
  const graphApi = app('ui-suite/module-graph.ts');
  const runtime = app('ui-suite/module-graph-runtime.ts');
  const { graphPlanSignature } = app('ui-suite/graph-plan.ts');
  const { suiteSiteTransform } = app('customization/site-transform.ts');
  const entries = ['Home.tsx'], publicNames = ['react', 'react/jsx-runtime'];
  const candidate = bundle({
    'Home.tsx': source("import './a.css'; export default()=> <p>original</p>"),
    'a.css': source('p{color:red}'),
  });
  const sites = [];
  const original = graphApi.buildModuleGraph(candidate, entries, publicNames, suiteSiteTransform(rows => sites.push(...rows)));
  const signature = graphPlanSignature(candidate, entries, publicNames, 'compiler-current');
  const metadata = { compilerSignature: 'compiler-current', plans: [{ signature, graph: runtime.serializeModuleGraph(original), sites }] };
  let builds = 0;
  const cachedApp = loadApp(new Map([
    ['virtual:ui-suite-graph-plans', metadata],
    [resolve(uiRoot, 'src/ui-suite/module-graph.ts'), { ...graphApi, buildModuleGraph(...args) { builds++; return graphApi.buildModuleGraph(...args); } }],
  ]));
  const { getSuiteModuleGraph } = cachedApp('ui-suite/graph-cache.ts');
  const first = await getSuiteModuleGraph(candidate, entries, publicNames);
  assert.equal(builds, 0, 'exact builtin plan never invokes the TypeScript builder');
  assert.equal(first.graph.identity, original.identity);
  assert.deepEqual(first.sites, sites);
  assert.deepEqual(first.graph.stylesFor('Home.tsx'), ['a.css']);
  candidate.files['a.css'].text = 'p{color:blue}'; descriptors(candidate);
  const cssOnly = await getSuiteModuleGraph(candidate, entries, publicNames);
  assert.equal(cssOnly.graph, first.graph, 'CSS-only edits retain code graph identity');
  candidate.files['Home.tsx'].text = candidate.files['Home.tsx'].text.replace('original', 'changed'); descriptors(candidate);
  const changed = await getSuiteModuleGraph(candidate, entries, publicNames);
  assert.equal(builds, 1); assert.notEqual(changed.graph.identity, original.identity);
  assert.ok(changed.graph.modules.get('Home.tsx').code.includes('changed'));
  assert.equal((await getSuiteModuleGraph(candidate, entries, publicNames)).graph, changed.graph);
  assert.equal(builds, 1, 'unchanged source graph is reused before synchronous transformation');
  candidate.files['unused.ts'] = source('export const x=1'); descriptors(candidate);
  await getSuiteModuleGraph(candidate, entries, publicNames);
  assert.equal(builds, 2, 'even unused resolution topology participates in signatures');
  let transformed = 0;
  await getSuiteModuleGraph(candidate, entries, publicNames, { cacheKey: 'custom', before() { transformed++; return []; } });
  assert.equal(builds, 3); assert.ok(transformed > 0, 'custom transform must execute the normal builder');
  const staleApp = loadApp(new Map([['virtual:ui-suite-graph-plans', { ...metadata, compilerSignature: 'compiler-next' }],
    [resolve(uiRoot, 'src/ui-suite/module-graph.ts'), { ...graphApi, buildModuleGraph(...args) { builds++; return graphApi.buildModuleGraph(...args); } }],
  ]));
  await staleApp('ui-suite/graph-cache.ts').getSuiteModuleGraph(bundle({ 'Home.tsx': source("import './a.css'; export default()=> <p>original</p>"), 'a.css': source('p{color:red}') }), entries, publicNames);
  assert.equal(builds, 4, 'compiler signature changes reject an otherwise matching precompiled plan');
});

await test('build graph plans derive both styles and exact editor sites from unchanged canonical source bytes', async () => {
  assert.ok(existsSync(resolve(uiRoot, 'src/ui-suite/build-graph-plugin.ts')), 'builtins need plans generated by their canonical source compiler');
  const app = loadApp();
  const { createBuiltinGraphPlans } = app('ui-suite/build-graph-plugin.ts');
  const { restoreModuleGraph } = app('ui-suite/module-graph-runtime.ts');
  const path = resolve(uiRoot, 'src/ui-suite/builtins/common/editor/Editor.tsx');
  const original = readFileSync(path);
  assert.equal((original.toString('utf8').match(/\r\n/g) ?? []).length, 3);
  const metadata = await createBuiltinGraphPlans(uiRoot);
  assert.equal(metadata.plans.length, 2);
  for (const [index, id] of ['modern', 'immersive'].entries()) {
    const plan = metadata.plans[index], graph = restoreModuleGraph(plan.graph);
    const canonicalFiles = Object.fromEntries(JSON.parse(plan.signature)[5].map(([path, kind, , media]) => {
      const bytes = readFileSync(resolve(uiRoot, 'src/ui-suite/builtins', path));
      return [path, kind === 'asset' ? { encoding: 'base64', media_type: media, data: bytes.toString('base64') } : source(bytes.toString('utf8'))];
    }));
    const runtimeBundle = { manifest: JSON.parse(readFileSync(resolve(uiRoot, `src/ui-suite/builtins/${id}/suite.json`), 'utf8')), files: canonicalFiles };
    descriptors(runtimeBundle);
    // Production validation canonicalizes object keys before collecting entries.
    const owned = app('ui-suite/bundle.ts').parseSuiteBundle(runtimeBundle);
    const views = new Map(Object.entries(owned.manifest.views));
    for (const route of owned.manifest.routes) views.set(`page.${route.id}`, route.entry);
    const entries = [...new Set([...views.values(), ...owned.manifest.overrides.filter(override => override.enabled).flatMap(override => override.entry ? [override.entry] : [])])];
    const publicNames = Object.keys(app('ui-suite/publicModules.ts').loadPublicModules());
    assert.deepEqual(graph.entries, entries, 'generated factories must keep the validated runtime initialization order');
    assert.equal(plan.signature, app('ui-suite/graph-plan.ts').graphPlanSignature(owned, entries, publicNames, metadata.compilerSignature));
    const expectedSites = [];
    const expectedGraph = app('ui-suite/module-graph.ts').buildModuleGraph(owned, entries, publicNames,
      app('customization/site-transform.ts').suiteSiteTransform(rows => expectedSites.push(...rows)));
    assert.equal(graph.identity, expectedGraph.identity);
    assert.deepEqual(plan.sites, expectedSites);
    assert.ok(graph.entries.includes(`${id}/Shell.tsx`));
    assert.ok(graph.entries.includes('common/editor/Editor.tsx'));
    const editorIdentity = JSON.parse(graph.identity)[1].find(row => row[0] === 'common/editor/Editor.tsx');
    assert.equal(editorIdentity[1], original.toString('utf8'), 'precompilation consumes exact canonical bytes, including CRLF offsets');
    assert.ok(plan.sites.some(site => site.sourcePath === 'common/editor/Editor.tsx' && site.site.startsWith('auto:')));
    assert.ok(graph.stylesFor(`${id}/Shell.tsx`).includes(`${id}/style.css`));
    assert.match(metadata.compilerSignature, /^[0-9a-f]{64}$/);
  }
  assert.deepEqual(readFileSync(path), original);
});

await test('scoped CSS-only preparation retains the module lease and cached graphs never bypass SHA or resolution collisions', async () => {
  const host = suiteRenderHost();
  const scope = host.app('ui-suite/prepared.ts').createSuiteRuntimeScope();
  const candidate = bundle({
    'Home.tsx': source("import './a.css'; import { label } from './helper'; export default()=> <p>{label}</p>"),
    'helper.ts': source("export const label='old';"),
    'a.css': source('p{color:red}'),
  });
  try {
    const first = await host.compile(candidate, scope, false);
    candidate.files['a.css'].text = 'p{color:blue}'; descriptors(candidate);
    const cssOnly = await host.compile(candidate, scope, false);
    assert.equal(cssOnly.codeGraphDigest, first.codeGraphDigest);
    assert.equal(cssOnly.views.get('page.home'), first.views.get('page.home'));
    assert.ok(first.css.includes('color:red')); assert.ok(cssOnly.css.includes('color:blue'));
    candidate.files['helper.ts'].text = "export const label='new';";
    await assert.rejects(() => host.compile(candidate, scope, false), /SHA mismatch/);
    descriptors(candidate);
    const changed = await host.compile(candidate, scope, false);
    assert.notEqual(changed.codeGraphDigest, first.codeGraphDigest);
    assert.notEqual(changed.views.get('page.home'), first.views.get('page.home'));
    candidate.files['helper.tsx'] = source('export const label="collision";'); descriptors(candidate);
    await assert.rejects(() => host.compile(candidate, scope, false), /ambiguous/);
  } finally { host.dispose(); }
});

await test('pure graph reuse evicts old source variants instead of retaining an unbounded editor history', async () => {
  const app = loadApp(), real = app('ui-suite/module-graph.ts');
  let builds = 0;
  const cached = loadApp(new Map([[resolve(uiRoot, 'src/ui-suite/module-graph.ts'), {
    ...real, buildModuleGraph(...args) { builds++; return real.buildModuleGraph(...args); },
  }]]))('ui-suite/graph-cache.ts');
  const first = bundle({ 'Home.tsx': source("export default()=> 'variant0'") });
  await cached.getSuiteModuleGraph(first, ['Home.tsx'], ['react', 'react/jsx-runtime']);
  for (let index = 1; index <= 10; index++)
    await cached.getSuiteModuleGraph(bundle({ 'Home.tsx': source(`export default()=> 'variant${index}'`) }), ['Home.tsx'], ['react', 'react/jsx-runtime']);
  assert.equal(builds, 11);
  await cached.getSuiteModuleGraph(first, ['Home.tsx'], ['react', 'react/jsx-runtime']);
  assert.equal(builds, 12, 'the oldest variant must have been evicted');
});

await test('unbounded source validation avoids string iterator allocation and bounded labels count Unicode points', () => {
  const api = loadApp()('ui-suite/bundle.ts');
  const candidate = bundle({ 'Home.tsx': source('export default()=>null; //' + 'a'.repeat(65536)) });
  const iterate = String.prototype[Symbol.iterator];
  let expanded = 0;
  String.prototype[Symbol.iterator] = function () {
    if (this.length > 60000) expanded++;
    return iterate.call(this);
  };
  try {
    assert.equal(api.parseSuiteBundle(candidate).files['Home.tsx'].text, candidate.files['Home.tsx'].text);
    assert.equal(expanded, 0, 'large UTF-8 source must not expand into a character array');
  } finally { String.prototype[Symbol.iterator] = iterate; }
  candidate.manifest.name = '😀'.repeat(48);
  assert.doesNotThrow(() => api.parseSuiteBundle(candidate));
  candidate.manifest.name += '😀';
  assert.throws(() => api.parseSuiteBundle(candidate));
  candidate.manifest.name = '\ud800';
  assert.throws(() => api.parseSuiteBundle(candidate), /Unicode/);
});

await test('compile validation transaction decodes each owned asset once and preserves digest and mutation rejection', async () => {
  let decodes = 0;
  const app = loadApp(new Map([[resolve(uiRoot, 'src/ui-suite/canonical.ts'), {
    ...canonical,
    decodeBase64(value) { decodes++; return canonical.decodeBase64(value); },
  }]]));
  const api = app('ui-suite/bundle.ts');
  const image = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url));
  const candidate = bundle({ 'art.png': { encoding: 'base64', media_type: 'image/png', data: image.toString('base64') } });
  const expected = await api.bundleDigest(candidate);
  decodes = 0;
  assert.equal(typeof api.validateSuiteBundleAndDigest, 'function', 'compiler needs one complete owned validation/digest transaction');
  // Only the platform image decoder is adapted; format, bytes, hashing and framing are real.
  const decodeImage = globalThis.createImageBitmap;
  let validated = 0, closed = 0;
  globalThis.createImageBitmap = async blob => {
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), image);
    validated++;
    return { width: 1, height: 1, close() { closed++; } };
  };
  try {
    const pending = api.validateSuiteBundleAndDigest(candidate);
    candidate.files['Home.tsx'].text = 'mutated while validation awaited';
    const checked = await pending;
    assert.equal(checked.digest, expected);
    assert.match(checked.bundle.files['Home.tsx'].text, /世界/);
    assert.equal(decodes, 1, 'one private decoded asset feeds size, SHA, asset validation and framed digest');
    assert.equal(validated, 1); assert.equal(closed, 1);
    await assert.rejects(() => api.validateSuiteBundleAndDigest(candidate), /format|SHA mismatch/);
    checked.bundle.files['Home.tsx'].text = 'public returned data may be edited';
    await assert.rejects(() => api.validateSuiteBundleAndDigest(checked.bundle), /format|SHA mismatch/);
    descriptors(candidate);
    assert.notEqual((await api.validateSuiteBundleAndDigest(candidate)).digest, expected);
    const changed = Buffer.from(image); changed[changed.length - 1] ^= 1;
    candidate.files['art.png'].data = changed.toString('base64');
    await assert.rejects(() => api.validateSuiteBundleAndDigest(candidate), /SHA mismatch/);
  } finally { globalThis.createImageBitmap = decodeImage; }
});
