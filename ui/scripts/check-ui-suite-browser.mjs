import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
import ts from 'typescript';
import { loadApp, initialConfig } from './lib/hook-test-host.mjs';
const out = resolve('.test-data/task-8-compiler', process.env.PARADOX_SUITE_EVIDENCE || 'dev');
await mkdir(out, { recursive: true });
const fixture = await createBrowserFixture({ desktopBoundary: true });
const report = {
  csp: fixture.contentSecurityPolicy,
  errors: fixture.observedPageErrors,
  sourceRequests: fixture.observedSourceModuleRequests,
  cspViolations: fixture.observedCspViolations,
  rows: [],
};
async function runBuiltinNoticeLeases(page){
  await page.clock.install();
  const main=()=>page.locator('body > .ui-notice-viewport .ui-notice');
  const editor=()=>page.locator('#paradox-suite-editor .ui-notice');
  const publish=async(message)=>{await page.evaluate(message=>{window.suiteBuiltinsFixture.controller.actions.open();window.suiteBuiltinsFixture.actions.notifications.publish('info',message)},message);await main().filter({hasText:message}).waitFor();await editor().filter({hasText:message}).waitFor()};
  await publish('Task12 pointer leases');
  await main().dispatchEvent('pointerover',{bubbles:true});await editor().dispatchEvent('pointerover',{bubbles:true});await main().dispatchEvent('pointerout',{bubbles:true});
  await page.clock.runFor(60000);assert.equal(await main().count(),1);assert.equal(await editor().count(),1);
  await editor().getByRole('button').focus();await page.evaluate(()=>window.suiteBuiltinsFixture.controller.actions.close());await page.clock.runFor(3100);assert.equal(await main().count(),0);
  await publish('Task12 focus leases');
  // The editor modal hides background notices from the accessibility tree; synthetic events still exercise their leases.
  await main().getByRole('button',{includeHidden:true}).dispatchEvent('focusin',{bubbles:true});await editor().getByRole('button').dispatchEvent('focusin',{bubbles:true});await main().getByRole('button',{includeHidden:true}).dispatchEvent('focusout',{bubbles:true});
  await page.clock.runFor(60000);assert.equal(await main().count(),1);assert.equal(await editor().count(),1);
  await page.evaluate(()=>window.suiteBuiltinsFixture.controller.actions.close());await page.clock.runFor(3100);assert.equal(await main().count(),0);
  await publish('Task12 replacement leases');await main().dispatchEvent('pointerover',{bubbles:true});await editor().dispatchEvent('pointerover',{bubbles:true});
  assert.equal(await page.evaluate(async()=>{const c=window.suiteBuiltinsFixture.controller,path=c.getSnapshot().draft.manifest.views['host.notifications'],file=c.getSnapshot().draft.files[path];c.actions.patchFile(path,file.text+'\n// Task12 changed notification source');return c.actions.preview()}),true);
  await page.clock.runFor(3100);assert.equal(await main().count(),0);assert.equal(await editor().count(),0);
  await page.evaluate(()=>{window.suiteBuiltinsFixture.controller.actions.close();window.suiteBuiltinsFixture.controller.actions.open()});await page.clock.runFor(100);assert.equal(await editor().count(),0);await page.evaluate(()=>window.suiteBuiltinsFixture.controller.actions.close());
  return ['same_pointer_lease_survives_other_root_leave','pointer_focus_cleanup_on_editor_unmount','same_focus_lease_survives_other_root_blur','notification_source_replacement_releases_both_old_views','expired_notice_never_revives'];
}
async function runBuiltinSourceStylesAndEditor(page, id, theme) {
  await page.evaluate(async ({id,theme}) => {
    const f=window.suiteBuiltinsFixture;
    assertSelection(await f.controller.actions.selectSuite('builtin.'+id));
    f.actions.settings.patchAppearance('theme',theme);
    if(!await f.actions.settings.save())throw new Error('Actual settings theme commit failed');
    f.actions.navigation.navigate('home');
    function assertSelection(value){if(!value)throw new Error('Original builtin selection failed');}
  }, {id,theme});
  await page.locator('.'+id+'-shell[data-theme="'+theme+'"]').waitFor();
  assert.equal(await page.evaluate(() => window.foundationDesktop.config.settings.appearance.theme), theme, 'native config stores committed theme');
  assert.equal(await page.evaluate(() => window.suiteBuiltinsFixture.snapshot.appearance.theme), theme, 'public owner resolves committed theme');
  const computed=await page.locator('.app-shell').evaluate(e=>{
    const before=getComputedStyle(e,'::before'),banner=document.querySelector('.banner-illustration');
    const appearance=window.suiteBuiltinsFixture.snapshot.appearance;
    return {theme:e.getAttribute('data-theme'),classes:e.className,backgroundArt:appearance.value?.background_art,hasCustomBackground:appearance.background?.startsWith('data:image/png;base64,')??false,shellBackground:getComputedStyle(e).backgroundImage,before:{content:before.content,background:before.backgroundImage,color:before.backgroundColor,position:before.position},windowBackground:getComputedStyle(document.querySelector('.window-bar')).backgroundImage,heading:document.querySelector('.page-heading') ? getComputedStyle(document.querySelector('.page-heading')).display : null,banner:banner?getComputedStyle(banner).backgroundImage:null};
  });
  assert.equal(computed.theme,theme,'actual saved source theme');
  assert.equal(computed.shellBackground,'none','default shell has a solid surface');
  assert.equal(computed.before.background,'none','default shell has no image layer');
  assert.equal(computed.windowBackground,'none','default titlebar has a solid surface');
  assert.equal(computed.banner,null,'default artwork node was removed');
  assert.ok(await page.locator('.home-page, .immersive-home').isVisible(), 'current default landing is rendered');
  await page.screenshot({path:resolve(out,`original-${id}-${theme}-${page.viewportSize().width}.png`)});
  const savedImage='data:image/png;base64,'+(await readFile(new URL('./fixtures/ui-suite/pixel.png',import.meta.url))).toString('base64');
  await page.evaluate(async image=>{
    const f=window.suiteBuiltinsFixture, native=window.__TAURI_INTERNALS__, original=native.invoke;
    native.invoke=async(command,args)=>command==='read_background'?image:original(command,args);
    window.foundationDesktop.config.settings.appearance.background_art=true;
    window.foundationDesktop.config.settings.personalization.background_file='a'.repeat(64)+'.png';
    await f.actions.config.reload();
  },savedImage);
  await page.waitForFunction(()=>window.suiteBuiltinsFixture.snapshot.appearance.background?.startsWith('data:image/png;base64,'));
  const ignored=await page.locator('.app-shell').evaluate(e=>{
    const appearance=window.suiteBuiltinsFixture.snapshot.appearance;
    const elements=[e,e.querySelector('.window-bar'),e.querySelector('.home-page, .immersive-home'),e.querySelector('.launch-banner')].filter(Boolean);
    return {art:appearance.value.background_art,file:window.foundationDesktop.config.settings.personalization.background_file,variables:[e.style.getPropertyValue('--background-image'),e.style.getPropertyValue('--banner-image')],images:elements.flatMap(element=>['', '::before', '::after'].map(pseudo=>getComputedStyle(element,pseudo||null).backgroundImage))};
  });
  assert.equal(ignored.art,true,'saved artwork preference is retained');
  assert.equal(ignored.file,'a'.repeat(64)+'.png','saved artwork file is retained');
  assert.ok(ignored.variables.every(value=>value.includes('data:image/png;base64,')),'public image variables remain available for custom suites');
  assert.ok(ignored.images.every(value=>value==='none'),'default_suite_ignores_saved_background');
  await page.evaluate(()=>window.suiteBuiltinsFixture.controller.actions.open());
  const editor=page.locator('#paradox-suite-editor');
  await editor.getByRole('dialog',{name:/^(?:UI Suite Editor|UI 套件编辑器)$/}).waitFor();
  await editor.getByRole('combobox',{name:/^(?:UI suite|UI 套件)$/}).click();
  await editor.getByRole('listbox').waitFor();
  assert.equal(await editor.getByRole('listbox').evaluate(e=>e.getRootNode()===document.getElementById('paradox-suite-editor').shadowRoot),true,'actual editor Select Portal root');
  assert.equal(await editor.getByRole('option').count(),2);
  await page.keyboard.press('Escape');
  const assetPaths=(await editor.locator('.suite-assets button:not([aria-label^="Remove "])').allTextContents()).sort();
  assert.deepEqual(assetPaths,[],'default builtin asset directory may be empty');
  for(const path of assetPaths)assert.equal(await editor.locator('.suite-assets').getByRole('button',{name:path,exact:true}).count(),1,`actual artwork accessible name ${path}`);
  const editorStyle=await editor.locator('.suite-editor').evaluate(e=>({display:getComputedStyle(e).display,background:getComputedStyle(e).backgroundColor,button:getComputedStyle(e.querySelector('button')).display,body:getComputedStyle(e.querySelector('.ui-editor-body')).overflowY}));
  assert.equal(editorStyle.display,'flex','ordinary editor keeps its layout');
  assert.notEqual(editorStyle.background,'rgba(0, 0, 0, 0)','ordinary editor has its own surface');
  assert.ok(['inline-flex','flex'].includes(editorStyle.button),'ordinary editor buttons keep their flex appearance');
  assert.equal(editorStyle.body,'auto','ordinary editor remains scrollable');
  assert.equal(await editor.evaluate(e=>[...e.shadowRoot.querySelectorAll('style[data-ui-suite]')].some(style=>/\.launch-banner|\.immersive-home/.test(style.textContent))),false,'player stylesheet rules never install into the ordinary editor');
  await page.screenshot({path:resolve(out,`editor-${id}-${theme}-${page.viewportSize().width}.png`)});
  await page.evaluate(()=>window.suiteBuiltinsFixture.controller.actions.close());
  return {computed,ignored,assetPaths,editorStyle,checks:['canonical_original_shell_styles','default_suite_ignores_saved_background','actual_editor_select_portal_shadowroot','actual_empty_asset_directory','ordinary_editor_independent_styles']};
}
if (process.env.PARADOX_SUITE_BUILTINS === '1') {
  try {
    const onlyCold=process.env.PARADOX_SUITE_COLD_RED==='1';
    for (const id of (onlyCold?['modern']:['modern','immersive'])) for(const theme of (onlyCold?['dark']:process.env.PARADOX_SUITE_LIGHT_ONLY==='1'?['light']:['dark','light'])) for(const viewport of (onlyCold?[{width:1240,height:780}]:[{width:1240,height:780},{width:320,height:240}])) {
      await fixture.page.setViewportSize(viewport); await fixture.page.reload();
      await fixture.page.waitForFunction(() => window.suiteBuiltinsFixture?.ready);
      const initial=await fixture.page.evaluate(()=>window.suiteBuiltinsFixture.initialCommit);
      assert.deepEqual(initial,{active:null,revision:0});
      const choice=fixture.page.locator('[data-style-choice]');
      await choice.waitFor();
      assert.equal(await choice.getByRole('radio').count(),2);
      assert.equal(await choice.getByRole('radio',{name:/Immersive|沉浸式/}).isChecked(),true);
      assert.equal(await fixture.page.evaluate(()=>window.foundationDesktop.calls.filter(x=>x.command==='save_ui_suite_library').length),0);
      await choice.getByRole('radio',{name:/Modern|现代式/}).click();
      await fixture.page.keyboard.press('ArrowRight');
      assert.equal(await choice.getByRole('radio',{name:/Immersive|沉浸式/}).isChecked(),true);
      await fixture.page.keyboard.press('Tab');
      assert.equal(await choice.getByRole('button',{name:/Use this interface|使用此界面/}).evaluate(e=>e===document.activeElement),true);
      await choice.getByRole('button',{name:/Use this interface|使用此界面/}).click();
      await fixture.page.waitForFunction(()=>!window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
      assert.deepEqual(await fixture.page.evaluate(()=>({active:window.foundationDesktop.suiteLibrary.active_suite_id,revision:window.foundationDesktop.suiteLibrary.revision})),{active:'builtin.immersive',revision:1});
      const original=await runBuiltinSourceStylesAndEditor(fixture.page,id,theme);
      const result=await fixture.page.evaluate(({id,theme})=>window.suiteBuiltinsFixture.run(id,theme),{id,theme});
      const canonicalAssetPaths=result.files.filter(file=>file.kind==='asset').map(file=>file.path).sort();
      assert.deepEqual(canonicalAssetPaths,[],'canonical builtins have no packaged artwork');
      assert.deepEqual(original.assetPaths,canonicalAssetPaths,'actual editor artwork paths match the canonical builtin bundle');
      for(const file of result.files){const bytes=await readFile(resolve('src/ui-suite/builtins',file.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`actual canonical bytes ${file.path}`)}
      report.rows.push({id,theme,viewport,initial,original,...result});console.log(JSON.stringify({id,theme,viewport,original:original.checks,checks:result.checks,failures:result.failures}));
      await fixture.page.screenshot({path:resolve(out,`${id}-${theme}-${viewport.width}.png`)});
      if(!onlyCold){const notices=await runBuiltinNoticeLeases(fixture.page);report.rows.at(-1).notices=notices;console.log(JSON.stringify({notices}));}
      const cold=[];
      for(const order of ['library-first','source-first']){const entry=await fixture.page.evaluate(order=>window.suiteBuiltinsFixture.coldStartup(order),order);cold.push({order,...entry});console.log(JSON.stringify({cold:entry,order}));assert.deepEqual(entry.failures,[])}
      const safe=await fixture.page.evaluate(()=>window.suiteBuiltinsFixture.coldStartup('source-first',true));cold.push({safe:true,...safe});console.log(JSON.stringify({safe}));assert.deepEqual(safe.failures,[]);report.rows.at(-1).cold=cold;
      assert.deepEqual(result.failures,[]);
      const pristine=[];
      for (const order of ['library-first','source-first']) {
        const entry=await fixture.page.evaluate(order=>window.suiteBuiltinsFixture.pristineStartup(order),order);
        assert.deepEqual(entry.failures,[]); pristine.push({order,...entry});
        await fixture.page.locator('[data-style-choice]').getByRole('radio',{name:/Modern|现代式/}).click();
        await fixture.page.locator('[data-style-choice]').getByRole('button',{name:/Use this interface|使用此界面/}).click();
        await fixture.page.waitForFunction(()=>!window.suiteBuiltinsFixture.controller.getSnapshot().initialSelectionRequired);
        assert.deepEqual(await fixture.page.evaluate(()=>({revision:window.foundationDesktop.suiteLibrary.revision,active:window.foundationDesktop.suiteLibrary.active_suite_id})),{revision:1,active:'builtin.modern'});
        await fixture.page.evaluate(()=>window.suiteBuiltinsFixture.restart());
        assert.equal(await fixture.page.locator('[data-style-choice]').count(),0);
      }
      for (const condition of ['reset','corrupt','safe']) {
        const entry=await fixture.page.evaluate(condition=>window.suiteBuiltinsFixture.pristineStartup('source-first',condition),condition);
        assert.deepEqual(entry.failures,[]); pristine.push({condition,...entry});
      }
      report.rows.at(-1).pristine=pristine; console.log(JSON.stringify({pristine}));
      const disposed=await fixture.page.evaluate(()=>window.suiteBuiltinsFixture.dispose());assert.deepEqual(disposed,{styles:0,owners:0,liveUrls:0});
    }
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.cspViolations,[]);
    if(process.env.PARADOX_TEST_NATIVE_CSP){assert.ok(report.csp);assert.deepEqual(report.sourceRequests,[])}
  } finally {
    await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
    await fixture.close();
  }
  process.exit(0);
}
async function runPublicViews(page, report, out) {
  const sites = loadApp()('customization/site-transform.ts');
  const source = `import {SuiteProvider as Provider} from './ui-suite/SuiteProvider';import {UiView} from './ui-suite/View';import {Button} from '@paradox/ui';const Alias=Provider;export default()=> <Alias><UiView id="page.content"/><Button>Visible editor control</Button></Alias>`;
  const instrumented = sites.instrumentSites(source, 'main.tsx', 'tsx');
  assert.equal(sites.siteTransformVersion, 'ui-sites-v1.3');
  assert.equal(instrumented.sites.size, 2);
  assert.ok(instrumented.source.includes('<Alias>'));
  assert.ok(instrumented.source.includes('data-ui-site'));
  for (const theme of ['dark', 'light'])
    for (const viewport of [
      { width: 1240, height: 780 },
      { width: 320, height: 240 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await page.waitForFunction(
        () =>
          window.suiteViewsFixture?.snapshot?.config.ready &&
          window.suiteViewsFixture.snapshot.accounts.ready,
      );
      const checks = [],
        pass = (name) => {
          checks.push(name);
          console.log(`PASS ${theme} ${viewport.width}x${viewport.height}: ${name}`);
        };
      const compilation = await page.evaluate(() => ({
        count: window.suiteViewsFixture.sourceCount,
        files: Object.entries(window.suiteViewsFixture.bundle.files).filter(([p]) =>
          /\.(?:tsx?|jsx?|css)$/.test(p),
        ),
        defs: window.suiteViewsFixture.definitions(),
      }));
      assert.ok(compilation.count >= 36);
      const whitelist = new Set([
        'react',
        'react/jsx-runtime',
        'lucide-react',
        '@paradox/ui',
        '@paradox/launcher',
        'react-i18next',
      ]);
      const privateImports = [];
      for (const [path, file] of compilation.files)
        if (file.encoding === 'utf8' && /\.tsx?$/.test(path)) {
          const source = ts.createSourceFile(
            path,
            file.text,
            ts.ScriptTarget.Latest,
            true,
            path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          );
          const inspect = (node) => {
            if (
              (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
              node.moduleSpecifier &&
              ts.isStringLiteral(node.moduleSpecifier)
            ) {
              const name = node.moduleSpecifier.text;
              if (!name.startsWith('.') && !whitelist.has(name)) privateImports.push([path, name]);
            }
            ts.forEachChild(node, inspect);
          };
          inspect(source);
        }
      assert.deepEqual(privateImports, []);
      assert.ok(
        compilation.defs
          .filter((d) => d.sourcePath)
          .every((d) => !d.site?.startsWith('auto:')),
      );
      pass('shared_views_have_no_private_imports');
      await page.evaluate(() => {
        window.task11BootstrapStyles = [...document.querySelectorAll('style[data-ui-suite]')];
        window.suiteViewsFixture.controller.actions.open();
      });
      const editor = page.getByRole('dialog', { name: 'Public suite editor' });
      await editor.waitFor();
      assert.ok(
        await page
          .locator('#paradox-suite-editor')
          .evaluate((host) => host.shadowRoot.querySelectorAll('style[data-ui-suite]').length > 0),
      );
      await page.evaluate(() => window.suiteViewsFixture.controller.actions.close());
      await editor.waitFor({ state: 'hidden' });
      await page.evaluate(() => window.suiteViewsFixture.releaseSource());
      await page.waitForFunction(
        () =>
          window.suiteViewsFixture.controller.getActivation() &&
          window.suiteViewsFixture.controller.getSnapshot().loaded,
      );
      assert.equal(
        await page.evaluate(() =>
          window.task11BootstrapStyles.every((style) => !style.isConnected),
        ),
        true,
      );
      assert.equal(await page.evaluate(() => window.suiteViewsFixture.disposals), 0);
      pass('borrowed_bootstrap_main_editor_styles_detach_without_dispose');
      await page.evaluate((theme) => window.suiteViewsFixture.theme(theme), theme);
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        window.task11SharedActions = f.actions;
        window.task11BusinessReads = window.foundationDesktop.calls.filter((c) =>
          ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(
            c.command,
          ),
        ).length;
        const key = f.snapshot.config.value.profiles[0].instance_key;
        f.actions.navigation.navigate('content', { profileKey: key });
      });
      const query = page.locator('main input[maxlength="256"]');
      await query.fill('retained source query');
      await page.locator('main form button[type="submit"]').click();
      await page.waitForFunction(() =>
        window.foundationDesktop.calls.some(
          (c) => c.command === 'search_content' && c.args.query === 'retained source query',
        ),
      );
      const replacement = `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';import {Button} from '@paradox/ui';export default function Content(){const s=useLauncherSnapshot(),a=useLauncherActions();return <section data-ui-site="replacement" data-complete-content><input data-ui-site="query" aria-label="Replacement query" value={s.content.query} onChange={e=>a.content.patchSearch({query:e.currentTarget.value})}/><Button data-ui-site="search" onClick={()=>a.content.search()}>Shared content search</Button></section>}`;
      assert.equal(
        await page.evaluate(
          (source) => window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['page.content'], source),
          replacement,
        ),
        true,
      );
      assert.equal(
        await page.getByLabel('Replacement query').inputValue(),
        'retained source query',
      );
      const searchCount = await page.evaluate(
        () => window.foundationDesktop.calls.filter((c) => c.command === 'search_content').length,
      );
      await page.getByRole('button', { name: 'Shared content search' }).click();
      await page.waitForFunction(
        (n) =>
          window.foundationDesktop.calls.filter((c) => c.command === 'search_content').length > n,
        searchCount,
      );
      assert.equal(await page.locator('[data-complete-content]').isVisible(), true);
      pass('complete_content_replacement_retains_business');
      await page.evaluate(() => window.suiteViewsFixture.actions.profileDraft.openCreate('1.21.1'));
      const nameInput = page.locator('#profile-name');
      await nameInput.fill('edited provider draft');
      const dialogSource = `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';import {Dialog,Input} from '@paradox/ui';export default function Profile(){const s=useLauncherSnapshot().profileDraft,a=useLauncherActions().profileDraft;if(!s.editor)return null;return <Dialog.Root data-ui-site="root" open onOpenChange={open=>!open&&!s.pending&&a.cancel()}><Dialog.Portal><Dialog.Popup data-ui-site="popup" className="modal" aria-label="Replaced profile draft"><Dialog.Title data-ui-site="title">Replaced profile</Dialog.Title><Dialog.Description data-ui-site="description">Shared draft</Dialog.Description><Input data-ui-site="name" aria-label="Shared profile name" value={s.editor.name} onChange={e=>a.patch({name:e.currentTarget.value})}/><button data-ui-site="cancel" onClick={a.cancel}>Cancel shared draft</button></Dialog.Popup></Dialog.Portal></Dialog.Root>}`;
      assert.equal(
        await page.evaluate(
          (source) =>
            window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['dialog.profile'], source),
          dialogSource,
        ),
        true,
      );
      assert.equal(
        await page.getByLabel('Shared profile name').inputValue(),
        'edited provider draft',
      );
      await page.getByLabel('Shared profile name').fill('replacement edited draft');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.profileDraft.editor.name),
        'replacement edited draft',
      );
      await page.getByRole('button', { name: 'Cancel shared draft' }).click();
      pass('replace_dialog_preserves_shared_draft');
      assert.equal(
        await page.evaluate(() => window.task11SharedActions === window.suiteViewsFixture.actions),
        true,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.foundationDesktop.calls.filter((c) =>
              ['get_config', 'account_state', 'account_recovery', 'plugin:event|listen'].includes(
                c.command,
              ),
            ).length,
        ),
        await page.evaluate(() => window.task11BusinessReads),
      );
      pass('view_replacement_retains_one_business_owner');
      await page.evaluate(() => window.suiteViewsFixture.restore());
      await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('accounts'));
      const client = page.locator('main input[maxlength="36"]');
      await client.fill('00000000-0000-4000-8000-000000000001');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.accounts.clientIdDraft),
        '00000000-0000-4000-8000-000000000001',
      );
      const accountSource = `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';import {Button} from '@paradox/ui';export default()=>{const s=useLauncherSnapshot(),a=useLauncherActions();return <section data-ui-site="account"><p data-ui-site="client">{s.accounts.clientIdDraft}</p><Button data-ui-site="offline" onClick={()=>a.accounts.select(null)}>Shared offline identity</Button></section>}`;
      assert.equal(
        await page.evaluate(
          (source) => window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['page.accounts'], source),
          accountSource,
        ),
        true,
      );
      await page.getByRole('button', { name: 'Shared offline identity' }).click();
      await page.waitForFunction(
        () => window.suiteViewsFixture.snapshot.accounts.state.active === null,
      );
      pass('account_replacement_uses_shared_selection_and_input');
      await page.evaluate(() => window.suiteViewsFixture.restore());
      await installTask11Boundary(page);
      await page.evaluate(async () => {
        const f = window.suiteViewsFixture;
        window.foundationDesktop.accounts.client_id = '00000000-0000-4000-8000-000000000001';
        await f.actions.accounts.reload();
        window.task11LoginOperation = f.actions.accounts.login();
      });
      await page.getByRole('dialog').waitFor();
      assert.ok((await page.getByRole('dialog').textContent()).includes('TASK11'));
      const login = `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';export default()=>{const s=useLauncherSnapshot(),a=useLauncherActions();return s.accounts.prompt?<section data-ui-site="login" className="modal" role="dialog"><p data-ui-site="code">{s.accounts.prompt.user_code}</p><button data-ui-site="cancel" onClick={()=>a.accounts.cancelLogin()}>Cancel shared device code</button></section>:null}`;
      assert.equal(
        await page.evaluate(
          (source) =>
            window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['dialog.login'], source),
          login,
        ),
        true,
      );
      assert.ok((await page.getByRole('dialog').textContent()).includes('TASK11'));
      await page.getByRole('button', { name: 'Cancel shared device code' }).click();
      await page.waitForFunction(
        () =>
          !window.suiteViewsFixture.snapshot.accounts.pending &&
          !window.suiteViewsFixture.snapshot.accounts.prompt,
      );
      await page.evaluate(() => window.task11LoginOperation);
      assert.ok(
        await page.evaluate(() =>
          window.foundationDesktop.calls.some((c) => c.command === 'cancel_login'),
        ),
      );
      await page.evaluate(() => window.suiteViewsFixture.restore());
      await page.evaluate(() => {
        window.task11LoginOperation = window.suiteViewsFixture.actions.accounts.login();
      });
      await page.getByRole('dialog').waitFor();
      await page.evaluate(() =>
        window.task11LoginComplete(structuredClone(window.foundationDesktop.accounts)),
      );
      await page.evaluate(() => window.task11LoginOperation);
      await page.waitForFunction(
        () =>
          !window.suiteViewsFixture.snapshot.accounts.pending &&
          !window.suiteViewsFixture.snapshot.accounts.prompt,
      );
      pass('device_login_canonical_replacement_cancel_complete_shared_owner');
      await page.evaluate(() =>
        window.suiteViewsFixture.actions.launch.request(
          window.suiteViewsFixture.snapshot.config.value.profiles[0].instance_key,
        ),
      );
      await page.getByRole('dialog').waitFor();
      await page.evaluate(() => window.suiteViewsFixture.actions.launch.chooseAccount(null));
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.launch.selection.accountId),
        null,
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.launch.cancelSelection());
      pass('fixed_launch_account_dialog_shared_choice_and_cancel');
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        f.actions.navigation.navigate('downloads');
        window.foundationDesktop.emit('launcher://downloads', [
          {
            id: 'suite-task',
            kind: 'install',
            profile_key: f.snapshot.config.value.profiles[0].instance_key,
            status: 'running',
            name: 'Shared queue task',
            message: '等待下载',
            progress: null,
          },
        ]);
      });
      const queue = page.locator('main .account-detail').filter({ hasText: 'Shared queue task' });
      await queue.locator('button').click();
      await page.waitForFunction(() =>
        window.foundationDesktop.calls.some(
          (c) => c.command === 'cancel_task' && c.args.id === 'suite-task',
        ),
      );
      await page.evaluate(() => window.foundationDesktop.emit('launcher://downloads', []));
      pass('canonical_download_queue_preserves_action_guard');
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        f.actions.navigation.navigate('settings');
        f.actions.settings.setTab('game');
      });
      const memory = page.locator('main input[type="number"][max="32768"]');
      await memory.fill('6144');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.settings.draft.memory_mb),
        6144,
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.java.discover());
      await page.waitForFunction(() => window.suiteViewsFixture.snapshot.java.discovery !== null);
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        f.actions.settings.setTab('advanced');
        f.actions.argumentTemplates.openNew();
      });
      const argumentDialog = page.getByRole('dialog').filter({ has: page.locator('textarea') });
      await argumentDialog.locator('input').first().fill('Suite argument draft');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.drafts.argumentTemplate.name),
        'Suite argument draft',
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.argumentTemplates.cancel());
      pass('canonical_settings_java_argument_dialog_share_drafts');
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        f.actions.settings.setTab('appearance');
        f.actions.presets.openDialog({ kind: 'save' });
      });
      await page.getByRole('dialog').locator('input').fill('Suite preset draft');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.drafts.preset.name),
        'Suite preset draft',
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.presets.cancelDialog());
      await page.evaluate(() =>
        window.suiteViewsFixture.actions.instanceDraft.open(
          window.suiteViewsFixture.snapshot.config.value.profiles[0].instance_key,
        ),
      );
      await page.getByRole('dialog').locator('input[maxlength="64"]').fill('Shared instance draft');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.instanceDraft.profile.name),
        'Shared instance draft',
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.instanceDraft.cancel());
      await page.evaluate(() => window.suiteViewsFixture.actions.importDraft.open());
      await page.getByRole('dialog').locator('input').fill('C:/suite-import');
      assert.equal(
        await page.evaluate(() => window.suiteViewsFixture.snapshot.importDraft.directory),
        'C:/suite-import',
      );
      await page.evaluate(() => window.suiteViewsFixture.actions.importDraft.cancel());
      await page.evaluate(() =>
        window.suiteViewsFixture.actions.removal.open(
          window.suiteViewsFixture.snapshot.config.value.profiles[0].instance_key,
        ),
      );
      assert.equal(await page.getByRole('dialog').count(), 1);
      await page.evaluate(() => window.suiteViewsFixture.actions.removal.cancel());
      await page.evaluate(() =>
        window.foundationDesktop.emit('launcher://close-requested', {
          game_running: false,
          downloads_active: true,
        }),
      );
      assert.equal(await page.getByRole('dialog').count(), 1);
      await page.evaluate(() => window.suiteViewsFixture.actions.window.respondToClose('stay'));
      pass('fixed_preset_instance_import_remove_close_dialogs');
      await page.evaluate(() => {
        const f = window.suiteViewsFixture;
        f.actions.settings.reset();
        f.actions.navigation.navigate('content', {
          profileKey: f.snapshot.config.value.profiles[0].instance_key,
        });
      });
      const fail =
        'export default function Fail(){throw new Error("Expected task11 primary failure")}';
      assert.equal(
        await page.evaluate(
          (source) => window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['page.content'], source),
          fail,
        ),
        true,
      );
      await page.locator('main input[maxlength="256"]').waitFor();
      const parent =
        'export default()=> <p data-ui-site="parent" data-fixed-parent>Fixed parent content</p>;';
      assert.equal(
        await page.evaluate((source) => window.suiteViewsFixture.parent(source), parent),
        true,
      );
      await page.locator('[data-fixed-parent]').waitFor();
      assert.ok(
        (await page.evaluate(() => window.suiteViewsFixture.owners())).some(
          (o) => o.target === 'page.content' && o.layerId?.includes('parent'),
        ),
      );
      pass('primary_failure_preserves_fixed_parent_owner');
      await page.evaluate(() => window.suiteViewsFixture.restore());
      await page.evaluate(() => window.suiteViewsFixture.controller.actions.open());
      await editor.waitFor();
      const userEditor = `import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';import {Button} from '@paradox/ui';export default()=>{const s=useUiEditorSnapshot(),a=useUiEditorActions();return <section data-ui-site="editor" role="dialog" aria-label="Public suite editor" style={{pointerEvents:'auto',position:'fixed',inset:8,background:'#202431',color:'white'}}><h1 data-ui-site="title">Replaced normal editor</h1><p data-ui-site="dirty">{String(s.dirty)}</p><Button data-ui-site="close" onClick={a.close}>Close replaced editor</Button></section>}`;
      assert.equal(
        await page.evaluate(
          (source) => window.suiteViewsFixture.replacement('Editor.tsx', source),
          userEditor,
        ),
        true,
      );
      await page.getByRole('heading', { name: 'Replaced normal editor' }).waitFor();
      const controls = await page.evaluate(async () => {
        const f = window.suiteViewsFixture;
        f.controller.actions.createFile('Control.tsx', 'tsx');
        f.controller.actions.patchFile(
          'Control.tsx',
          `export default function Control({Original}){return <span data-ui-site="override" data-control-replaced><Original data-ui-site="original"/></span>}`,
        );
        f.controller.actions.patchManifest({
          overrides: [
            {
              selector: { kind: 'type', target: 'control.button' },
              enabled: true,
              entry: 'Control.tsx',
              stylesheet: null,
            },
          ],
        });
        return f.controller.actions.preview();
      });
      assert.equal(controls, true);
      await editor.locator('[data-control-replaced]').waitFor();
      await page.getByRole('button', { name: 'Close replaced editor' }).click();
      await editor.waitFor({ state: 'hidden' });
      await page.evaluate(() => window.suiteViewsFixture.controller.recovery.openBuiltinEditor());
      await editor.waitFor();
      await page.getByRole('heading', { name: 'Trusted fixture editor' }).waitFor();
      assert.equal(await editor.locator('[data-control-replaced]').count(), 0);
      pass('normal_editor_control_original_and_protected_trusted_resolver');
      await page.evaluate(() => window.suiteViewsFixture.controller.actions.close());
      await runAutomaticBindings(page, { rows: [] });
      pass('automatic_native_marked_tsx_html_shared_callbacks_and_original');
      await runTargetRoutes(page, pass);
      await runPublicViewResources(page, pass);
      await page.screenshot({ path: resolve(out, `views-${theme}-${viewport.width}.png`) });
      await page.evaluate(() => window.suiteViewsFixture.controller.actions.close());
      await page.evaluate(() => window.suiteViewsFixture.destroy());
      assert.equal(await page.locator('style[data-ui-suite]').count(), 0);
      assert.equal(await page.evaluate(() => window.suiteViewsFixture.disposals), 3);
      assert.equal(await page.evaluate(() => window.suiteViewsFixture.owners().length), 0);
      assert.deepEqual(
        await page.evaluate(() => window.suiteViewsFixture.disposalObservations),
        Array.from({ length: 3 }, () => ({ styles: 0, owners: 0 })),
      );
      pass('renderer_owned_styles_registry_cleanup_then_caller_dispose');
      report.rows.push({ theme, viewport, checks, sourceCount: compilation.count });
    }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.cspViolations, []);
  if (process.env.PARADOX_TEST_NATIVE_CSP) {
    assert.ok(report.csp);
    assert.deepEqual(report.sourceRequests, []);
  }
}
async function runAutomaticBindings(page, report) {
  await page.waitForFunction(() => window.suiteViewsFixture.snapshot.config.ready);
  await page.evaluate(() => window.suiteViewsFixture.releaseSource());
  await page.waitForFunction(() => window.suiteViewsFixture.controller.getActivation());
  await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('content'));
  const source = `import {Fragment} from 'react';import {useLauncherActions} from '@paradox/launcher';function Marked({onClick}){return <button data-ui-site="marked-inner" onClick={onClick}>Marked callback</button>}export default function Subjects(){const a=useLauncherActions();return <Fragment data-ui-site="subjects"><button data-ui-site="native" ref={node=>node?.setAttribute('data-ref-seen','yes')} onClick={()=>a.settings.patch('memory_mb',7168)}>Native callback</button><Marked data-ui-site="marked" data-ui-target="component.marked" onClick={()=>a.settings.patch('memory_mb',8192)}/></Fragment>}`;
  assert.equal(
    await page.evaluate(
      (source) => window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['page.content'], source),
      source,
    ),
    true,
  );
  const passed = await page.evaluate(async () => {
    const f = window.suiteViewsFixture;
    f.controller.actions.createFile('Native.tsx', 'tsx');
    f.controller.actions.patchFile(
      'Native.tsx',
      `export default function Native({Original}){return <span data-ui-site="wrapper" data-native-bound><Original data-ui-site="original"/></span>}`,
    );
    f.controller.actions.createFile('Marked.html', 'html');
    f.controller.actions.patchFile(
      'Marked.html',
      '<span data-ui-site="marked-wrapper" data-marked-bound><ui-slot/></span>',
    );
    f.controller.actions.patchManifest({
      overrides: [
        {
          selector: { kind: 'type', target: 'element.button' },
          enabled: true,
          entry: 'Native.tsx',
          stylesheet: null,
        },
        {
          selector: { kind: 'type', target: 'component.marked' },
          enabled: true,
          entry: 'Marked.html',
          stylesheet: null,
        },
      ],
    });
    return f.controller.actions.preview();
  });
  assert.equal(passed, true);
  const rows = {
    native: (await page.locator('[data-native-bound]').count()) > 0,
    marked: (await page.locator('[data-marked-bound]').count()) > 0,
  };
  report.rows.push(rows);
  console.log(JSON.stringify(rows));
  assert.deepEqual(
    rows,
    { native: true, marked: true },
    'Compiled automatic native TSX and marked HTML use the same Suite resolver',
  );
  await page.getByRole('button', { name: 'Native callback', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.suiteViewsFixture.snapshot.settings.draft.memory_mb),
    7168,
  );
  await page.getByRole('button', { name: 'Marked callback', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.suiteViewsFixture.snapshot.settings.draft.memory_mb),
    8192,
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Native callback', exact: true })
      .getAttribute('data-ref-seen'),
    'yes',
  );
}
async function runTargetRoutes(page, pass) {
  await page.evaluate(() => window.suiteViewsFixture.restore());
  await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('content'));
  const source = `import {Fragment} from 'react';import {UiIdentity} from '@paradox/ui';export default()=> <Fragment data-ui-site="subjects"><UiIdentity data-ui-site="business" namespace="fixture" value="bound"><button data-ui-site="bound">Bound subject</button></UiIdentity>{['a','b'].map(value=><button data-ui-site="repeat">{value}</button>)}</Fragment>`;
  assert.equal(
    await page.evaluate(
      (source) => window.suiteViewsFixture.replacement(window.suiteViewsFixture.bundle.manifest.views['page.content'], source),
      source,
    ),
    true,
  );
  await page.getByRole('button', { name: 'Bound subject' }).waitFor();
  const selectors = await page.evaluate(() => {
    const owners = window.suiteViewsFixture.owners(),
      matches = (row, site) => row.target === 'element.button' && row.site?.endsWith(site);
    return {
      position: owners.find((row) => matches(row, 'bound')).locator,
      repeat: owners.find((row) => matches(row, 'repeat')).locator,
      unsafe: owners
        .filter((row) => matches(row, 'repeat'))
        .every((row) => row.stability === 'missing-repeat-key'),
    };
  });
  assert.equal(selectors.unsafe, true);
  assert.equal(
    await page.evaluate(async ({ position, repeat }) => {
      const f = window.suiteViewsFixture,
        c = f.controller;
      for (const name of ['Type', 'Business', 'Position', 'Unsafe']) {
        c.actions.createFile(name + '.tsx', 'tsx');
        c.actions.patchFile(
          name + '.tsx',
          `export default function Bound({Original}){return <span data-ui-site="override" data-selected="${name}"><Original data-ui-site="original"/></span>}`,
        );
      }
      c.actions.createFile('Only.css', 'css');
      c.actions.patchFile('Only.css', ':scope{font-weight:600}');
      c.actions.patchManifest({
        overrides: [
          {
            selector: { kind: 'type', target: 'element.button' },
            enabled: true,
            entry: 'Type.tsx',
            stylesheet: null,
          },
          {
            selector: {
              kind: 'business',
              target: 'element.button',
              identity: { namespace: 'fixture', value: 'bound' },
            },
            enabled: true,
            entry: 'Business.tsx',
            stylesheet: null,
          },
          {
            selector: { kind: 'position', target: 'element.button', locator: position },
            enabled: true,
            entry: 'Position.tsx',
            stylesheet: null,
          },
          {
            selector: { kind: 'position', target: 'element.button', locator: repeat },
            enabled: true,
            entry: 'Unsafe.tsx',
            stylesheet: null,
          },
          {
            selector: { kind: 'type', target: 'component.css-only' },
            enabled: true,
            entry: null,
            stylesheet: 'Only.css',
          },
        ],
      });
      return c.actions.preview();
    }, selectors),
    true,
  );
  const bound = page.getByRole('button', { name: 'Bound subject' });
  assert.equal(
    await bound.evaluate((node) => node.closest('[data-selected]').dataset.selected),
    'Type',
  );
  assert.equal(
    await bound.evaluate((node) => {
      const values = [];
      for (let current = node.parentElement; current; current = current.parentElement)
        if (current.dataset.selected) values.push(current.dataset.selected);
      return values.join(',');
    }),
    'Type,Business,Position',
  );
  assert.equal(await page.locator('[data-selected="Unsafe"]').count(), 0);
  const metadata = await page.evaluate(() => ({
    rows: window.suiteViewsFixture.metadata(),
    definitions: window.suiteViewsFixture
      .definitions()
      .filter((row) => row.target === 'component.css-only'),
  }));
  assert.ok(metadata.rows.length >= 2);
  assert.ok(metadata.definitions.length > 0);
  assert.ok(metadata.definitions.every((row) => row.sourcePath === 'Only.css'));
  pass('position_business_type_original_chain_and_unsafe_repeat_eligibility');
  const custom = `import {useLauncherSnapshot,useLauncherActions} from '@paradox/launcher';export default()=>{const s=useLauncherSnapshot(),a=useLauncherActions();return <section data-ui-site="custom"><p data-ui-site="params" data-custom-params>{s.navigation.params.profileKey}</p><input data-ui-site="search" aria-label="Custom shared search" value={s.navigation.search} onChange={e=>a.navigation.setSearch(e.currentTarget.value)}/></section>}`;
  assert.equal(
    await page.evaluate(async (source) => {
      const f = window.suiteViewsFixture,
        c = f.controller;
      c.actions.createFile('Custom.tsx', 'tsx');
      c.actions.patchFile('Custom.tsx', source);
      const manifest = c.getSnapshot().draft.manifest;
      c.actions.patchManifest({
        views: { ...manifest.views, 'page.custom.task11': 'Custom.tsx' },
        routes: [
          ...manifest.routes,
          {
            ...manifest.routes[0],
            id: 'custom.task11',
            entry: 'Custom.tsx',
            title: 'Task11 custom route',
            description: 'Shared navigation',
            order: 99,
          },
        ],
      });
      return c.actions.preview();
    }, custom),
    true,
  );
  await page.waitForFunction(() =>
    window.suiteViewsFixture.snapshot.navigation.routes.some(
      (route) => route.id === 'custom.task11',
    ),
  );
  await page.evaluate(() => {
    const f = window.suiteViewsFixture;
    window.task11CustomReads = window.foundationDesktop.calls.filter((c) =>
      ['get_config', 'account_state', 'plugin:event|listen'].includes(c.command),
    ).length;
    f.actions.navigation.navigate('custom.task11', { profileKey: 'retained-route-param' });
  });
  assert.equal(await page.locator('[data-custom-params]').textContent(), 'retained-route-param');
  await page.getByLabel('Custom shared search').fill('shared custom query');
  assert.equal(
    await page.evaluate(() => window.suiteViewsFixture.snapshot.navigation.search),
    'shared custom query',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.foundationDesktop.calls.filter((c) =>
          ['get_config', 'account_state', 'plugin:event|listen'].includes(c.command),
        ).length,
    ),
    await page.evaluate(() => window.task11CustomReads),
  );
  pass('canonical_custom_route_source_shared_params_search_without_business_reload');
}
async function runPublicViewResources(page, pass) {
  await page.evaluate(() => window.suiteViewsFixture.restore());
  await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('content'));
  const content = `import {Fragment} from 'react';import {UiView} from '@paradox/ui';export default function Probe({Original}){return <Fragment data-ui-site="fragment"><input data-ui-site="input" data-css-input aria-label="CSS local input" defaultValue="local" style={{animationName:'fresh'}}/><p data-ui-site="primary" data-layer-primary className="layer-probe">Primary probe</p><UiView data-ui-site="nested" id="component.profile-card" props={{origin:Original}}/><UiView data-ui-site="trusted" id="component.probe"/></Fragment>}`;
  const editor = `import {Fragment} from 'react';import {UiView} from '@paradox/ui';export default function Editor({Original}){return <section data-ui-site="editor" role="dialog" aria-label="Public suite editor" style={{pointerEvents:'auto',position:'fixed',inset:8,background:'#202431',color:'white'}}><input data-ui-site="input" data-css-editor-input aria-label="CSS editor input" defaultValue="editor"/><p data-ui-site="primary" data-layer-primary className="layer-probe">Primary editor</p><Original data-ui-site="original"/><UiView data-ui-site="trusted" id="component.probe"/></section>}`;
  const css = `:root{--task11-token:primary}:host{--task11-host:primary}.layer-probe{color:rgb(200,0,0)}.layer-probe::before{content:"primary"}.layer-probe::after{content:"after"}@keyframes pulse{from{opacity:1}to{opacity:1}}`;
  assert.equal(
    await page.evaluate(
      async ({ content, editor, css }) => {
        const f = window.suiteViewsFixture;
        await f.replacement(window.suiteViewsFixture.bundle.manifest.views['page.content'], content);
        await f.replacement('Editor.tsx', editor);
        await f.replacement('Layer.css', css);
        f.controller.actions.patchFile(
          window.suiteViewsFixture.bundle.manifest.views['component.profile-card'],
          `export default function Nest({props}){const Origin=props.origin;return <Origin data-ui-site="nested-original"/>}`,
        );
        f.controller.actions.patchFile(
          'Probe.tsx',
          'export default function Fail(){throw new Error("Expected primary probe failure")}',
        );
        return f.controller.actions.preview();
      },
      { content, editor, css },
    ),
    true,
  );
  const parentCSS = `:root{--task11-token:parent}:host{--task11-host:parent}.layer-probe{color:rgb(0,0,200)}.layer-probe::before{content:"parent"}.layer-probe::after{content:"after"}`;
  assert.equal(
    await page.evaluate(
      ({ parentCSS }) =>
        window.suiteViewsFixture.parentFiles({
          [window.suiteViewsFixture.bundle.manifest.views['page.content']]:
            'export default()=> <p data-ui-site="parent" data-layer-parent className="layer-probe">Parent through nested Original</p>',
          'Editor.tsx':
            'export default()=> <p data-ui-site="parent" data-layer-parent className="layer-probe">Parent editor Original</p>',
          'Probe.tsx':
            'export default function Fail(){throw new Error("Expected parent probe failure")}',
          'Layer.css': parentCSS,
        }),
      { parentCSS },
    ),
    true,
  );
  await page.locator('[data-layer-parent]').waitFor();
  await page.evaluate(() => window.suiteViewsFixture.controller.actions.open());
  const editorRoot = page.getByRole('dialog', { name: 'Public suite editor' });
  await editorRoot.locator('[data-layer-parent]').waitFor();
  const styles = await page.evaluate(() => {
    const roots = [document, document.getElementById('paradox-suite-editor').shadowRoot];
    return roots.map((root) =>
      Object.fromEntries(
        ['primary', 'parent', 'trusted'].map((layer) => {
          const node = root.querySelector(`[data-layer-${layer}]`),
            style = getComputedStyle(node);
          return [
            layer,
            {
              color: style.color,
              token: style.getPropertyValue('--task11-token').trim(),
              host: style.getPropertyValue('--task11-host').trim(),
              before: getComputedStyle(node, '::before').content,
              after: getComputedStyle(node, '::after').content,
              source: node.getAttribute('data-ui-render-layer'),
            },
          ];
        }),
      ),
    );
  });
  for (const root of styles)
    for (const [layer, color] of Object.entries({
      primary: 'rgb(200, 0, 0)',
      parent: 'rgb(0, 0, 200)',
      trusted: 'rgb(0, 120, 0)',
    })) {
      assert.equal(root[layer].color, color);
      assert.equal(root[layer].token, layer);
      assert.equal(root[layer].host, layer);
      assert.equal(root[layer].before, `"${layer}"`);
      assert.equal(root[layer].after, '"after"');
      assert.ok(root[layer].source);
    }
  pass('document_shadow_layer_original_tokens_and_pseudo_elements');
  const input = page.getByLabel('CSS local input');
  await input.fill('persisted source input');
  await input.evaluate((node) => {
    window.task11Input = node;
    node.focus();
    node.setSelectionRange(2, 9);
    window.task11InlineBefore = getComputedStyle(node).animationName;
  });
  assert.equal(
    await page.evaluate(
      (source) => window.suiteViewsFixture.replacement('Layer.css', source),
      css + '\n.layer-probe{font-weight:700}@keyframes fresh{from{opacity:1}to{opacity:1}}',
    ),
    true,
  );
  assert.deepEqual(
    await input.evaluate((node) => ({
      same: node === window.task11Input,
      value: node.value,
      focused: document.activeElement === node,
      start: node.selectionStart,
      end: node.selectionEnd,
      inline: getComputedStyle(node).animationName !== window.task11InlineBefore,
    })),
    { same: true, value: 'persisted source input', focused: true, start: 2, end: 9, inline: true },
  );
  const editorInput = page.getByLabel('CSS editor input');
  await editorInput.fill('persisted shadow input');
  await editorInput.evaluate((node) => {
    window.task11EditorInput = node;
    node.focus();
    node.setSelectionRange(1, 6);
  });
  assert.equal(
    await page.evaluate(
      (source) => window.suiteViewsFixture.replacement('Layer.css', source),
      css + '\n.layer-probe{font-weight:600}',
    ),
    true,
  );
  assert.deepEqual(
    await editorInput.evaluate((node) => ({
      same: node === window.task11EditorInput,
      value: node.value,
      focused: node.getRootNode().activeElement === node,
      start: node.selectionStart,
      end: node.selectionEnd,
    })),
    { same: true, value: 'persisted shadow input', focused: true, start: 1, end: 6 },
  );
  assert.equal(await page.evaluate(() => window.suiteViewsFixture.leases()), true);
  pass('css_only_dom_focus_selection_inline_and_independent_leases');
  await page.evaluate(() => window.suiteViewsFixture.controller.actions.close());
  await page.evaluate(() => window.suiteViewsFixture.genericBootstrap());
  await page.waitForFunction(() => window.suiteViewsFixture.snapshot.config.ready);
  assert.equal(
    await page.evaluate(() => window.suiteViewsFixture.controller.getActivation()),
    null,
  );
  await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('content'));
  await page.locator('main input[maxlength="256"]').waitFor();
  const unavailable = await page.evaluate(() =>
    window.suiteViewsFixture
      .owners()
      .filter(
        (row) =>
          row.layerId === 'trusted.bootstrap' &&
          row.target === 'page.content' &&
          row.site === 'view:page.content',
      )
      .map((row) => row.metadata),
  );
  assert.ok(unavailable.length > 0);
  assert.ok(unavailable.every((row) => row.sourcePath === null && row.routeId === null));
  assert.equal(await page.evaluate(() => window.suiteViewsFixture.disposals), 0);
  await page.evaluate(() => window.suiteViewsFixture.controller.actions.open());
  await page.getByRole('dialog', { name: 'Public suite editor' }).waitFor();
  await page.evaluate(() => window.suiteViewsFixture.controller.actions.close());
  pass('generic_borrowed_bootstrap_null_metadata_and_dual_root_styles');
  await page.evaluate(() => window.suiteViewsFixture.genericBootstrap(true));
  await page.getByRole('heading', { name: /Recovery|恢复/i }).waitFor();
  assert.equal(
    await page.evaluate(() => window.suiteViewsFixture.controller.isRecoveryVisible()),
    true,
  );
  pass('trusted_failure_reaches_fixed_recovery_without_loop');
}
async function installTask11Boundary(page) {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'begin_login') {
        window.foundationDesktop.calls.push({ command, args });
        return {
          id: args.requestId,
          user_code: 'TASK11',
          verification_uri: 'https://example.invalid/task11',
          expires_at: Math.floor(Date.now() / 1000) + 600,
        };
      }
      if (command === 'complete_login') {
        window.foundationDesktop.calls.push({ command, args });
        return new Promise((resolve, reject) => {
          window.task11LoginComplete = resolve;
          window.task11LoginCancel = () => reject(new Error('Expected Task11 login cancellation'));
        });
      }
      if (command === 'cancel_login') {
        window.foundationDesktop.calls.push({ command, args });
        window.task11LoginCancel?.();
        return;
      }
      if (['cancel_task', 'clear_stored_logs'].includes(command)) {
        window.foundationDesktop.calls.push({ command, args });
        return command === 'clear_stored_logs' ? { session: 'task11', sequence: 1 } : undefined;
      }
      return original(command, args);
    };
  });
}
try {
  const { page } = fixture;
  if (process.env.PARADOX_SUITE_VIEWS === '1') {
    if (!process.env.PARADOX_TEST_NATIVE_CSP)
      await page.evaluate(async () => {
        if (window.suiteViewsFixture) return;
        const { installSuiteViewsFixture } = await import('/src/ui-tests/suite-views-fixture.tsx');
        const { root } = await import('/src/main.tsx');
        await installSuiteViewsFixture(root);
      });
    await page.waitForFunction(() => window.suiteViewsFixture);
    if (process.env.PARADOX_SUITE_VIEWS_FOCUS) {
      await page.waitForFunction(() => window.suiteViewsFixture.snapshot.config.ready);
      await page.evaluate(() => window.suiteViewsFixture.releaseSource());
      await page.waitForFunction(() => window.suiteViewsFixture.controller.getActivation());
      const checks = [],
        pass = (name) => {
          checks.push(name);
          console.log('PASS ' + name);
        };
      if (process.env.PARADOX_SUITE_VIEWS_FOCUS === 'targets') await runTargetRoutes(page, pass);
      else await runPublicViewResources(page, pass);
      report.rows.push({ checks });
    } else if (process.env.PARADOX_SUITE_SUBJECT_RED === '1') {
      await runAutomaticBindings(page, report);
    } else if (process.env.PARADOX_SUITE_LAYER_RED === '1') {
      await page.waitForFunction(() => window.suiteViewsFixture?.snapshot?.config.ready);
      await page.evaluate(() => window.suiteViewsFixture.releaseSource());
      await page.waitForFunction(() => window.suiteViewsFixture.controller.getActivation());
      await page.evaluate(() => window.suiteViewsFixture.actions.navigation.navigate('content'));
      await page.evaluate(() =>
        window.suiteViewsFixture.replacement(
          window.suiteViewsFixture.bundle.manifest.views['page.content'],
          'export default function Fail(){throw new Error("Expected primary view failure")}',
        ),
      );
      await page.evaluate(() =>
        window.suiteViewsFixture.replacement('Layer.css', '.layer-probe{color:rgb(200,0,0)}'),
      );
      await page.evaluate(() =>
        window.suiteViewsFixture.parent(
          'export default()=> <p data-ui-site="parent" data-layer-parent className="layer-probe">Fixed parent color</p>',
        ),
      );
      await page.locator('[data-layer-parent]').waitFor();
      const result = await page
        .locator('[data-layer-parent]')
        .evaluate((node) => ({ actual: getComputedStyle(node).color, expected: 'rgb(0, 120, 0)' }));
      report.rows.push(result);
      console.log(JSON.stringify(result));
      assert.equal(
        result.actual,
        result.expected,
        'Parent fallback keeps own direct-property CSS while primary shell remains mounted',
      );
    } else await runPublicViews(page, report, out);
    process.exitCode = 0;
  } else {
    if (!process.env.PARADOX_TEST_NATIVE_CSP)
      await page.evaluate(async () => {
        const { installSuiteCompilerFixture } =
          await import('/src/ui-tests/suite-compiler-fixture.tsx');
        installSuiteCompilerFixture();
      });
    await page.waitForFunction(() => window.suiteCompilerFixture);
    // Startup owns its asset URLs until application teardown. Complete that
    // activation before the compiler fixture tracks its own resource lifetime.
    await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation());
    await page.evaluate(() => {
      window.suiteCompilerFixture.capture = true;
    });
    for (const language of ['zh-CN', 'en'])
      for (const viewport of [
        { width: 1240, height: 720 },
        { width: 320, height: 240 },
      ]) {
        await page.setViewportSize(viewport);
        const fix1 =
          process.env.PARADOX_SUITE_CSS_FIX1 === '1' ||
          process.env.PARADOX_SUITE_CSS_FIX2 === '1' ||
          process.env.PARADOX_SUITE_CSS_FIX3 === '1';
        const running = page.evaluate(
          ({ lang, fix }) =>
            fix
              ? window.suiteCompilerFixture.runCssFix1(lang)
              : window.suiteCompilerFixture.run(lang),
          { lang: language, fix: fix1 },
        );
        const capture = await Promise.race([
          page
            .waitForFunction(() => window.suiteCompilerFixture.captureReady, {}, { timeout: 15000 })
            .then(() => true)
            .catch(() => false),
          running.then(() => false),
        ]);
        if (capture) {
          await page.evaluate(() => {
            const host = document.getElementById('suite-compiler-acceptance');
            for (const element of host?.querySelectorAll('*') ?? []) {
              for (const animation of element.getAnimations()) animation.finish();
              for (const child of element.shadowRoot?.querySelectorAll('*') ?? [])
                for (const animation of child.getAnimations()) animation.finish();
            }
          });
          await page.screenshot({ path: resolve(out, `${language}-${viewport.width}.png`) });
          await page.evaluate(() => window.suiteCompilerFixture.resumeCapture?.());
        }
        const result = await running;
        assert.deepEqual(result.failures, []);
        if (fix1) assert.equal(result.checks.length, 10);
        else {
          assert.ok(result.checks.includes('relative_modules_reexports_and_cjs_cycle'));
          assert.ok(result.checks.includes('dependency_change_vs_css_state'));
          assert.ok(result.checks.includes('assets_csp_and_failure_cleanup'));
        }
        report.rows.push({ language, viewport, ...result });
        assert.ok(capture, 'Actual compiled main/editor styles were captured before teardown');
        console.log(
          `PASS suite compiler ${language} ${viewport.width}x${viewport.height}: ${result.checks.length} checks`,
        );
      }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.cspViolations, []);
    if (process.env.PARADOX_TEST_NATIVE_CSP) {
      assert.ok(report.csp);
      assert.deepEqual(report.sourceRequests, []);
    }
  }
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await fixture.close();
}
