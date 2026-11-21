import { listOwners, listUiDefinitions } from '../customization/ownership';

import i18n from '../i18n';
import { turn, wait, assert, equal } from './suite-builtins-support';
import type { BuiltinCaseContext } from './suite-builtins-support';
export async function checkCustomRouteRegistry(context: BuiltinCaseContext) {
  const { f, c, a, check } = context;
  await check('custom_help_navigation_startup_registry', async () => {
    c.actions.createFile('Help.tsx', 'tsx');
    c.actions.patchFile(
      'Help.tsx',
      `export default()=> <section data-ui-site="task12-help"><h2 data-ui-site="task12-help-title">Custom help</h2></section>`,
    );
    const manifest = c.getSnapshot().draft!.manifest;
    c.actions.patchManifest({
      views: { ...manifest.views, 'page.custom.help': 'Help.tsx' },
      routes: [
        ...manifest.routes,
        {
          id: 'custom.help',
          entry: 'Help.tsx',
          title: 'Custom help',
          description: 'Suite help',
          navigation: true,
          startupSelectable: true,
          order: 99,
          icon: 'CircleHelp',
        },
      ],
    });
    assert(await c.actions.preview(), 'custom route prepared');
    await turn();
    const route = f.snapshot.navigation.routes.find(
      (r) => r.id === 'custom.help',
    );
    assert(
      route?.navigation && route.startupSelectable,
      'same navigation/startup registry',
    );
    a.settings.setStartupRoute('custom.help');
    a.navigation.navigate('custom.help');
    await turn();
    equal(
      f.snapshot.settings.draft?.personalization.startup_page,
      'custom.help',
      'startup draft',
    );
    assert(
      document.body.textContent?.includes('Custom help'),
      'custom route rendered',
    );
  });
}

export async function checkSinglePresetOwner(context: BuiltinCaseContext) {
  const { a, check } = context;
  await check('preset_dialog_has_one_source_owner', async () => {
    a.settings.setTab('appearance');
    a.navigation.navigate('settings');
    a.presets.openDialog({ kind: 'save' });
    await turn();
    equal(
      document.querySelectorAll('[role="dialog"]').length,
      1,
      'one preset dialog mounted by shared page composition',
    );
    a.presets.cancelDialog();
    a.navigation.navigate('custom.help');
    await turn();
  });
}

export async function checkEditorSourcePorts(context: BuiltinCaseContext) {
  const { c, a, check } = context;
  await check(
    'editor_sources_shadow_assets_select_and_notifications',
    async () => {
      c.actions.open();
      await wait(
        () =>
          !!document
            .getElementById('paradox-suite-editor')
            ?.shadowRoot?.querySelector(
              `[role="dialog"][aria-label="${i18n.t('uiSuiteEditor.title')}"]`,
            ),
      );
      const shadow = document.getElementById(
        'paradox-suite-editor',
      )!.shadowRoot!;
      assert(
        shadow.querySelector(
          `[aria-label="${i18n.t('uiSuiteEditor.source')}"]`,
        ),
        'actual source editor',
      );
      assert(
        shadow.querySelector(
          `[role="combobox"][aria-label="${i18n.t('uiSuiteEditor.suite')}"]`,
        ),
        'foundation Select',
      );
      assert(shadow.querySelector('.suite-assets'), 'actual asset manager');
      assert(
        shadow.querySelector('.ui-notice-viewport'),
        'same editor notice host',
      );
      const notice = a.notifications.publish('info', 'Task12 dual root lease');
      await turn();
      assert(
        [...document.querySelectorAll('.ui-notice')].some((n) =>
          n.textContent?.includes('Task12 dual root lease'),
        ),
        'main notices',
      );
      assert(
        shadow.textContent?.includes('Task12 dual root lease'),
        'editor notices',
      );
      const secondNotice = a.notifications.publish(
        'warning',
        'Task4 distinct notice identity',
      );
      await turn();
      const noticeSource =
        c.getSnapshot().draft!.manifest.views['host.notifications'];
      for (const identity of [notice, secondNotice]) {
        for (const renderRoot of ['launcher.main', 'launcher.editor']) {
          assert(
            listOwners().some(
              (owner) =>
                owner.metadata.sourcePath === noticeSource &&
                owner.locator.renderRoot === renderRoot &&
                owner.locator.business.some(
                  (item) =>
                    item.namespace === 'notice' && item.value === identity,
                ),
            ),
            'each source notice has its own business identity in each viewport',
          );
        }
      }
      a.notifications.dismiss(secondNotice);
      a.notifications.dismiss(notice);
      c.actions.close();
      await turn();
      assert(!shadow.querySelector('.suite-editor'), 'source editor closes');
    },
  );
}

export async function checkSourceProvenance(context: BuiltinCaseContext) {
  const { builtin, check } = context;
  await check('actual_source_and_registry_provenance', () => {
    assert(
      listUiDefinitions().some(
        (d) => d.sourcePath === builtin.manifest.views['layout.shell'],
      ),
      'actual source path',
    );
    assert(
      listOwners().some((o) => o.locator.renderRoot === 'launcher.main'),
      'same runtime owners',
    );
  });
}
