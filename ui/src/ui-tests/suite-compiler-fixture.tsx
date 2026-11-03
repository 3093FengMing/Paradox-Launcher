/* eslint-disable @typescript-eslint/unbound-method -- Test instrumentation restores native methods by identity. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as React from 'react';
import * as launcher from '../launcher/public/index';
import * as foundation from '../ui-foundation/index';
import i18n from '../i18n';
import assetFixtures from '../../scripts/fixtures/ui-suite/browser-assets.json';
import vectors from '../../scripts/fixtures/ui-suite/format-vectors.json';
import { normalizeDraftBundle } from '../ui-suite/bundle';
import { compileSuite, compileSuiteInScope, loadPublicModules } from '../ui-suite/compiler';
import {
  createSuiteRuntimeScope,
  attachSuiteStyles,
  SuiteInlineStyleContext,
  suiteInlineStyleResolver,
} from '../ui-suite/prepared';
import type { PreparedUiSuite, UiViewProps } from '../ui-suite/prepared';
import type { UiSuiteBundle } from '../ui-suite/model';
import { parseSuiteHtml, renderSuiteHtml } from '../customization/html';
import { encodeBase64, sha256, utf8 } from '../ui-suite/canonical';
import {
  prepareSuiteCss,
  prepareSuiteInlineStyle,
  createSuiteStyleRewriter,
} from '../customization/css';

const source = (text: string) => ({ encoding: 'utf8' as const, text });
async function make(files: Record<string, UiSuiteBundle['files'][string]>, css = false) {
  const b = structuredClone(vectors.fix1.non_bmp.bundle) as UiSuiteBundle;
  b.files = { 'Home.tsx': source('export default () => null'), ...files };
  b.manifest.styles = css ? ['style.css'] : [];
  return normalizeDraftBundle(b);
}
const viewProps = {
  snapshot: {},
  actions: {},
  props: {},
  Original: () => null,
} as unknown as UiViewProps;
declare global {
  interface Window {
    suiteCompilerFixture: {
      capture?: boolean;
      captureReady?: boolean;
      resumeCapture?: () => void;
      run(language: string): Promise<{ checks: string[]; failures: string[]; liveUrls: number }>;
      runCssFix1(
        language: string,
      ): Promise<{ checks: string[]; failures: string[]; liveUrls: number }>;
    };
  }
}
export function installSuiteCompilerFixture() {
  window.suiteCompilerFixture = {
    async runCssFix1(language) {
      await i18n.changeLanguage(language);
      const checks: string[] = [],
        failures: string[] = [];
      const host = document.createElement('section');
      host.id = 'suite-compiler-acceptance';
      host.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:white;color:black;padding:8px;overflow:auto';
      document.body.append(host);
      const assert = (ok: unknown, message: string) => {
        if (!ok) throw new Error(message);
      };
      const sample = (
        text: string,
        markup = '<div class="probe">CSS fixture</div>',
        target = false,
      ) => {
        const css = prepareSuiteCss(text, {
          sourcePath: 'fix1-browser.css',
          resolveAsset: (r) => r,
        });
        const rewrite = createSuiteStyleRewriter([css], 'fix1browser');
        const element = document.createElement('div');
        element.className = 'fix1-boundary';
        element.innerHTML = markup;
        host.append(element);
        const style = document.createElement('style');
        style.textContent = rewrite.render([css], false, target ? '.fix1-boundary' : undefined);
        document.head.append(style);
        const inline = (node: HTMLElement, values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(rewrite.inline(values)))
            node.style.setProperty(
              key.startsWith('--') || key.includes('-')
                ? key
                : key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
              String(value),
            );
        };
        return {
          element,
          rewrite,
          inline,
          remove() {
            element.remove();
            style.remove();
          },
        };
      };
      const check = (name: string, fn: () => void) => {
        try {
          fn();
          checks.push(name);
        } catch (error) {
          failures.push(name + ': ' + String(error));
        }
      };
      try {
        check('fix1_animation_grammar_global_target_inline', () => {
          for (const target of [false, true]) {
            const row = sample(
              '@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}.probe{animation:fade 1s linear}',
              undefined,
              target,
            );
            try {
              const node = row.element.querySelector<HTMLElement>('.probe')!;
              assert(
                getComputedStyle(node).animationName === 'suite-fix1browser-animation-1' &&
                  getComputedStyle(node).animationTimingFunction === 'linear',
                'shorthand timing preserved',
              );
              row.inline(node, { animation: 'linear 1s linear' });
              assert(
                getComputedStyle(node).animationName === 'suite-fix1browser-animation-0' &&
                  getComputedStyle(node).animationTimingFunction === 'linear',
                'keyword name disambiguated',
              );
            } finally {
              row.remove();
            }
          }
        });
        check('fix1_custom_literals_descriptor_vars_fallbacks_and_cascade', () => {
          const row = sample(
            '@keyframes pulse{to{opacity:1}}@keyframes fade{to{opacity:1}}@font-face{font-family:TestFamily;src:local("Arial")}.probe{--label:"pulse";--font:TestFamily;--whole:fade 1s linear;--opaque:?? pulse {x:TestFamily} url(#sprite);animation-name:var(--label);animation-duration:1s;font-family:var(--font,TestFamily)}.probe::before{content:var(--label,"pulse")}.alternate{--label:"fade"}',
            '<div class="probe">default</div><div class="probe alternate">cascade</div>',
            true,
          );
          try {
            const [first, second] = row.element.querySelectorAll<HTMLElement>('.probe');
            assert(
              getComputedStyle(first, '::before').content === '"pulse"' &&
                getComputedStyle(second, '::before').content === '"fade"',
              'same variable content preserved through cascade',
            );
            assert(
              getComputedStyle(first).animationName === 'suite-fix1browser-animation-0' &&
                getComputedStyle(second).animationName === 'suite-fix1browser-animation-1',
              'descriptor mirrors follow cascade',
            );
            assert(
              getComputedStyle(first).fontFamily === 'suite-fix1browser-font-0',
              'font variable resolved',
            );
            assert(
              getComputedStyle(first).getPropertyValue('--opaque').includes('pulse {x:TestFamily}'),
              'opaque original preserved',
            );
            row.inline(first, {
              animationName: 'var(--missing,var(--label,pulse))',
              fontFamily: 'var(--missing,TestFamily)',
            });
            assert(
              getComputedStyle(first).animationName === 'suite-fix1browser-animation-0' &&
                getComputedStyle(first).fontFamily === 'suite-fix1browser-font-0',
              'stylesheet variables consumed by inline with nested fallback',
            );
            row.inline(first, { animation: 'var(--whole,fade 1s linear)' });
            assert(
              getComputedStyle(first).animationName === 'suite-fix1browser-animation-1' &&
                getComputedStyle(first).animationTimingFunction === 'linear',
              'whole shorthand variable',
            );
          } finally {
            row.remove();
          }
        });
        check('fix1_uppercase_keywords_and_case_sensitive_identities', () => {
          const multi = sample(
            '@font-face{font-family:My Font;src:local("Arial")}.probe{--family:My Font;font-family:var(--family),My Font}',
          );
          try {
            const node = multi.element.querySelector<HTMLElement>('.probe')!;
            assert(
              getComputedStyle(node).fontFamily ===
                'suite-fix1browser-font-0, suite-fix1browser-font-0',
              'multiword fallback family consumed as one sequence',
            );
            multi.inline(node, { fontFamily: 'var(--family),My Font' });
            assert(
              getComputedStyle(node).fontFamily ===
                'suite-fix1browser-font-0, suite-fix1browser-font-0',
              'inline multiword family token removal',
            );
          } finally {
            multi.remove();
          }
          const row = sample(
            '@KEYFRAMES Pulse{TO{opacity:1}}@FONT-FACE{FONT-FAMILY:TestFamily;SRC:local("Arial")}@LAYER Layer{.probe{ANIMATION-NAME:Pulse;ANIMATION-DURATION:1s;FONT-FAMILY:testfamily}}',
            undefined,
            true,
          );
          try {
            const node = row.element.querySelector<HTMLElement>('.probe')!;
            assert(
              getComputedStyle(node).animationName === 'suite-fix1browser-animation-0' &&
                getComputedStyle(node).fontFamily === 'suite-fix1browser-font-0',
              'uppercase descriptor keywords',
            );
            row.inline(node, { animationName: 'pulse' });
            assert(
              getComputedStyle(node).animationName === 'pulse',
              'frame identities stay case-sensitive',
            );
            row.inline(node, { 'ANIMATION-NAME': 'Pulse', 'FONT-FAMILY': 'TESTFAMILY' });
            assert(
              getComputedStyle(node).animationName === 'suite-fix1browser-animation-0' &&
                getComputedStyle(node).fontFamily === 'suite-fix1browser-font-0',
              'uppercase inline property classification',
            );
          } finally {
            row.remove();
          }
        });
        check('fix1_registered_mirror_defaults_and_noninheritance', () => {
          const row = sample(
            '@PROPERTY --Motion{SYNTAX:"<custom-ident>";INHERITS:false;INITIAL-VALUE:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.probe{animation-name:var(--Motion);animation-duration:1s}',
            '<div class="parent"><div class="probe">registered default</div></div>',
            true,
          );
          try {
            const node = row.element.querySelector<HTMLElement>('.probe')!;
            assert(
              getComputedStyle(node).animationName === 'suite-fix1browser-animation-0',
              'inherits false keeps registered default rather than parent value',
            );
            row.inline(node, { animationName: 'var(--Motion)' });
            assert(
              getComputedStyle(node).animationName === 'suite-fix1browser-animation-0',
              'inline retains registered default',
            );
            row.inline(node, { '--Motion': 'pulse', animationName: 'var(--Motion)' });
            assert(
              getComputedStyle(node).animationName === 'suite-fix1browser-animation-1',
              'local registered value and its mirrors',
            );
          } finally {
            row.remove();
          }
        });
        check('fix1_R4f_actual_ambiguous_consumers_only', () => {
          const definitions = '@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}';
          const row = sample(definitions + '.probe{--x:linear;animation:fade 1s var(--x)}');
          try {
            const node = row.element.querySelector<HTMLElement>('.probe')!;
            assert(
              getComputedStyle(node).animationTimingFunction === 'linear' &&
                getComputedStyle(node).animationName === 'suite-fix1browser-animation-1',
              'fixed name leaves var in timing role',
            );
          } finally {
            row.remove();
          }
          for (const expression of ['ease 1s var(--x)', 'var(--x) 1s linear']) {
            let failed = false;
            try {
              sample(definitions + `.probe{--x:linear;animation:${expression}}`);
            } catch (error) {
              failed = /fix1-browser.css:\d+:\d+:.*animation-name\/font-family/.test(String(error));
            }
            assert(failed, 'ambiguous consumer diagnostic');
          }
          const unused = sample(
            definitions +
              '.probe{--x:linear;--potential:var(--x) 1s linear;content:var(--potential)}',
          );
          unused.remove();
          const plain = sample('.probe{animation:ease 1s var(--x)}');
          plain.remove();
        });
        check('fix2_N1_registered_literal_validation_defaults_and_inheritance', () => {
          for (const target of [false, true]) {
            const row = sample(
              '@property --Motion{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.local{--Motion:pulse}.invalid{--Motion:unknown}.probe{animation-name:var(--Motion);animation-duration:1s}',
              '<div class="probe default"></div><div class="parent"><div class="probe nested"></div></div><div class="probe local"></div><div class="probe invalid"></div>',
              target,
            );
            try {
              const nodes = Array.from(row.element.querySelectorAll<HTMLElement>('.probe'));
              const verify = () => {
                for (const [index, node] of nodes.entries()) {
                  const name = index === 2 ? 'pulse' : 'still';
                  assert(
                    getComputedStyle(node).animationName ===
                      `suite-fix1browser-animation-${index === 2 ? 1 : 0}`,
                    `registered literal ${node.className}`,
                  );
                  assert(
                    getComputedStyle(node)
                      .getPropertyValue('--suite-fix1browser-property-0')
                      .trim() === name,
                    `original validation ${node.className}`,
                  );
                }
              };
              verify();
              for (const node of nodes) row.inline(node, { animationName: 'var(--Motion)' });
              verify();
              row.inline(nodes[2], { '--Motion': 'pulse', animationName: 'var(--Motion)' });
              row.inline(nodes[3], { '--Motion': 'invalid', animationName: 'var(--Motion)' });
              verify();
            } finally {
              row.remove();
            }
          }
        });
        check('fix2_N2_leading_middle_and_trailing_animation_variable', () => {
          const definitions = '@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}';
          for (const target of [false, true])
            for (const value of [
              'var(--timing) 1s fade',
              '1s var(--timing) fade',
              'fade 1s var(--timing)',
            ]) {
              const row = sample(
                definitions + `.probe{--timing:linear;animation:${value}}`,
                undefined,
                target,
              );
              try {
                const node = row.element.querySelector<HTMLElement>('.probe')!;
                const verify = () =>
                  assert(
                    getComputedStyle(node).animationName === 'suite-fix1browser-animation-1' &&
                      getComputedStyle(node).animationTimingFunction === 'linear',
                    `fixed name in ${value}`,
                  );
                verify();
                row.inline(node, { '--timing': 'linear', animation: value });
                verify();
              } finally {
                row.remove();
              }
            }
        });
        check('fix2_N3_escaped_custom_declaration_reference_and_inline', () => {
          for (const target of [false, true]) {
            const row = sample(
              String.raw`.probe{--label\ x:"pulse";--Label\ x:"upper"}.probe::before{content:var(--label\ x)}.probe::after{content:var(--Label\ x)}`,
              undefined,
              target,
            );
            try {
              const node = row.element.querySelector<HTMLElement>('.probe')!;
              assert(
                getComputedStyle(node, '::before').content === '"pulse"',
                'escaped stylesheet reference',
              );
              assert(
                getComputedStyle(node, '::after').content === '"upper"',
                'escaped names remain case-sensitive',
              );
              row.inline(node, { content: String.raw`var(--label\ x)` });
              assert(
                getComputedStyle(node).content === '"pulse"',
                'stylesheet variable consumed by inline',
              );
              row.inline(node, {
                '--label x': '"local"',
                content: String.raw`var(--label\ x)`,
              });
              assert(
                getComputedStyle(node).content === '"local"',
                'escaped inline declaration and reference',
              );
              assert(
                getComputedStyle(node, '::after').content === '"upper"',
                'inline does not alias case-distinct name',
              );
              row.inline(
                node,
                prepareSuiteInlineStyle(String.raw`--slash\\x:"slash";content:var(--slash\\x)`, {
                  sourcePath: 'inline.html',
                  resolveAsset: (ref) => ref,
                }),
              );
              assert(
                getComputedStyle(node).content === '"slash"',
                'HTML style record keeps a literal backslash identity through inline rewriting',
              );
            } finally {
              row.remove();
            }
            const owned = sample(
              String.raw`@property --Frame\ x{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.probe{--Frame\ x:pulse;animation-name:var(--Frame\ x)}`,
              undefined,
              target,
            );
            try {
              const node = owned.element.querySelector<HTMLElement>('.probe')!;
              assert(
                getComputedStyle(node).animationName === 'suite-fix1browser-animation-1',
                'escaped registered identity and mirror',
              );
              owned.inline(node, {
                '--Frame x': 'still',
                animationName: String.raw`var(--Frame\ x)`,
              });
              assert(
                getComputedStyle(node).animationName === 'suite-fix1browser-animation-0',
                'escaped registered inline identity',
              );
            } finally {
              owned.remove();
            }
          }
        });
        check('fix2_R4g_registered_repetition_semantic_boundary', () => {
          for (const name of ['pulse', 'linear']) {
            const definitions = `@property --Motion{syntax:"${name}+";inherits:false;initial-value:${name}}@keyframes ${name}{to{opacity:1}}`;
            for (const target of [false, true]) {
              let failed = false;
              try {
                sample(
                  definitions + `.probe{--Motion:${name} ${name};animation:var(--Motion)}`,
                  undefined,
                  target,
                );
              } catch (error) {
                failed =
                  /fix1-browser.css:\d+:\d+:.*Cannot preserve @property.*unregistered variable/.test(
                    String(error),
                  );
              }
              assert(failed, 'registration validation mismatch gets a consumer diagnostic');
              const unused = sample(
                definitions + `.probe{--Motion:${name} ${name};content:var(--Motion)}`,
                undefined,
                target,
              );
              try {
                failed = false;
                try {
                  unused.rewrite.inline({ animation: 'var(--Motion)' });
                } catch (error) {
                  failed = /<inline-style>:1:1:.*Cannot preserve @property/.test(String(error));
                }
                assert(failed, 'inline actual consumer diagnosed');
              } finally {
                unused.remove();
              }
              const safe = sample(
                definitions + `.probe{--Motion:${name};animation:var(--Motion)}`,
                undefined,
                target,
              );
              try {
                const node = safe.element.querySelector<HTMLElement>('.probe')!;
                assert(
                  getComputedStyle(node).animationName ===
                    (name === 'pulse' ? 'suite-fix1browser-animation-0' : 'none'),
                  'safe repeated syntax remains supported',
                );
              } finally {
                safe.remove();
              }
              const list = sample(
                definitions.replace(`${name}+`, `${name}#`) +
                  `.probe{--Motion:${name},${name};animation-name:var(--Motion)}`,
                undefined,
                target,
              );
              try {
                const node = list.element.querySelector<HTMLElement>('.probe')!;
                assert(
                  getComputedStyle(node).animationName ===
                    'suite-fix1browser-animation-0, suite-fix1browser-animation-0',
                  'safe list registration remains supported',
                );
              } finally {
                list.remove();
              }
            }
          }
          const plain = sample(
            '@property --Motion{syntax:"pulse+";inherits:false;initial-value:pulse}.probe{--Motion:pulse pulse;animation:var(--Motion)}',
          );
          plain.remove();
        });
        check('fix3_N4_unchanged_typed_default_values_and_literal_alternative', () => {
          for (const target of [false, true]) {
            const row = sample(
              '@property --Motion{syntax:"pulse | <number>";inherits:false;initial-value:1}@keyframes pulse{to{opacity:1}}.parent{--Motion:pulse}.literal{--Motion:pulse}.numeric{--Motion:3}.invalid{--Motion:unknown}.probe{animation:var(--Motion)}',
              '<div class="probe default"></div><div class="parent"><div class="probe nested"></div></div><div class="probe literal"></div><div class="probe numeric"></div><div class="probe invalid"></div>',
              target,
            );
            try {
              const nodes = Array.from(row.element.querySelectorAll<HTMLElement>('.probe'));
              const verify = (number = '3') => {
                for (const [index, node] of nodes.entries()) {
                  const computed = getComputedStyle(node);
                  assert(
                    computed.animationName ===
                      (index === 2 ? 'suite-fix1browser-animation-0' : 'none'),
                    `typed alternative name ${node.className}`,
                  );
                  assert(
                    computed.animationIterationCount === (index === 3 ? number : '1'),
                    `typed alternative iteration ${node.className}`,
                  );
                  assert(
                    computed.getPropertyValue('--suite-fix1browser-property-0').trim() ===
                      (index === 2 ? 'pulse' : index === 3 ? number : '1'),
                    `original registered value ${node.className}`,
                  );
                }
              };
              verify();
              for (const node of nodes) row.inline(node, { animation: 'var(--Motion)' });
              verify();
              row.inline(nodes[2], { '--Motion': 'pulse', animation: 'var(--Motion)' });
              row.inline(nodes[3], { '--Motion': 5, animation: 'var(--Motion)' });
              row.inline(nodes[4], { '--Motion': 'invalid', animation: 'var(--Motion)' });
              verify('5');
            } finally {
              row.remove();
            }
          }
        });
        host.replaceChildren();
        const summary = document.createElement('pre');
        summary.style.whiteSpace = 'pre-wrap';
        summary.textContent = checks.join('\n');
        host.append(summary);
        if (window.suiteCompilerFixture.capture) {
          await new Promise<void>((resolve) => {
            window.suiteCompilerFixture.resumeCapture = resolve;
            window.suiteCompilerFixture.captureReady = true;
          });
          window.suiteCompilerFixture.captureReady = false;
          delete window.suiteCompilerFixture.resumeCapture;
        }
      } finally {
        host.remove();
      }
      return { checks, failures, liveUrls: 0 };
    },
    async run(language) {
      await i18n.changeLanguage(language);
      const checks: string[] = [],
        failures: string[] = [];
      const assert = (ok: unknown, message: string) => {
        if (!ok) throw Error(message);
      };
      const rejects = async (fn: () => Promise<unknown>, match?: RegExp) => {
        try {
          await fn();
        } catch (e) {
          if (match) assert(match.test(String(e)), String(e));
          return;
        }
        throw Error('Expected rejection');
      };
      const live = new Set<string>();
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        live.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        live.delete(url);
        revoke(url);
      };
      const host = document.createElement('section');
      host.id = 'suite-compiler-acceptance';
      host.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:white;color:black;overflow:auto;padding:8px';
      document.body.append(host);
      const root = createRoot(host),
        retained: PreparedUiSuite[] = [],
        detaches: (() => void)[] = [];
      const check = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn();
          checks.push(name);
        } catch (e) {
          failures.push(`${name}: ${String(e)}`);
        }
      };
      const keep = <T extends PreparedUiSuite>(p: T) => {
        retained.push(p);
        return p;
      };
      const render = (p: PreparedUiSuite) =>
        flushSync(() => root.render(createElement(p.views.get('page.home')!, viewProps)));
      try {
        await check('relative_modules_reexports_and_cjs_cycle', async () => {
          const p = keep(
            await compileSuite(
              await make({
                'Home.tsx': source(
                  "import {label} from './barrel'; import {partial} from './cycle'; export const later='ready'; export default ()=><div data-testid='result'>{label}:{String(partial)}</div>",
                ),
                'barrel.ts': source("export {label} from './lib';"),
                'lib/index.ts': source("export const label='helper-ok'"),
                'cycle.ts': source("import {later} from './Home';export const partial=later"),
              }),
            ),
          );
          render(p);
          assert(
            host.textContent === 'helper-ok:undefined',
            'named exports and CJS partial export',
          );
          const a = keep(
            await compileSuite(await make({ 'Home.tsx': source('export default ()=><p>a</p>') })),
          );
          const b = keep(
            await compileSuite(await make({ 'Home.tsx': source('export default ()=><p>b</p>') })),
          );
          render(a);
          assert(host.textContent === 'a', 'suite A isolation');
          render(b);
          assert(host.textContent === 'b', 'suite B isolation');
        });
        await check('dependency_change_vs_css_state', async () => {
          const scope = createSuiteRuntimeScope();
          const files = {
            'Home.tsx': source(
              "import {useState} from 'react';import {label} from './helper';import './style.css';export default function View(){const [text,setText]=useState('');return <div><input aria-label='suite input' value={text} onInput={e=>setText(e.currentTarget.value)}/><b>{label}</b></div>}",
            ),
            'helper.ts': source("export const label='old helper'"),
            'style.css': source('input{color:rgb(1,2,3)}'),
          };
          const p = keep(await compileSuiteInScope(await make(files), scope));
          render(p);
          const input = host.querySelector('input')!;
          flushSync(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              input,
              'typed value',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          const next = keep(
            await compileSuiteInScope(
              await make({ ...files, 'style.css': source('input{color:rgb(4,5,6)}') }),
              scope,
            ),
          );
          assert(
            p.views.get('page.home') === next.views.get('page.home'),
            'CSS update component identity',
          );
          render(next);
          p.dispose();
          assert(
            host.querySelector('input') === input && input.value === 'typed value',
            'typed value survives CSS preview',
          );
          const changed = keep(
            await compileSuiteInScope(
              await make({ ...files, 'helper.ts': source("export const label='new helper'") }),
              scope,
            ),
          );
          assert(
            changed.views.get('page.home') !== next.views.get('page.home'),
            'helper changes component',
          );
          render(changed);
          assert(host.textContent === 'new helper', 'new helper execution');
        });
        await check('assets_csp_and_failure_cleanup', async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1920;
          canvas.height = 1;
          canvas.getContext('2d')!.fillRect(0, 0, 1920, 1);
          const png = {
            encoding: 'base64' as const,
            media_type: 'image/png',
            data: canvas.toDataURL('image/png').split(',')[1],
          };
          const font = assetFixtures.find((f) => f.media === 'font/woff2')!;
          const files = {
            'Home.tsx': source(
              "import image from './wide.png';export default ()=><div className='leased'><img src={image} alt='leased 1920'/><span>Font lease</span></div>",
            ),
            'wide.png': png,
            'font.woff2': { encoding: 'base64' as const, media_type: font.media, data: font.data },
            'style.css': source(
              "@font-face{font-family:SuiteTest;src:url('./font.woff2')} .leased{font-family:SuiteTest;--image:url('./wide.png');background-image:var(--image)}",
            ),
          };
          const scope = createSuiteRuntimeScope(),
            p = keep(await compileSuiteInScope(await make(files, true), scope));
          render(p);
          detaches.push(
            attachSuiteStyles(document, p, {
              id: 'launcher.main',
              viewIds: new Set(['page.home']),
              resolveTarget: () => null,
            }),
          );
          const img = host.querySelector('img')!;
          await img.decode();
          assert(img.naturalWidth === 1920, 'leased image naturalWidth 1920');
          await document.fonts.ready;
          assert(
            [...document.fonts].some((f) => f.status === 'loaded'),
            'leased CSS font loaded',
          );
          const activeDigest = p.digest,
            count = live.size;
          for (const bad of [
            "import './missing';export default()=>null",
            "import './amb';export default()=>null",
            'export default()=> <',
            'export default 42',
            "throw Error('factory failure');export default()=>null",
          ]) {
            const candidate = await make(
              { ...files, 'Home.tsx': source(bad), 'amb.ts': source(''), 'amb.tsx': source('') },
              true,
            );
            await rejects(() => compileSuiteInScope(candidate, scope));
            assert(p.digest === activeDigest, 'failed compile retains active digest');
            assert(live.size === count, 'failed compile no leaked URL');
          }
          const next = keep(
            await compileSuiteInScope(
              await make({ ...files, 'style.css': source('.leased{color:blue}') }, true),
              scope,
            ),
          );
          assert(
            next.views.get('page.home') === p.views.get('page.home'),
            'static asset URL captures retained component',
          );
          p.dispose();
          render(next);
          await host.querySelector('img')!.decode();
          assert(live.has(img.src), 'module asset stays leased after old prepared disposal');
          const changedPng = {
            ...png,
            data: assetFixtures.find((f) => f.media === 'image/png')!.data,
          };
          const changed = keep(
            await compileSuiteInScope(
              await make({ ...files, 'wide.png': changedPng }, true),
              scope,
            ),
          );
          assert(
            changed.views.get('page.home') !== next.views.get('page.home'),
            'imported bytes invalidate code identity',
          );
          next.dispose();
          changed.dispose();
        });
        await check('validation_cancellation_and_deferred_initialize', async () => {
          (globalThis as Record<string, unknown>).__suiteExecuted = 0;
          const bundle = await make({
            'Home.tsx': source('globalThis.__suiteExecuted++;export default()=>null'),
          });
          const stale = structuredClone(bundle);
          stale.files['Home.tsx'] = source('globalThis.__suiteExecuted++');
          await rejects(() => compileSuite(stale));
          assert(
            (globalThis as Record<string, unknown>).__suiteExecuted === 0,
            'strict hash gate before executable',
          );
          const controller = new AbortController();
          controller.abort();
          await rejects(() => compileSuite(bundle, controller.signal));
          let current = true;
          const tracked = URL.createObjectURL;
          URL.createObjectURL = (blob) => {
            const url = tracked(blob);
            if (blob instanceof Blob && blob.type === 'text/javascript') current = false;
            return url;
          };
          try {
            await rejects(
              () =>
                compileSuiteInScope(bundle, createSuiteRuntimeScope(), {
                  isCurrent: () => current,
                }),
              /Abort|current|supersed/i,
            );
          } finally {
            URL.createObjectURL = tracked;
          }
          assert(
            (globalThis as Record<string, unknown>).__suiteExecuted === 0,
            'await import completes before ownership guarded initialize',
          );
        });
        await check('public_module_identity_and_policy', async () => {
          const m = loadPublicModules();
          assert((m.react as typeof React).useState === React.useState, 'React hook identity');
          assert(m['@paradox/launcher'] === launcher, 'launcher namespace identity');
          assert(m['@paradox/ui'] === foundation, 'foundation namespace identity');
          assert(
            Object.keys(m).length === 6 && !('LauncherProvider' in launcher),
            'whitelist/private provider',
          );
          for (const text of [
            "import type {A} from './missing';export default()=>null",
            "import('react')",
            "require('react')",
            'await Promise.resolve()',
            'import.meta.url',
          ])
            await rejects(
              async () => compileSuite(await make({ 'Home.tsx': source(text) })),
              /Home\.tsx:\d+:\d+:/,
            );
        });
        await check('source_aware_styles_roots_targets_and_active_views', async () => {
          flushSync(() => root.render(null));
          const font = assetFixtures.find((f) => f.media === 'font/woff2')!;
          const b = await make(
            {
              'Home.tsx': source("import './entry.css';export default()=>null"),
              'style.css': source(':root{--suite-root:present}.probe{color:rgb(10,20,30)}'),
              'entry.css': source('.entry{padding-top:19px}'),
              'target.css': source(
                ':scope{color:rgb(40,50,60)}@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}@font-face{font-family:"Scoped Font";src:url("./font.woff2")} .label{animation:pulse 1s;font-family:"Scoped Font";--owned:2}',
              ),
              'position.css': source(':scope{border-top:7px solid red}'),
              'font.woff2': { encoding: 'base64', media_type: font.media, data: font.data },
            },
            true,
          );
          b.manifest.overrides = [
            {
              selector: { kind: 'type', target: 'test.target' },
              enabled: true,
              entry: null,
              stylesheet: 'target.css',
            },
            {
              selector: {
                kind: 'position',
                target: 'test.position',
                locator: { version: 1, renderRoot: 'launcher.main', calls: [], business: [] },
              },
              enabled: true,
              entry: null,
              stylesheet: 'position.css',
            },
          ];
          const p = keep(await compileSuite(await normalizeDraftBundle(b)));
          const main = document.createElement('div'),
            editorHost = document.createElement('div');
          host.append(main, editorHost);
          const shadow = editorHost.attachShadow({ mode: 'open' });
          main.innerHTML =
            '<div class="probe owned entry position"><span class="label">Main style</span></div><div class="probe outside">Outside</div>';
          shadow.innerHTML =
            '<div class="probe owned entry position"><span class="label">Editor style</span></div><div class="probe outside">Outside</div>';
          const resolveTarget = (selector: { target: string }) =>
            selector.target === 'test.target' ? '.owned' : '.position';
          const d1 = attachSuiteStyles(document, p, {
            id: 'launcher.main',
            viewIds: new Set(['page.home']),
            resolveTarget,
          });
          detaches.push(d1);
          const d2 = attachSuiteStyles(shadow, p, {
            id: 'launcher.editor',
            viewIds: new Set(),
            resolveTarget,
          });
          detaches.push(d2);
          const owned = main.querySelector('.owned')!,
            outside = main.querySelector('.outside')!,
            editor = shadow.querySelector('.owned')!;
          assert(
            getComputedStyle(owned).color === 'rgb(40, 50, 60)' &&
              getComputedStyle(outside).color === 'rgb(10, 20, 30)',
            'target CSS contains selector effects',
          );
          assert(
            getComputedStyle(owned).paddingTop === '19px' &&
              getComputedStyle(editor).paddingTop === '0px',
            'only active entry usage installed',
          );
          assert(
            getComputedStyle(owned).borderTopWidth === '7px' &&
              getComputedStyle(editor).borderTopWidth === '0px',
            'position renderRoot mismatch omitted',
          );
          assert(
            getComputedStyle(editor).color === 'rgb(40, 50, 60)' &&
              getComputedStyle(editor).getPropertyValue('--suite-root') === 'present',
            'editor receives globals/target styles and :host variables',
          );
          const text = shadow.querySelector('style')!.textContent!;
          assert(
            text.includes(':host') &&
              !/@keyframes pulse/.test(text) &&
              !text.includes('font-family:"Scoped Font"'),
            'side-effect names scoped',
          );
          if (window.suiteCompilerFixture.capture) {
            await document.fonts.ready;
            await new Promise<void>((resolve) => {
              window.suiteCompilerFixture.resumeCapture = resolve;
              window.suiteCompilerFixture.captureReady = true;
            });
            window.suiteCompilerFixture.captureReady = false;
            delete window.suiteCompilerFixture.resumeCapture;
          }
          d2();
          assert(!shadow.querySelector('style'), 'synchronous detach');
          detaches.push(
            attachSuiteStyles(shadow, p, {
              id: 'launcher.editor',
              viewIds: new Set(['page.home']),
              resolveTarget,
            }),
          );
          assert(
            getComputedStyle(editor).paddingTop === '19px',
            'same actual view may render in editor',
          );
          p.dispose();
          assert(!shadow.querySelector('style'), 'dispose detaches installed roots');
          main.remove();
          editorHost.remove();
        });
        await check('html_resources_and_R6_event_projections', async () => {
          const png = assetFixtures.find((f) => f.media === 'image/png')!;
          const b = await make({
            'view/Home.html': source(
              '<div><img src="../pixel.png#test" style="--image:url(../pixel.png);background-image:var(--image)"/><input data-ui-action="props.changed" data-ui-event="onInput" data-ui-args=\'[{"$prop":"event.value"}]\'/><ui-prop name="props.label"/></div>',
            ),
            'pixel.png': { encoding: 'base64', media_type: png.media, data: png.data },
          });
          for (const id of Object.keys(b.manifest.views)) b.manifest.views[id] = 'view/Home.html';
          for (const route of b.manifest.routes) route.entry = 'view/Home.html';
          const p = keep(await compileSuite(await normalizeDraftBundle(b)));
          let value: unknown;
          flushSync(() =>
            root.render(
              createElement(p.views.get('page.home')!, {
                ...viewProps,
                props: {
                  label: 'HTML value',
                  changed: (v: unknown) => {
                    value = v;
                  },
                },
              }),
            ),
          );
          const input = host.querySelector('input');
          assert(input, `HTML input missing: ${host.innerHTML}`);
          input!.value = 'event value';
          input!.dispatchEvent(new Event('input', { bubbles: true }));
          assert(value === 'event value', 'actual HTML input event projection');
          const img = host.querySelector('img')!;
          await img.decode();
          assert(
            img.naturalWidth === 3 && img.src.endsWith('#test'),
            'relative image fragment preserved',
          );
          assert(
            img.style.getPropertyValue('--image').includes('blob:'),
            'inline custom resource AST',
          );
          const callback = (action: string, args?: string) => {
            const nodes = parseSuiteHtml(
              `<input data-ui-action="${action}" ${args === undefined ? '' : `data-ui-args='${args}'`}/>`,
              { sourcePath: 'events.html', resolveAsset: (ref) => ref },
            );
            let received: unknown[] = [];
            const envelope = {
              ...viewProps,
              props: {
                call: (...v: unknown[]) => {
                  received = v;
                },
              },
              actions: {
                call: (...v: unknown[]) => {
                  received = v;
                },
              },
            } as unknown as UiViewProps;
            const element = (renderSuiteHtml(nodes, envelope) as React.ReactElement[])[0];
            const invoke = (event: unknown) =>
              (element.props as { onClick: (event: unknown) => void }).onClick(event);
            return { invoke, received: () => received };
          };
          const event = { currentTarget: { value: 'text', checked: true, valueAsNumber: 42 } };
          for (const action of ['props.call', 'actions.call']) {
            const omitted = callback(action);
            omitted.invoke(event);
            assert(
              omitted.received().length === (action.startsWith('props') ? 1 : 0),
              'omitted callback args',
            );
            const empty = callback(action, '[]');
            empty.invoke(event);
            assert(empty.received().length === 0, 'explicit empty args');
          }
          const projected = callback(
            'props.call',
            '[{"$prop":"event.value"},{"$prop":"event.checked"},{"$prop":"event.valueAsNumber"},"literal"]',
          );
          projected.invoke(event);
          event.currentTarget.value = 'later';
          assert(
            JSON.stringify(projected.received()) === '["text",true,42,"literal"]',
            'immutable event-time primitive values',
          );
          for (const invalid of [
            { currentTarget: {} },
            { currentTarget: { value: 'ok', checked: true, valueAsNumber: NaN } },
          ]) {
            let failed = false;
            try {
              projected.invoke(invalid);
            } catch (e) {
              failed = /missing or invalid/.test(String(e));
            }
            assert(failed, 'missing/non-finite event field diagnostics');
          }
          await rejects(
            () =>
              Promise.resolve().then(() =>
                parseSuiteHtml('<img src="./pixel.png?query"/>', {
                  sourcePath: 'image.html',
                  resolveAsset: () => {
                    throw Error('queries not supported');
                  },
                }),
              ),
            /image.html/,
          );
        });
        await check('current_inline_style_metadata_preserves_component_identity', async () => {
          const b = await make(
            {
              'view.html': source(
                '<input style="animation-name:pulse;--owned:2;color:var(--color)"/>',
              ),
              'style.css': source(
                '@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}',
              ),
            },
            true,
          );
          for (const id of Object.keys(b.manifest.views)) b.manifest.views[id] = 'view.html';
          for (const route of b.manifest.routes) route.entry = 'view.html';
          const scope = createSuiteRuntimeScope();
          const p = keep(await compileSuiteInScope(await normalizeDraftBundle(b), scope));
          const show = (prepared: typeof p) =>
            flushSync(() =>
              root.render(
                createElement(
                  SuiteInlineStyleContext.Provider,
                  { value: suiteInlineStyleResolver(prepared) },
                  createElement(prepared.views.get('page.home')!, viewProps),
                ),
              ),
            );
          show(p);
          const input = host.querySelector('input')!;
          input.value = 'retained';
          const oldName = input.style.animationName;
          assert(
            oldName.includes('suite-') && !input.style.getPropertyValue('--owned'),
            'HTML inline descriptor references rewritten',
          );
          b.files['style.css'] = source(
            '@keyframes first{from{opacity:0}to{opacity:1}}@keyframes pulse{from{opacity:0}to{opacity:1}}@property --owned{syntax:"<number>";inherits:false;initial-value:0}',
          );
          const next = keep(await compileSuiteInScope(await normalizeDraftBundle(b), scope));
          assert(
            input.style.animationName === oldName,
            'pending compile does not publish style maps',
          );
          assert(
            p.views.get('page.home') === next.views.get('page.home'),
            'HTML CSS-only Component reuse',
          );
          show(next);
          assert(
            host.querySelector('input') === input &&
              input.value === 'retained' &&
              input.style.animationName !== oldName,
            'activated resolver updates inline style without remount',
          );
          const nameMap = suiteInlineStyleResolver(next)({
            fontWeight: 400,
            content: '"pulse"',
            animationName: 'pulse',
          });
          assert(
            nameMap.fontWeight === 400 &&
              nameMap.content === '"pulse"' &&
              nameMap.animationName === input.style.animationName,
            'resolver preserves numeric/literal values',
          );
        });
        await check('full_asset_gate_and_async_validation_cancellation', async () => {
          (globalThis as Record<string, unknown>).__suiteExecuted = 0;
          const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
          const b = await make({
            'Home.tsx': source('globalThis.__suiteExecuted++;export default()=>null'),
          });
          b.files['invalid.svg'] = {
            encoding: 'base64',
            media_type: 'image/svg+xml',
            data: encodeBase64(svg),
          };
          b.manifest.files.push({
            path: 'invalid.svg',
            kind: 'asset',
            media_type: 'image/svg+xml',
            bytes: svg.length,
            sha256: await sha256(svg),
          });
          const count = live.size;
          await rejects(() => compileSuite(b));
          assert(
            live.size === count && (globalThis as Record<string, unknown>).__suiteExecuted === 0,
            'full XML policy gate before executable resources',
          );
          const png = assetFixtures.find((f) => f.media === 'image/png')!;
          const raster = await make({
            'Home.tsx': source('globalThis.__suiteExecuted++;export default()=>null'),
            'pixel.png': { encoding: 'base64', media_type: png.media, data: png.data },
          });
          const controller = new AbortController(),
            bitmap = window.createImageBitmap;
          window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
            const result = await bitmap(...args);
            controller.abort();
            return result;
          }) as typeof createImageBitmap;
          try {
            await rejects(() => compileSuite(raster, controller.signal), /Abort|cancel/);
          } finally {
            window.createImageBitmap = bitmap;
          }
          assert(
            live.size === count && (globalThis as Record<string, unknown>).__suiteExecuted === 0,
            'post-validation cancellation before acquisition/initialize',
          );
        });
      } finally {
        flushSync(() => root.unmount());
        for (const detach of detaches) detach();
        for (const p of retained) p.dispose();
        host.remove();
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      }
      if (live.size) failures.push(`leakedAssetUrls: ${live.size}`);
      return { checks, failures, liveUrls: live.size };
    },
  };
}
