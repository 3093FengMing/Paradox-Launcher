import type { LauncherActions } from '../launcher/public/types';

import type { UiEditorController } from '../ui-editor/controller';

import { canonicalSuiteJson } from '../ui-suite/canonical';

import type { UiSuiteBundle, UiSuiteLibrary } from '../ui-suite/model';

export const desktop = () =>
  (
    window as unknown as {
      foundationDesktop: {
        calls: { command: string }[];
        suiteLibrary: UiSuiteLibrary | null;
        suiteRaw: Uint8Array | null;
        config: { settings: { personalization: { startup_page: string } } };
      };
    }
  ).foundationDesktop;
export const turn = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 40));
export const wait = async (check: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await turn();
  }
  throw Error('Fixture state did not settle');
};

export const equal = (a: unknown, b: unknown, message: string) => {
  if (canonicalSuiteJson(a) !== canonicalSuiteJson(b)) throw Error(message);
};
export const assert = (v: unknown, message: string) => {
  if (!v) throw Error(message);
};

export interface BuiltinCaseContext {
  f: Window['suiteBuiltinsFixture'];
  c: UiEditorController;
  a: LauncherActions;
  id: 'modern' | 'immersive';
  theme: 'dark' | 'light';
  builtin: UiSuiteBundle;
  exports: Blob[];
  check(
    this: void,
    name: string,
    run: () => void | Promise<void>,
  ): Promise<void>;
}
