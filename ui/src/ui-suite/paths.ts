/* eslint-disable no-control-regex -- Virtual paths explicitly reject Unicode controls. */
import fold from './unicode-simple-fold-15.1.0.json';
import { wellFormed } from './canonical';
import type { UiFile } from './model';
import { normalizeSuiteNfc } from './unicode-nfc';
const mapping = new Map(fold.mappings.map(([a, b]) => [a, b]));
export function suitePathCollisionKey(nfcPath: string): string {
  return Array.from(nfcPath, (c) =>
    String.fromCodePoint(mapping.get(c.codePointAt(0)!) ?? c.codePointAt(0)!),
  ).join('');
}
export function validateSuitePath(path: string): string {
  if (
    typeof path !== 'string' ||
    !path ||
    !wellFormed(path) ||
    normalizeSuiteNfc(path) !== path ||
    /[\u0000-\u001f\u007f-\u009f\\<>:"|?*]/u.test(path)
  )
    throw new Error('Invalid suite path');
  for (const part of path.split('/'))
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      /[. ]$/.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)
    )
      throw new Error('Invalid suite path');
  return path;
}
export function uniqueSuitePaths(paths: readonly string[], allowManifest = false): void {
  const keys = new Set<string>();
  for (const p of paths) {
    validateSuitePath(p);
    const key = suitePathCollisionKey(p);
    if (keys.has(key) || (!allowManifest && key === 'suite.json'))
      throw new Error('Colliding suite path');
    keys.add(key);
  }
}
export function resolveSuitePath(
  from: string,
  specifier: string,
  files: ReadonlyMap<string, UiFile>,
): string {
  validateSuitePath(from);
  if (typeof specifier !== 'string' || !/^\.\.?\//.test(specifier) || /[?#]/.test(specifier))
    throw new Error('Expected relative suite path');
  const parts = from.split('/');
  parts.pop();
  for (const p of specifier.split('/')) {
    if (p === '.') continue;
    if (p === '..') {
      if (!parts.length) throw new Error('Suite path escapes root');
      parts.pop();
    } else {
      if (!p) throw new Error('Empty suite path segment');
      parts.push(p);
    }
  }
  const path = validateSuitePath(parts.join('/'));
  const candidates = /\.[^/]+$/.test(path)
    ? [path]
    : [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`];
  const found = candidates.filter((p) => files.has(p));
  if (found.length !== 1) throw new Error('Missing or ambiguous suite path');
  return found[0];
}
