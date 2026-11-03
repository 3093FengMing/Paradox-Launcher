import type { Appearance, DeepReadonly } from '@paradox/launcher';
export const MAX_APPEARANCE_PRESETS = 32;
export function appearancesEqual(a: DeepReadonly<Appearance>, b: DeepReadonly<Appearance>) {
  return (Object.keys(a) as (keyof Appearance)[]).every((key) => a[key] === b[key]);
}
