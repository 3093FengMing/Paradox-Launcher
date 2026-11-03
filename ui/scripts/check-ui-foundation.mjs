import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadApp, suiteRenderHost, uiRoot } from './lib/hook-test-host.mjs';
import { bundle } from './lib/suite-test-fixtures.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const app = loadApp(new Map([[resolve(uiRoot, 'src/ui-foundation/foundation.css'), {}]]));
const foundation = app('ui-foundation/index.ts');
const { Field, Select, UiFoundationProvider } = foundation;
const el = React.createElement;
const attr = (markup, name) => markup.match(new RegExp(`${name}="([^"]*)"`))?.[1];

test('Field retains label association for an actual custom JSX-runtime input', () => {
  const realApp = loadApp(new Map(), { isolateCustomization: false });
  const { Field: RuntimeField } = realApp('ui-foundation/index.ts');
  const { jsx } = realApp('customization/jsx-runtime.tsx');
  const markup = renderToStaticMarkup(
    el(
      RuntimeField,
      { label: 'Runtime name', description: 'Runtime help' },
      jsx('input', { 'data-ui-node': 'node.foundation-test.input' }),
    ),
  );
  const label = markup.match(/<span[^>]*id="([^"]*)"[^>]*>Runtime name<\/span>/)?.[1];
  const description = markup.match(/<small[^>]*id="([^"]*)"[^>]*>Runtime help<\/small>/)?.[1];
  assert.ok(label);
  assert.equal(attr(markup, 'aria-labelledby'), label);
  assert.equal(attr(markup, 'aria-describedby'), description);
});

test('Field associates native and runtime-wrapped controls while preserving explicit aria attributes', () => {
  function WrappedInput(props) {
    return el('input', props);
  }
  WrappedInput.uiTag = 'input';
  for (const tag of ['input', 'select', 'textarea', WrappedInput]) {
    const markup = renderToStaticMarkup(el(Field, { label: 'Name', description: 'Help' }, el(tag)));
    const label = markup.match(/<span[^>]*id="([^"]*)"[^>]*>Name<\/span>/)?.[1];
    const description = markup.match(/<small[^>]*id="([^"]*)"[^>]*>Help<\/small>/)?.[1];
    assert.ok(label);
    assert.ok(description);
    assert.equal(attr(markup, 'aria-labelledby'), label);
    assert.equal(attr(markup, 'aria-describedby'), description);
    const explicit = renderToStaticMarkup(
      el(
        Field,
        { label: 'Name', description: 'Help' },
        el(tag, {
          'aria-label': 'Custom',
          'aria-labelledby': 'own-label',
          'aria-describedby': 'own-help',
        }),
      ),
    );
    assert.equal(attr(explicit, 'aria-labelledby'), 'own-label');
    assert.equal(attr(explicit, 'aria-describedby'), 'own-help');
    assert.equal(attr(explicit, 'aria-label'), 'Custom');
  }
});

test('Field context reaches nested Select and missing values display placeholder without changing value', () => {
  const markup = renderToStaticMarkup(
    el(
      Field,
      { label: 'Choice', description: 'Help' },
      el(
        'div',
        null,
        el(Select, {
          value: 'missing',
          options: [
            { value: '', label: 'Empty' },
            { value: 'b', label: 'Beta' },
          ],
          onValueChange() {
            assert.fail('Rendering changed value');
          },
          placeholder: 'Choose',
          name: 'choice',
        }),
      ),
    ),
  );
  const label = markup.match(/<span[^>]*id="([^"]*)"[^>]*>Choice<\/span>/)?.[1];
  const description = markup.match(/<small[^>]*id="([^"]*)"[^>]*>Help<\/small>/)?.[1];
  const trigger = markup.match(/<button[^>]*>/)?.[0];
  assert.equal(attr(trigger, 'aria-labelledby'), label);
  assert.equal(attr(trigger, 'aria-describedby'), description);
  assert.match(markup, />Choose<\/span>/);
  assert.match(markup, /value="missing"/);
  const empty = renderToStaticMarkup(
    el(Select, {
      value: '',
      options: [{ value: '', label: 'Empty' }],
      onValueChange() {},
      placeholder: 'Choose',
    }),
  );
  assert.match(empty, />Empty<\/span>/);
  const explicit = renderToStaticMarkup(
    el(
      Field,
      { label: 'Choice', description: 'Help' },
      el(Select, {
        value: '',
        options: [],
        onValueChange() {},
        'aria-label': 'Own name',
        'aria-labelledby': 'own-label',
        'aria-describedby': 'own-help',
      }),
    ),
  );
  const ownTrigger = explicit.match(/<button[^>]*>/)?.[0];
  assert.equal(attr(ownTrigger, 'aria-label'), 'Own name');
  assert.equal(attr(ownTrigger, 'aria-labelledby'), 'own-label');
  assert.equal(attr(ownTrigger, 'aria-describedby'), 'own-help');
});

