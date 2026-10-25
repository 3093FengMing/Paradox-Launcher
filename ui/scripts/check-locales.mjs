import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url));
const localeDirectory = join(sourceDirectory, 'locales');
const languages = ['zh-CN', 'en-US'];

function flatten(value, prefix = '', entries = new Map()) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    `${prefix}: invalid object`,
  );
  for (const [name, text] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof text === 'string') {
      assert.ok(text.trim(), `${key}: empty translation`);
      entries.set(key, text);
    } else {
      flatten(text, key, entries);
    }
  }
  return entries;
}

function variables(text) {
  return [...text.matchAll(/\{\{\s*-?\s*([^},\s]+)[^}]*\}\}/g)].map((match) => match[1]).sort();
}

const resources = await Promise.all(
  languages.map(async (language) =>
    flatten(JSON.parse(await readFile(join(localeDirectory, `${language}.json`), 'utf8'))),
  ),
);
const referenceKeys = [...resources[0].keys()].sort();
for (let index = 1; index < languages.length; index++) {
  assert.deepEqual(
    [...resources[index].keys()].sort(),
    referenceKeys,
    `${languages[index]}: key mismatch`,
  );
  for (const key of referenceKeys) {
    assert.deepEqual(
      variables(resources[index].get(key)),
      variables(resources[0].get(key)),
      `${languages[index]}: interpolation mismatch for ${key}`,
    );
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return results.flat();
}

function literalKeys(expression) {
  if (!expression) return [];
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return [expression.text];
  if (ts.isConditionalExpression(expression))
    return [...literalKeys(expression.whenTrue), ...literalKeys(expression.whenFalse)];
  return [];
}

let checkedUsages = 0;
for (const path of await sourceFiles(sourceDirectory)) {
  const source = ts.createSourceFile(
    path,
    await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    const translateCall =
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'));
    if (translateCall) {
      for (const key of literalKeys(node.arguments[0])) {
        checkedUsages++;
        for (let index = 0; index < languages.length; index++) {
          assert.ok(resources[index].has(key), `${path}: missing ${languages[index]} key ${key}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

console.log(
  `Verified ${referenceKeys.length} locale keys and ${checkedUsages} static translation usages across ${languages.length} languages.`,
);
