import { access, mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep every source and embedded test in the original audit domains. A fresh
// source snapshot avoids the analyzer's traversal of dependency/build trees.
const root = fileURLToPath(new URL('..', import.meta.url));
const domains = ['crates/launcher-core/src', 'apps/desktop/src', 'ui/src'];
const files = ['apps/desktop/build.rs', 'ui/vite.config.ts'];
async function visit(relative) {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile() && /\.(rs|[cm]?js|tsx?)$/.test(entry.name)) files.push(path);
  }
}
for (const domain of domains) await visit(domain);
files.sort();
const auditRoot = join(root, '.test-data/fuck-u-code-review-2026-11-21');
await mkdir(auditRoot, { recursive: true });
const snapshot = await mkdtemp(join(auditRoot, 'source-'));
for (const file of files) {
  const target = join(snapshot, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(join(root, file)));
}
const report = resolve(root, process.argv[2] ?? '.test-data/fuck-u-code-review-2026-11-21/optimized.json');
await mkdir(dirname(report), { recursive: true });
const args = ['analyze', snapshot, '-v', '-t', '20', '-f', 'json', '-o', report, '-l', 'en'];
let command = 'fuck-u-code', commandArgs = args;
if (process.platform === 'win32') {
  // Invoke the installed npm CLI entry with Node so paths never enter a shell.
  let executable;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, 'node_modules/eff-u-code/bin/fuck-u-code.js');
    try { await access(candidate); executable = candidate; break; } catch { /* Search the next npm prefix. */ }
  }
  if (!executable) throw Error('Install eff-u-code globally before running this check');
  command = process.execPath;
  commandArgs = [executable, ...args];
}
const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const quality = JSON.parse(await readFile(report, 'utf8'));
if (quality.summary.analyzedFiles !== files.length) throw Error('Analyzer did not cover every source file');
console.log(`Quality: ${quality.overallScore.toFixed(2)}/100; ${files.length} source files; ${report}`);
if (quality.overallScore < 90) process.exitCode = 1;
