import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const lucide = require('lucide-react');
const packageJson = require('lucide-react/package.json');
assert.equal(
  packageJson.version,
  '0.468.0',
  'Dependency changes require an explicit catalogue update',
);
const concrete = new Set(Object.values(lucide.icons));
const names = Object.keys(lucide)
  .filter((name) => concrete.has(lucide[name]))
  .sort();
const catalogue = { dependency: 'lucide-react', version: packageJson.version, names };
const target = new URL('../src/ui-suite/lucide-icon-names.json', import.meta.url);
if (process.argv.includes('--generate'))
  await writeFile(target, JSON.stringify(catalogue, null, 2) + '\n');
assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), catalogue);
for (const helper of ['Icon', 'createLucideIcon', 'icons', 'default'])
  assert.ok(!names.includes(helper));
for (const alias of ['House', 'Home', 'HomeIcon', 'LucideHome']) assert.ok(names.includes(alias));
console.log(
  `PASS pinned Lucide 0.468.0 catalogue: ${names.length} concrete exports/aliases, SHA256 ${createHash('sha256').update(JSON.stringify(names)).digest('hex')}`,
);
