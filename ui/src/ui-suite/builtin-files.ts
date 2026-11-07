import { normalizeDraftBundle } from './bundle';
import { encodeBase64, utf8 } from './canonical';
import type { UiFile, UiSuiteBundle, UiSuiteManifest } from './model';

type SourceLoaders = Readonly<Record<string, () => Promise<string>>>;
export interface BuiltinFileLoaders {
  sources: SourceLoaders;
  raster: SourceLoaders;
  vectors: SourceLoaders;
}
/** Catalog captions do not require editable sources or assets; execution still validates the bundle. */
export async function readBuiltinName(id: 'modern' | 'immersive', sources: SourceLoaders): Promise<string> {
  const manifest = JSON.parse(await sources[`./builtins/${id}/suite.json`]()) as UiSuiteManifest;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw Error('Builtin name unavailable.');
  return manifest.name;
}

/** Read exact packaged bytes only for the requested source tree; imports obey script-src. */
export async function readBuiltinBundle(
  id: 'modern' | 'immersive',
  loaders: BuiltinFileLoaders,
): Promise<UiSuiteBundle> {
  const files = Object.create(null) as Record<string, UiFile>;
  await Promise.all(Object.entries(loaders.sources).map(async ([source, load]) => {
    const path = source.slice('./builtins/'.length);
    if ((path.startsWith('common/') || path.startsWith(id + '/')) && !path.endsWith('/suite.json'))
      files[path] = { encoding: 'utf8', text: await load() };
  }));
  // SVG raw text avoids URL optimization; inline PNG preserves exact base64 bytes.
  await Promise.all(Object.entries({ ...loaders.raster, ...loaders.vectors }).map(async ([source, load]) => {
    const encoded = await load();
    if (source.endsWith('.png') && !encoded.startsWith('data:image/png;base64,'))
      throw Error(`Builtin artwork encoding unavailable: ${source}`);
    files[source.slice('./builtins/'.length)] = {
      encoding: 'base64',
      media_type: source.endsWith('.png') ? 'image/png' : 'image/svg+xml',
      data: source.endsWith('.png')
        ? encoded.slice('data:image/png;base64,'.length)
        : encodeBase64(utf8(encoded)),
    };
  }));
  const manifest = JSON.parse(await loaders.sources[`./builtins/${id}/suite.json`]()) as UiSuiteManifest;
  return normalizeDraftBundle({ manifest, files });
}
