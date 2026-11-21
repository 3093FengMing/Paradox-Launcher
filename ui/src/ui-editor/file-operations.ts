import { normalizeDraftBundle } from '../ui-suite/bundle';
import { decodeSuiteArchive, encodeSuiteArchive } from '../ui-suite/archive';
import { encodeBase64, utf8 } from '../ui-suite/canonical';
import { uniqueSuitePaths, validateSuitePath } from '../ui-suite/paths';
import { suiteLimits } from '../ui-suite/model';
import type { UiFileDescriptor, UiSuiteBundle } from '../ui-suite/model';
import type { UiEditorDependencies } from './controller-model';

export async function readSourceFile(file: File): Promise<string> {
  if (file.size > suiteLimits.source) throw new Error('Source exceeds limit');
  return file.text();
}

export async function readAssetFile(file: File) {
  validateSuitePath(file.name);
  if (file.size > suiteLimits.asset) throw new Error('Asset exceeds limit');
  return {
    encoding: 'base64' as const,
    media_type: file.type,
    data: encodeBase64(new Uint8Array(await file.arrayBuffer())),
  };
}

export async function readBundleFile(file: File): Promise<UiSuiteBundle> {
  if (file.size > suiteLimits.total) throw new Error('Bundle input exceeds limit');
  return decodeSuiteArchive(new Uint8Array(await file.arrayBuffer()));
}

export async function exportNormalizedSource(
  deps: UiEditorDependencies,
  bundle: UiSuiteBundle,
  path: string,
  current: () => boolean,
): Promise<void> {
  const normalized = await normalizeDraftBundle(bundle),
    file = normalized.files[path];
  if (current() && file.encoding === 'utf8')
    await deps.exportFile(path.split('/').at(-1)!, utf8(file.text));
}

export async function exportNormalizedBundle(
  deps: UiEditorDependencies,
  bundle: UiSuiteBundle,
  current: () => boolean,
): Promise<void> {
  const normalized = await normalizeDraftBundle(bundle);
  const bytes = await encodeSuiteArchive(normalized);
  if (current()) await deps.exportFile(`${normalized.manifest.name}.paradox-ui`, bytes);
}

export function inheritedFileDescriptors(draft: UiSuiteBundle): UiFileDescriptor[] {
  const known = new Map(draft.manifest.files.map((file) => [file.path, file]));
  return Object.entries(draft.files).map(([path, file]) => ({
    path,
    kind:
      file.encoding === 'base64'
        ? 'asset'
        : (known.get(path)?.kind ?? (path.split('.').at(-1) as UiFileDescriptor['kind'])),
    bytes: known.get(path)?.bytes ?? 0,
    sha256: known.get(path)?.sha256 ?? '0'.repeat(64),
    ...(file.encoding === 'base64' ? { media_type: file.media_type } : {}),
  }));
}

export function addFileAsset(
  draft: UiSuiteBundle,
  path: string,
  asset: Awaited<ReturnType<typeof readAssetFile>>,
) {
  if (Object.hasOwn(draft.files, path)) throw new Error('File already exists');
  uniqueSuitePaths([...Object.keys(draft.files), path]);
  draft.files[path] = asset;
}
