import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = {
  windows: { target: 'x86_64-pc-windows-msvc', arch: 'x64', extension: '.exe' },
  linux: { target: 'x86_64-unknown-linux-gnu', arch: 'x64', extension: '.tar.gz' },
  macos: { target: 'aarch64-apple-darwin', arch: 'arm64', extension: '.app.tar.gz' },
};
const [platform, output] = process.argv.slice(2);
if (!Object.hasOwn(platforms, platform) || !output)
  throw new Error(
    'Usage: node scripts/package-build-artifact.mjs <windows|linux|macos> <empty-output-directory>',
  );
const { target, arch, extension } = platforms[platform];
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { productName } = JSON.parse(
  await readFile(join(root, 'apps/desktop/tauri.conf.json'), 'utf8'),
);
const release = join(root, 'target', target, 'release');
const application = `${productName}.app`;
const source =
  platform === 'macos'
    ? join(release, 'bundle/macos', application, 'Contents/MacOS/paradox-launcher')
    : join(release, `paradox-launcher${platform === 'windows' ? '.exe' : ''}`);
const binary = await stat(source);
if (!binary.isFile() || binary.size === 0)
  throw new Error(`Missing compiled application: ${source}`);

const directory = resolve(output);
await mkdir(directory, { recursive: true });
if ((await readdir(directory)).length) throw new Error('Artifact output directory must be empty');
const artifact = `Paradox-Launcher-${version}-${platform}-${arch}${extension}`;
if (platform === 'windows') {
  await copyFile(source, join(directory, artifact));
} else {
  const parent = platform === 'macos' ? join(release, 'bundle/macos') : release;
  const entry = platform === 'macos' ? application : 'paradox-launcher';
  // Tar preserves Unix executable permissions and macOS bundle symlinks.
  execFileSync('tar', ['-czf', join(directory, artifact), '-C', parent, entry], {
    stdio: 'inherit',
  });
}
const commit =
  process.env.GITHUB_SHA ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sdkCommit = execFileSync('git', ['-C', 'vendor/QuintElement', 'rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
await copyFile(join(root, 'LICENSE'), join(directory, 'LICENSE'));
await writeFile(
  join(directory, 'BUILD-INFO.json'),
  JSON.stringify(
    {
      version,
      platform,
      arch,
      target,
      commit,
      sdk_commit: sdkCommit,
      artifact,
      profile: 'release',
      frontend_embedded: true,
    },
    null,
    2,
  ) + '\n',
);
const instructions = {
  windows: 'Run the .exe. Windows requires the Microsoft Edge WebView2 Runtime.',
  linux:
    'Extract the .tar.gz, then run ./paradox-launcher. Built on Ubuntu 24.04; compatible WebKitGTK 4.1, GTK 3 and system libraries are required.',
  macos:
    'Extract the .app.tar.gz, then open the .app on an Apple Silicon Mac. This CI build is unsigned and is not notarized.',
};
await writeFile(
  join(directory, 'README.txt'),
  [
    `${productName} ${version} (${platform}/${arch})`,
    '',
    instructions[platform],
    '',
    'The frontend is embedded; Rust, Node.js and Vite are not needed to run the app.',
    'Minecraft requires a compatible Java runtime.',
    `Source: https://github.com/3093FengMing/Paradox-Launcher/tree/${commit}`,
    `QuintElement source: https://github.com/3093FengMing/QuintElement/tree/${sdkCommit}`,
    'BUILD-INFO.json records the exact build. SHA256SUMS covers every supplied file.',
    '',
  ].join('\n'),
);
const checksums = [];
for (const name of (await readdir(directory)).sort()) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  checksums.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS'), checksums.join('\n') + '\n');
console.log(`Prepared ${artifact} with build information, license and SHA-256 checksums`);
