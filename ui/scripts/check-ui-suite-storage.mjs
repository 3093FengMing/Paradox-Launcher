import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert.ok(
  existsSync(new URL('../src/ui-suite/storage.ts', import.meta.url)),
  'Task7 atomic storage must exist',
);
// Browser transaction/persistence checks are installed through the existing explicit test fixture.
await import('./check-ui-suite-storage-browser.mjs');
