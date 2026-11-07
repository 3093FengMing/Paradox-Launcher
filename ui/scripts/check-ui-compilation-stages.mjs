import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { suiteRenderHost } from './lib/hook-test-host.mjs';
import { bundle } from './lib/suite-test-fixtures.mjs';

const png = readFileSync(new URL('./fixtures/ui-suite/pixel.png', import.meta.url));
const source = text => ({ encoding: 'utf8', text });
const artwork = { encoding: 'base64', media_type: 'image/png', data: png.toString('base64') };
async function decodeImages(run) {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async blob => {
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
    return { width: 1, height: 1, close() {} };
  };
  try { await run(); } finally { globalThis.createImageBitmap = original; }
}

await test('cancellation after CSS acquisition releases assets without publishing a module', async () => decodeImages(async () => {
  const host = suiteRenderHost(), real = host.app('ui-suite/prepared.ts'), abort = new AbortController();
  let acquisitions = 0;
  const create = URL.createObjectURL, scope = real.createSuiteRuntimeScope();
  URL.createObjectURL = blob => {
    const url = create.call(URL, blob);
    if (blob.type === 'image/png') { acquisitions++; abort.abort(); }
    return url;
  };
  const input = bundle({ 'Home.tsx': source('export default()=>null;'), 'art.png': artwork, 'a.css': source('p{background:url("./art.png")}') });
  input.manifest.styles = ['a.css'];
  try {
    await assert.rejects(host.compile(input, scope, true, { signal: abort.signal }), error => {
      assert.equal(error.name, 'AbortError', error.message); return true;
    });
    assert.equal(acquisitions, 1);
    assert.equal(real.suiteScopeState(scope).assets.size, 0);
    assert.equal(real.suiteScopeState(scope).modules.size, 0);
  } finally { host.dispose(); URL.createObjectURL = create; }
}));

await test('module initialization failure releases static and stylesheet leases before recovery compile', async () => decodeImages(async () => {
  const host = suiteRenderHost(), api = host.app('ui-suite/prepared.ts'), scope = api.createSuiteRuntimeScope();
  const input = bundle({
    'Home.tsx': source('import art from "./art.png"; throw Error("initializer exploded"); export default()=>art;'),
    'art.png': artwork, 'a.css': source('p{background:url("./art.png")}'),
  });
  input.manifest.styles = ['a.css'];
  try {
    await assert.rejects(host.compile(input, scope), /initializer exploded/);
    assert.equal(api.suiteScopeState(scope).assets.size, 0);
    assert.equal(api.suiteScopeState(scope).modules.size, 0);
    input.files['Home.tsx'] = source('import art from "./art.png"; export default()=>art;');
    const recovered = await host.compile(input, scope);
    assert.equal(api.suiteScopeState(scope).modules.size, 1);
    recovered.dispose();
    assert.equal(api.suiteScopeState(scope).assets.size, 0);
    assert.equal(api.suiteScopeState(scope).modules.size, 0);
  } finally { host.dispose(); }
}));

await test('shared module preparation keeps sibling leases alive until both prepared suites dispose', async () => decodeImages(async () => {
  const host = suiteRenderHost(), api = host.app('ui-suite/prepared.ts'), scope = api.createSuiteRuntimeScope();
  const input = bundle({ 'Home.tsx': source('import art from "./art.png"; export default()=>art;'), 'art.png': artwork });
  try {
    const first = await host.compile(input, scope), second = await host.compile(input, scope);
    assert.equal(first.views.get('page.home'), second.views.get('page.home'));
    assert.equal(api.suiteScopeState(scope).modules.size, 1);
    first.dispose();
    assert.equal(api.suiteScopeState(scope).modules.size, 1);
    assert.equal(api.suiteScopeState(scope).assets.size, 1);
    second.dispose();
    assert.equal(api.suiteScopeState(scope).modules.size, 0);
    assert.equal(api.suiteScopeState(scope).assets.size, 0);
  } finally { host.dispose(); }
}));
