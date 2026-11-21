import type { SuiteActivation, SuiteActivationLayer } from './controller-model';
export function createActivation(
  primary: SuiteActivationLayer,
  parent: SuiteActivationLayer | null,
  trusted: SuiteActivationLayer,
  owned: readonly SuiteActivationLayer[],
): SuiteActivation {
  let retired = false;
  const listeners = new Set<() => void>();
  return {
    primary,
    parent,
    trusted,
    get retired() {
      return retired;
    },
    onRetire(listener) {
      if (retired) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (retired) return;
      retired = true;
      // Physical roots detach synchronously, before prepared resources release.
      // A later passive effect can observe retirement without taking a lease.
      try {
        for (const listener of [...listeners]) listener();
      } finally {
        listeners.clear();
        owned.forEach((layer) => layer.prepared.dispose());
      }
    },
  };
}
