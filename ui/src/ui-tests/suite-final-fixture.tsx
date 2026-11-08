/** @jsxImportSource react */
import { useLauncherSnapshot, useLauncherActions } from '../launcher/public/context';
import { useUiEditorController } from '../ui-editor/controller';
import type { UiEditorController } from '../ui-editor/controller';
import type { LauncherActions, LauncherSnapshot, DeepReadonly } from '../launcher/public/types';
import { getBuiltinBundle } from '../ui-suite/builtins';
import { encodeSuiteArchive } from '../ui-suite/archive';
import { readRecoverableLibrary } from '../ui-suite/storage';
import { listOwners, getDomOwnership, registerOwner, registerDom, getSuiteStyleRoot } from '../customization/ownership';
import { attachSuiteStyles } from '../ui-suite/prepared';
import type { PreparedUiSuite } from '../ui-suite/prepared';
import i18n from '../i18n';

// Imported only by the foundation-test entry's existing source context. The
// desktop boundary is injected by the runner before the actual owner starts.
// eslint-disable-next-line react-refresh/only-export-components -- Mode-only source fault boundary.
export async function getFoundationBuiltinBundle(id: 'modern' | 'immersive') {
  const failure = (window as unknown as { foundationDesktop?: { sourceFailure?: string | null } }).foundationDesktop?.sourceFailure;
  if (failure) throw Error(failure);
  return getBuiltinBundle(id);
}

