import type { ReactNode } from 'react';

import type { getSuiteStyleRoot } from '../customization/ownership';
import type { UiOwnerRecord } from '../customization/ownership';

import type { UiViewProps } from '../ui-suite/prepared';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import type { UiSuiteBundle, UiSelector } from '../ui-suite/model';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
export const check = (value: unknown, message: string) => {
  if (!value) throw Error(message);
};
export const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const position = (owner: UiOwnerRecord): UiSelector => ({
  kind: 'position',
  target: owner.target,
  locator: owner.locator,
});
export const tick = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
export const source = (text: string) => ({ encoding: 'utf8' as const, text });
export async function bundle(
  files: UiSuiteBundle['files'],
  styles: string[] = [],
) {
  const value = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  value.files = { 'Home.tsx': source('export default ()=>null'), ...files };
  value.manifest.styles = styles;
  return normalizeDraftBundle(value);
}
export const envelope = {
  snapshot: {},
  actions: {},
  props: {},
  Original: () => null,
} as unknown as UiViewProps;
export const publication = {
  viewId: 'test.ownership',
  sourcePath: 'src/ui-tests/ownership-fixture.tsx',
  routeId: 'home',
  layerId: 'test',
};
export interface OwnershipCaseContext {
  checks: string[];
  evidence: Record<string, unknown>;
  host: HTMLDivElement;
  mount: HTMLDivElement;
  portalA: HTMLDivElement;
  shadowContainer: HTMLDivElement;
  foreignBody: HTMLElement;
  resources: (() => void)[];
  render(this: void, children: ReactNode, strict?: boolean): void;
  own(this: void): UiOwnerRecord[];
  at(this: void, site: string): UiOwnerRecord[];
  styleRoot(
    this: void,
    id: 'launcher.main' | 'launcher.editor',
  ): ReturnType<typeof getSuiteStyleRoot>;
  notifications(this: void): number;
}
