import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { loadApp } from './lib/hook-test-host.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const cssTree = require('css-tree');
const { compileCss, prepareSuiteCss, createSuiteStyleRewriter } = loadApp()('customization/css.ts');
const { identityToken, safeTargetIdentity } = loadApp()('customization/identity.ts');
const target = 'component.profile-card';
const scope = `:where([data-ui-root-target~="${target}"],[data-ui-node="${target}"])`;
const contained = `:is(${scope},${scope} *)`;

await test('document CSS retains global selectors and custom token streams', () => {
  const output = compileCss(
    'html, body, :root { --accent: #abc; --tokens: {a:b}; --external-token:@my-token; color: var(--accent); }',
  );
  assert.match(output, /^html,body,:root\{/);
  assert.ok(!output.includes('data-ui-scope'));
  assert.ok(output.includes('--tokens: {a:b}'));
  assert.ok(output.includes('--external-token:@my-token'));
  assert.equal(compileCss(' /* comment only */ '), '');
  assert.equal(compileCss('  '), '');
});

await test('target roots and third-party descendants match on the rightmost compound', () => {
  assert.equal(compileCss('button { color:red }', target), `button${contained}{color:red}`);
  assert.equal(
    compileCss('.layout > button:hover, input::placeholder { color:red }', target),
    `.layout>button:hover${contained},input${contained}::placeholder{color:red}`,
  );
  assert.equal(
    compileCss('body .card [role="menuitem"] { color:red }', target),
    `body .card [role="menuitem"]${contained}{color:red}`,
  );
});

await test('scope and ampersand refer to the exact target root', () => {
  const css = compileCss(':scope:hover {opacity:.5} & > button {color:red}', target);
  assert.equal(css, `${scope}:hover${contained}{opacity:.5}${scope}>button${contained}{color:red}`);
  assert.ok(!css.includes(':scope'));
  assert.ok(!css.includes('&'));
  assert.ok(!css.includes('data-ui-scope'), 'inherited descendant scopes are not component roots');
  assert.ok(css.includes('data-ui-root-target'));
  const nestedPseudo = compileCss(':is(:scope, .extra)::before {content:"x"}', target);
  assert.equal(nestedPseudo, `:is(${scope},.extra)${contained}::before{content:"x"}`);
});

await test('keyframe percentages and from/to are never scoped', () => {
  const source =
    '@keyframes pulse {from{opacity:0} 25%,50%{opacity:.5} to{opacity:1}} button{animation:pulse 1s}';
  const output = compileCss(source, target);
  assert.equal(
    output,
    `@keyframes pulse{from{opacity:0}25%,50%{opacity:.5}to{opacity:1}}button${contained}{animation:pulse 1s}`,
  );
  const vendor = compileCss(
    '@-webkit-keyframes turn{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
    target,
  );
  assert.ok(!vendor.includes('data-ui'));
  assert.throws(() => compileCss('@keyframes x{button{color:red}}'), /keyframe/);
  assert.throws(() => compileCss('@keyframes x{101%{color:red}}'), /percentage/);
});

await test('font-face and property descriptors remain valid and unscoped', () => {
  const font =
    '@font-face{font-family:"UI Font";src:url(data:font/woff2;base64,a) format("woff2");font-weight:400}';
  const output = compileCss(font, target);
  assert.equal(output, cssTree.generate(cssTree.parse(font)));
  assert.ok(!output.includes('data-ui'));
  assert.equal(
    compileCss('@property --tint{syntax:"<color>";inherits:false;initial-value:red}', target),
    '@property --tint{syntax:"<color>";inherits:false;initial-value:red}',
  );
  assert.throws(() => compileCss('@font-face{font-weight:banana}'), /font-weight/);
});

await test('conditional rules and layers preserve structure while scoping their selectors', () => {
  const output = compileCss(
    '@layer overrides; @layer overrides{@media(width>600px){@supports(display:grid){button{display:grid}}}}',
    target,
  );
  assert.equal(
    output,
    `@layer overrides;@layer overrides{@media (width>600px){@supports (display:grid){button${contained}{display:grid}}}}`,
  );
  assert.equal(
    compileCss('@container card (width>300px){:scope{padding:2px}}', target),
    `@container card (width>300px){${scope}${contained}{padding:2px}}`,
  );
});

await test('native nested ampersands keep referring to their scoped parent', () => {
  assert.equal(
    compileCss('.card{color:red;&:hover{color:blue}}', target),
    `.card${contained}{color:red;&:hover${contained}{color:blue}}`,
  );
  assert.equal(
    compileCss('&{color:red;@media(width>600px){&:hover{color:blue}}}', target),
    `${scope}${contained}{color:red;@media (width>600px){&:hover${contained}{color:blue}}}`,
  );
});

await test('unfinished and malformed CSS reports the actual source position', () => {
  for (const source of [
    'button { color:red',
    'button { color:rgb(1,2,3 }',
    'button { content:"unclosed }',
    'button { content:"escaped\\" }',
    'button { background:url(unclosed }',
    '/* unclosed comment',
    'button] { color:red }',
    'button { color:; }',
    'button { color:banana; }',
    'button { invalid value; }',
    'button { padding:12badunit; }',
    'button { --:value }',
    '50% { color:red }',
    'button > { color:red }',
    '@keyframes {from{color:red}}',
    '@keyframes none{from{color:red}}',
    '@property ordinary{syntax:"<color>";inherits:false;initial-value:red}',
    '@media{button{color:red}}',
    '@supports{button{color:red}}',
  ]) {
    assert.throws(() => compileCss(source), /CSS \d+:\d+:/, source);
  }
  assert.throws(() => compileCss('button{color:red}\ninput {color:banana}'), /CSS 2:8:/);
  assert.equal(
    compileCss('button {content:"}";background:url(data:text/plain,a{b)}'),
    'button{content:"}";background:url(data:text/plain,a{b)}',
  );
});

await test('external and unknown rules fail without returning partial CSS', () => {
  for (const name of ['import', 'charset', 'namespace', 'unknown-rule', 'page', 'scope']) {
    assert.throws(() => compileCss(`@${name} "external";`), /not supported/, name);
  }
  assert.throws(() => compileCss('button{color:red}@import "evil.css"'), /@import/);
  assert.throws(
    () => compileCss('button{color:red}', '../invalid'),
    /invalid customization target/,
  );
  assert.throws(() => compileCss('@media screen;'), /needs a block/);
});

await test('the actual CSS engine may accept properties newer than the grammar', () => {
  const original = globalThis.CSS;
  try {
    globalThis.CSS = {
      supports: (property, value) => property === 'future-property' && value === 'valid',
    };
    assert.equal(compileCss('button{future-property:valid}'), 'button{future-property:valid}');
    assert.throws(() => compileCss('button{future-property:bad}'), /future-property/);
    assert.throws(() => compileCss('button{color:banana}'), /color/);
  } finally {
    if (original === undefined) delete globalThis.CSS;
    else globalThis.CSS = original;
  }
});

await test('business identity tokens remain readable when safe and hash arbitrary values stably', () => {
  const uuid = 'be81e267-9477-4a6b-88a9-b04bde413496';
  for (const value of [uuid, 'button-1', '1.21.1', 'a'.repeat(48)]) {
    assert.equal(identityToken(value), value);
  }
  const values = [
    '中文世界 🌏',
    'UPPERCASE',
    'with spaces',
    '',
    '-starts-with-dash',
    'a'.repeat(49),
    'A'.repeat(160),
  ];
  const tokens = values.map((value) => identityToken(value));
  assert.equal(new Set(tokens).size, values.length);
  for (const [index, value] of values.entries()) {
    assert.match(tokens[index], /^id-[a-f0-9]{16}$/);
    assert.equal(identityToken(value), tokens[index], `stable identity for ${value}`);
  }
  assert.notEqual(identityToken('Player'), identityToken('PLAYER'));
  assert.notEqual(identityToken('中文'), identityToken('中 文'));
});

await test('instance target IDs are bounded and stable even for long component names', () => {
  const uuid = 'be81e267-9477-4a6b-88a9-b04bde413496';
  assert.equal(safeTargetIdentity(target, uuid), `${target}.${uuid}`);
  for (const base of [
    target,
    'component.'.padEnd(76, 'a'),
    'component.'.padEnd(96, 'a'),
    'component.'.padEnd(160, 'a'),
  ]) {
    for (const value of [uuid, '中文世界', 'A'.repeat(160), 'x'.repeat(48)]) {
      const id = safeTargetIdentity(base, value);
      assert.match(id, /^[a-z][a-z0-9.-]{0,95}$/);
      assert.equal(safeTargetIdentity(base, value), id);
    }
  }
  const base = 'component.'.padEnd(96, 'a');
  assert.notEqual(safeTargetIdentity(base, '世界一'), safeTargetIdentity(base, '世界二'));
  assert.notEqual(safeTargetIdentity(`${base}x`, 'same'), safeTargetIdentity(`${base}y`, 'same'));
  for (const invalid of ['', 'Component.Card', 'component/card', '../card']) {
    assert.throws(() => safeTargetIdentity(invalid, uuid), /Invalid UI customization target/);
  }
});

// Every generated stylesheet must still be parseable by the real CSS parser.
cssTree.parse(compileCss(':scope{border-radius:12px} button::after{content:"→"}', target), {
  onParseError(error) {
    throw error;
  },
});

await test('SVG camelCase target identities retain case, limits and selector scope', () => {
  for (const target of ['element.linearGradient', 'element.radialGradient', 'element.clipPath']) {
    const token = safeTargetIdentity(target, 'stable');
    assert.equal(token, target + '.stable');
    assert.ok(compileCss(':scope { opacity:.5 }', token).includes(token));
    assert.notEqual(token, safeTargetIdentity(target.toLowerCase(), 'stable'));
  }
  const long = 'element.' + 'CamelCase'.repeat(20);
  const one = safeTargetIdentity(long, '"<unicode>😀');
  assert.equal(one.length, 96);
  assert.match(one, /^[a-z][A-Za-z0-9.-]*$/);
  assert.notEqual(one, safeTargetIdentity(long + 'x', '"<unicode>😀'));
  for (const bad of ['element.linear Gradient', 'element.clipPath"', 'element.[' , 'Element.svg']) {
    assert.throws(() => safeTargetIdentity(bad, 'one'), /Invalid/);
    assert.throws(() => compileCss(':scope { color:red }', bad), /invalid/);
  }
});

const suiteSource = (sourcePath, text) =>
  prepareSuiteCss(text, { sourcePath, resolveAsset: (reference) => reference });

await test('suite rewrite collects later-source symbols and leaves prepared ASTs intact across renders', () => {
  const sources = [
    suiteSource('consumer.css', ':root{--motion:pulse;--face:My Font;animation-name:var(--motion);font-family:var(--face);content:var(--motion)}'),
    suiteSource('definitions.css', '@keyframes pulse{to{opacity:1}}@font-face{font-family:My Font;src:local("Arial")}@layer a.b{.x{color:red}}'),
  ];
  const before = sources.map(({ ast }) => cssTree.generate(ast));
  const rewrite = createSuiteStyleRewriter(sources, 'stages');
  const plain = rewrite.render(sources, false);
  assert.match(plain, /--motion:pulse;/);
  assert.match(plain, /--suite-stages-var-animation-name-2d-2d-6d-6f-74-69-6f-6e:suite-stages-animation-0;/);
  assert.match(plain, /--suite-stages-var-font-family-2d-2d-66-61-63-65:suite-stages-font-0;/);
  assert.match(plain, /content:var\(--motion\)/);
  assert.match(plain, /@layer suite-stages-layer-0\.suite-stages-layer-1/);
  const shadow = rewrite.render(sources, true);
  assert.match(shadow, /:host\{/);
  const bounded = rewrite.render(sources, false, '.target', '.owned');
  assert.ok(bounded.includes(':where(.owned)'));
  assert.equal(rewrite.render(sources, false), plain);
  assert.equal(rewrite.render(sources, true), shadow);
  assert.deepEqual(sources.map(({ ast }) => cssTree.generate(ast)), before);
});

await test('suite preflight follows all cascade candidates across files and cyclic variable chains', () => {
  const sources = [
    suiteSource('owned.css', '@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}.x{--whole:fade 1s linear;animation:var(--whole)}'),
    suiteSource('later.css', '.x{--a:var(--b);--b:var(--a);--whole:var(--a) 1s linear}'),
  ];
  const before = sources.map(({ ast }) => cssTree.generate(ast));
  assert.throws(() => createSuiteStyleRewriter(sources, 'stages'), /later\.css:\d+:\d+: Cannot safely namespace/);
  assert.deepEqual(sources.map(({ ast }) => cssTree.generate(ast)), before);
  assert.doesNotThrow(() => createSuiteStyleRewriter([
    suiteSource('safe.css', '@keyframes pulse{to{opacity:1}}.x{--a:var(--b,pulse);--b:var(--a);animation-name:var(--a)}'),
  ], 'safe'));
});

await test('inline candidate overrides and failed checks cannot leak into later rewrites or groups', () => {
  const source = suiteSource('stored.css', '@keyframes linear{to{opacity:1}}@keyframes fade{to{opacity:1}}.x{--whole:fade 1s linear;animation:var(--whole)}');
  const rewrite = createSuiteStyleRewriter([source], 'one');
  const plain = rewrite.render([source], false);
  const input = { '--whole': 'var(--timing) 1s linear', animation: 'var(--whole)' };
  assert.throws(() => rewrite.inline(input), /<inline-style>:1:1: Cannot safely namespace/);
  assert.deepEqual(input, { '--whole': 'var(--timing) 1s linear', animation: 'var(--whole)' });
  assert.doesNotThrow(() => rewrite.inline({ animation: 'var(--whole)' }));
  assert.equal(rewrite.render([source], false), plain);
  const other = createSuiteStyleRewriter([source], 'two');
  assert.equal(rewrite.inline({ animationName: 'fade' }).animationName, 'suite-one-animation-1');
  assert.equal(other.inline({ animationName: 'fade' }).animationName, 'suite-two-animation-1');
});

await test('registered constraints follow chained fallback candidates and preserve typed branch rejection', () => {
  const prefix = '@property --Motion{syntax:"pulse | <color>";inherits:false;initial-value:pulse}@keyframes pulse{to{opacity:1}}';
  const safe = suiteSource('registered.css', prefix + '.x{--a:var(--b,pulse);--b:red;--Motion:var(--a);animation-name:var(--Motion)}');
  const rewrite = createSuiteStyleRewriter([safe], 'registered');
  assert.doesNotThrow(() => rewrite.inline({ animationName: 'var(--Motion)' }));
  assert.throws(() => rewrite.inline({ '--b': 'var(--missing) pulse', animationName: 'var(--Motion)' }), /Cannot preserve @property/);
  assert.doesNotThrow(() => rewrite.inline({ animationName: 'var(--Motion)' }));
  const computed = suiteSource('computed.css', '@property --Motion{syntax:"<color> | <custom-ident>";inherits:false;initial-value:red}@keyframes red{to{opacity:1}}.x{animation-name:var(--Motion)}');
  assert.throws(() => createSuiteStyleRewriter([computed], 'computed'), /Cannot preserve @property/);
});
