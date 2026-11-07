/// <reference types="vite/client" />
declare module 'virtual:ui-suite-graph-plans' {
  export const compilerSignature: string;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Ambient virtual-module types use relative import annotations.
  export const plans: readonly import('./ui-suite/graph-plan').BuiltinGraphPlan[];
}
