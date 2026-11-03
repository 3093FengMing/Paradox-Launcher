/** Independent suite bytes. Async validation precedes the final IDB CAS transaction. */
import { invoke } from '@tauri-apps/api/core';
import { desktop } from '../api';
import type { UiSuiteLibrary } from './model';
import { suiteLimits } from './model';
import {
  validateSuiteLibrary,
  validateSuiteLibraryData,
  materializeSuite,
  suiteFileBytes,
} from './bundle';
import { canonicalSuiteJson, decodeBase64, decodeUtf8, sha256, utf8 } from './canonical';

export type RecoveryToken = { kind: 'missing' } | { kind: 'raw'; sha256: string };
export interface RecoveryInspection {
  raw: Uint8Array;
  token: RecoveryToken;
}
const databaseName = 'paradox.ui-suite-library.v1';
const currentKey = 'current';
const stores = ['library', 'assets', 'backups'];
function defaults(): UiSuiteLibrary {
  return {
    kind: 'paradox-ui-suite-library',
    schema_version: 1,
    revision: 0,
    active_suite_id: null,
    suites: [],
  };
}
function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid suite revision');
}
function token(value: RecoveryToken): RecoveryToken {
  const checked = JSON.parse(canonicalSuiteJson(value)) as RecoveryToken;
  if (
    !checked ||
    typeof checked !== 'object' ||
    (checked.kind === 'missing'
      ? Object.keys(checked).length !== 1
      : checked.kind !== 'raw' ||
        Object.keys(checked).length !== 2 ||
        typeof checked.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(checked.sha256))
  )
    throw new Error('Invalid suite recovery token');
  return checked;
}
function same(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a === undefined
    ? b === undefined
    : b !== undefined && a.length === b.length && a.every((n, i) => n === b[i]);
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store);
    };
    request.onerror = () => reject(request.error ?? new Error('Open suite database failed'));
    request.onblocked = () => reject(new Error('Suite database upgrade blocked'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function rawValue(value: unknown): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array)) throw new Error('Invalid stored suite raw bytes');
  return value.slice();
}
async function read(): Promise<Uint8Array | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('library', 'readonly');
      const request = tx.objectStore('library').get(currentKey);
      let raw: Uint8Array | undefined, failure: Error | undefined;
      request.onsuccess = () => {
        try {
          raw = rawValue(request.result);
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(raw);
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error('Read suite database failed'));
    });
  } finally {
    db.close();
  }
}
async function parse(raw: Uint8Array | undefined): Promise<UiSuiteLibrary> {
  if (raw === undefined) return defaults();
  if (raw.length > suiteLimits.library) throw new Error('Suite library exceeds limit');
  return validateSuiteLibraryData(JSON.parse(decodeUtf8(raw)) as UiSuiteLibrary);
}
function encoded(library: UiSuiteLibrary): Uint8Array {
  const raw = utf8(canonicalSuiteJson(library));
  if (raw.length > suiteLimits.library) throw new Error('Suite library exceeds limit');
  return raw;
}
function assetEntries(library: UiSuiteLibrary): [string, Uint8Array][] {
  const entries: [string, Uint8Array][] = [];
  for (const record of library.suites) {
    for (const [scope, bundle] of [
      ['materialized', materializeSuite(record)],
      ['parent', record.parent_snapshot?.bundle],
    ] as const) {
      if (!bundle) continue;
      for (const [path, file] of Object.entries(bundle.files))
        if (file.encoding === 'base64')
          entries.push([`${record.instance_id}/${scope}/${path}`, suiteFileBytes(file)]);
    }
  }
  return entries;
}
async function publish(
  snapshot: Uint8Array | undefined,
  library: UiSuiteLibrary,
  backup: boolean,
  expectedRevision: number | null,
): Promise<UiSuiteLibrary> {
  // All bytes and asset associations are detached/prepared before a readwrite transaction exists.
  const bytes = encoded(library),
    entries = assetEntries(library),
    backupKey = backup && snapshot !== undefined ? crypto.randomUUID() : null;
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      let failure: Error | undefined;
      const request = tx.objectStore('library').get(currentKey);
      request.onsuccess = () => {
        try {
          // This exact comparison binds the asynchronously checked revision/classification to final CAS.
          if (!same(snapshot, rawValue(request.result)))
            throw new Error('UI suite revision/recovery conflict');
          if (expectedRevision !== null) {
            const currentRevision =
              snapshot === undefined
                ? 0
                : (JSON.parse(decodeUtf8(snapshot)) as UiSuiteLibrary).revision;
            if (currentRevision !== expectedRevision) throw new Error('UI suite revision conflict');
          }
          if (backupKey !== null) tx.objectStore('backups').add(snapshot!.slice(), backupKey);
          tx.objectStore('library').put(bytes, currentKey);
          const assets = tx.objectStore('assets');
          assets.clear();
          for (const [key, bytes] of entries) assets.put(bytes, key);
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(library);
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error('Suite transaction aborted'));
    });
  } finally {
    db.close();
  }
}
export async function loadSuiteLibrary(): Promise<UiSuiteLibrary> {
  return desktop
    ? validateSuiteLibraryData(await invoke<UiSuiteLibrary>('get_ui_suite_library'))
    : parse(await read());
}
export async function saveSuiteLibrary(
  candidate: UiSuiteLibrary,
  expectedRevision: number,
): Promise<UiSuiteLibrary> {
  revision(expectedRevision);
  const checked = await validateSuiteLibrary(candidate);
  if (desktop)
    return validateSuiteLibraryData(
      await invoke<UiSuiteLibrary>('save_ui_suite_library', { library: checked, expectedRevision }),
    );
  const raw = await read(),
    current = await parse(raw);
  if (current.revision !== expectedRevision) throw new Error('UI suite revision conflict');
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('UI suite revision overflow');
  return publish(raw, { ...checked, revision: current.revision + 1 }, false, expectedRevision);
}
export async function resetSuiteLibrary(expectedRevision: number): Promise<UiSuiteLibrary> {
  revision(expectedRevision);
  if (desktop)
    return validateSuiteLibraryData(
      await invoke<UiSuiteLibrary>('reset_ui_suite_library', { expectedRevision }),
    );
  const raw = await read(),
    current = await parse(raw);
  if (current.revision !== expectedRevision) throw new Error('UI suite revision conflict');
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('UI suite revision overflow');
  return publish(raw, { ...defaults(), revision: current.revision + 1 }, true, expectedRevision);
}
export async function readRecoverableLibrary(): Promise<Uint8Array> {
  return desktop
    ? decodeBase64(await invoke<string>('read_ui_suite_recoverable'))
    : ((await read()) ?? new Uint8Array());
}
export async function inspectSuiteRecovery(): Promise<RecoveryInspection> {
  if (desktop) {
    const inspection = await invoke<{ raw: string; token: RecoveryToken }>(
      'inspect_ui_suite_recovery',
    );
    return { raw: decodeBase64(inspection.raw), token: token(inspection.token) };
  }
  const raw = await read();
  return {
    raw: raw ?? new Uint8Array(),
    token: raw === undefined ? { kind: 'missing' } : { kind: 'raw', sha256: await sha256(raw) },
  };
}
export async function resetRecoverableSuiteLibrary(
  expectedToken: RecoveryToken,
): Promise<UiSuiteLibrary> {
  const checked = token(expectedToken);
  if (desktop)
    return validateSuiteLibraryData(
      await invoke<UiSuiteLibrary>('reset_recoverable_ui_suite_library', {
        expectedToken: checked,
      }),
    );
  const raw = await read();
  if (raw !== undefined) {
    let valid = false;
    try {
      await parse(raw);
      valid = true;
    } catch {
      /* Only persistent DATA failure authorizes raw recovery. */
    }
    if (valid) throw new Error('Valid UI suite library requires revision reset');
    if (checked.kind !== 'raw' || checked.sha256 !== (await sha256(raw)))
      throw new Error('UI suite recovery token conflict');
  } else if (checked.kind !== 'missing') throw new Error('UI suite recovery token conflict');
  return publish(raw, { ...defaults(), revision: 1 }, true, null);
}
