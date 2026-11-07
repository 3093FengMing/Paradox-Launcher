/* eslint-disable no-control-regex -- Persisted strings explicitly reject Unicode control characters. */
import type {
  UiFile,
  UiFileDescriptor,
  UiSuiteBundle,
  UiSuiteLibrary,
  UiSuiteManifest,
  UiSuiteRecord,
} from './model';
import { suiteLimits as L } from './model';
import { builtinRouteIds, validateRouteRegistry } from './routes';
import { canonicalSuiteJson, compareCodePoints, decodeBase64, sha256, utf8 } from './canonical';
import { uniqueSuitePaths, validateSuitePath } from './paths';
import { inspectSuiteAsset, validateSuiteAsset } from './assets';
export { canonicalSuiteJson } from './canonical';

function fail(): never {
  throw new Error('Invalid UI suite format');
}
function object(v: unknown): Record<string, unknown> {
  const prototype: unknown = v && typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    (prototype !== Object.prototype && prototype !== null)
  )
    fail();
  return v as Record<string, unknown>;
}
function exact(v: unknown, fields: string[], optional: string[] = []): Record<string, unknown> {
  const o = object(v);
  if (
    fields.some((k) => !Object.hasOwn(o, k)) ||
    Object.keys(o).some((k) => !fields.includes(k) && !optional.includes(k))
  )
    fail();
  return o;
}
function text(v: unknown, min = 0, max = Infinity): string {
  if (typeof v !== 'string') fail();
  if (min === 0 && max === Infinity) return v;
  let length = 0;
  for (let i = 0; i < v.length; i++) {
    if (v.codePointAt(i)! > 0xffff) i++;
    if (++length > max) fail();
  }
  if (length < min) fail();
  return v;
}
function label(v: unknown, min = 1, max = Infinity): string {
  const s = text(v, min, max);
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(s)) fail();
  return s;
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail();
  return v;
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) fail();
  return v;
}
function uuid(v: unknown): string {
  const s = text(v);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) fail();
  return s;
}
function hash(v: unknown): string {
  const s = text(v);
  if (!/^[0-9a-f]{64}$/.test(s)) fail();
  return s;
}
function snapshot(value: unknown, maximum = Infinity): unknown {
  const json = canonicalSuiteJson(value);
  if (utf8(json).length > maximum) fail();
  return JSON.parse(json) as unknown;
}
function path(value: unknown): string {
  return validateSuitePath(text(value));
}
export function suiteFileBytes(file: UiFile): Uint8Array {
  return file.encoding === 'utf8' ? utf8(file.text) : decodeBase64(file.data);
}
// Only one detached parsing transaction owns this cache; public mutable values never reuse it.
type OwnedBytes = Map<UiFile, Uint8Array>;
function bytesOf(file: UiFile, ownedBytes?: OwnedBytes): Uint8Array {
  let bytes = ownedBytes?.get(file);
  if (!bytes) {
    bytes = suiteFileBytes(file);
    ownedBytes?.set(file, bytes);
  }
  return bytes;
}
function files(value: unknown, ownedBytes?: OwnedBytes): Record<string, UiFile> {
  const input = object(value),
    names = Object.keys(input);
  uniqueSuitePaths(names);
  if (names.length > L.files) fail();
  const result = Object.create(null) as Record<string, UiFile>;
  for (const p of names) {
    const o = object(input[p]);
    if (o.encoding === 'utf8') {
      exact(o, ['encoding', 'text']);
      const s = text(o.text);
      const bytes = utf8(s);
      if (bytes.length > L.source) fail();
      result[p] = { encoding: 'utf8', text: s };
      ownedBytes?.set(result[p], bytes);
    } else {
      exact(o, ['encoding', 'media_type', 'data']);
      if (o.encoding !== 'base64') fail();
      const media = text(o.media_type),
        data = text(o.data);
      if (data.length > Math.ceil(L.asset / 3) * 4) fail();
      const bytes = decodeBase64(data);
      inspectSuiteAsset(p, media, bytes);
      result[p] = { encoding: 'base64', media_type: media, data };
      ownedBytes?.set(result[p], bytes);
    }
  }
  return result;
}
function identity(value: unknown): void {
  const o = exact(value, ['namespace', 'value']);
  text(o.namespace, 1);
  text(o.value);
}
function selector(value: unknown): void {
  const o = object(value);
  text(o.target, 1);
  if (o.kind === 'type') {
    exact(o, ['kind', 'target']);
    return;
  }
  if (o.kind === 'business') {
    exact(o, ['kind', 'target', 'identity']);
    identity(o.identity);
    return;
  }
  exact(o, ['kind', 'target', 'locator']);
  if (o.kind !== 'position') fail();
  const l = exact(o.locator, ['version', 'renderRoot', 'calls', 'business']);
  if (l.version !== 1 || !['launcher.main', 'launcher.editor'].includes(text(l.renderRoot))) fail();
  for (const call of array(l.calls)) {
    const c = exact(call, ['site', 'key']);
    text(c.site, 1);
    if (c.key !== null) text(c.key);
  }
  for (const id of array(l.business)) identity(id);
}
const requiredViews = [
  'layout.shell',
  'tool.editor',
  'host.loading',
  'host.error',
  'host.notifications',
  ...[
    'profile',
    'instance-settings',
    'import-instances',
    'remove-profile',
    'close-request',
    'launch-account',
    'login',
    'preset',
    'argument-template',
  ].map((p) => `dialog.${p}`),
];
export function parseSuiteManifest(value: unknown): UiSuiteManifest {
  const o = exact(snapshot(value, L.manifest), [
    'kind',
    'schema_version',
    'api_version',
    'id',
    'version',
    'name',
    'views',
    'routes',
    'styles',
    'files',
    'overrides',
  ]);
  if (o.kind !== 'paradox-ui-suite' || o.schema_version !== 1 || o.api_version !== 1) fail();
  uuid(o.id);
  label(o.version, 1, 64);
  label(o.name, 1, 48);
  const descriptions = array(o.files);
  if (descriptions.length > L.files) fail();
  const descriptors = new Map<string, UiFileDescriptor>();
  for (const d of descriptions) {
    const f = exact(d, ['path', 'kind', 'bytes', 'sha256'], ['media_type']);
    const p = path(f.path),
      kind = text(f.kind);
    if (!['ts', 'tsx', 'html', 'css', 'asset'].includes(kind)) fail();
    integer(f.bytes, 0, kind === 'asset' ? L.asset : L.source);
    hash(f.sha256);
    if (kind === 'asset') text(f.media_type, 1);
    else if (Object.hasOwn(f, 'media_type') || !p.endsWith('.' + kind)) fail();
    descriptors.set(p, f as unknown as UiFileDescriptor);
  }
  uniqueSuitePaths(descriptions.map((d) => path(object(d).path)));
  const reference = (v: unknown, kinds: string[]) => {
    const p = path(v),
      d = descriptors.get(p);
    if (!d || !kinds.includes(d.kind)) fail();
    return p;
  };
  const views = object(o.views);
  for (const [id, p] of Object.entries(views)) {
    if (!/^[a-z][a-z0-9.-]{0,95}$/.test(id) || id === 'tool.recovery' || id === 'host.recovery')
      fail();
    reference(p, ['tsx', 'html']);
  }
  const routes = array(o.routes);
  validateRouteRegistry(routes as UiSuiteManifest['routes']);
  for (const r of routes) {
    const route = object(r);
    integer(route.order, 0, 1_000_000);
    const p = reference(route.entry, ['tsx', 'html']),
      key = 'page.' + text(route.id);
    if (Object.hasOwn(views, key) && views[key] !== p) fail();
  }
  if (
    requiredViews.some((v) => !Object.hasOwn(views, v)) ||
    builtinRouteIds.some((id) => !routes.some((r) => object(r).id === id))
  )
    fail();
  for (const s of array(o.styles)) reference(s, ['css']);
  for (const value of array(o.overrides)) {
    const ov = exact(value, ['selector', 'enabled', 'stylesheet', 'entry']);
    selector(ov.selector);
    if (typeof ov.enabled !== 'boolean') fail();
    if (ov.stylesheet !== null) reference(ov.stylesheet, ['css']);
    if (ov.entry !== null) reference(ov.entry, ['tsx', 'html']);
  }
  return {
    ...o,
    views: Object.assign(Object.create(null) as Record<string, unknown>, views),
  } as unknown as UiSuiteManifest;
}
function parsedBundle(value: unknown, ownedBytes?: OwnedBytes): UiSuiteBundle {
  const o = exact(value, ['manifest', 'files']),
    manifest = parseSuiteManifest(o.manifest),
    table = files(o.files, ownedBytes);
  if (Object.keys(table).length !== manifest.files.length) fail();
  let total = utf8(canonicalSuiteJson(manifest)).length;
  for (const d of manifest.files) {
    if (!Object.hasOwn(table, d.path)) fail();
    const f = table[d.path],
      bytes = bytesOf(f, ownedBytes);
    if (
      bytes.length !== d.bytes ||
      (d.kind === 'asset'
        ? f.encoding !== 'base64' || f.media_type !== d.media_type
        : f.encoding !== 'utf8')
    )
      fail();
    total += bytes.length;
    if (total > L.total) fail();
  }
  return { manifest, files: table };
}
export function parseSuiteBundle(value: unknown): UiSuiteBundle {
  return parsedBundle(snapshot(value));
}
function parsedRecord(value: unknown): UiSuiteRecord {
  const o = exact(value, ['instance_id', 'manifest', 'parent_snapshot', 'overlay', 'deleted']);
  uuid(o.instance_id);
  const manifest = parseSuiteManifest(o.manifest),
    overlay = files(o.overlay),
    deleted = array(o.deleted).map(path);
  uniqueSuitePaths(deleted);
  let parent_snapshot: UiSuiteRecord['parent_snapshot'] = null;
  if (o.parent_snapshot !== null) {
    const p = exact(o.parent_snapshot, ['digest', 'bundle']);
    parent_snapshot = { digest: hash(p.digest), bundle: parsedBundle(p.bundle) };
  }
  for (const p of deleted)
    if (
      !parent_snapshot ||
      !Object.hasOwn(parent_snapshot.bundle.files, p) ||
      Object.hasOwn(overlay, p)
    )
      fail();
  const r = { instance_id: o.instance_id as string, manifest, parent_snapshot, overlay, deleted };
  materialized(r);
  return r;
}
function materialized(record: UiSuiteRecord): UiSuiteBundle {
  const table: Record<string, UiFile> = Object.assign(
    Object.create(null) as Record<string, UiFile>,
    record.parent_snapshot?.bundle.files,
  );
  for (const p of record.deleted) delete table[p];
  Object.assign(table, record.overlay);
  return parsedBundle({ manifest: record.manifest, files: table });
}
export function materializeSuite(record: UiSuiteRecord): UiSuiteBundle {
  return materialized(parsedRecord(snapshot(record)));
}
export function parseSuiteLibrary(value: unknown): UiSuiteLibrary {
  const o = exact(snapshot(value, L.library), [
    'kind',
    'schema_version',
    'revision',
    'active_suite_id',
    'suites',
  ]);
  if (o.kind !== 'paradox-ui-suite-library' || o.schema_version !== 1) fail();
  integer(o.revision, 0, Number.MAX_SAFE_INTEGER);
  const list = array(o.suites);
  if (list.length > L.records) fail();
  const suites = list.map(parsedRecord),
    ids = new Set(suites.map((r) => r.instance_id));
  if (ids.size !== suites.length) fail();
  if (
    o.active_suite_id !== null &&
    !['builtin.modern', 'builtin.immersive'].includes(text(o.active_suite_id)) &&
    !ids.has(text(o.active_suite_id))
  )
    fail();
  return {
    kind: 'paradox-ui-suite-library',
    schema_version: 1,
    revision: o.revision as number,
    active_suite_id: o.active_suite_id as string | null,
    suites,
  };
}
async function verifyHashes(bundle: UiSuiteBundle, ownedBytes?: OwnedBytes): Promise<void> {
  for (const d of bundle.manifest.files)
    if ((await sha256(bytesOf(bundle.files[d.path], ownedBytes))) !== d.sha256)
      throw new Error('Suite SHA mismatch');
}
async function digestOwned(bundle: UiSuiteBundle, ownedBytes?: OwnedBytes, verified = false): Promise<string> {
  if (!verified) await verifyHashes(bundle, ownedBytes);
  const parts: Uint8Array[] = [
    Uint8Array.from([80, 65, 82, 65, 68, 79, 88, 45, 85, 73, 45, 66, 85, 78, 68, 76, 69, 0, 1]),
  ];
  const u32 = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n);
    return b;
  };
  const append = (b: Uint8Array) => {
    parts.push(u32(b.length), b);
  };
  append(utf8(canonicalSuiteJson(bundle.manifest)));
  const names = Object.keys(bundle.files).sort(compareCodePoints);
  parts.push(u32(names.length));
  for (const p of names) {
    append(utf8(p));
    append(bytesOf(bundle.files[p], ownedBytes));
  }
  const bytes = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of parts) {
    bytes.set(b, offset);
    offset += b.length;
  }
  return sha256(bytes);
}
export async function bundleDigest(bundle: UiSuiteBundle): Promise<string> {
  return digestOwned(parseSuiteBundle(bundle));
}
async function validateOwned(bundle: UiSuiteBundle, ownedBytes?: OwnedBytes): Promise<void> {
  await verifyHashes(bundle, ownedBytes);
  for (const d of bundle.manifest.files)
    if (d.kind === 'asset')
      await validateSuiteAsset(d.path, d.media_type!, bytesOf(bundle.files[d.path], ownedBytes));
}
export async function validateSuiteBundle(bundle: UiSuiteBundle): Promise<UiSuiteBundle> {
  const owned = parseSuiteBundle(bundle);
  await validateOwned(owned);
  return owned;
}
/** Package-private compiler transaction: full validation and exact digest of one owned snapshot. */
export async function validateSuiteBundleAndDigest(bundle: UiSuiteBundle): Promise<{
  bundle: UiSuiteBundle;
  digest: string;
}> {
  const ownedBytes: OwnedBytes = new Map();
  const owned = parsedBundle(snapshot(bundle), ownedBytes);
  await validateOwned(owned, ownedBytes);
  const digest = await digestOwned(owned, ownedBytes, true);
  return { bundle: owned, digest };
}
export async function validateSuiteLibraryData(library: UiSuiteLibrary): Promise<UiSuiteLibrary> {
  const owned = parseSuiteLibrary(library);
  for (const r of owned.suites) {
    if (
      r.parent_snapshot &&
      (await digestOwned(r.parent_snapshot.bundle)) !== r.parent_snapshot.digest
    )
      throw new Error('Suite snapshot digest mismatch');
    await verifyHashes(materialized(r));
  }
  return owned;
}
export async function validateSuiteLibrary(library: UiSuiteLibrary): Promise<UiSuiteLibrary> {
  const owned = await validateSuiteLibraryData(library);
  for (const r of owned.suites) {
    if (r.parent_snapshot) await validateOwned(r.parent_snapshot.bundle);
    await validateOwned(materialized(r));
  }
  return owned;
}
export async function normalizeDraftBundle(draft: UiSuiteBundle): Promise<UiSuiteBundle> {
  const o = exact(snapshot(draft), ['manifest', 'files']),
    table = files(o.files),
    manifest = object(o.manifest);
  const rebuilt: UiFileDescriptor[] = [];
  for (const p of Object.keys(table).sort(compareCodePoints)) {
    const f = table[p],
      bytes = suiteFileBytes(f),
      kind = f.encoding === 'base64' ? 'asset' : p.split('.').pop();
    if (!kind || !['asset', 'ts', 'tsx', 'html', 'css'].includes(kind)) fail();
    rebuilt.push({
      path: p,
      kind: kind as UiFileDescriptor['kind'],
      bytes: bytes.length,
      sha256: await sha256(bytes),
      ...(f.encoding === 'base64' ? { media_type: f.media_type } : {}),
    });
  }
  return validateSuiteBundle({
    manifest: { ...manifest, files: rebuilt } as unknown as UiSuiteManifest,
    files: table,
  });
}
