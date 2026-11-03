import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import { loadApp } from './lib/hook-test-host.mjs';
import { bundle } from './lib/suite-test-fixtures.mjs';

assert.ok(
  existsSync(new URL('../src/ui-suite/module-graph.ts', import.meta.url)),
  'Task8 multi-file compiler must exist',
);
const { buildModuleGraph, moduleBlobSource } = loadApp()('ui-suite/module-graph.ts');
const source = (text) => ({ encoding: 'utf8', text });
const graph = (files) =>
  buildModuleGraph(bundle(files), ['Home.tsx'], ['react', 'react/jsx-runtime']);
const cssApi = loadApp()('customization/css.ts');
const style = (text) => {
  const css = cssApi.prepareSuiteCss(text, { sourcePath: 'fix1.css', resolveAsset: (ref) => ref });
  return { css, rewrite: cssApi.createSuiteStyleRewriter([css], 'fix1') };
};
const run = (g) =>
  vm.runInNewContext(
    moduleBlobSource(g).replace('export function initialize', 'function initialize') +
      '\ninitialize',
    {},
  )({}, {});
await test('relative_modules_reexports_and_cjs_cycle', () => {
  const g = graph({
    'Home.tsx': source(
      "import { label } from './barrel'; import { partial } from './cycle'; export const before = partial; export const later = 'ready'; export default () => label;",
    ),
    'barrel.ts': source("export { label } from './lib';"),
    'lib/index.ts': source("export const label = 'helper-ok';"),
    'cycle.ts': source("import { later } from './Home'; export const partial = later;"),
  });
  const modules = run(g);
  assert.equal(modules['Home.tsx'].default(), 'helper-ok');
  assert.equal(modules['Home.tsx'].before, undefined);
  assert.equal(
    run(graph({ 'Home.tsx': source("export default () => 'a'") }))['Home.tsx'].default(),
    'a',
  );
  assert.equal(
    run(graph({ 'Home.tsx': source("export default () => 'b'") }))['Home.tsx'].default(),
    'b',
  );
});
await test('dependency_change_vs_css_state', () => {
  const make = (css, helper) =>
    graph({
      'Home.tsx': source(
        "import './a.css'; import { value } from './helper'; export default () => value",
      ),
      'a.css': source(css),
      'helper.ts': source(`export const value = '${helper}'`),
    });
  assert.equal(make('p{color:red}', 'one').identity, make('p{color:blue}', 'one').identity);
  assert.notEqual(make('p{color:red}', 'one').identity, make('p{color:red}', 'two').identity);
});
await test('source positions, erased type imports, and unsupported module constructs', () => {
  for (const text of [
    "import type { T } from './missing'; export default () => null",
    "type T = import('./missing').T; export default () => null",
    "import('./x')",
    "require('react')",
    'await Promise.resolve()',
    'import.meta.url',
    'import x = require("react")',
    'for await (const x of []) {}',
  ])
    assert.throws(() => graph({ 'Home.tsx': source(text) }), /Home\.tsx:\d+:\d+:/);
  assert.throws(
    () => graph({ 'Home.tsx': source("import './x';"), 'x.ts': source(''), 'x.tsx': source('') }),
    /ambiguous/i,
  );
});
await test('CSS resource ASTs, descriptor names and inline metadata', () => {
  const { prepareSuiteCss, createSuiteStyleRewriter, prepareSuiteInlineStyle } =
    loadApp()('customization/css.ts');
  const seen = [];
  const resolveAsset = (value) => {
    seen.push(value);
    return 'blob:accepted';
  };
  const sourcePath = 'styles/file.css';
  const css = prepareSuiteCss(
    '@layer foo.bar{.x{--asset:u\\72l("../image.png");background-image:image-set("../image.png" 1x)}}@font-face{font-family:My Font;src:url("../font.woff2")}@keyframes pulse{from{opacity:0}to{opacity:1}}.x{font:12px My Font;animation:pulse 1s;content:"pulse"}',
    { sourcePath, resolveAsset },
  );
  assert.deepEqual(seen, ['../image.png', '../image.png', '../font.woff2']);
  const names = createSuiteStyleRewriter([css], 'layer-test');
  const output = names.render([css], false, '.target');
  assert.match(output, /@layer suite-layer-test-layer-0\.suite-layer-test-layer-1/);
  assert.match(output, /font:12px suite-layer-test-font-0/);
  assert.match(output, /content:"pulse"/);
  assert.equal(
    names.inline({
      animationName: 'pulse',
      fontFamily: 'My Font',
      content: '"pulse"',
      fontWeight: 400,
    }).animationName,
    'suite-layer-test-animation-0',
  );
  assert.ok(
    prepareSuiteInlineStyle('--bg:url(../image.png)', { sourcePath, resolveAsset })[
      '--bg'
    ].includes('blob:accepted'),
  );
  const opaque = prepareSuiteCss(
    '.x{--opaque:?? {x:y} url("../raw.png");--literal:"url(untouched)"}',
    { sourcePath, resolveAsset },
  );
  assert.match(
    createSuiteStyleRewriter([opaque], 'raw').render([opaque], false),
    /--opaque:\?\? \{x:y\} url\(blob:accepted\)/,
  );
  assert.ok(seen.includes('../raw.png'));
});
await test('fix1 I1 animation grammar keeps timing and disambiguates keyword names', () => {
  const { css, rewrite } = style(
    '@keyframes linear{to{opacity:0}}@keyframes fade{to{opacity:0}}@keyframes reverse{to{opacity:0}}.probe{animation:fade 1s linear,linear 1s linear,fade 1s reverse 2 forwards running}',
  );
  const expected =
    'suite-fix1-animation-1 1s linear,linear 1s suite-fix1-animation-0,suite-fix1-animation-1 1s reverse 2 forwards running';
  assert.equal(
    rewrite.inline({
      animation: 'fade 1s linear,linear 1s linear,fade 1s reverse 2 forwards running',
    }).animation,
    expected,
  );
  assert.ok(rewrite.render([css], false, '.probe').includes('animation:' + expected));
  assert.equal(rewrite.inline({ animationName: 'linear' }).animationName, 'suite-fix1-animation-0');
  assert.equal(
    rewrite.inline({ animation: 'fade 1s steps(var(--steps))' }).animation,
    'suite-fix1-animation-1 1s steps(var(--steps))',
  );
  assert.equal(
    rewrite.inline({ animation: 'steps(var(--steps)) 1s linear' }).animation,
    'steps(var(--steps)) 1s suite-fix1-animation-0',
  );
  const keyword = style(
    '@keyframes "none"{to{opacity:0}}.x{--frame:"none";animation-name:none,var(--frame)}',
  );
  assert.ok(keyword.rewrite.render([keyword.css], false).includes('animation-name:none,var('));
});
await test('fix1 I2 raw custom values stay literal while descriptor consumers resolve', () => {
  const { css, rewrite } = style(
    '@keyframes pulse{to{opacity:0}}@font-face{font-family:TestFamily;src:local("Arial")}.probe{--label:"pulse";--opaque:?? pulse {x:TestFamily};--font:TestFamily;animation-name:var(--label);font-family:var(--font,TestFamily)}.probe::before{content:var(--label,"pulse")}',
  );
  const text = rewrite.render([css], false);
  assert.ok(text.includes('--label:"pulse";'), 'stored label must remain literal');
  assert.ok(text.includes('--opaque:?? pulse {x:TestFamily}'), 'opaque tokens must remain literal');
  assert.equal(
    rewrite.inline({ '--label': '"pulse"', '--opaque': '?? pulse {x:TestFamily}' })['--label'],
    '"pulse"',
  );
  const inline = rewrite.inline({
    animationName: 'var(--label,pulse)',
    fontFamily: 'var(--font,TestFamily)',
    content: 'var(--label,"pulse")',
  });
  assert.equal(inline.content, 'var(--label,"pulse")');
  assert.notEqual(inline.animationName, 'var(--label,pulse)');
  assert.notEqual(inline.fontFamily, 'var(--font,TestFamily)');
  assert.equal(
    rewrite.inline({ font: 'calc(var(--size)*1px) TestFamily' }).font,
    'calc(var(--size)*1px) suite-fix1-font-0',
  );
  const multi = style(
    '@font-face{font-family:My Font;src:local("Arial")}.x{--font:My Font;font-family:var(--font),My Font}',
  );
  assert.ok(multi.rewrite.render([multi.css], false).includes(',suite-fix1-font-0}'));
  assert.ok(
    !multi.rewrite.inline({ fontFamily: 'var(--font),My Font' }).fontFamily.endsWith(' Font'),
  );
});
await test('fix1 I3 decoded case-insensitive CSS keywords preserve case-sensitive identities', () => {
  const { css, rewrite } = style(
    '@KEYFRAMES Pulse{TO{opacity:0}}@FONT-FACE{FONT-FAMILY:TestFamily;SRC:local("Arial")}@PROPERTY --Owned{SYNTAX:"<number>";INHERITS:false;INITIAL-VALUE:0}@LAYER A{.probe{ANIMATION-NAME:Pulse;FONT-FAMILY:testfamily;--Owned:2;--owned:3}}',
  );
  const output = rewrite.render([css], false, '.probe');
  assert.match(output, /@keyframes suite-fix1-animation-0/);
  assert.match(output, /animation-name:suite-fix1-animation-0/);
  assert.match(output, /font-family:suite-fix1-font-0/);
  assert.ok(output.includes('--owned:3'));
  assert.equal(
    rewrite.inline({ 'ANIMATION-NAME': 'Pulse', 'FONT-FAMILY': 'TESTFAMILY' })['ANIMATION-NAME'],
    'suite-fix1-animation-0',
  );
  assert.equal(rewrite.inline({ animationName: 'pulse' }).animationName, 'pulse');
  const escaped = style('@\\6b eyframes pulse{to{opacity:0}}.x{\\61 nimation-name:pulse}');
  assert.match(
    escaped.rewrite.render([escaped.css], false),
    /animation-name:suite-fix1-animation-0/,
  );
});
await test('fix1 I4 thousands of unmatched custom tokens avoid quadratic substring enumeration', () => {
  const { rewrite } = style('@font-face{font-family:TestFamily;src:local("Arial")}');
  const count = 3000,
    value = Array(count).fill('token').join(' '),
    slice = Array.prototype.slice;
  let slices = 0;
  Array.prototype.slice = function (...args) {
    if (this.length === count && args.length === 2 && ++slices > count * 2)
      throw new Error('Unbounded font substring enumeration');
    return slice.apply(this, args);
  };
  try {
    assert.equal(rewrite.inline({ '--tokens': value })['--tokens'], value);
  } finally {
    Array.prototype.slice = slice;
  }
  assert.ok(slices <= count * 2);
  const animation = style('@keyframes fade{to{opacity:0}}').rewrite.inline({
    animation: Array(count).fill('fade 1s linear').join(','),
  }).animation;
  assert.equal(animation.split('suite-fix1-animation-0').length - 1, count);
});
await test('fix1 R4f diagnoses only actual ambiguous shorthand consumers', () => {
  const prefix = '@keyframes linear{to{opacity:0}}@keyframes fade{to{opacity:0}}';
  const safe = style(prefix + '.x{--v:linear;animation:fade 1s var(--v)}');
  assert.ok(
    safe.rewrite.render([safe.css], false).includes('animation:suite-fix1-animation-1 1s var('),
  );
  for (const value of ['ease 1s var(--v)', 'var(--v) 1s linear'])
    assert.throws(
      () => style(prefix + `.x{--v:linear;animation:${value}}`),
      /fix1.css:\d+:\d+:.*animation-name\/font-family/,
    );
  const stored = style(prefix + '.x{--v:linear;--whole:var(--v) 1s linear;content:var(--whole)}');
  assert.throws(
    () => stored.rewrite.inline({ animation: 'var(--whole)' }),
    /Cannot safely namespace/,
  );
  assert.throws(
    () => stored.rewrite.inline({ '--new': 'var(--v) 1s linear', animation: 'var(--new)' }),
    /Cannot safely namespace/,
  );
  assert.doesNotThrow(() => style('.x{animation:ease 1s var(--v)}'));
  assert.doesNotThrow(() =>
    style(prefix + '.x{--whole:fade 1s linear;animation:var(--whole,fade 1s linear)}'),
  );
});
await test('fix2 N1 registered literal syntax follows each descriptor mirror', () => {
  const { css, rewrite } = style(
    '@property --Motion{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}.x{--Motion:pulse;animation-name:var(--Motion)}',
  );
  for (const target of [undefined, '.target']) {
    const text = rewrite.render([css], false, target);
    assert.equal(
      text.split('syntax:"suite-fix1-animation-1 | suite-fix1-animation-0"').length - 1,
      2,
    );
    assert.ok(text.includes('syntax:"pulse | still";inherits:false;initial-value:still'));
    assert.equal(text.split('inherits:false').length - 1, 3);
  }
  assert.match(
    rewrite.inline({ animationName: 'var(--Motion)' }).animationName,
    /var\(--suite-fix1-var-animation-name-/,
  );
});
await test('fix2 N2 fixed nonkeyword animation names allow leading and middle variables', () => {
  const definitions = '@keyframes linear{to{opacity:0}}@keyframes fade{to{opacity:0}}';
  for (const value of [
    'var(--v) 1s fade',
    '1s var(--v) fade',
    'fade 1s var(--v)',
    'var(--v) 1s fade,fade 2s var(--v)',
  ]) {
    const { css, rewrite } = style(definitions + `.x{--v:linear;animation:${value}}`);
    for (const target of [undefined, '.target'])
      assert.ok(rewrite.render([css], false, target).includes('suite-fix1-animation-1'));
    const inline = rewrite.inline({ '--v': 'linear', animation: value });
    assert.ok(inline.animation.includes('suite-fix1-animation-1'));
    assert.ok(inline.animation.includes('var(--suite-fix1-var-animation-'));
  }
});
await test('fix2 N3 escaped custom identity is emitted as a valid CSS identifier', () => {
  const value = String.raw`var(--label\ x)`;
  const { css, rewrite } = style(
    String.raw`.x{--label\ x:"pulse"}.x::before{content:var(--label\ x)}`,
  );
  for (const target of [undefined, '.target']) {
    const text = rewrite.render([css], false, target);
    assert.ok(text.includes(String.raw`--label\ x:"pulse"`));
    assert.ok(text.includes(value));
  }
  assert.equal(rewrite.inline({ content: value }).content, value);
  const html = cssApi.prepareSuiteInlineStyle(
    String.raw`--label\ x:"local";--slash\\x:"slash";content:var(--label\ x)`,
    { sourcePath: 'inline.html', resolveAsset: (ref) => ref },
  );
  assert.equal(html['--label x'], '"local"');
  assert.equal(html[String.raw`--slash\x`], '"slash"');
  const inline = rewrite.inline(html);
  assert.equal(inline['--label x'], '"local"');
  assert.equal(inline[String.raw`--slash\x`], '"slash"');
  assert.equal(inline.content, value);
  const registered = style(
    String.raw`@property --Label\ x{syntax:"<custom-ident>";inherits:false;initial-value:pulse}@keyframes pulse{to{opacity:0}}.x{--Label\ x:pulse;--label\ x:still;animation-name:var(--Label\ x);content:var(--label\ x)}`,
  );
  const text = registered.rewrite.render([registered.css], false, '.target');
  assert.ok(text.includes(String.raw`--label\ x:still`));
  assert.ok(text.includes(String.raw`content:var(--label\ x)`));
  assert.ok(text.includes('--suite-fix1-property-0:pulse'));
});
await test('fix2 R4g checks registration semantics at actual consumers, not syntax shape', () => {
  assert.throws(
    () =>
      style(
        '@property --Motion{syntax:"<color> | <custom-ident>";inherits:false;initial-value:red}@keyframes red{to{opacity:1}}.x{animation-name:var(--Motion)}',
      ),
    /Cannot preserve @property/,
  );
  assert.doesNotThrow(() =>
    style(
      '@property --Motion{syntax:"red | <color>";inherits:false;initial-value:red}@keyframes red{to{opacity:1}}.x{animation-name:var(--Motion)}',
    ),
  );
  for (const name of ['pulse', 'linear']) {
    const definitions = `@property --Motion{syntax:"${name}+";inherits:false;initial-value:${name}}@keyframes ${name}{to{opacity:1}}`;
    assert.throws(
      () => style(definitions + `.x{--Motion:${name} ${name};animation:var(--Motion)}`),
      /fix1.css:\d+:\d+:.*Cannot preserve @property.*unregistered variable/,
    );
    const unused = style(definitions + `.x{--Motion:${name} ${name};content:var(--Motion)}`);
    assert.doesNotThrow(() => unused.rewrite.render([unused.css], false, '.target'));
    assert.throws(
      () => unused.rewrite.inline({ animation: 'var(--Motion)' }),
      /<inline-style>:1:1:.*Cannot preserve @property/,
    );
    assert.doesNotThrow(() => style(definitions + `.x{--Motion:${name};animation:var(--Motion)}`));
    assert.doesNotThrow(() =>
      style(
        definitions.replace(`${name}+`, `${name}#`) +
          `.x{--Motion:${name},${name};animation-name:var(--Motion)}`,
      ),
    );
    assert.doesNotThrow(() =>
      style(
        definitions.replace(`@keyframes ${name}`, '@keyframes unrelated') +
          `.x{--Motion:${name} ${name};animation:var(--Motion)}`,
      ),
    );
  }
  const registered =
    '@property --Motion{syntax:"pulse | still";inherits:false;initial-value:still}@keyframes still{to{opacity:1}}@keyframes pulse{to{opacity:1}}';
  assert.doesNotThrow(() =>
    style(registered + '.x{--a:pulse;--Motion:var(--a,still);animation-name:var(--Motion)}'),
  );
  assert.doesNotThrow(() => style(registered + '.x{--Motion:PULSE;animation-name:var(--Motion)}'));
  assert.doesNotThrow(() =>
    style(
      '@property --Motion{syntax:"pulse+";inherits:false;initial-value:pulse}.x{--Motion:pulse pulse;animation:var(--Motion)}',
    ),
  );
});
await test('fix3 N4 unchanged numeric alternatives coexist with namespaced literals', () => {
  const definitions =
    '@property --Motion{syntax:"pulse | <number>";inherits:false;initial-value:1}@keyframes pulse{to{opacity:1}}';
  const { css, rewrite } = style(
    definitions +
      '.literal{--Motion:pulse}.numeric{--Motion:3}.invalid{--Motion:unknown}.probe{animation:var(--Motion)}',
  );
  for (const target of [undefined, '.target']) {
    const output = rewrite.render([css], false, target);
    assert.ok(
      output.includes('syntax:"suite-fix1-animation-0 | <number>";inherits:false;initial-value:1'),
    );
    assert.ok(output.includes('syntax:"pulse | <number>";inherits:false;initial-value:1'));
  }
  for (const value of [undefined, 'pulse', '3', 5, 'unknown']) {
    const input = { animation: 'var(--Motion)' };
    if (value !== undefined) input['--Motion'] = value;
    assert.match(rewrite.inline(input).animation, /var\(--suite-fix1-var-animation-/);
  }
  assert.doesNotThrow(() => rewrite.inline({ animationName: 'var(--Motion)' }));
});
