const scriptUrl = new URL('../check-ui-suite-model.mjs', import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateRawSync, constants } from 'node:zlib';
import { loadApp } from './hook-test-host.mjs';
import {
  bundle,
  descriptors,
  record,
  library,
  zip,
  zipBundle,
  bytes,
  crc,
  sha,
} from './suite-test-fixtures.mjs';
import { fixed, dynamic } from './suite-deflate-vectors.mjs';
import { checkArchiveOutputBoundary } from './suite-archive-output-check.mjs';
assert.ok(
  existsSync(new URL('../src/ui-suite/bundle.ts', scriptUrl)),
  'Task 6 strict bundle model must exist',
);
const app = loadApp(new Map(), { isolateCustomization: false });
const {
  parseSuiteBundle,
  parseSuiteLibrary,
  materializeSuite,
  bundleDigest,
  validateSuiteBundle,
  validateSuiteLibrary,
  normalizeDraftBundle,
} = app('ui-suite/bundle.ts');
const { validateSuiteLibraryData } = app('ui-suite/bundle.ts');
const { canonicalSuiteJson } = app('ui-suite/canonical.ts');
const { resolveSuitePath, suitePathCollisionKey } = app('ui-suite/paths.ts');
const { inspectSuiteDeflate } = app('ui-suite/deflate-structure.ts');
const { inspectSuiteZip } = app('ui-suite/archive-structure.ts');
const { decodeSuiteArchive, encodeSuiteArchive } = app('ui-suite/archive.ts');
const { inspectSuiteAsset, validateSuiteAsset } = app('ui-suite/assets.ts');
const { checkRasterDimensions } = app('ui-suite/asset-raster.ts');
const plain = (x) => JSON.parse(JSON.stringify(x));
const sharedVectors = JSON.parse(
  readFileSync(new URL('./fixtures/ui-suite/format-vectors.json', scriptUrl)),
);

export function createContext() {
  return {
    assert,
    test,
    existsSync,
    readFileSync,
    createRequire,
    deflateRawSync,
    constants,
    loadApp,
    bundle,
    descriptors,
    record,
    library,
    zip,
    zipBundle,
    bytes,
    crc,
    sha,
    fixed,
    dynamic,
    checkArchiveOutputBoundary,
    parseSuiteBundle,
    parseSuiteLibrary,
    materializeSuite,
    bundleDigest,
    validateSuiteBundle,
    validateSuiteLibrary,
    normalizeDraftBundle,
    validateSuiteLibraryData,
    canonicalSuiteJson,
    resolveSuitePath,
    suitePathCollisionKey,
    inspectSuiteDeflate,
    inspectSuiteZip,
    decodeSuiteArchive,
    encodeSuiteArchive,
    inspectSuiteAsset,
    validateSuiteAsset,
    checkRasterDimensions,
    plain,
    sharedVectors,
    scriptUrl,
  };
}