test('public controls use environment views and protected mode uses trusted originals', () => {
  const seen = [];
  const environment = {
    theme: 'light',
    variables: {},
    portalContainer: null,
    protectedMode: false,
    renderView(id, props, Original) {
      seen.push(id);
      return el('div', { 'data-replaced': id }, el(Original, props));
    },
  };
  const controls = [
    el(foundation.Panel, null, 'Panel'),
    el(foundation.Badge, null, 'Badge'),
    el(foundation.Toggle, { checked: true, onChange() {}, label: 'Toggle' }),
    el(Field, { label: 'Field' }, el('input')),
    el(Select, { value: '', options: [], onValueChange() {} }),
  ].map((control, key) => React.cloneElement(control, { key }));
  renderToStaticMarkup(el(UiFoundationProvider, { value: environment }, controls));
  assert.deepEqual(seen, [
    'control.panel',
    'control.badge',
    'control.toggle',
    'control.field',
    'control.select',
  ]);
  seen.length = 0;
  const markup = renderToStaticMarkup(
    el(UiFoundationProvider, { value: { ...environment, protectedMode: true } }, controls),
  );
  assert.deepEqual(seen, []);
  assert.match(markup, /class="panel /);
  assert.match(markup, /role="combobox"/);
});

test('protected Field and nested runtime input bypass current suite overrides', async () => {
  const host = suiteRenderHost();
  const current = bundle({
    'Field.tsx': { encoding: 'utf8', text: 'export default function Field({Original,props,children}){return <section data-replaced-field="true"><Original {...props}>{children}</Original></section>}' },
    'Input.tsx': { encoding: 'utf8', text: 'export default function Input({Original,props}){return <Original {...props} data-replaced-input="true"/>}' },
  });
  current.manifest.overrides = [
    { selector: { kind: 'type', target: 'control.field' }, enabled: true, entry: 'Field.tsx', stylesheet: null },
    { selector: { kind: 'type', target: 'element.input' }, enabled: true, entry: 'Input.tsx', stylesheet: null },
  ];
  try {
    host.activate(await host.compile(current), await host.compile(bundle()));
    const real = host.app('ui-foundation/index.ts');
    const { jsx } = host.app('customization/jsx-runtime.tsx');
    const field = el(real.Field, { label: 'Trusted', description: 'Retained help' },
      jsx('input', { defaultValue: 'retained draft', 'aria-label': 'Original input' }));
    const normal = host.render(field);
    assert.match(normal, /data-replaced-field="true"/);
    assert.match(normal, /data-replaced-input="true"/);
    assert.match(normal, /Trusted/);assert.match(normal, /value="retained draft"/);
    const markup = host.render(field, true);
    assert.doesNotMatch(markup, /data-replaced-field|data-replaced-input/);
    assert.match(markup, /class="field"/);assert.match(markup, /<input/);
    assert.match(markup, /Trusted/);assert.match(markup, /Retained help/);
    assert.match(markup, /value="retained draft"/);assert.match(markup, /aria-label="Original input"/);
  } finally { host.dispose(); }
});