const replacementEditorSource = `import {useState} from 'react';import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';import {Button,Dialog,UiView} from '@paradox/ui';export default function Editor(){const s=useUiEditorSnapshot(),a=useUiEditorActions();const [value,setValue]=useState('');return <Dialog.Root open onOpenChange={open=>{if(!open)a.close()}}><Dialog.Portal><Dialog.Popup aria-label="Replacement editor" style={{pointerEvents:'auto',background:'#223',color:'white',padding:20}}><Dialog.Title render={<h1/>}>Replacement editor</Dialog.Title><input aria-label="Replacement local input" value={value} onChange={e=>setValue(e.currentTarget.value)}/><p data-pending>{s.pending}</p><p data-editor-draft>{s.dirty?'Unsaved':''}</p><Button onClick={()=>a.close()}>Close replacement</Button><UiView id="host.notifications"/></Dialog.Popup></Dialog.Portal></Dialog.Root>}`;
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 60));
const equal = (a: unknown, b: unknown, message: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(message);
};
const check = (value: unknown, message: string) => { if (!value) throw Error(message); };
interface Fixture {
  controller: UiEditorController;
  snapshot: DeepReadonly<LauncherSnapshot>;
  actions: LauncherActions;
  run(name: string): Promise<{ checks: string[]; failures: string[] }>;
  editOnboarding(id: 'modern' | 'immersive'): Promise<{ source: string; preview: boolean; saved: boolean; selected: string | null }>;
  setLanguage(language: string): Promise<unknown>;
  importValid(): Promise<boolean>;
  validArchive(): Promise<number[]>;
  savedRaw(): Promise<number[]>;
  sourceOwners(element: Element): unknown;
  probeStyleAttachment(prepared: PreparedUiSuite): string;
  owners: typeof listOwners;
  registerInspectorOwner: typeof registerOwner;
  registerInspectorDom: typeof registerDom;
}
declare global { interface Window { suiteFinalFixture: Fixture; } }
const desktop = () => (window as unknown as { foundationDesktop: {
  calls: {command:string}[]; suiteRaw: Uint8Array | null;
} }).foundationDesktop;
let exports: {name:string;blob:Blob}[] | null = null;
function captureDownloads() {
  if (exports) return exports;
  exports = [];
  const blobs = new Map<string, Blob>();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url=create(blob); if(blob instanceof Blob) blobs.set(url,blob); return url; };
  URL.revokeObjectURL = (url) => { blobs.delete(url); revoke(url); };
  const click = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'click')!.value as (this: HTMLAnchorElement) => void;
  HTMLAnchorElement.prototype.click = function() { const blob=blobs.get(this.href); if(blob && this.download) exports!.push({name:this.download,blob}); else click.call(this); };
  return exports;
}
export function Capture() {
  const controller = useUiEditorController(), snapshot = useLauncherSnapshot(), actions = useLauncherActions();
  window.suiteFinalFixture = {
    controller,snapshot,actions,
    async editOnboarding(id) {
      await controller.actions.copyBuiltin(id, 'Edited onboarding ' + id);
      const draft = controller.getSnapshot().draft!, source = draft.manifest.views['onboarding.style-choice'], file = draft.files[source];
      if (!source || file?.encoding !== 'utf8') throw Error('Expected editable onboarding binding');
      const heading = /(<h1\b[^>]*>)\s*\{t\(['"]onboarding\.title['"]\)\}\s*(<\/h1>)/;
      check(heading.test(file.text), 'current onboarding heading patch anchor');
      controller.actions.patchFile(source, file.text.replace(heading, '$1' + '{"Edited onboarding ' + id + '"}' + '$2'));
      // Register the ordinary source as a normal page so its saved version remains inspectable after restart.
      controller.actions.patchManifest({ views: { ...controller.getSnapshot().draft!.manifest.views, 'page.home': source }, routes: controller.getSnapshot().draft!.manifest.routes.map(route => route.id === 'home' ? { ...route, entry: source } : route) });
      const preview = await controller.actions.preview();
      await turn();
      check(document.querySelector('[data-style-choice] h1')?.textContent === 'Edited onboarding ' + id, 'actual onboarding Preview output: ' + JSON.stringify({ preview, diagnostics: controller.getSnapshot().diagnostics, heading: document.querySelector('[data-style-choice] h1')?.textContent, source: controller.getSnapshot().draft!.files[source] }));
      const owned = listOwners().filter(owner => owner.metadata.sourcePath === source);
      check(owned.length > 0, 'onboarding owns its actual source metadata');
      const saved = await controller.actions.save();
      return { source, preview, saved, selected: controller.getSnapshot().selectedSuiteId };
    },
    setLanguage: (language) => i18n.changeLanguage(language),
    owners: listOwners,
    probeStyleAttachment(prepared) {
      const boundary = getSuiteStyleRoot('launcher.main', controller.getActivation()!.primary.layerId);
      try { const detach = attachSuiteStyles(document, prepared, boundary); detach(); return 'attached'; }
      catch (error) { return String(error); }
      finally { boundary.dispose(); }
    },
    registerInspectorOwner: registerOwner,
    registerInspectorDom: registerDom,
    sourceOwners: (element) => getDomOwnership(element),
    async validArchive() { return Array.from(await encodeSuiteArchive(await getBuiltinBundle('modern'))); },
    async savedRaw() { return Array.from(await readRecoverableLibrary()); },
    async importValid() {
      const archive = await encodeSuiteArchive(await getBuiltinBundle('modern'));
      return controller.actions.importBundle(new File([archive.slice().buffer], 'Imported.paradox-ui'));
    },
    async run(name) {
      const checks: string[]=[], failures: string[]=[], c=controller, a=actions;
      try {
        await i18n.changeLanguage('en-US');
        for(let i=0;i<150&&!c.getActivation();i++)await turn();
        check(c.getActivation(), 'current default controller activation');
        const stableController = c, stableActions = window.suiteFinalFixture.actions;
        const bootCommands = () => desktop().calls.filter(x=>['get_config','account_state','account_recovery','download_tasks','plugin:event|listen'].includes(x.command)).map(x=>x.command);
        if(name==='custom_editor_then_recovery') {
          const sink=captureDownloads();
          await c.actions.copyBuiltin('modern','Actual self replacement');
          c.actions.createFile('Editor.tsx','tsx');
          c.actions.patchFile('Editor.tsx',replacementEditorSource);
          c.actions.patchManifest({views:{...c.getSnapshot().draft!.manifest.views,'tool.editor':'Editor.tsx'}});
          c.actions.selectFile('Editor.tsx');
          c.actions.selectTarget({kind:'type',target:'page.home'});
          a.settings.patch('memory_mb',6144);
          c.actions.open();
          check(await c.actions.preview(),'self replacement preview');await turn();
          const shadow=document.getElementById('paradox-suite-editor')!.shadowRoot!;
          check(shadow.textContent?.includes('Replacement editor'),'custom editor heading visible');
          equal(c.getSnapshot().draft!.files['Editor.tsx'],{encoding:'utf8',text:replacementEditorSource},'exact self replacement draft');
          check(c.getSnapshot().selection?.selector.target==='page.home','same selection retained');
          check(window.suiteFinalFixture.controller===stableController,'same controller during replacement');
          c.actions.close();c.actions.open();await turn();
          check(c.getSnapshot().dirty && c.getSnapshot().selectedFile==='Editor.tsx','close/reopen retains exact draft and source selection');
          const input=shadow.querySelector<HTMLInputElement>('[aria-label="Replacement local input"]')!;
          const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!;
          descriptor.set!.call(input,'retained local draft');input.dispatchEvent(new Event('input',{bubbles:true}));
          await turn();
          const beforeComponent=c.getActivation()!.primary.prepared.views.get('tool.editor');
          const cssPath='Final.css';c.actions.createFile(cssPath,'css');c.actions.patchFile(cssPath,'.app-shell{--final-preview:1}');
          c.actions.patchManifest({styles:[...c.getSnapshot().draft!.manifest.styles,cssPath]});
          check(await c.actions.preview(),'CSS-only preview');await turn();
          check(shadow.querySelector('[aria-label="Replacement local input"]')===input,'actual editor DOM retained on CSS-only preview');
          check(c.getActivation()!.primary.prepared.views.get('tool.editor')===beforeComponent,'actual editor Component retained');
          check(await c.actions.save(),'actual user source save');
          const raw=Array.from(desktop().suiteRaw!);
          c.actions.patchFile('Editor.tsx','export default function BrokenEditor(){throw new Error("Task13 actual editor crash")}');
          c.actions.patchFile(cssPath,'.app-shell{visibility:hidden}');
          check(await c.actions.preview(),'editor crash source prepared');await turn();
          check(getComputedStyle(document.querySelector('.app-shell')!).visibility==='hidden','user global hidden CSS is active');
          window.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',ctrlKey:true,shiftKey:true,bubbles:true}));await turn();
          const recovery=document.getElementById('paradox-suite-recovery')!.shadowRoot!;
          check(recovery.textContent?.includes('Disable user UI'),'fixed Recovery available after actual editor failure');
          check(c.getSnapshot().suspended,'synchronous emergency deactivation');
          await c.recovery.exportRecoverable();
          equal(Array.from(new Uint8Array(await [...sink].reverse().find(x=>x.name==='ui-suite-library.recoverable.bin')!.blob.arrayBuffer())),raw,'raw recovery export exact persisted bytes');
          c.recovery.openBuiltinEditor();await turn();
          check(shadow.textContent?.includes('UI Suite Editor'),'trusted editor repairs same draft');
          const broken = c.getSnapshot().draft!.files['Editor.tsx'];
          check(broken.encoding==='utf8' && broken.text.includes('BrokenEditor'),'Recovery preserves broken unsaved source');
          equal(window.suiteFinalFixture.snapshot.settings.draft?.memory_mb,6144,'unfinished business draft retained');
          checks.push('actual_self_replacement_same_controller_draft_selection','close_reopen_and_css_only_same_dom_component','actual_hidden_css_editor_crash_fixed_recovery','raw_saved_bytes_export_and_protected_same_draft_repair');
        } else if(name==='complete_suite_switch_keeps_controllers') {
          a.settings.patch('memory_mb',7168);a.accounts.patchClientId('unfinished-client');a.java.patchDownloadMajor('21');a.content.patchSearch({query:'unfinished-query'});await turn();
          const before=bootCommands();
          for(const id of ['builtin.immersive','builtin.modern']){check(await c.actions.selectSuite(id),'actual full suite switch ACK');await turn();}
          equal(bootCommands(),before,'suite switch causes no bootstrap or subscriptions');
          check(window.suiteFinalFixture.controller===stableController && window.suiteFinalFixture.actions===stableActions,'same controller and permanent business action ownership');
          const current=window.suiteFinalFixture.snapshot;
          equal([current.settings.draft?.memory_mb,current.accounts.clientIdDraft,current.java.downloadMajorDraft,current.content.query],[7168,'unfinished-client','21','unfinished-query'],'all unfinished domain drafts retained');
          checks.push('complete_modern_immersive_switch_actual_cas','no_bootstrap_or_subscriptions','same_controller_actions_and_all_domain_drafts');
        } else if(name==='old_namespace_untouched') {
          const seeded={'paradox.ui-customization.v1':'{malformed legacy bytes\n','paradox.ui-customization.v1.recovery.keep':'{"kind":"paradox-ui-customization","enabled":true}','ui-customization-legacy.json':'opaque desktop-name marker'};
          await c.actions.copyBuiltin('modern','New library only');check(await c.actions.save(),'new source saved');
          check(await c.actions.selectSuite('builtin.immersive'),'new default selection ACK');
          c.actions.requestReset();check(await c.actions.confirmReset(),'new library reset');
          for(const [key,value]of Object.entries(seeded))equal(localStorage.getItem(key),value,'old namespace raw bytes remain untouched: '+key);
          equal(sessionStorage.getItem('paradox.ui-customization.safe'),'opaque legacy safe bytes','old session namespace untouched');
          check(!desktop().calls.some(x=>/^(get|save|reset)_ui_customization$/.test(x.command)),'removed API never invoked');
          checks.push('new_load_copy_save_select_reset_only','malformed_valid_backup_old_bytes_untouched','legacy_session_bytes_untouched','no_old_ipc');
        } else throw Error('Unknown final scenario '+name);
      } catch(error) { failures.push(String(error)); }
      return {checks,failures};
    },
  };
  return null;
}
