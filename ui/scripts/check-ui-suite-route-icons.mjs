import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadApp, suiteRenderHost } from './lib/hook-test-host.mjs';
import { bundle, bytes, library, record } from './lib/suite-test-fixtures.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const lucide = require('lucide-react');
const { renderToStaticMarkup } = require('react-dom/server');
const rendererSources = ['lib/navigation.ts', 'ui-suite/builtins/common/lib/navigation.ts'];
const navigationSource = new URL(
  '../src/ui-suite/builtins/common/lib/navigation.ts',
  import.meta.url,
);
function withIcon(icon) {
  const value = bundle();
  value.manifest.routes[0].icon = icon;
  return value;
}
function originalDigest(value, canonicalSuiteJson) {
  const u32 = (number) => {
    const data = Buffer.alloc(4);
    data.writeUInt32BE(number);
    return data;
  };
  const frame = (data) => [u32(data.length), data];
  const paths = Object.keys(value.files).sort();
  return createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('PARADOX-UI-BUNDLE\0\x01'),
        ...frame(Buffer.from(canonicalSuiteJson(value.manifest))),
        u32(paths.length),
        ...paths.flatMap((path) => [
          ...frame(Buffer.from(path)),
          ...frame(bytes(value.files[path])),
        ]),
      ]),
    )
    .digest('hex');
}

await test('route metadata validation does not load or inspect Lucide', () => {
  let reads = 0;
  const app = loadApp(
    new Map([
      [
        'lucide-react',
        new Proxy(
          {},
          {
            get() {
              reads++;
              throw new Error('UI icon dependency accessed by metadata');
            },
          },
        ),
      ],
    ]),
  );
  const { validateRouteRegistry } = app('ui-suite/routes.ts');
  const input = withIcon('suite:custom-icon').manifest.routes;
  assert.equal(validateRouteRegistry(input)[0].icon, 'suite:custom-icon');
  assert.equal(reads, 0);
});

await test('removed Lucide names and custom identifiers survive bundle/library validation unchanged', async () => {
  const app = loadApp();
  const api = app('ui-suite/bundle.ts');
  const { canonicalSuiteJson } = app('ui-suite/canonical.ts');
  for (const icon of [
    'Github',
    'Chrome',
    'suite:星',
    'made-up-icon',
    'Icon',
    ' Home ',
    '\u0080',
    '😀'.repeat(128),
  ]) {
    const input = withIcon(icon);
    const normalized = await api.normalizeDraftBundle(input);
    const validated = await api.validateSuiteBundle(input);
    const stored = await api.validateSuiteLibrary(library([record(input)]));
    const parsed = api.parseSuiteLibrary(JSON.parse(JSON.stringify(stored)));
    const reloaded = api.materializeSuite(parsed.suites[0]);
    for (const value of [normalized, validated, reloaded]) {
      assert.equal(value.manifest.schema_version, 1);
      assert.equal(value.manifest.routes[0].icon, icon);
      assert.equal(await api.bundleDigest(value), originalDigest(input, canonicalSuiteJson));
    }
    assert.notEqual(await api.bundleDigest(input), await api.bundleDigest(withIcon(null)));
  }
});

await test('icon identifiers reject empty/oversized text, nonstrings and ASCII controls', async () => {
  const app = loadApp();
  const api = app('ui-suite/bundle.ts');
  const { validateRouteRegistry } = app('ui-suite/routes.ts');
  const invalid = [
    '',
    'x'.repeat(129),
    '😀'.repeat(129),
    '\ud800',
    '\udc00',
    1,
    false,
    {},
    [],
    ...Array.from({ length: 32 }, (_, i) => `suite:${String.fromCharCode(i)}`),
    'suite:\u007f',
  ];
  for (const icon of invalid) {
    const input = withIcon(icon);
    assert.throws(() => validateRouteRegistry(input.manifest.routes), String(icon));
    assert.throws(() => api.parseSuiteManifest(input.manifest), String(icon));
    assert.throws(() => api.parseSuiteLibrary(library([record(input)])), String(icon));
    await assert.rejects(api.normalizeDraftBundle(input), String(icon));
  }
  assert.equal(api.parseSuiteBundle(withIcon(null)).manifest.routes[0].icon, null);
});

await test('default UI resolvers display concrete component aliases from the installed dependency', () => {
  const app = loadApp();
  for (const source of rendererSources) {
    const { routeIcon } = app(source);
    for (const name of ['Home', 'HomeIcon', 'LucideHome']) {
      assert.equal(routeIcon(name), lucide.Home, `${source}: ${name}`);
      assert.match(renderToStaticMarkup(React.createElement(routeIcon(name))), /<svg\b/);
    }
    for (const name of [
      null,
      'Github',
      'Chrome',
      'suite:custom-icon',
      'createLucideIcon',
      'Icon',
      'icons',
      'default',
      'toString',
      '__proto__',
    ]) {
      assert.equal(routeIcon(name), null, `${source}: ${name}`);
    }
  }
});

await test('default UI never executes helper or arbitrary module exports as icon components', () => {
  let executions = 0;
  const helper = () => {
    executions++;
    throw new Error('Non-icon export rendered');
  };
  const fakeLucide = {
    ...lucide,
    icons: { Home: lucide.Home },
    createLucideIcon: helper,
    Icon: helper,
    ArbitraryExport: helper,
  };
  const app = loadApp(new Map([['lucide-react', fakeLucide]]));
  for (const source of rendererSources) {
    const { routeIcon } = app(source);
    for (const name of ['createLucideIcon', 'Icon', 'ArbitraryExport']) {
      const Component = routeIcon(name);
      const markup = renderToStaticMarkup(Component ? React.createElement(Component) : null);
      assert.equal(markup, '');
    }
    assert.equal(routeIcon('HomeIcon'), lucide.Home);
  }
  assert.equal(executions, 0);
});

await test('compiled UI source owns custom icons and safely omits unknown dependency exports', async () => {
  const host = suiteRenderHost();
  try {
    const current = bundle({
      'navigation.ts': { encoding: 'utf8', text: readFileSync(navigationSource, 'utf8') },
      'Home.tsx': {
        encoding: 'utf8',
        text: `
        import { routeIcon } from './navigation';
        export default function Page({ props }) {
          if (props.icon === 'suite:星') return <svg data-suite-icon="star"/>;
          const Icon = routeIcon(props.icon);
          return Icon ? <Icon/> : <span data-icon="omitted"/>;
        }
      `,
      },
    });
    current.manifest.routes[0].icon = 'Github';
    const prepared = await host.compile(current);
    assert.equal(prepared.routes[0].icon, 'Github');
    host.activate(prepared, await host.compile(bundle()));
    const { UiView } = host.app('ui-suite/View.tsx');
    const render = (icon) =>
      host.render(React.createElement(UiView, { id: 'page.home', props: { icon } }));
    assert.match(render('suite:星'), /data-suite-icon="star"/);
    for (const name of ['Home', 'HomeIcon', 'LucideHome']) assert.match(render(name), /<svg\b/);
    for (const name of ['Github', 'Chrome', 'createLucideIcon', 'Icon', 'suite:missing']) {
      assert.match(render(name), /data-icon="omitted"/);
      assert.doesNotMatch(render(name), /<svg\b/);
    }
  } finally {
    host.dispose();
  }
});
