import { getBuiltinBundle, getPreparedBuiltin } from '../ui-suite/builtins';
import { bundleDigest } from '../ui-suite/bundle';

import { desktop, turn, assert, equal } from './suite-builtins-support';
import type { BuiltinCaseContext } from './suite-builtins-support';
export async function checkBuiltinProtocol(context: BuiltinCaseContext) {
  const { id, builtin, check } = context;
  await check('modern_immersive_same_protocol', async () => {
    const other = await getBuiltinBundle(
      id === 'modern' ? 'immersive' : 'modern',
    );
    equal(
      other.manifest.api_version,
      builtin.manifest.api_version,
      'one API protocol',
    );
    const p = await getPreparedBuiltin(id);
    equal(
      p.digest,
      await bundleDigest(builtin),
      'prepared exact real builtin bytes',
    );
    assert(
      p.views.has('tool.editor') && p.views.has('host.notifications'),
      'complete views',
    );
    p.dispose();
  });
}

export async function checkSuiteSelectionOwners(context: BuiltinCaseContext) {
  const { f, c, a, id, theme, check } = context;
  await check('suite_selection_does_not_save_settings', async () => {
    a.settings.patch('memory_mb', 6144);
    a.accounts.patchClientId('unfinished-client');
    a.java.patchDownloadMajor('21');
    a.content.patchSearch({ query: 'unfinished-query' });
    await turn();
    const commands = desktop().calls.length,
      stableActions = f.actions;
    assert(
      await c.actions.selectSuite('builtin.' + id),
      'builtin selection ACK',
    );
    await turn();
    equal(
      f.snapshot.settings.draft?.memory_mb,
      6144,
      'settings draft retained',
    );
    equal(
      f.snapshot.accounts.clientIdDraft,
      'unfinished-client',
      'account draft',
    );
    equal(f.snapshot.java.downloadMajorDraft, '21', 'Java draft');
    equal(f.snapshot.content.query, 'unfinished-query', 'content draft');
    assert(f.actions === stableActions, 'stable actions');
    assert(
      !desktop()
        .calls.slice(commands)
        .some((x) =>
          [
            'save_config',
            'get_config',
            'account_state',
            'account_recovery',
            'download_tasks',
            'plugin:event|listen',
          ].includes(x.command),
        ),
      'no settings write/read/new subscription',
    );
    a.settings.patchAppearance('theme', theme);
    await turn();
    assert(
      document.querySelector('.app-shell')?.classList.contains(id + '-shell'),
      'library selects builtin shell',
    );
    const old = c.getSnapshot().selectedSuiteId;
    a.settings.patchAppearance(
      'interface_style',
      id === 'modern' ? 'immersive' : 'modern',
    );
    await turn();
    equal(
      c.getSnapshot().selectedSuiteId,
      old,
      'appearance tokens do not select structure',
    );
  });
}

export async function checkReadonlyCatalog(context: BuiltinCaseContext) {
  const { c, check } = context;
  await check('public_catalog_ack_and_readonly', () => {
    const rows = c.getSnapshot().suites;
    assert(
      rows.filter((r) => r.builtin).length === 2 &&
        rows.some((r) => !r.builtin && r.name === 'Task12 copy'),
      'genuine builtins and ACKed user',
    );
    assert(
      Object.isFrozen(rows) && rows.every(Object.isFrozen),
      'detached readonly catalog',
    );
  });
}
