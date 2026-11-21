import { normalizeDraftBundle, materializeSuite } from '../ui-suite/bundle';
import { encodeSuiteArchive, decodeSuiteArchive } from '../ui-suite/archive';

import type { UiSuiteBundle } from '../ui-suite/model';

import { turn, wait, assert, equal } from './suite-builtins-support';
import type { BuiltinCaseContext } from './suite-builtins-support';
export async function checkBuiltinCopyExport(context: BuiltinCaseContext) {
  const { c, id, builtin, exports, check } = context;
  await check('builtin_source_equals_copied_export', async () => {
    await c.actions.copyBuiltin(id, 'Task12 copy');
    equal(
      c.getSnapshot().draft?.files,
      builtin.files,
      'exact complete builtin copy',
    );
    const before = exports.length;
    await c.actions.exportDraft();
    assert(exports.length === before + 1, 'actual editor export sink');
    const reimported = await decodeSuiteArchive(
      new Uint8Array(await exports.at(-1)!.arrayBuffer()),
    );
    equal(
      reimported.files,
      builtin.files,
      'actual exported ZIP reimport exact',
    );
    const archive = await encodeSuiteArchive(
      await normalizeDraftBundle(
        structuredClone(c.getSnapshot().draft!) as UiSuiteBundle,
      ),
    );
    equal(
      (await decodeSuiteArchive(archive)).files,
      reimported.files,
      'self-contained materialization',
    );
    assert(await c.actions.save(), 'copied source commit');
    const record = c
      .getLibrary()!
      .suites.find((r) => r.instance_id === c.getSnapshot().selectedSuiteId)!;
    equal(
      materializeSuite(record).files,
      builtin.files,
      'fixed parent materialization',
    );
    equal(
      record.parent_snapshot?.bundle.files[
        builtin.manifest.views['layout.shell']
      ],
      builtin.files[builtin.manifest.views['layout.shell']],
      'actual source bytes are fixed in the parent snapshot',
    );
  });
}

export async function checkCustomArtwork(context: BuiltinCaseContext) {
  const { c, a, builtin, exports, check } = context;
  await check(
    'copied_default_can_add_preview_save_and_export_artwork',
    async () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="#6387f5" d="M0 0h2v2H0z"/></svg>';
      assert(
        await c.actions.addAsset(
          new File([svg], 'user-added.svg', { type: 'image/svg+xml' }),
        ),
        'public artwork importer accepts a user image',
      );
      const path = c
        .getSnapshot()
        .files.find((file) => file.kind === 'asset')!.path;
      const home = builtin.manifest.views['page.home'];
      const relative = '../' + path;
      c.actions.patchFile(
        home,
        `import image from '${relative}';export default function Home(){return <img data-ui-site="task1-custom-artwork" className="task1-custom-artwork" src={image} alt="User supplied artwork"/>}`,
      );
      a.navigation.navigate('home');
      assert(
        await c.actions.preview(),
        'copied source with a user asset previews',
      );
      await turn();
      const image = document.querySelector<HTMLImageElement>(
        '.task1-custom-artwork',
      );
      assert(
        image && image.src.startsWith('blob:'),
        'custom source resolves its local artwork URL',
      );
      await wait(() => !!image?.complete && !!image.naturalWidth);
      assert(
        await c.actions.save(),
        'user artwork persists with copied source',
      );
      const record = c
        .getLibrary()!
        .suites.find(
          (row) => row.instance_id === c.getSnapshot().selectedSuiteId,
        )!;
      equal(
        materializeSuite(record).files[path],
        c.getSnapshot().draft!.files[path],
        'saved user artwork bytes',
      );
      await c.actions.exportDraft();
      const exported = await decodeSuiteArchive(
        new Uint8Array(await exports.at(-1)!.arrayBuffer()),
      );
      equal(
        exported.files[path],
        c.getSnapshot().draft!.files[path],
        'archive keeps user artwork',
      );
    },
  );
}

export async function checkCustomShellHome(context: BuiltinCaseContext) {
  const { f, c, a, builtin, check } = context;
  await check('changed_shell_home_keep_business', async () => {
    const shell = builtin.manifest.views['layout.shell'],
      home = builtin.manifest.views['page.home'],
      file = c.getSnapshot().draft!.files[shell];
    if (file.encoding === 'utf8')
      c.actions.patchFile(
        shell,
        file.text.replace(
          /(onPointerDownCapture=\{\(\) => setKeyboard\(false\)\}>)/,
          '$1<h2 data-ui-site="task12-custom-shell">My custom shell</h2>',
        ),
      );
    c.actions.patchFile(
      home,
      `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';export default function Home(){const s=useLauncherSnapshot(),a=useLauncherActions();return <section data-ui-site="task12-home"><h2 data-ui-site="task12-home-title">My custom home</h2><input data-ui-site="task12-input" aria-label="Custom home input" defaultValue=""/><button data-ui-site="task12-content" onClick={()=>a.navigation.navigate('content')}>Open shared content</button><p data-ui-site="task12-memory">{s.settings.draft?.memory_mb}</p></section>}`,
    );
    a.navigation.navigate('home');
    assert(await c.actions.preview(), 'actual Shell/Home edits prepare');
    await turn();
    assert(
      document.body.textContent?.includes('My custom shell') &&
        document.body.textContent?.includes('My custom home'),
      'edited sources render',
    );
    equal(f.snapshot.settings.draft?.memory_mb, 6144, 'shared draft retained');
  });
}

export async function checkCssOnlyIdentity(context: BuiltinCaseContext) {
  const { c, builtin, check } = context;
  await check('css_only_keeps_input_identity', async () => {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Custom home input"]',
    )!;
    input.value = 'unfinished-local-input';
    input.focus();
    const homePath = builtin.manifest.views['page.home'],
      homeFile = builtin.files[homePath];
    assert(homeFile?.encoding === 'utf8', 'current builtin Home is editable');
    const cssImport =
      homeFile.encoding === 'utf8'
        ? [...homeFile.text.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)][0]?.[1]
        : null;
    assert(cssImport, 'current Home imports its own stylesheet');
    const component = c
        .getActivation()!
        .primary.prepared.views.get('layout.shell'),
      style = new URL(
        cssImport!,
        'https://fixture.invalid/' + homePath,
      ).pathname.slice(1),
      file = c.getSnapshot().draft!.files[style];
    if (file.encoding === 'utf8')
      c.actions.patchFile(
        style,
        file.text +
          '\n.app-shell input[aria-label="Custom home input"]{color:rgb(20,80,150)}',
      );
    assert(await c.actions.preview(), 'CSS-only compilation');
    await turn();
    assert(
      input === document.querySelector('[aria-label="Custom home input"]'),
      'same local DOM',
    );
    equal(input.value, 'unfinished-local-input', 'text retained');
    assert(
      c.getActivation()!.primary.prepared.views.get('layout.shell') ===
        component,
      'same code graph Component',
    );
    equal(
      getComputedStyle(input).color,
      'rgb(20, 80, 150)',
      'current computed CSS',
    );
  });
}
