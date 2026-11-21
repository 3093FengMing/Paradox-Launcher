import vectors from "../../scripts/fixtures/ui-suite/format-vectors.json";
import { normalizeDraftBundle } from "../ui-suite/bundle";

import type { PreparedUiSuite, UiViewProps } from "../ui-suite/prepared";
import type { UiSuiteBundle } from "../ui-suite/model";

import type { SuiteStyleRewriter } from "../customization/css";
import type { Root } from "react-dom/client";

export const source = (text: string) => ({ encoding: "utf8" as const, text });
export async function make(
  files: Record<string, UiSuiteBundle["files"][string]>,
  css = false,
) {
  const b = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  b.files = { "Home.tsx": source("export default () => null"), ...files };
  b.manifest.styles = css ? ["style.css"] : [];
  return normalizeDraftBundle(b);
}
export const viewProps = {
  snapshot: {},
  actions: {},
  props: {},
  Original: () => null,
} as unknown as UiViewProps;

export interface CssFixtureSample {
  element: HTMLDivElement;
  rewrite: SuiteStyleRewriter;
  inline(this: void, node: HTMLElement, values: Record<string, unknown>): void;
  remove(this: void): void;
}
export interface CssFixtureContext {
  assert(this: void, ok: unknown, message: string): void;
  sample(this: void, text: string, markup?: string, target?: boolean): CssFixtureSample;
  check(this: void, name: string, fn: () => void): void;
}
export interface CompilerFixtureContext {
  assert(this: void, ok: unknown, message: string): void;
  rejects(this: void, fn: () => Promise<unknown>, match?: RegExp): Promise<void>;
  check(this: void, name: string, fn: () => Promise<void>): Promise<void>;
  host: HTMLElement;
  root: Root;
  live: Set<string>;
  detaches: (() => void)[];
  keep<T extends PreparedUiSuite>(this: void, prepared: T): T;
  render(this: void, prepared: PreparedUiSuite): void;
}
