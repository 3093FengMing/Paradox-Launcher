import { readBuiltinBundle, readBuiltinName } from './builtin-files';
import type { UiSuiteBundle } from './model';
import type { PreparedUiSuite } from './prepared';

const sources = import.meta.glob<string>('./builtins/**/*.{ts,tsx,css,json}', {
  query: '?raw',
  import: 'default',
});
const raster = import.meta.glob<string>('./builtins/common/assets/*.png', {
  query: '?inline',
  import: 'default',
});
const vectors = import.meta.glob<string>('./builtins/common/assets/*.svg', {
  query: '?raw',
  import: 'default',
});
const bundles = new Map<string, Promise<UiSuiteBundle>>();
export function getBuiltinName(id: 'modern' | 'immersive'): Promise<string> {
  return readBuiltinName(id, sources);
}

export async function getBuiltinBundle(id: 'modern' | 'immersive'): Promise<UiSuiteBundle> {
  let promise = bundles.get(id);
  if (!promise) {
    promise = readBuiltinBundle(id, { sources, raster, vectors });
    bundles.set(id, promise);
    void promise.catch(() => {
      if (bundles.get(id) === promise) bundles.delete(id);
    });
  }
  return structuredClone(await promise);
}
// Each caller owns this prepared result. Source/bundle caching never owns runtime leases.
export async function getPreparedBuiltin(id: 'modern' | 'immersive'): Promise<PreparedUiSuite> {
  const { compileSuite } = await import('./compiler');
  return compileSuite(await getBuiltinBundle(id));
}
