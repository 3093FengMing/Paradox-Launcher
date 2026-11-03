import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await test('named ZIP CRC case waits for its actual asynchronous rejection assertion', async () => {
  const model = new URL('./check-ui-suite-model.mjs', import.meta.url);
  const name = 'ZIP local/central layouts and descriptor CRC-signature ambiguity';
  const capture = '__paradoxCrcAttribution';
  let source = await readFile(model, 'utf8');
  source = source.replace("import test from 'node:test';", `const test = (name, fn) => { if (name === ${JSON.stringify(name)}) globalThis.${capture} = fn; return Promise.resolve(); };`);
  source = source.replaceAll('import.meta.url', JSON.stringify(model.href));
  source = source.replace(/from '(\.\/[^']+)'/g, (_, relative) => `from ${JSON.stringify(new URL(relative, model).href)}`);
  const original = assert.rejects;
  let pending, settled = false;
  try {
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    assert.equal(typeof globalThis[capture], 'function');
    assert.rejects = (...args) => {
      pending = original(...args).then(async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
        settled = true;
      });
      return pending;
    };
    await globalThis[capture]();
    assert.equal(settled, true, 'named callback returned before its real CRC rejection assertion settled');
    assert.ok(pending, 'actual CRC assertion was invoked');
  } finally {
    assert.rejects = original;
    await pending;
    delete globalThis[capture];
  }
});
