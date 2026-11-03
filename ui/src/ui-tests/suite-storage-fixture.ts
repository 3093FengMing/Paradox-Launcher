/** Explicit test installer; ordinary production never imports this module. */
/* eslint-disable @typescript-eslint/unbound-method -- Prototype failure hooks explicitly preserve their receiver and restore identity. */
import * as storage from '../ui-suite/storage';
import { desktop } from '../api';
import type { UiSuiteLibrary, UiSuiteRecord } from '../ui-suite/model';
import { validateSuiteLibraryData, validateSuiteLibrary } from '../ui-suite/bundle';
import {
  canonicalSuiteJson,
  decodeBase64,
  encodeBase64,
  sha256,
  utf8,
} from '../ui-suite/canonical';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
import assets from '../../scripts/fixtures/ui-suite/browser-assets.json';

const dbName = 'paradox.ui-suite-library.v1';
function assert(value: unknown, reason = 'Storage assertion failed'): asserts value {
  if (!value) throw new Error(reason);
}
async function rejects(fn: () => Promise<unknown>) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert(rejected, 'Expected rejection');
}
function equal(a: unknown, b: unknown) {
  assert(
    canonicalSuiteJson(JSON.parse(JSON.stringify(a))) ===
      canonicalSuiteJson(JSON.parse(JSON.stringify(b))),
    'Unequal data',
  );
}
function sample(): UiSuiteLibrary {
  const b = structuredClone(vectors.bundle);
  return {
    kind: 'paradox-ui-suite-library',
    schema_version: 1,
    revision: 1234,
    active_suite_id: 'fd910be2-a6bc-4976-a397-137ace486aa8',
    suites: [
      {
        instance_id: 'fd910be2-a6bc-4976-a397-137ace486aa8',
        manifest: b.manifest,
        parent_snapshot: null,
        overlay: b.files,
        deleted: [],
      } as UiSuiteRecord,
    ],
  };
}
async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      for (const s of ['library', 'assets', 'backups']) request.result.createObjectStore(s);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Fixture database failed'));
  });
}
async function raw(value: Uint8Array): Promise<void> {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('library', 'readwrite');
      tx.objectStore('library').put(value, 'current');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Fixture transaction failed'));
    });
  } finally {
    database.close();
  }
}
async function rows(name: string): Promise<unknown[]> {
  const database = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(name, 'readonly');
      const request = tx.objectStore(name).getAll();
      tx.oncomplete = () => resolve(request.result as unknown[]);
      tx.onabort = () => reject(tx.error ?? new Error('Fixture transaction failed'));
    });
  } finally {
    database.close();
  }
}
async function clear(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(dbName);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error ?? new Error('Fixture cleanup failed'));
    r.onblocked = () => reject(new Error('Blocked fixture cleanup'));
  });
}
declare global {
  interface Window {
    suiteStorageFixture: {
      run(): Promise<string[]>;
      reloadCheck(): Promise<string[]>;
      desktop(): Promise<string[]>;
    };
  }
}
export function installSuiteStorageFixture(): void {
  window.suiteStorageFixture = {
    async run() {
      assert(!desktop, 'Real browser IDB branch required');
      await clear();
      const checks: string[] = [];
      const check = async (name: string, fn: () => Promise<void>) => {
        await fn();
        checks.push(name);
      };
      await check(
        'missing revision0; candidate revision authority; complete valid asset commit',
        async () => {
          assert((await storage.loadSuiteLibrary()).revision === 0);
          const committed = await storage.saveSuiteLibrary(sample(), 0);
          assert(committed.revision === 1);
          assert((await rows('assets')).length > 0);
        },
      );
      const first = await storage.loadSuiteLibrary(),
        firstRaw = await storage.readRecoverableLibrary(),
        firstAssets = await rows('assets');
      await check('revision conflict and invalid orphan leave exact bytes/assets', async () => {
        await rejects(() => storage.saveSuiteLibrary(sample(), 0));
        await rejects(() => storage.saveSuiteLibrary({ ...first, active_suite_id: 'orphan' }, 1));
        assert(encodeBase64(await storage.readRecoverableLibrary()) === encodeBase64(firstRaw));
        equal(await rows('assets'), firstAssets);
      });
      await check('quota failure aborts library and active/assets transaction', async () => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
          if (this.name === 'assets')
            throw new DOMException('Injected quota', 'QuotaExceededError');
          return original.apply(this, args);
        };
        try {
          const next = sample();
          next.active_suite_id = 'builtin.modern';
          await rejects(() => storage.saveSuiteLibrary(next, 1));
        } finally {
          IDBObjectStore.prototype.put = original;
        }
        equal(await storage.loadSuiteLibrary(), first);
        equal(await rows('assets'), firstAssets);
        assert((await rows('backups')).length === 0);
      });
      await check('backup failure aborts reset before replacement', async () => {
        const original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args: Parameters<typeof original>) {
          if (this.name === 'backups')
            throw new DOMException('Injected backup failure', 'QuotaExceededError');
          return original.apply(this, args);
        };
        try {
          await rejects(() => storage.resetSuiteLibrary(1));
        } finally {
          IDBObjectStore.prototype.add = original;
        }
        equal(await storage.loadSuiteLibrary(), first);
        equal(await rows('assets'), firstAssets);
        assert((await rows('backups')).length === 0);
      });
      await check('captured full candidate cannot mutate through async hash await', async () => {
        const candidate = sample(),
          originalName = candidate.suites[0].manifest.name;
        const original = crypto.subtle.digest.bind(crypto.subtle);
        let release!: () => void, entered!: () => void;
        const enteredPromise = new Promise<void>((r) => {
          entered = r;
        });
        const held = new Promise<void>((r) => {
          release = r;
        });
        let hold = true;
        crypto.subtle.digest = async (...args: Parameters<typeof original>) => {
          if (hold) {
            hold = false;
            entered();
            await held;
          }
          return original(...args);
        };
        try {
          const pending = storage.saveSuiteLibrary(candidate, 1);
          await enteredPromise;
          candidate.suites[0].manifest.name = 'mutated';
          candidate.active_suite_id = 'builtin.immersive';
          release();
          const result = await pending;
          assert(
            result.revision === 2 &&
              result.suites[0].manifest.name === originalName &&
              result.active_suite_id === first.active_suite_id,
          );
        } finally {
          crypto.subtle.digest = original;
          release();
        }
      });
      await check('active removal and all asset deletion commit together', async () => {
        const next = { ...first, suites: [], active_suite_id: null };
        assert((await storage.saveSuiteLibrary(next, 2)).revision === 3);
        assert((await rows('assets')).length === 0);
        assert((await storage.loadSuiteLibrary()).active_suite_id === null);
      });
      await check(
        'full asset rejection makes no host commit; DATA keeps revision and normal reset',
        async () => {
          const broken = sample(),
            bytes = utf8('<svg><script/></svg>');
          broken.revision = 7;
          broken.suites[0].overlay['broken.svg'] = {
            encoding: 'base64',
            media_type: 'image/svg+xml',
            data: encodeBase64(bytes),
          };
          broken.suites[0].manifest.files.push({
            path: 'broken.svg',
            kind: 'asset',
            media_type: 'image/svg+xml',
            bytes: bytes.length,
            sha256: await sha256(bytes),
          });
          await validateSuiteLibraryData(broken);
          await rejects(() => validateSuiteLibrary(broken));
          const before = await storage.readRecoverableLibrary();
          await rejects(() => storage.saveSuiteLibrary(broken, 3));
          assert(encodeBase64(await storage.readRecoverableLibrary()) === encodeBase64(before));
          await raw(utf8(canonicalSuiteJson(broken)));
          assert((await storage.loadSuiteLibrary()).revision === 7);
          const inspected = await storage.inspectSuiteRecovery();
          await rejects(() => storage.resetRecoverableSuiteLibrary(inspected.token));
          assert((await storage.resetSuiteLibrary(7)).revision === 8);
          assert(
            (await rows('backups')).some(
              (v) => v instanceof Uint8Array && encodeBase64(v) === encodeBase64(inspected.raw),
            ),
          );
        },
      );
      await check('revision maximum overflow; input cannot bypass persisted CAS', async () => {
        const maximum = { ...first, revision: Number.MAX_SAFE_INTEGER };
        await raw(utf8(canonicalSuiteJson(maximum)));
        const before = await storage.readRecoverableLibrary();
        await rejects(() => storage.saveSuiteLibrary(sample(), Number.MAX_SAFE_INTEGER));
        await rejects(() => storage.resetSuiteLibrary(Number.MAX_SAFE_INTEGER));
        await rejects(() => storage.saveSuiteLibrary(sample(), 0));
        assert(encodeBase64(await storage.readRecoverableLibrary()) === encodeBase64(before));
      });
      await check(
        'final transaction compares exact raw even when revision stays equal',
        async () => {
          await raw(utf8(canonicalSuiteJson(first)));
          const changed = { ...first, active_suite_id: 'builtin.modern' };
          const replacement = utf8(canonicalSuiteJson(changed));
          const original = IDBDatabase.prototype.transaction;
          let once = true;
          IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
            if (args[1] === 'readwrite' && once) {
              once = false;
              const ahead = original.call(this, 'library', 'readwrite');
              ahead.objectStore('library').put(replacement, 'current');
            }
            return original.apply(this, args);
          };
          try {
            await rejects(() => storage.saveSuiteLibrary(sample(), 1));
          } finally {
            IDBDatabase.prototype.transaction = original;
          }
          equal(await storage.loadSuiteLibrary(), changed);
        },
      );
      await check(
        'corrupt exact export, stale raw token, strict token, recovery revision1',
        async () => {
          const corrupt = new Uint8Array([255, 0, 123, 1]);
          await raw(corrupt);
          const inspected = await storage.inspectSuiteRecovery();
          assert(
            inspected.token.kind === 'raw' && inspected.token.sha256 === (await sha256(corrupt)),
          );
          await rejects(() => storage.loadSuiteLibrary());
          assert(encodeBase64(await storage.readRecoverableLibrary()) === encodeBase64(corrupt));
          await raw(new Uint8Array([255, 2]));
          await rejects(() => storage.resetRecoverableSuiteLibrary(inspected.token));
          await raw(corrupt);
          await rejects(() =>
            storage.resetRecoverableSuiteLibrary({
              kind: 'missing',
              extra: 1,
            } as storage.RecoveryToken),
          );
          assert((await storage.resetRecoverableSuiteLibrary(inspected.token)).revision === 1);
          assert(
            (await rows('backups')).some(
              (v) => v instanceof Uint8Array && encodeBase64(v) === encodeBase64(corrupt),
            ),
          );
        },
      );
      await check('old v1 rejected; malformed JSON and base64/SHA remain unrepaired', async () => {
        await raw(utf8('{"kind":"paradox-ui-customization","schema_version":1}'));
        await rejects(() => storage.loadSuiteLibrary());
        const invalid = sample();
        invalid.suites[0].manifest.files[0].sha256 = '0'.repeat(64);
        await raw(utf8(canonicalSuiteJson(invalid)));
        await rejects(() => storage.loadSuiteLibrary());
      });
      await check(
        'oversized raw export is complete beyond load ceiling and backed up exactly',
        async () => {
          const oversized = new Uint8Array(134_217_729);
          oversized[0] = 255;
          oversized[oversized.length - 1] = 17;
          await raw(oversized);
          await rejects(() => storage.loadSuiteLibrary());
          const exported = await storage.readRecoverableLibrary();
          assert(
            exported.length === oversized.length && exported[0] === 255 && exported.at(-1) === 17,
          );
          const inspected = await storage.inspectSuiteRecovery();
          assert((await storage.resetRecoverableSuiteLibrary(inspected.token)).revision === 1);
          const backup = (await rows('backups')).find(
            (v) => v instanceof Uint8Array && v.length === oversized.length,
          ) as Uint8Array;
          assert(backup && (await sha256(backup)) === (await sha256(oversized)));
        },
      );
      await clear();
      await storage.resetRecoverableSuiteLibrary({ kind: 'missing' });
      const final = await storage.saveSuiteLibrary(sample(), 1);
      sessionStorage.setItem('suite-storage-reload', canonicalSuiteJson(final));
      checks.push('missing token reset and reload fixture committed');
      return checks;
    },
    async reloadCheck() {
      const expected = sessionStorage.getItem('suite-storage-reload');
      assert(expected);
      const loaded = await storage.loadSuiteLibrary();
      assert(canonicalSuiteJson(loaded) === expected);
      assert((await rows('assets')).length > 0);
      return ['reload real IndexedDB retains exact source/assets/revision/active'];
    },
    async desktop() {
      assert(desktop, 'Captured desktop branch required');
      const first = await storage.loadSuiteLibrary();
      assert(first.revision === 0);
      const committed = await storage.saveSuiteLibrary(sample(), 0);
      assert(committed.revision === 1);
      await rejects(() => storage.saveSuiteLibrary(sample(), 0));
      assert((await storage.resetSuiteLibrary(1)).revision === 2);
      assert((await storage.readRecoverableLibrary()) instanceof Uint8Array);
      const inspected = await storage.inspectSuiteRecovery();
      await rejects(() => storage.resetRecoverableSuiteLibrary(inspected.token));
      // Gate fails before a suite IPC call, even in the actual captured desktop adapter.
      const malformed = sample();
      malformed.suites[0].manifest.files[0].sha256 = '0'.repeat(64);
      await rejects(() => storage.saveSuiteLibrary(malformed, 2));
      const boundary = (
        window as unknown as {
          foundationDesktop: {
            suiteLibrary: UiSuiteLibrary | null;
            suiteRaw: Uint8Array | null;
            calls: { command: string }[];
          };
        }
      ).foundationDesktop;
      boundary.suiteLibrary = null;
      boundary.suiteRaw = new Uint8Array([255, 0, 17]);
      const corrupt = await storage.inspectSuiteRecovery();
      assert(encodeBase64(await storage.readRecoverableLibrary()) === encodeBase64(corrupt.raw));
      assert((await storage.resetRecoverableSuiteLibrary(corrupt.token)).revision === 1);
      boundary.suiteLibrary = null;
      boundary.suiteRaw = null;
      assert((await storage.resetRecoverableSuiteLibrary({ kind: 'missing' })).revision === 1);
      for (const command of [
        'get_ui_suite_library',
        'save_ui_suite_library',
        'reset_ui_suite_library',
        'read_ui_suite_recoverable',
        'inspect_ui_suite_recovery',
        'reset_recoverable_ui_suite_library',
      ])
        assert(boundary.calls.some((c) => c.command === command));
      const f = assets[0];
      assert(decodeBase64(f.data).length > 0);
      return [
        'captured desktop dedicated suite IPC load/save/reset/raw/inspect/recoverable',
        'desktop complete candidate gate and returned revision',
      ];
    },
  };
}
