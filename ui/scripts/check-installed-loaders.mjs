import assert from 'node:assert/strict';
import { loadApp } from './lib/hook-test-host.mjs';

const { profileIsInstalled } = loadApp()('lib/instances.ts');
const settings = { game_directory: 'C:\\Minecraft Root' };
const profile = {
  instance_key: 'loader-fixture',
  game_version: '1.20.1',
  loader: 'fabric',
  loader_version: '0.16.10',
  game_directory: null,
};
const installed = {
  instance_key: profile.instance_key,
  game_version: profile.game_version,
  loader: profile.loader,
  loader_version: '0.16.9',
  root: 'c:/minecraft root/versions/loader-fixture',
};
assert.equal(
  profileIsInstalled(profile, settings, [installed]),
  false,
  'an old loader cannot satisfy the requested installation',
);
assert.equal(
  profileIsInstalled(profile, settings, [{ ...installed, loader_version: profile.loader_version }]),
  true,
);
assert.equal(
  profileIsInstalled(profile, settings, [{ ...installed, loader_version: null }]),
  false,
  'unknown loader versions require repair',
);
assert.equal(
  profileIsInstalled({ ...profile, loader: 'vanilla', loader_version: '' }, settings, [
    { ...installed, loader: 'vanilla', loader_version: null },
  ]),
  true,
  'Vanilla has no loader version',
);
assert.equal(
  profileIsInstalled(profile, settings, [
    {
      ...installed,
      loader_version: profile.loader_version,
      root: 'C:/Other Root/versions/loader-fixture',
    },
  ]),
  false,
);
console.log(
  'Installed loader identity regression passed: actual versions, unknown metadata, Vanilla compatibility and instance roots.',
);
