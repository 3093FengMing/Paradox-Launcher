import { normalizeDraftBundle } from './bundle';
import type { UiFile, UiSuiteBundle, UiSuiteManifest } from './model';
import { encodeBase64, decodeBase64, utf8 } from './canonical';
import { compileSuite } from './compiler';
import type { PreparedUiSuite } from './prepared';

const sources = import.meta.glob('./builtins/**/*.{ts,tsx,css,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const raster = import.meta.glob('./builtins/common/assets/*.png', {
  query: '?inline',
  import: 'default',
  eager: true,
});
const vectors = import.meta.glob('./builtins/common/assets/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const bundles = new Map<string, Promise<UiSuiteBundle>>();

async function collect(id: 'modern' | 'immersive'): Promise<UiSuiteBundle> {
  const files = Object.create(null) as Record<string, UiFile>;
  for (const [source, value] of Object.entries(sources)) {
    const path = source.slice('./builtins/'.length);
    if ((path.startsWith('common/') || path.startsWith(id + '/')) && !path.endsWith('/suite.json'))
      files[path] = { encoding: 'utf8', text: value as string };
  }
  // Package bytes are bundled directly: desktop connect-src permits IPC only.
  // SVG raw text avoids Vite's SVG URL optimization; PNG inline is exact base64.
  for (const [source, value] of Object.entries({ ...raster, ...vectors })) {
    const encoded = value as string;
    if (source.endsWith('.png') && !encoded.startsWith('data:image/png;base64,'))
      throw Error(`Builtin artwork encoding unavailable: ${source}`);
    const bytes = source.endsWith('.png')
      ? decodeBase64(encoded.slice('data:image/png;base64,'.length))
      : utf8(encoded);
    files[source.slice('./builtins/'.length)] = {
      encoding: 'base64',
      media_type: source.endsWith('.png') ? 'image/png' : 'image/svg+xml',
      data: encodeBase64(bytes),
    };
  }
  const manifest = JSON.parse(sources[`./builtins/${id}/suite.json`] as string) as UiSuiteManifest;
  return normalizeDraftBundle({ manifest, files });
}
export async function getBuiltinBundle(id: 'modern' | 'immersive'): Promise<UiSuiteBundle> {
  let promise = bundles.get(id);
  if (!promise) {
    promise = collect(id);
    bundles.set(id, promise);
    void promise.catch(() => {
      if (bundles.get(id) === promise) bundles.delete(id);
    });
  }
  return structuredClone(await promise);
}
// Each caller owns this prepared result. Source/bundle caching never owns runtime leases.
export async function getPreparedBuiltin(id: 'modern' | 'immersive'): Promise<PreparedUiSuite> {
  return compileSuite(await getBuiltinBundle(id));
}
