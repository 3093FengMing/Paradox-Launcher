import type { UiSuiteBundle, UiSuiteRecord } from '../ui-suite/model';
import type { SuiteRuntimeScope } from '../ui-suite/prepared';
import type {
  SuiteActivation,
  SuiteActivationLayer,
  UiEditorDependencies,
} from './controller-model';
import { detached } from './controller-model';
import { canonicalSuiteJson } from '../ui-suite/canonical';
import { createActivation } from './activation';
interface PreparationHost {
  readonly deps: UiEditorDependencies;
  scopes: Map<string, Promise<SuiteRuntimeScope>>;
  trusted: SuiteActivationLayer | null;
  trustedPromise: Promise<SuiteActivationLayer> | null;
  readonly activations: number;
  alive: (life: number) => boolean;
}
/** Compiler scopes and owned layers share the controller's lifecycle fences. */
export function createPreparation(host: PreparationHost) {
  const operations = {
    scope(key: string): Promise<SuiteRuntimeScope> {
      let value = host.scopes.get(key);
      if (!value) {
        const pending = Promise.resolve().then(() => host.deps.createScope());
        value = pending.catch((error) => {
          if (host.scopes.get(key) === value) host.scopes.delete(key);
          throw error;
        });
        host.scopes.set(key, value);
      }
      return value;
    },
    async prepareTrusted(life: number): Promise<SuiteActivationLayer> {
      if (host.trusted) return host.trusted;
      if (!host.trustedPromise) {
        const pending = (async () => {
          const bundle = await host.deps.getBuiltinBundle('modern'),
            scope = await operations.scope('trusted.modern');
          const isCurrent = () => host.alive(life);
          if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
          const prepared = await host.deps.compile(bundle, scope, { isCurrent });
          if (!isCurrent()) {
            prepared.dispose();
            throw new DOMException('Superseded', 'AbortError');
          }
          host.trusted = { layerId: 'trusted.modern', bundle: detached(bundle), prepared };
          return host.trusted;
        })();
        const cached = pending.catch((error) => {
          // Only the failed attempt may clear its cache; a reconnect can own a newer one.
          if (host.trustedPromise === cached) host.trustedPromise = null;
          throw error;
        });
        host.trustedPromise = cached;
      }
      return host.trustedPromise;
    },
    async prepare(
      bundle: UiSuiteBundle,
      id: string,
      generation: number,
      life: number,
    ): Promise<SuiteActivationLayer> {
      const isCurrent = () => host.alive(life) && generation === host.activations;
      if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
      const scope = await operations.scope(id);
      if (!isCurrent()) throw new DOMException('Superseded', 'AbortError');
      const prepared = await host.deps.compile(bundle, scope, { isCurrent });
      if (!isCurrent()) {
        prepared.dispose();
        throw new DOMException('Superseded', 'AbortError');
      }
      return { layerId: id, bundle: detached(bundle), prepared };
    },
    async prepareActivation(
      draft: UiSuiteBundle,
      id: string,
      parent: UiSuiteRecord['parent_snapshot'],
      generation: number,
      life: number,
      stagedParent: SuiteActivationLayer | null = null,
    ): Promise<SuiteActivation> {
      const layers: SuiteActivationLayer[] = stagedParent ? [stagedParent] : [];
      try {
        const trusted = await operations.prepareTrusted(life),
          trustedBundle = trusted.bundle;
        if (!host.alive(life) || generation !== host.activations)
          throw new DOMException('Superseded', 'AbortError');
        const parentLayer =
          stagedParent ??
          (parent
            ? await operations.prepare(
                parent.bundle,
                `${id}.parent.${parent.digest}`,
                generation,
                life,
              )
            : null);
        if (parentLayer && !stagedParent) layers.push(parentLayer);
        const primary =
          id === 'builtin.modern' && canonicalSuiteJson(draft) === canonicalSuiteJson(trustedBundle)
            ? trusted
            : await operations.prepare(draft, id, generation, life);
        if (primary !== trusted) layers.push(primary);
        return createActivation(primary, parentLayer, trusted, layers);
      } catch (error) {
        layers.forEach((layer) => layer.prepared.dispose());
        throw error;
      }
    },
  };
  return operations;
}
