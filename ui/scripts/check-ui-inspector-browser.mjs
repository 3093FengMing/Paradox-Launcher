import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';

const label = process.env.PARADOX_FINAL_EVIDENCE ?? 'manual-run';
const previewOnly = process.argv.includes('--preview-only');
const pickerOnly = process.argv.includes('--picker-only');
const out = resolve(`../.test-data/inspector-task-${pickerOnly ? 3 : previewOnly ? 2 : 1}/browser`, label);
await mkdir(out, { recursive: true });
const report = { rows: [] };
const sourceOnly = process.argv.includes('--source-only');
const onlyCases = process.env.PARADOX_INSPECTOR_CASES && new RegExp(process.env.PARADOX_INSPECTOR_CASES);
const fixture = await createBrowserFixture({ desktopBoundary: true });
const { page } = fixture;
page.setDefaultTimeout(15000);
const check = async (name, fn) => {
  if (onlyCases && !onlyCases.test(name)) return;
  if (sourceOnly && !['canonical_source_file_search_unknown_override', 'page_errors_and_actual_compiled_desktop_csp'].includes(name)) return;
  try { const detail = await fn(); report.rows.push({ name, detail }); console.log('PASS ' + name); }
  catch (error) { report.rows.push({ name, failure: String(error) }); console.error('FAIL ' + name + ' ' + error); process.exitCode = 1; }
};
try {
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
  await page.evaluate(async (pickerOnly) => {
    await window.suiteFinalFixture.setLanguage('en-US');
    window.suiteFinalFixture.actions.navigation.navigate(pickerOnly ? 'home' : 'accounts');
    await window.suiteFinalFixture.controller.actions.copyBuiltin('modern', 'Inspector browser source');
  }, pickerOnly);
  await page.waitForFunction(() => window.suiteFinalFixture.owners().some((owner) => owner.target === 'component.account-avatar'));
  await page.keyboard.press('Control+Shift+F11');
  const editor = page.getByRole('dialog', { name: 'UI Suite Editor', exact: true });
  await editor.waitFor();
  if (pickerOnly) {
    await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      window.inspectorPointerCalls = [];
      const source = `import {Fragment} from 'react';import {Dialog,Button} from '@paradox/ui';export default function Pick({props}){const index=props.index??0;const call=e=>window.inspectorPointerCalls.push(e.type);return <Fragment key="pick-fragment"><section data-ui-site="Pick-section" key="pick-section" data-pick-root style={{position:'fixed',top:260,left:20+index*270,width:240,height:90,background:'#abc'}}><button data-ui-site="Pick-button" key="pick-button" data-pick-button onPointerDown={call} onPointerUp={call} onMouseDown={call} onMouseUp={call} onClick={call}><span data-ui-site="Pick-icon" key="pick-icon" data-pick-icon>Pick icon</span></button><Button data-ui-site="Pick-control" key="pick-control" data-pick-control onClick={call}>Control pick</Button></section><Dialog.Root data-ui-site="Pick-dialog" key="pick-dialog" open modal={false}><Dialog.Portal data-ui-site="Pick-portal" key="pick-portal" style={{position:"fixed",top:370,left:20+index*270,width:170,height:60}}><Dialog.Popup data-ui-site="Pick-popup" key="pick-popup" aria-label="Pick portal" style={{position:'fixed',top:370,left:20+index*270,width:170,height:60,pointerEvents:'auto'}}>Separate portal</Dialog.Popup></Dialog.Portal></Dialog.Root></Fragment>}`;
      c.actions.createFile('Pick.tsx','tsx'); c.actions.patchFile('Pick.tsx',source);
      c.actions.createFile('PickAccounts.tsx','tsx'); c.actions.patchFile('PickAccounts.tsx',`import {Fragment,useState} from 'react';import {UiView,UiIdentity} from '@paradox/ui';export default function Accounts(){const [keys,setKeys]=useState(["one","two","three"]);window.inspectorReorder=()=>setKeys(["three","one","two"]);return <Fragment data-ui-site="Pick-accounts-root" key="pick-accounts-root"><UiIdentity data-ui-site="Pick-identity" key="pick-identity" namespace="account" value="account-a">{keys.map((key,index)=><UiView data-ui-site="Pick-view" key={key} id="component.inspector-pick" props={{index}}/>)}</UiIdentity></Fragment>}`);
      c.actions.patchManifest({views:{...c.getSnapshot().draft.manifest.views,'page.accounts':'PickAccounts.tsx','component.inspector-pick':'Pick.tsx'},routes:c.getSnapshot().draft.manifest.routes.map(r=>r.id==='accounts'?{...r,entry:'PickAccounts.tsx'}:r)});
      if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));
      window.suiteFinalFixture.actions.navigation.navigate('accounts');
    });
    await page.waitForFunction(()=>window.suiteFinalFixture.owners().filter(o=>o.target==='component.inspector-pick' && o.roots.size===2).length===3);
    if(process.argv.includes('--source-reorder-probe')) {
      await page.evaluate(()=>window.suiteFinalFixture.controller.actions.beginPick());
      await page.locator('[data-pick-icon]').last().hover();
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.selectTarget(c.getSnapshot().targetAncestors.find(d=>d.selector.target==='component.inspector-pick').selector);});
      await page.waitForFunction(()=>document.querySelector('[data-ui-inspector-artifact="range"]')?.shadowRoot.querySelectorAll('[data-ui-inspector-rect]').length===2);
    }
    if(process.argv.includes('--source-reorder-probe'))await check('source_code_reorder_origin_probe',async()=>{
      const result=await page.evaluate(async()=>{const f=window.suiteFinalFixture,c=f.controller;const selector=c.getSnapshot().selection.selector,before=c.getSnapshot().currentTarget,source=c.getSnapshot().draft.files['PickAccounts.tsx'].text,next=source.replace('useState(["one","two","three"])','useState(["three","one","two"])');c.actions.patchFile('PickAccounts.tsx',next);const preview=await c.actions.preview();await new Promise(y=>setTimeout(y,150));const after=c.getSnapshot().currentTarget,owners=f.owners().filter(o=>o.target==='page.accounts'||o.target==='component.inspector-pick').map(o=>({ownerId:o.ownerId,parentOwnerId:o.parentOwnerId,target:o.target,stability:o.stability,locator:o.locator,rootCount:o.roots.size})),ranges=[...document.querySelectorAll('[data-ui-inspector-artifact="range"]')].reduce((n,h)=>n+h.shadowRoot.querySelectorAll('[data-ui-inspector-rect]').length,0),rangeHosts=document.querySelectorAll('[data-ui-inspector-artifact="range"]').length;c.actions.cancelPick();return {source,next,selector,before,preview,after,owners,ranges,rangeHosts,diagnostics:c.getSnapshot().diagnostics};});await writeFile(resolve(out,'source-code-reorder-origin-probe.json'),JSON.stringify(result,null,2));assert.equal(result.after.status,'resolved');assert.equal(result.after.matchCount,1);assert.ok(result.rangeHosts>0,'ranges must remain established after this source preview');return result;
    });
    await check('pointerdown_is_consumed', async () => {
      await page.evaluate(()=>window.suiteFinalFixture.controller.actions.beginPick());
      await page.waitForTimeout(100);
      await writeFile(resolve(out,'picker-hit-target.json'),JSON.stringify(await page.evaluate(()=>{const b=document.querySelectorAll('[data-pick-button]')[2],r=b.getBoundingClientRect(),h=document.getElementById('paradox-suite-editor');return {rect:r.toJSON(),host:getComputedStyle(h).pointerEvents,hint:h.shadowRoot.querySelector('.ui-pick-hint')?.getBoundingClientRect().toJSON(),point:document.elementFromPoint(r.x+5,r.y+5)?.outerHTML,shadowPoint:h.shadowRoot.elementFromPoint(r.x+5,r.y+5)?.outerHTML};}),null,2));
      const button=page.locator('[data-pick-button]').last(); await button.hover();
      await page.mouse.down();
      assert.deepEqual(await page.evaluate(()=>window.inspectorPointerCalls),[], 'business pointerdown must be consumed before click');
      assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().picking),true);
      await page.mouse.up(); await page.waitForTimeout(40);
      assert.deepEqual(await page.evaluate(()=>window.inspectorPointerCalls),[]);
      assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().picking),false);
      return page.evaluate(()=>({calls:window.inspectorPointerCalls,selector:window.suiteFinalFixture.controller.getSnapshot().selection.selector}));
    });
    await check('picker_long_held_escape_consumes_native_release', async () => {
      await page.evaluate(() => {
        const c = window.suiteFinalFixture.controller; c.actions.cancelPick(); window.inspectorPointerCalls = [];
        const names = new Set(['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown']);
        const live = new Map(), add = window.addEventListener, remove = window.removeEventListener;
        window.addEventListener = function(name, listener, options) { if (names.has(name) && options === true) { const listeners = live.get(name) ?? new Set(); listeners.add(listener); live.set(name, listeners); } return add.call(this, name, listener, options); };
        window.removeEventListener = function(name, listener, options) { live.get(name)?.delete(listener); return remove.call(this, name, listener, options); };
        window.inspectorHeldProbe = { count: () => [...live.values()].reduce((total, listeners) => total + listeners.size, 0), restore: () => { window.addEventListener = add; window.removeEventListener = remove; } };
        c.actions.beginPick();
      });
      let result;
      try {
        await page.locator('[data-pick-button]').last().hover();
        await page.waitForFunction(() => document.querySelector('[data-ui-inspector-artifact="range"]'));
        await page.mouse.down();
        const pressed = await page.evaluate(() => ({ listeners: window.inspectorHeldProbe.count(), calls: [...window.inspectorPointerCalls] }));
        await page.keyboard.press('Escape');
        const cancelled = await page.evaluate(() => ({ picking: window.suiteFinalFixture.controller.getSnapshot().picking, listeners: window.inspectorHeldProbe.count(), ranges: document.querySelectorAll('[data-ui-inspector-artifact="range"]').length }));
        await page.waitForTimeout(1350);
        const held = await page.evaluate(() => {
          const c = window.suiteFinalFixture.controller, listeners = window.inspectorHeldProbe.count(); c.actions.beginPick();
          return { listeners, afterBegin: window.inspectorHeldProbe.count(), picking: c.getSnapshot().picking, calls: [...window.inspectorPointerCalls] };
        });
        await page.mouse.up(); await page.waitForTimeout(40);
        const released = await page.evaluate(() => ({ listeners: window.inspectorHeldProbe.count(), calls: [...window.inspectorPointerCalls], ranges: document.querySelectorAll('[data-ui-inspector-artifact="range"]').length }));
        await page.evaluate(() => window.suiteFinalFixture.controller.actions.beginPick());
        const next = await page.evaluate(() => ({ picking: window.suiteFinalFixture.controller.getSnapshot().picking, listeners: window.inspectorHeldProbe.count() }));
        await page.keyboard.press('Escape');
        result = { pressed, cancelled, held, released, next };
        await writeFile(resolve(out, 'picker-native-held-cancel.json'), JSON.stringify(result, null, 2));
      } finally {
        await page.mouse.up();
        await page.evaluate(() => { window.suiteFinalFixture.controller.actions.cancelPick(); window.inspectorHeldProbe.restore(); });
      }
      assert.equal(result.pressed.listeners, 11); assert.deepEqual(result.pressed.calls, []);
      assert.deepEqual(result.cancelled, { picking: false, listeners: 11, ranges: 0 });
      assert.deepEqual(result.held, { listeners: 11, afterBegin: 11, picking: false, calls: [] });
      assert.deepEqual(result.released, { listeners: 0, calls: [], ranges: 0 });
      assert.deepEqual(result.next, { picking: true, listeners: 11 });
      return result;
    });
    await check('pick_exact_position_and_expand_scope', async () => {
      await page.evaluate(()=>window.suiteFinalFixture.controller.actions.beginPick());
      await page.locator('[data-pick-icon]').last().hover();
      const hovered=await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().currentTarget);
      await writeFile(resolve(out,'picker-icon-ownership.json'),JSON.stringify(await page.evaluate(()=>{const f=window.suiteFinalFixture,r=document.querySelectorAll('[data-pick-icon]')[2],d=f.sourceOwners(r);return {dom:d,owners:f.owners().filter(o=>d?.ownerIds.includes(o.ownerId)).map(o=>({id:o.ownerId,target:o.target,stability:o.stability,locator:o.locator,rootCount:o.roots.size})),hovered:f.controller.getSnapshot().currentTarget};}),null,2));
      assert.equal(hovered.selector.kind,'position'); assert.match(hovered.selector.target,/span/); assert.equal(hovered.matchCount,1);
      await page.locator('[data-pick-icon]').last().click(); await page.waitForTimeout(40);
      const result=await page.evaluate(()=>{const c=window.suiteFinalFixture.controller, exact=c.getSnapshot().selection.selector; const parent=c.getSnapshot().targetAncestors.find(d=>d.selector.target==='component.inspector-pick'); if(!parent)throw Error('logical component ancestor missing'); c.actions.selectTarget(parent.selector);c.actions.setScope('business');const broad=c.getSnapshot().currentTarget;c.actions.setScope('position');return {exact,parent:parent.selector,broad,restored:c.getSnapshot().selection.selector,calls:window.inspectorPointerCalls};});
      assert.equal(result.exact.kind,'position');assert.equal(result.broad.matchCount,3);assert.deepEqual(result.restored,result.parent);assert.deepEqual(result.calls,[]);return result;
    });
    await check('rectangles_track_scroll_and_multiple_roots', async () => {
      await page.evaluate(()=>window.suiteFinalFixture.controller.actions.beginPick()); await page.locator('[data-pick-icon]').last().hover();
      const read=()=>page.evaluate(()=>[...document.querySelector('[data-ui-inspector-artifact="range"]').shadowRoot.querySelectorAll('[data-ui-inspector-rect]')].map(e=>['left','top','width','height'].map(k=>parseFloat(e.style[k]))));
      await page.waitForFunction(()=>document.querySelector('[data-ui-inspector-artifact="range"]'));
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.selectTarget(c.getSnapshot().targetAncestors.find(d=>d.selector.target==='component.inspector-pick').selector);});
      await page.waitForTimeout(80);const before=await read();await writeFile(resolve(out,'picker-parent-ranges.json'),JSON.stringify(await page.evaluate(()=>{const c=window.suiteFinalFixture.controller,o=window.suiteFinalFixture.owners().find(o=>o.ownerId===c.getSnapshot().currentTarget.ownerId);return {target:c.getSnapshot().currentTarget,hosts:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length,roots:[...o.roots].map(r=>({html:r.outerHTML,rects:[...r.getClientRects()].map(b=>b.toJSON()),visibility:getComputedStyle(r).visibility,opacity:getComputedStyle(r).opacity}))};}),null,2));assert.equal(before.length,2);
      if(process.env.PARADOX_CAPTURE_TASK4==='1')await page.screenshot({path:resolve('../docs/screenshots/ui-framework-picker.png')});
      await page.evaluate(()=>{const root=document.querySelectorAll('[data-pick-root]')[2];root.style.top='115px';root.style.width='210px';window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(80);const after=await read();assert.notDeepEqual(after,before);
      const expected=await page.evaluate(()=>{const c=window.suiteFinalFixture.controller,o=window.suiteFinalFixture.owners().find(o=>o.ownerId===c.getSnapshot().currentTarget.ownerId);return [...o.roots].flatMap(r=>[...r.getClientRects()].filter(b=>b.width>0&&b.height>0)).map(r=>[r.left,r.top,r.width,r.height]);});assert.deepEqual(after,expected);
      await page.keyboard.press('Escape');await page.waitForTimeout(40);assert.equal(await page.locator('[data-ui-inspector-artifact="range"]').count(),0);return {before,after,expected};
    });
    await check('picker_excludes_recovery_and_mirror', async () => {
      const result=await page.evaluate(async()=>{const c=window.suiteFinalFixture.controller;c.actions.beginPick();const root=document.querySelector('[data-pick-icon]');root.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));const before=c.getSnapshot().selection.selector;const container=document.createElement('div');document.body.append(container);const h=c.actions.createDomPreview(before,container);const clone=container.querySelector('[data-ui-inspector-artifact]');clone.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));clone.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true}));clone.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));const recovery=document.getElementById('paradox-suite-recovery');for(const n of ['pointermove','pointerdown','pointerup','click'])recovery.dispatchEvent(n==='click'?new MouseEvent(n,{bubbles:true,composed:true,cancelable:true}):new PointerEvent(n,{pointerId:21,bubbles:true,composed:true,cancelable:true}));const after=c.getSnapshot().selection.selector,picking=c.getSnapshot().picking;h.dispose();container.remove();c.actions.cancelPick();return {before,after,picking};});assert.deepEqual(result.after,result.before);assert.equal(result.picking,true);return result;
    });
    await check('pointer_compatibility_escape_single_lease_cleanup', async () => {
      const result=await page.evaluate(async()=>{
        const c=window.suiteFinalFixture.controller, button=document.querySelectorAll('[data-pick-button]')[2];c.actions.cancelPick();window.inspectorPointerCalls=[];
        const names=new Set(['pointermove','pointerdown','pointerup','pointercancel','mousedown','mouseup','click','dblclick','auxclick','contextmenu']),live=new Map(),add=window.addEventListener,remove=window.removeEventListener;
        window.addEventListener=function(n,f,o){if(names.has(n)&&o===true){const set=live.get(n)||new Set();set.add(f);live.set(n,set);}return add.call(this,n,f,o);};window.removeEventListener=function(n,f,o){live.get(n)?.delete(f);return remove.call(this,n,f,o);};
        let owned=null;const count=()=>[...live.values()].reduce((n,s)=>n+[...s].filter(f=>!owned||owned.has(f)).length,0), frame=()=>new Promise(y=>setTimeout(y,40));
        try{c.actions.beginPick();const first=count();owned=new Set([...live.values()].flatMap(s=>[...s]));c.actions.beginPick();const duplicate=count();button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,bubbles:true,composed:true,cancelable:true}));button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));const cancelled=!c.getSnapshot().picking,draining=count();button.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,bubbles:true,composed:true,cancelable:true}));button.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true,cancelable:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true,cancelable:true}));await frame();const afterCancel=count();c.actions.beginPick();button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));for(const n of ['pointerdown','mousedown','pointerup','mouseup','click'])button.dispatchEvent(n.startsWith('pointer')?new PointerEvent(n,{pointerId:8,bubbles:true,composed:true,cancelable:true}):new MouseEvent(n,{bubbles:true,composed:true,cancelable:true}));await frame();return {first,duplicate,cancelled,draining,afterCancel,afterSelect:count(),calls:window.inspectorPointerCalls,rangeHosts:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length};}
        finally{c.actions.cancelPick();window.addEventListener=add;window.removeEventListener=remove;}
      });await writeFile(resolve(out,'picker-compatibility.json'),JSON.stringify(result,null,2));assert.equal(result.first,result.duplicate);assert.ok(result.first>0);assert.equal(result.cancelled,true);assert.ok(result.draining>0);assert.equal(result.afterCancel,0);assert.equal(result.afterSelect,0);assert.deepEqual(result.calls,[]);assert.equal(result.rangeHosts,0);return result;
    });
    await check('range_root_replacement_shadow_native_scroll_and_ambiguity', async () => {
      const result=await page.evaluate(async()=>{
        const f=window.suiteFinalFixture,c=f.controller,host=document.createElement('div');host.style.cssText='position:fixed;left:600px;top:200px;width:150px;height:120px';document.body.append(host);const shadow=host.attachShadow({mode:'open'}),scroll=document.createElement('div');scroll.style.cssText='overflow:auto;height:80px;width:140px';const content=document.createElement('div');content.style.height='400px';const button=document.createElement('button');button.textContent='Shadow picker';content.append(button);scroll.append(content);shadow.append(scroll);
        const target='control.inspector-shadow-picker',locator={version:1,renderRoot:'launcher.main',calls:[{site:'inspector-shadow-picker',key:'stable'}],business:[]},row={ownerId:'inspector-shadow-picker',parentOwnerId:null,target,site:locator.calls[0].site,locator,stability:'stable',roots:new Set([button]),metadata:{nameKey:null,type:'control',sourcePath:null,routeId:null},catalogPresentation:false,viewId:null,layerId:null};let unowner=f.registerInspectorOwner(row),undom=f.registerInspectorDom(button,{ownerIds:[row.ownerId],rootOwnerIds:[row.ownerId],leafOwnerId:row.ownerId});const frames=()=>new Promise(y=>setTimeout(y,80)),read=()=>[...(document.querySelector('[data-ui-inspector-artifact="range"]')?.shadowRoot.querySelectorAll('[data-ui-inspector-rect]')??[])].map(e=>['left','top','width','height'].map(k=>parseFloat(e.style[k])));
        try{c.actions.beginPick();button.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));await frames();const initialTarget=c.getSnapshot().currentTarget, nativeDom=f.sourceOwners(button), nativeOwners=f.owners().filter(o=>o.ownerId===row.ownerId).map(o=>({target:o.target,stability:o.stability,roots:[...o.roots].map(r=>r.getBoundingClientRect().toJSON())})),before=read();scroll.scrollTop=25;await frames();const scrolled=read();const next=document.createElement('button');next.textContent='Replacement root';next.style.width='100px';button.replaceWith(next);undom();unowner();unowner=f.registerInspectorOwner({...row,roots:new Set([next])});undom=f.registerInspectorDom(next,{ownerIds:[row.ownerId],rootOwnerIds:[row.ownerId],leafOwnerId:row.ownerId});await frames();const replaced=read(),r=next.getBoundingClientRect();c.actions.cancelPick();const twin=document.createElement('button');twin.textContent='Ambiguous twin';content.prepend(twin);const untwin=f.registerInspectorOwner({...row,ownerId:'inspector-shadow-twin',roots:new Set([twin])});try{c.actions.beginPick();next.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));const ambiguous=c.getSnapshot().currentTarget;for(const n of ['pointerdown','pointerup','click'])next.dispatchEvent(n==='click'?new MouseEvent(n,{bubbles:true,composed:true,cancelable:true}):new PointerEvent(n,{pointerId:9,bubbles:true,composed:true,cancelable:true}));await frames();return {initialTarget,nativeDom,nativeOwners,before,scrolled,replaced,expected:[[r.left,r.top,r.width,r.height]],ambiguous,picking:c.getSnapshot().picking,afterRanges:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length};}finally{untwin();}}
        finally{c.actions.cancelPick();undom();unowner();host.remove();}
      });await writeFile(resolve(out,'picker-shadow-ranges.json'),JSON.stringify(result,null,2));assert.notDeepEqual(result.scrolled,result.before);assert.notDeepEqual(result.replaced,result.scrolled);assert.deepEqual(result.replaced,result.expected);assert.equal(result.ambiguous.status,'ambiguous');assert.equal(result.ambiguous.ownerId,null);assert.equal(result.picking,false);assert.equal(result.afterRanges,0);return result;
    });
    await check('stable_key_reorder_keeps_position_and_ranges', async () => {
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.cancelPick();document.querySelectorAll('[data-pick-root]')[2].style.top='260px';c.actions.beginPick();});
      await page.locator('[data-pick-icon]').last().hover();
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.selectTarget(c.getSnapshot().targetAncestors.find(d=>d.selector.target==='component.inspector-pick').selector);});
      await page.waitForFunction(()=>document.querySelector('[data-ui-inspector-artifact="range"]')?.shadowRoot.querySelectorAll('[data-ui-inspector-rect]').length===2);
      const beforeReorder=await page.evaluate(()=>{const c=window.suiteFinalFixture.controller,selector=c.getSnapshot().selection.selector;window.inspectorReorder();return selector;});
      await page.waitForTimeout(100);
      const result=await page.evaluate((before)=>{const c=window.suiteFinalFixture.controller;const after=c.getSnapshot().selection.selector,target=c.getSnapshot().currentTarget,owner=window.suiteFinalFixture.owners().find(o=>o.ownerId===target.ownerId),roots=[...(owner?.roots??[])].map(r=>r.getBoundingClientRect()).map(r=>[r.left,r.top,r.width,r.height]),ranges=[...(document.querySelector('[data-ui-inspector-artifact="range"]')?.shadowRoot.querySelectorAll('[data-ui-inspector-rect]')??[])].map(e=>['left','top','width','height'].map(k=>parseFloat(e.style[k])));c.actions.cancelPick();return {before,after,target,roots,ranges,picking:c.getSnapshot().picking};},beforeReorder);await writeFile(resolve(out,'picker-key-reorder.json'),JSON.stringify(result,null,2));assert.deepEqual(result.after,result.before);assert.equal(result.target.status,'resolved');assert.equal(result.target.matchCount,1);assert.equal(result.roots[0][0],20);assert.deepEqual(result.ranges,result.roots);return result;
    });
    await check('canonical_scope_controls_and_same_selector_css_structure', async () => {
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.beginPick();const root=document.querySelectorAll('[data-pick-root]')[2];root.style.top='260px';root.querySelector('[data-pick-icon]').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));});
      const hint=page.locator('.ui-pick-hint');await hint.getByRole('button',{name:/component\.inspector-pick$/}).click();
      const parent=await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().selection.selector);assert.equal(parent.kind,'position');
      await hint.getByRole('button',{name:/^Same business item ·/}).click();
      assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().currentTarget.matchCount),3);
      assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().picking),true);
      await hint.getByRole('button',{name:/^This position ·/}).click();assert.deepEqual(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().selection.selector),parent);
      const result=await page.evaluate(async(parent)=>{
        const c=window.suiteFinalFixture.controller;c.actions.cancelPick();c.actions.createFile('PickExact.css','css');c.actions.patchFile('PickExact.css','[data-pick-root]{background:rgb(123,45,67)!important}');c.actions.patchManifest({overrides:[...c.getSnapshot().draft.manifest.overrides,{selector:parent,enabled:true,entry:null,stylesheet:'PickExact.css'}]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await new Promise(y=>setTimeout(y,80));const colors=[...document.querySelectorAll('[data-pick-root]')].map(r=>getComputedStyle(r).backgroundColor),binding=c.getSnapshot().draft.manifest.overrides.find(o=>JSON.stringify(o.selector)===JSON.stringify(parent));c.actions.createFile('PickReplacement.tsx','tsx');c.actions.patchFile('PickReplacement.tsx','export default function Replacement(){return <section data-ui-site="Pick-replaced" key="replaced" data-pick-replacement>Exact replacement</section>}');c.actions.patchManifest({overrides:c.getSnapshot().draft.manifest.overrides.map(o=>o===binding?{...o,entry:'PickReplacement.tsx'}:JSON.stringify(o.selector)===JSON.stringify(parent)?{...o,entry:'PickReplacement.tsx'}:o)});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await new Promise(y=>setTimeout(y,80));const count=document.querySelectorAll('[data-pick-replacement]').length,remaining=document.querySelectorAll('[data-pick-root]').length,stored=c.getSnapshot().draft.manifest.overrides.find(o=>o.entry==='PickReplacement.tsx').selector;c.actions.patchManifest({overrides:c.getSnapshot().draft.manifest.overrides.filter(o=>o.entry!=='PickReplacement.tsx')});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await new Promise(y=>setTimeout(y,80));return {colors,count,remaining,stored};
      },parent);await writeFile(resolve(out,'picker-css-structure.json'),JSON.stringify(result,null,2));assert.deepEqual(result.colors,['rgb(170, 187, 204)','rgb(170, 187, 204)','rgb(123, 45, 67)']);assert.equal(result.count,1);assert.equal(result.remaining,2);assert.deepEqual(result.stored,parent);return {parent,...result};
    });
    await check('business_type_css_structural_same_selector_regression',async()=>{
      const result=await page.evaluate(async()=>{const c=window.suiteFinalFixture.controller,frame=()=>new Promise(y=>setTimeout(y,60));c.actions.cancelPick();c.actions.createFile('PickBroad.css','css');c.actions.patchFile('PickBroad.css','[data-pick-root]{background:rgb(11,22,33)!important}');if(!c.getSnapshot().draft.files['PickReplacement.tsx']){c.actions.createFile('PickReplacement.tsx','tsx');c.actions.patchFile('PickReplacement.tsx','export default function Replacement(){return <section data-ui-site="Pick-replaced" key="replaced" data-pick-replacement>Exact replacement</section>}');}const rows=[];for(const selector of [{kind:'business',target:'component.inspector-pick',identity:{namespace:'account',value:'account-a'}},{kind:'type',target:'component.inspector-pick'}]){c.actions.selectTarget(selector);c.actions.patchManifest({overrides:[{selector,enabled:true,entry:null,stylesheet:'PickBroad.css'}]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await frame();const colors=[...document.querySelectorAll('[data-pick-root]')].map(r=>getComputedStyle(r).backgroundColor);c.actions.patchManifest({overrides:[{selector,enabled:true,entry:'PickReplacement.tsx',stylesheet:'PickBroad.css'}]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await frame();rows.push({selector,stored:c.getSnapshot().draft.manifest.overrides[0].selector,colors,replacements:document.querySelectorAll('[data-pick-replacement]').length});c.actions.patchManifest({overrides:[]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await frame();}return rows;});for(const row of result){assert.deepEqual(row.colors,['rgb(11, 22, 33)','rgb(11, 22, 33)','rgb(11, 22, 33)']);assert.equal(row.replacements,3);assert.deepEqual(row.stored,row.selector);}return result;
    });
    await check('existing_control_callsite_position_structural_regression',async()=>{
      await page.evaluate(()=>{const c=window.suiteFinalFixture.controller;c.actions.cancelPick();c.actions.beginPick();});await page.locator('[data-pick-control]').last().hover();
      const result=await page.evaluate(async()=>{const c=window.suiteFinalFixture.controller,s=c.getSnapshot(),target=[s.currentTarget,...s.targetAncestors].find(d=>d.selector.kind==='position'&&d.selector.locator.calls.at(-1).site.endsWith(':Pick-control'));if(!target)throw Error('Current public Button callsite owner missing');const selector=target.selector;c.actions.selectTarget(selector);c.actions.cancelPick();c.actions.createFile('PickControlReplacement.tsx','tsx');c.actions.patchFile('PickControlReplacement.tsx','export default function Replacement(){return <button data-ui-site="Pick-control-replaced" key="replaced" data-pick-control-replacement>Replaced control</button>}');c.actions.patchManifest({overrides:[{selector,enabled:true,entry:'PickControlReplacement.tsx',stylesheet:null}]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await new Promise(y=>setTimeout(y,80));const replacements=document.querySelectorAll('[data-pick-control-replacement]').length,remaining=document.querySelectorAll('[data-pick-control]').length,stored=c.getSnapshot().draft.manifest.overrides[0].selector;c.actions.patchManifest({overrides:[]});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));return {selector,stored,replacements,remaining};});await writeFile(resolve(out,'picker-control-callsite.json'),JSON.stringify(result,null,2));assert.equal(result.replacements,1);assert.equal(result.remaining,2);assert.deepEqual(result.stored,result.selector);return result;
    });
    await check('editor_replacement_crash_escape_f12_cancel', async () => {
      const result=await page.evaluate(async()=>{
        const f=window.suiteFinalFixture,c=f.controller,frame=()=>new Promise(y=>setTimeout(y,80));c.actions.beginPick();document.querySelector('[data-pick-icon]').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));c.actions.createFile('PickerEditor.tsx','tsx');c.actions.patchFile('PickerEditor.tsx',`import {useUiEditorSnapshot,useUiEditorActions} from '@paradox/launcher';export default function Editor(){const s=useUiEditorSnapshot(),a=useUiEditorActions();return <aside data-ui-site="Pick-editor-replacement" key="replacement" data-picker-editor style={{pointerEvents:'auto',background:'#abc'}}>{s.picking?'Replacement picking':'Replacement ready'}<button data-ui-site="Pick-editor-cancel" key="cancel" data-ui-inspector-controls="" onClick={()=>a.cancelPick()}>Cancel replacement picker</button></aside>}`);c.actions.patchManifest({views:{...c.getSnapshot().draft.manifest.views,'tool.editor':'PickerEditor.tsx'}});if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await frame();const replaced=document.getElementById('paradox-suite-editor').shadowRoot.querySelector('[data-picker-editor]')?.textContent,pickingAfterReplacement=c.getSnapshot().picking;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await frame();const escape={picking:c.getSnapshot().picking,ranges:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length};c.actions.beginPick();const editor=document.getElementById('paradox-suite-editor').shadowRoot.querySelector('[data-picker-editor]');editor.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,composed:true}));const editableTarget=c.getSnapshot().currentTarget;c.actions.patchFile('PickerEditor.tsx','export default function Broken(){throw new Error("Inspector Task3 expected editor crash")}');if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await frame();const pickingAfterCrash=c.getSnapshot().picking;window.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));await frame();const emergency={picking:c.getSnapshot().picking,ranges:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length,suspended:c.getSnapshot().suspended,recovery:!!document.getElementById('paradox-suite-recovery').shadowRoot.textContent.trim()};c.recovery.openBuiltinEditor();await frame();return {replaced,pickingAfterReplacement,escape,editableTarget,pickingAfterCrash,emergency,calls:window.inspectorPointerCalls,diagnostics:c.getSnapshot().diagnostics.filter(d=>d.includes('Inspector Task3 expected editor crash'))};
      });assert.match(result.replaced,/Replacement picking/);assert.equal(result.pickingAfterReplacement,true);assert.deepEqual(result.escape,{picking:false,ranges:0});assert.equal(result.editableTarget.selector.locator.renderRoot,'launcher.editor');assert.equal(result.editableTarget.status,'resolved');assert.ok(result.editableTarget.ownerId);assert.equal(result.pickingAfterCrash,true);assert.deepEqual(result.emergency,{picking:false,ranges:0,suspended:true,recovery:true});assert.deepEqual(result.calls,[]);assert.ok(result.diagnostics.length);return result;
    });
    for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark'])await check(`picker_locale_theme_320_${language}_${theme}`,async()=>{
      await page.evaluate(async({language,theme})=>{const f=window.suiteFinalFixture;f.actions.settings.patchAppearance('theme',theme);if(!await f.actions.settings.save())throw Error('Theme save failed');await f.setLanguage(language);f.controller.actions.beginPick();},{language,theme});await page.setViewportSize({width:320,height:240});
      const cancel=page.getByRole('button',{name:language==='zh-CN'?'取消选取':'Cancel pick',exact:true});await cancel.scrollIntoViewIfNeeded();assert.equal(await cancel.isVisible(),true);const box=await cancel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=320&&box.y+box.height<=240);const screenshot=resolve(out,`picker-${language}-${theme}-320.png`);await page.screenshot({path:screenshot});await cancel.click();await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().picking),false);assert.equal(await page.locator('[data-ui-inspector-artifact="range"]').count(),0);return {screenshot,box,theme:await page.evaluate(()=>window.suiteFinalFixture.snapshot.appearance.theme)};
    });
    await check('picker_page_errors_and_actual_compiled_desktop_csp',async()=>{assert.deepEqual(fixture.observedPageErrors,[]);assert.deepEqual(fixture.observedCspViolations,[]);if(process.env.PARADOX_TEST_NATIVE_CSP==='1'){assert.ok(fixture.contentSecurityPolicy);assert.deepEqual(fixture.observedSourceModuleRequests,[]);}return {csp:fixture.contentSecurityPolicy,pageErrors:fixture.observedPageErrors,cspViolations:fixture.observedCspViolations,sourceModuleRequests:fixture.observedSourceModuleRequests};});
  } else if (previewOnly) {
    await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      const source = `import {Fragment,useEffect} from 'react';import {UiView,Dialog} from '@paradox/ui';import {useLauncherActions} from '@paradox/launcher';export default function Preview(){const a=useLauncherActions();useEffect(()=>{window.inspectorMounts=(window.inspectorMounts||0)+1;return()=>{window.inspectorUnmounts=(window.inspectorUnmounts||0)+1}},[]);return <Fragment key="preview-fragment"><section data-ui-site="Preview-real" data-preview-real style={{width:360,background:'rgb(12, 34, 56)',padding:8}}><input data-ui-site="Preview-input" aria-label="Current preview input" defaultValue="initial"/><textarea data-ui-site="Preview-textarea" defaultValue="initial text"/><input data-ui-site="Preview-check" type="checkbox" defaultChecked/><select data-ui-site="Preview-select" defaultValue="b" multiple><option data-ui-site="Preview-a" value="a">A</option><option data-ui-site="Preview-b" value="b">B</option></select><img data-ui-site="Preview-image" alt="Current pixels" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="/><svg data-ui-site="Preview-svg" width="30" height="30"><defs data-ui-site="Preview-defs"><linearGradient data-ui-site="Preview-gradient" id="preview-gradient"><stop data-ui-site="Preview-stop" stopColor="red"/></linearGradient></defs><rect data-ui-site="Preview-rect" id="preview-rect" width="30" height="30" fill="url(#preview-gradient)"/><use data-ui-site="Preview-use" href="#preview-rect"/></svg><canvas data-ui-site="Preview-canvas" width="20" height="20"/><button data-ui-site="Preview-launch" onClick={()=>a.profiles.launch('fixture-instance')}>Mirror launch</button><a data-ui-site="Preview-link" href="https://example.invalid/preview">Unsafe link</a></section><Dialog.Root data-ui-site="Preview-dialog" open modal={false}><Dialog.Portal data-ui-site="Preview-portal"><Dialog.Popup data-ui-site="Preview-popup" aria-label="Preview portal" style={{position:'fixed',top:30,left:10,width:160,height:50,pointerEvents:'auto'}}>Current portal</Dialog.Popup></Dialog.Portal></Dialog.Root></Fragment>}`;
      c.actions.createFile('Preview.tsx', 'tsx'); c.actions.patchFile('Preview.tsx', source);
      c.actions.createFile('PreviewAccounts.tsx', 'tsx'); c.actions.patchFile('PreviewAccounts.tsx', `import {UiView} from '@paradox/ui';export default function Accounts({Original}){return <><Original/><UiView data-ui-site="Preview-view" id="component.inspector-preview"/></>}`);
      c.actions.createFile('PreviewNull.tsx', 'tsx'); c.actions.patchFile('PreviewNull.tsx', 'export default()=>null');
      c.actions.patchManifest({ views: { ...c.getSnapshot().draft.manifest.views, 'page.accounts': 'PreviewAccounts.tsx', 'component.inspector-preview': 'Preview.tsx', 'component.inspector-null': 'PreviewNull.tsx' }, routes: c.getSnapshot().draft.manifest.routes.map((route) => route.id === 'accounts' ? { ...route, entry: 'PreviewAccounts.tsx' } : route) });
      if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
    });
    await page.waitForFunction(() => window.suiteFinalFixture.owners().some((owner) => owner.target === 'component.inspector-preview' && owner.roots.size === 2));
    await page.waitForFunction(() => window.suiteFinalFixture.owners().some((owner) => owner.target === 'component.inspector-preview' && [...owner.roots].filter(root => {const style=getComputedStyle(root);return style.opacity!=='0' && style.visibility==='visible' && root.getClientRects().length;}).length === 2));
    await page.evaluate(() => { const c = window.suiteFinalFixture.controller; c.actions.selectTarget({ kind: 'type', target: 'component.inspector-preview' }); });
    await check('preview_canvas_current_pixels_after_clear', async () => {
      const requests = [], listener = request => requests.push(request.url()); page.on('request', listener);
      try {
        const result = await page.evaluate(async () => {
          const f = window.suiteFinalFixture, source = document.createElement('canvas'), container = document.createElement('div');
          source.width = 48; source.height = 24; container.style.width = '300px'; document.body.append(source, container);
          const target = 'element.inspector-canvas-clear-regression', locator = { version: 1, renderRoot: 'launcher.main', calls: [{ site: 'inspector-canvas-clear-regression', key: 'one' }], business: [] };
          const unregister = f.registerInspectorOwner({ ownerId: target, parentOwnerId: null, target, site: locator.calls[0].site, locator, stability: 'stable', roots: new Set([source]), metadata: { nameKey: null, type: 'element', sourcePath: null, routeId: null }, catalogPresentation: false, viewId: null, layerId: null });
          const context = source.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 48, 24);
          const calls = window.foundationDesktop.calls.length, mounts = window.inspectorMounts;
          const handle = f.controller.actions.createDomPreview({ kind: 'position', target, locator }, container);
          const surface = container.firstElementChild.shadowRoot, mirror = surface.querySelector('canvas');
          const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const capture = async name => {
            const real = context.getImageData(0, 0, 48, 24).data, clone = mirror.getContext('2d').getImageData(0, 0, 48, 24).data;
            return { name, realHash: await digest(real), mirrorHash: await digest(clone), realSamples: [[...real.slice(0,4)], [...real.slice((16*48+40)*4,(16*48+40)*4+4)]], mirrorSamples: [[...clone.slice(0,4)], [...clone.slice((16*48+40)*4,(16*48+40)*4+4)]], reused: surface.querySelector('canvas') === mirror, state: handle.getSnapshot() };
          };
          try {
            const rows = [await capture('initial')]; context.clearRect(0, 0, 48, 24); handle.refresh(); rows.push(await capture('full_clear_sync'));
            await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(await capture('full_clear_frame'));
            context.fillStyle = '#ff0000'; context.fillRect(0, 0, 48, 24); context.fillStyle = '#0000ff'; context.fillRect(24, 0, 24, 24); handle.refresh();
            context.clearRect(0, 0, 12, 24); handle.refresh(); rows.push(await capture('partial_clear_sync'));
            await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(await capture('partial_clear_frame'));
            return { rows, calls: window.foundationDesktop.calls.slice(calls).map(call => call.command), mounts: window.inspectorMounts - mounts };
          } finally { handle.dispose(); unregister(); source.remove(); container.remove(); }
        });
        await writeFile(resolve(out, 'canvas-clear-current.json'), JSON.stringify(result, null, 2));
        for (const row of result.rows) { assert.equal(row.mirrorHash, row.realHash, `${row.name}: every current pixel, including transparent pixels, must replace old paint`); assert.deepEqual(row.mirrorSamples, row.realSamples); assert.equal(row.reused, true); assert.equal(row.state.status, 'resolved'); assert.equal(row.state.reason, null); }
        assert.deepEqual(result.rows[1].realSamples, [[0,0,0,0],[0,0,0,0]]); assert.deepEqual(result.rows[3].realSamples, [[0,0,0,0],[0,0,255,255]]);
        assert.deepEqual(result.calls, []); assert.equal(result.mounts, 0); assert.deepEqual(requests, []); return { ...result, requests };
      } finally { page.off('request', listener); }
    });
    await check('preview_current_attached_scroll_region', async () => {
      const result = await page.evaluate(async () => {
        const variants = [];
        for (const mode of ['light', 'open-shadow-contents', 'root-inside-shadow']) {
        const f = window.suiteFinalFixture, source = document.createElement('div'), content = document.createElement('div'), nested = document.createElement('div'), inner = document.createElement('div'), container = document.createElement('div');
        source.style.cssText = 'width:180px;height:120px;overflow:auto;'; content.style.cssText = 'position:relative;width:520px;height:420px;background:linear-gradient(red,blue);';
        nested.style.cssText = 'position:absolute;left:170px;top:150px;width:130px;height:55px;overflow:auto;'; nested.setAttribute('data-scroll-regression', 'nested'); inner.style.cssText = 'width:350px;height:270px;background:linear-gradient(green,yellow);'; inner.textContent = 'Current nested scroll content';
        nested.append(inner); content.append(nested); container.style.width = '300px';
        let boundary = null;
        if (mode === 'open-shadow-contents') source.attachShadow({mode:'open'}).append(content); else source.append(content);
        if (mode === 'root-inside-shadow') { boundary = document.createElement('div'); boundary.attachShadow({mode:'open'}).append(source); document.body.append(boundary, container); } else document.body.append(source, container);
        source.scrollTop = 80; source.scrollLeft = 90; nested.scrollTop = 50; nested.scrollLeft = 60;
        const target = 'element.inspector-scroll-regression-' + mode, locator = { version: 1, renderRoot: 'launcher.main', calls: [{ site: 'inspector-scroll-regression-' + mode, key: 'one' }], business: [] };
        const unregister = f.registerInspectorOwner({ ownerId: target, parentOwnerId: null, target, site: locator.calls[0].site, locator, stability: 'stable', roots: new Set([source]), metadata: { nameKey: null, type: 'element', sourcePath: null, routeId: null }, catalogPresentation: false, viewId: null, layerId: null });
        const handle = f.controller.actions.createDomPreview({ kind: 'position', target, locator }, container), surface = container.firstElementChild.shadowRoot;
        const mirror = surface.querySelector('[data-ui-preview-root]'), mirrorNested = mirror.querySelector('[data-scroll-regression]');
        const capture = name => { const current = surface.querySelector('[data-ui-preview-root]'), currentNested = current.querySelector('[data-scroll-regression]'); return { name, real: [source.scrollTop,source.scrollLeft,nested.scrollTop,nested.scrollLeft], mirror: [current.scrollTop,current.scrollLeft,currentNested.scrollTop,currentNested.scrollLeft], rootReused: current === mirror, nestedReused: currentNested === mirrorNested, state: handle.getSnapshot() }; };
        try {
          const rows = [capture('initial_attached_sync')]; await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(capture('initial_attached_frame'));
          source.scrollTop = 100; source.scrollLeft = 120; nested.scrollTop = 110; nested.scrollLeft = 140; handle.refresh(); rows.push(capture('stable_reuse_sync'));
          await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(capture('stable_reuse_frame'));
          source.scrollTop = 130; source.scrollLeft = 160; nested.scrollTop = 150; nested.scrollLeft = 180;
          await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(capture('native_scroll_event_refresh'));
          nested.scrollTop = 170; nested.scrollLeft = 200;
          await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(capture('nested_only_scroll_event_refresh'));
          inner.textContent = 'Updated content causes mirror replacement'; handle.refresh(); rows.push(capture('replaced_attached_sync'));
          await new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes))); rows.push(capture('replaced_attached_frame')); variants.push({ mode, rows });
        } finally { handle.dispose(); unregister(); source.remove(); boundary?.remove(); container.remove(); }
        }
        return { variants };
      });
      await writeFile(resolve(out, 'scroll-current.json'), JSON.stringify(result, null, 2));
      for (const {mode,rows} of result.variants) {
        for (const row of rows) { assert.deepEqual(row.mirror, row.real, `${mode}/${row.name}: root and nested containers must show the current region on both axes`); assert.equal(row.state.status, 'resolved'); assert.equal(row.state.reason, null); }
        assert.deepEqual(rows[0].real, [80,90,50,60]); assert.deepEqual(rows[2].real, [100,120,110,140]); assert.deepEqual(rows[4].real, [130,160,150,180]); assert.deepEqual(rows[5].real, [130,160,170,200]); assert.equal(rows[2].rootReused, true); assert.equal(rows[2].nestedReused, true); assert.equal(rows[6].rootReused, false);
      } return result;
    });
    await check('readonly_preview_current_values_no_actions', async () => {
      const requests = []; const listener = (request) => requests.push(request.url()); page.on('request', listener);
      try {
        const result = await page.evaluate(async () => {
          const c = window.suiteFinalFixture.controller;
          if (typeof c.actions.createDomPreview !== 'function') throw Error('Current DOM preview action is missing');
          const real = document.querySelector('[data-preview-real]'), input = real.querySelector('input'), area = real.querySelector('textarea');
          input.value = 'current typed value'; area.value = 'current textarea'; input.setSelectionRange(2, 8); real.querySelector('canvas').getContext('2d').fillRect(0, 0, 10, 10);
          const focus = document.getElementById('paradox-suite-editor').shadowRoot.querySelector('button'); focus.focus();
          const active = document.getElementById('paradox-suite-editor').shadowRoot.activeElement;
          const mountCount = window.inspectorMounts, calls = window.foundationDesktop.calls.length;
          const container = document.createElement('div'); container.style.width = '300px'; container.id = 'direct-preview'; document.body.append(container);
          const handle = c.actions.createDomPreview({ kind: 'type', target: 'component.inspector-preview' }, container); const content=container.firstElementChild.shadowRoot; window.inspectorPreview = { handle, container, content };
          const mirror = container.querySelector('[data-ui-inspector-artifact="mirror"]'), clone = content.querySelector('[data-ui-preview-root]'), mirroredInput = clone.querySelector('input');
          content.querySelector('button').click(); content.querySelector('a').click(); mirroredInput.focus();
          return { value: mirroredInput.value, realValue: input.value, text: clone.querySelector('textarea').value, selection: [mirroredInput.selectionStart, mirroredInput.selectionEnd], checked: clone.querySelector('input[type=checkbox]').checked, selected: [...clone.querySelector('select').selectedOptions].map(o=>o.value), inert: mirror.inert, ariaHidden: mirror.getAttribute('aria-hidden'), focusRetained: document.getElementById('paradox-suite-editor').shadowRoot.activeElement === active, calls: window.foundationDesktop.calls.slice(calls).map(x=>x.command), mounts: window.inspectorMounts - mountCount, ids: [...content.querySelectorAll('[id]')].map(x=>x.id), svgRef: clone.querySelector('use').getAttribute('href'), svgId: clone.querySelector('rect').id, image: clone.querySelector('img').src, pixels: [...clone.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data], status: handle.getSnapshot(), stableSnapshot: handle.getSnapshot() === handle.getSnapshot() };
        });
        assert.equal(result.value, result.realValue); assert.equal(result.text, 'current textarea'); assert.deepEqual(result.selection, [2,8]); assert.equal(result.checked, true); assert.deepEqual(result.selected, ['b']);
        assert.equal(result.inert, true); assert.equal(result.ariaHidden, 'true'); assert.equal(result.focusRetained, true); assert.deepEqual(result.calls, []); assert.equal(result.mounts, 0); assert.equal(result.stableSnapshot, true);
        assert.equal(new Set(result.ids).size, result.ids.length); assert.ok(result.ids.every(id=>id !== 'preview-gradient' && id !== 'preview-rect')); assert.equal(result.svgRef, '#' + result.svgId); assert.match(result.image, /^data:image\/png/); assert.equal(result.pixels[3], 255);
        await page.waitForTimeout(120); assert.deepEqual(requests, []); return { ...result, requests };
      } finally { page.off('request', listener); }
    });
    await check('preview_multiple_roots_and_status', async () => {
      const result = await page.evaluate(async () => {
        const c = window.suiteFinalFixture.controller;
        if (typeof c.actions.createDomPreview !== 'function') throw Error('Current DOM preview action is missing');
        const p = window.inspectorPreview;
        const roots = p.content.querySelectorAll('[data-ui-preview-root]');
        const multipleRoots = roots.length, portalStatic = roots[1] ? getComputedStyle(roots[1]).position : null;
        const currentRoots = window.suiteFinalFixture.owners().filter(owner=>owner.target==='component.inspector-preview').flatMap(owner=>[...owner.roots].map(root=>({tag:root.tagName,connected:root.isConnected,opacity:getComputedStyle(root).opacity,visibility:getComputedStyle(root).visibility,rects:root.getClientRects().length,html:root.outerHTML.slice(0,500)})));
        const statuses = {};
        for (const [name, selector] of [['unknown',{kind:'type',target:'manual.preview-unknown'}],['unmounted',{kind:'type',target:'dialog.profile'}]]) {
          const container=document.createElement('div'), h=c.actions.createDomPreview(selector,container); statuses[name]=h.getSnapshot(); h.dispose(); h.dispose();
        }
        c.actions.selectTarget({kind:'type',target:'dialog.profile'}); await new Promise(yes=>requestAnimationFrame(()=>requestAnimationFrame(yes)));
        return {multipleRoots,portalStatic,statuses,currentRoots,profileDraft:window.suiteFinalFixture.snapshot.profileDraft.editor,route:window.suiteFinalFixture.snapshot.navigation.routeId};
      });
      await writeFile(resolve(out,'multiple-roots-current.json'),JSON.stringify(result,null,2));
      assert.equal(result.multipleRoots, 2, JSON.stringify(result.currentRoots)); assert.equal(result.portalStatic, 'static'); assert.equal(result.statuses.unknown.status, 'unmounted'); assert.match(result.statuses.unknown.reason, /unknown/i); assert.equal(result.statuses.unmounted.status, 'unmounted'); assert.equal(result.profileDraft, null); assert.equal(result.route, 'accounts');
      assert.equal(await editor.getByText('This target is not shown in the current interface.', {exact:true}).isVisible(), true);
      return result;
    });
    await check('preview_refresh_after_successful_apply', async () => {
      const result = await page.evaluate(async () => {
        const c=window.suiteFinalFixture.controller;
        if (typeof c.actions.createDomPreview !== 'function') throw Error('Current DOM preview action is missing');
        c.actions.selectTarget({kind:'type',target:'component.inspector-preview'});
        const p=window.inspectorPreview; const before=p.handle.getSnapshot(); let notifications=0; const stop=p.handle.subscribe(()=>notifications++);
        c.actions.createFile('Preview.css','css'); c.actions.patchFile('Preview.css','[data-preview-real]{background:rgb(78, 90, 123)!important}'); c.actions.patchManifest({styles:[...c.getSnapshot().draft.manifest.styles,'Preview.css']});
        const unchanged=getComputedStyle(p.content.querySelector('[data-ui-preview-root]')).backgroundColor;
        if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n')); await new Promise(yes=>setTimeout(yes,160));
        const real=document.querySelector('[data-preview-real]'), clone=p.content.querySelector('[data-ui-preview-root]');
        const applied={real:getComputedStyle(real).backgroundColor,mirror:getComputedStyle(clone).backgroundColor};
        c.actions.patchFile('Preview.tsx','export default function ( broken'); const failed=await c.actions.preview(); await new Promise(yes=>setTimeout(yes,80));
        const afterFailure=getComputedStyle(p.content.querySelector('[data-ui-preview-root]')).backgroundColor;
        c.actions.patchFile('Preview.tsx',c.getActivation().primary.bundle.files['Preview.tsx'].text);
        stop(); return {unchanged,applied,failed,afterFailure,notifications,before};
      });
      assert.equal(result.unchanged,'rgb(12, 34, 56)'); assert.deepEqual(result.applied,{real:'rgb(78, 90, 123)',mirror:'rgb(78, 90, 123)'}); assert.equal(result.failed,false); assert.equal(result.afterFailure,result.applied.mirror); return result;
    });
    await check('preview_fallback_location_root_updates_and_disposal',async()=>{
      const result=await page.evaluate(async()=>{
        const c=window.suiteFinalFixture.controller,p=window.inspectorPreview,selector={kind:'type',target:'component.inspector-preview'};
        const canvas=document.querySelector('[data-preview-real] canvas'),context=canvas.getContext('2d'),read=context.getImageData;
        context.getImageData=()=>{throw new DOMException('Protected canvas fixture','SecurityError')};p.handle.refresh();
        const canvasFallback={reason:p.handle.reason,present:!!p.content.querySelector('[data-ui-preview-unavailable="canvas"]')};context.getImageData=read;p.handle.refresh();
        const realOwner=window.suiteFinalFixture.owners().find(owner=>owner.target==='component.inspector-preview'),realRoots=[...realOwner.roots];
        realRoots.forEach(root=>root.style.display='none');p.handle.refresh();const hidden=p.handle.getSnapshot(),hiddenLocated=await c.actions.locateTarget(selector);realRoots.forEach(root=>root.style.removeProperty('display'));p.handle.refresh();
        const real=document.querySelector('[data-preview-real]'),outline=real.style.outline;real.style.marginTop='3000px';
        const beforeTop=real.getBoundingClientRect().top,located=await c.actions.locateTarget(selector);
        await new Promise(yes=>requestAnimationFrame(()=>requestAnimationFrame(yes)));
        const rangeWaitRows=[];
        for(let attempt=0;attempt<20;attempt++) {
          const count=document.querySelectorAll('[data-ui-inspector-artifact="range"]').length;
          rangeWaitRows.push({attempt,count});
          if(count)break;
          await new Promise(yes=>setTimeout(yes,20));
        }
        const afterTop=real.getBoundingClientRect().top;
        const ranges=document.querySelectorAll('[data-ui-inspector-artifact="range"]').length;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        const escaped=document.querySelectorAll('[data-ui-inspector-artifact="range"]').length;
        const pending=c.actions.locateTarget(selector);c.actions.selectTarget({kind:'type',target:'dialog.profile'});const cancelled=await pending;
        real.style.removeProperty('margin-top');
        c.actions.patchFile('PreviewAccounts.tsx',`import {UiView} from '@paradox/ui';export default function Accounts({Original}){return <><Original/><UiView data-ui-site="Preview-view" id="component.inspector-preview"/><UiView data-ui-site="Preview-other" id="component.inspector-preview"/><UiView data-ui-site="Preview-null" id="component.inspector-null"/></>}`);
        if(!await c.actions.preview())throw Error(c.getSnapshot().diagnostics.join('\n'));await new Promise(yes=>setTimeout(yes,160));p.handle.refresh();
        const multiple=p.handle.getSnapshot(),noFirst=await c.actions.locateTarget(selector),invalidIndex=await c.actions.locateTarget(selector,99),explicitIndex=await c.actions.locateTarget(selector,1);
        c.actions.selectTarget({kind:'type',target:'dialog.profile'});
        const locator={version:1,renderRoot:'launcher.main',calls:[{site:'inspector-direct-ambiguous',key:'same'}],business:[]},target='element.inspector-direct-ambiguous';
        const directRoots=[document.createElement('div'),document.createElement('div')];directRoots.forEach(root=>{root.style.cssText='width:20px;height:20px';document.body.append(root);});
        const leases=directRoots.map((root,index)=>window.suiteFinalFixture.registerInspectorOwner({ownerId:'inspector-direct-'+index,parentOwnerId:null,target,site:locator.calls[0].site,locator,stability:'stable',roots:new Set([root]),metadata:{nameKey:null,type:'element',sourcePath:null,routeId:null},catalogPresentation:false,viewId:null,layerId:null}));
        const exact={kind:'position',target,locator};
        const ambiguousHandle=c.actions.createDomPreview(exact,document.createElement('div')),ambiguous=ambiguousHandle.getSnapshot(),ambiguousLocated=await c.actions.locateTarget(exact,0);ambiguousHandle.dispose();
        leases.forEach(dispose=>dispose());directRoots.forEach(root=>root.remove());
        const nullContainer=document.createElement('div'),nullHandle=c.actions.createDomPreview({kind:'type',target:'component.inspector-null'},nullContainer),opaque=nullHandle.getSnapshot();nullHandle.dispose();
        window.suiteFinalFixture.actions.navigation.navigate('home');await new Promise(yes=>setTimeout(yes,160));const unmounted=p.handle.getSnapshot(),empty=p.content.childElementCount;
        window.suiteFinalFixture.actions.navigation.navigate('accounts');await new Promise(yes=>setTimeout(yes,160));const remounted=p.handle.getSnapshot();
        let afterDispose=0;const stop=p.handle.subscribe(()=>afterDispose++);p.handle.dispose();p.handle.dispose();document.querySelector('[data-preview-real]').textContent='changed after disposal';await new Promise(yes=>setTimeout(yes,80));p.handle.refresh();stop();
        return {canvasFallback,hidden,hiddenLocated,beforeTop,afterTop,located,rangeWaitRows,ranges,escaped,cancelled,outlineUnchanged:real.style.outline===outline,multiple,noFirst,invalidIndex,explicitIndex,ambiguous,ambiguousLocated,opaque,unmounted,empty,remounted,afterDispose,removed:!p.container.firstElementChild};
      });
      await writeFile(resolve(out,'fallback-location-root-updates-and-disposal.json'),JSON.stringify(result,null,2));
      assert.equal(result.canvasFallback.present,true);assert.match(result.canvasFallback.reason,/Canvas pixels/);assert.equal(result.hidden.status,'hidden');assert.equal(result.hiddenLocated,false);
      assert.ok(result.beforeTop>=240);assert.ok(result.afterTop<240);assert.equal(result.located,true);assert.equal(result.ranges,1);assert.equal(result.escaped,0);assert.equal(result.cancelled,false);assert.equal(result.outlineUnchanged,true);
      assert.equal(result.multiple.locations.length,2);assert.equal(result.multiple.rootCount,4);assert.equal(result.noFirst,false);assert.equal(result.invalidIndex,false);assert.equal(result.explicitIndex,true);assert.equal(result.opaque.status,'unsupported');assert.ok(result.opaque.reason);
      assert.equal(result.ambiguous.status,'ambiguous');assert.equal(result.ambiguousLocated,false);
      assert.equal(result.unmounted.status,'unmounted');assert.equal(result.empty,0);assert.equal(result.remounted.status,'resolved');assert.equal(result.afterDispose,0);assert.equal(result.removed,true);return result;
    });
    for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) await check(`preview_locale_theme_320_${language}_${theme}`, async()=>{
      await page.evaluate(async ({language,theme})=>{const f=window.suiteFinalFixture; f.actions.settings.patchAppearance('theme',theme);await f.actions.settings.save();await f.setLanguage(language);f.controller.actions.selectTarget({kind:'type',target:'component.inspector-preview'});}, {language,theme});
      await page.waitForFunction(theme=>window.suiteFinalFixture.snapshot.appearance.theme===theme && document.querySelector('.app-shell').getAttribute('data-theme')===theme,theme);
      await page.setViewportSize({width:320,height:240}); const panel=page.locator('.ui-target-preview'); const locate=panel.getByRole('button',{name:language==='zh-CN'?'定位目标':'Locate target',exact:true}); await locate.scrollIntoViewIfNeeded(); assert.equal(await locate.isVisible(),true); const box=await locate.boundingBox(); assert.ok(box.width>0 && box.x>=0 && box.x+box.width<=320); assert.equal(await panel.getByText(language==='zh-CN'?'当前生效界面':'Current active interface',{exact:true}).isVisible(),true); const screenshot=resolve(out,`${language}-${theme}-320.png`);await page.screenshot({path:screenshot});return {screenshot,box};
    });
    await check('preview_controller_shutdown_cleans_handles_and_ranges',async()=>{
      const result=await page.evaluate(async()=>{
        const c=window.suiteFinalFixture.controller,container=document.createElement('div');document.body.append(container);const selector={kind:'type',target:'component.inspector-preview'},handle=c.actions.createDomPreview(selector,container);
        const hadMirror=!!container.firstElementChild;const pending=c.actions.locateTarget(selector,0);c.connectionCleanup();const cancelled=await pending;handle.refresh();return {hadMirror,removed:!container.firstElementChild,cancelled,ranges:document.querySelectorAll('[data-ui-inspector-artifact="range"]').length};
      });assert.equal(result.hadMirror,true);assert.equal(result.removed,true);assert.equal(result.cancelled,false);assert.equal(result.ranges,0);return result;
    });
    await check('page_errors_and_actual_compiled_desktop_csp',async()=>{assert.deepEqual(fixture.observedPageErrors,[]);assert.deepEqual(fixture.observedCspViolations,[]);if(process.env.PARADOX_TEST_NATIVE_CSP==='1'){assert.ok(fixture.contentSecurityPolicy);assert.deepEqual(fixture.observedSourceModuleRequests,[]);}return {csp:fixture.contentSecurityPolicy,pageErrors:fixture.observedPageErrors,cspViolations:fixture.observedCspViolations,sourceModuleRequests:fixture.observedSourceModuleRequests};});
  } else {
  await check('catalog_converges_and_projection_stays_pickable', async () => {
    await editor.getByRole('button', { name: /^Target catalog/ }).click();
    await page.waitForFunction(() => window.suiteFinalFixture.owners().some((owner) => owner.catalogPresentation));
    const samples = [];
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(40); samples.push(await page.evaluate(() => ({ targets: window.suiteFinalFixture.controller.getSnapshot().targets.length, owners: window.suiteFinalFixture.owners().length }))); }
    const settled = await page.evaluate(() => {
      const c = window.suiteFinalFixture.controller;
      const before = c.getSnapshot(); c.refreshTargets(); const after = c.getSnapshot();
      const projected = window.suiteFinalFixture.owners().find((owner) => owner.catalogPresentation && owner.roots.size);
      c.actions.selectTarget({ kind: 'position', target: projected.target, locator: projected.locator });
      return { sameSnapshot: before === after, projectedOwner: projected.ownerId, selectedOwner: c.getSnapshot().currentTarget.ownerId, autoRow: before.targets.some((d) => d.selector.kind === 'position' && d.ownerId === projected.ownerId), normalControls: before.targets.some((d) => d.selector.kind === 'position' && d.selector.locator.renderRoot === 'launcher.editor' && !d.selector.target.includes('TargetCatalog-row')) };
    });
    settled.samples = samples;
    assert.deepEqual(samples.slice(-4), Array(4).fill(samples.at(-1)));
    assert.equal(settled.sameSnapshot, true, JSON.stringify(settled)); assert.equal(settled.projectedOwner, settled.selectedOwner);
    assert.equal(settled.autoRow, false); assert.equal(settled.normalControls, true);
    return settled;
  });
  await check('canonical_source_file_search_unknown_override', async () => {
    const search = editor.getByRole('textbox', { name: 'Search name, ID, page or source file' });
    if (!await search.count()) await editor.getByRole('button', { name: /^Target catalog/ }).click();
    await search.fill('common/components/AccountAvatar.tsx');
    await editor.locator('.ui-target-list button').first().waitFor();
    assert.ok(await editor.locator('.ui-target-list button').count() > 0);
    await editor.locator('.ui-target-list button').first().click();
    await page.evaluate(() => { const c = window.suiteFinalFixture.controller, selector = c.getSnapshot().selection.selector; c.actions.selectTarget(Object.fromEntries(Object.entries(selector).reverse())); });
    assert.equal(await editor.locator('.ui-target-list button[aria-pressed="true"]').count(), 1, 'field order does not change complete-selector row identity');
    assert.match(await editor.locator('.ui-target-details dd').nth(1).textContent(), /common\/components\/AccountAvatar.tsx/);
    const known = await page.evaluate(() => ({ descriptor: window.suiteFinalFixture.controller.getSnapshot().currentTarget, selectedFile: window.suiteFinalFixture.controller.getSnapshot().selectedFile }));
    assert.equal(known.descriptor.sourcePath, 'common/components/AccountAvatar.tsx'); assert.equal(known.selectedFile, known.descriptor.sourcePath);
    await editor.getByRole('textbox', { name: 'Manual target ID' }).fill('manual.inspector-unknown');
    await editor.getByRole('button', { name: 'Select manual target', exact: true }).click();
    assert.match(await editor.locator('.ui-target-details [data-ui-site$=":TargetDetails-reason"]').textContent(), /unknown/);
    const unknown = await page.evaluate(() => {
      const c = window.suiteFinalFixture.controller, selector = c.getSnapshot().selection.selector;
      c.actions.createFile('unknown.css', 'css'); c.actions.patchFile('unknown.css', 'button { color: red; }');
      c.actions.patchManifest({ overrides: [...c.getSnapshot().draft.manifest.overrides, { selector, enabled: true, stylesheet: 'unknown.css', entry: null }] });
      c.actions.selectTarget(selector);
      return { descriptor: c.getSnapshot().currentTarget, binding: c.getSnapshot().selection.filePath, selectedFile: c.getSnapshot().selectedFile, retained: c.getSnapshot().targets.some((d) => d.selector.target === 'manual.inspector-unknown') };
    });
    assert.equal(unknown.descriptor.status, 'unmounted'); assert.equal(unknown.descriptor.sourcePath, null); assert.equal(unknown.binding, 'unknown.css'); assert.equal(unknown.selectedFile, 'unknown.css'); assert.equal(unknown.retained, true);
    return { known, unknown };
  });
  await check('known_never_opened_dialog_does_not_open', async () => {
    const result = await page.evaluate(() => {
      const c = window.suiteFinalFixture.controller;
      const target = c.getSnapshot().targets.find((d) => d.selector.target === 'dialog.profile' && d.selector.kind === 'type');
      if (!target) throw Error('Known unmounted dialog definition missing');
      c.actions.selectTarget(target.selector);
      return { descriptor: c.getSnapshot().currentTarget, profileDraft: window.suiteFinalFixture.snapshot.profileDraft.editor, route: window.suiteFinalFixture.snapshot.navigation.routeId };
    });
    assert.equal(result.descriptor.status, 'unmounted'); assert.ok(result.descriptor.sourcePath); assert.equal(result.profileDraft, null); assert.equal(result.route, 'accounts'); return result;
  });
  await check('three_account_positions_scope_parent_hidden_cleanup', async () => {
    const result = await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      const source = `import {Fragment} from 'react';import {useLauncherSnapshot} from '@paradox/launcher';import {UiIdentity,UiView} from '@paradox/ui';import Avatar from './common/components/AccountAvatar';export default function Accounts({Original}){const account=useLauncherSnapshot().accounts.state.accounts[0];return <Fragment data-ui-site="Inspector-accounts-root" key="inspector-accounts-root"><Original/><UiIdentity namespace="account" value={account.id}><UiView data-ui-site="Inspector-third-avatar" id="component.account-avatar" Original={Avatar} props={{account,name:account.name}}/></UiIdentity><UiIdentity namespace="inspector-fixture" value="hidden-control"><button data-ui-site="Inspector-hidden" key="inspector-hidden" style={{display:"none"}}>Inspector hidden control</button></UiIdentity><UiView data-ui-site="Inspector-null-view" id="component.inspector-null"/></Fragment>}`;
      c.actions.createFile('InspectorAccounts.tsx', 'tsx'); c.actions.patchFile('InspectorAccounts.tsx', source);
      c.actions.createFile('Null.tsx', 'tsx'); c.actions.patchFile('Null.tsx', 'export default () => null');
      c.actions.patchManifest({ views: { ...c.getSnapshot().draft.manifest.views, 'page.accounts': 'InspectorAccounts.tsx', 'component.inspector-null': 'Null.tsx' }, routes: c.getSnapshot().draft.manifest.routes.map((route) => route.id === 'accounts' ? { ...route, entry: 'InspectorAccounts.tsx' } : route) });
      if (!await c.actions.preview()) return { failure: c.getSnapshot().diagnostics, manifest: c.getSnapshot().draft.manifest, paths: Object.keys(c.getSnapshot().draft.files) };
      return { previewed: true };
    });
    if (result.failure) { await writeFile(resolve(out, 'preview-failure.json'), JSON.stringify(result, null, 2)); throw Error(result.failure.join('\n')); }
    await page.waitForFunction(() => window.suiteFinalFixture.owners().some((owner) => owner.site?.includes('Inspector-hidden')));
    const state = await page.evaluate(async () => {
      const c = window.suiteFinalFixture.controller;
      c.actions.selectTarget({ kind: 'type', target: 'component.inspector-null' });
      const knownNull = c.getSnapshot().currentTarget;
      c.actions.patchFile('Null.tsx', 'export default () => <p data-ui-site="Inspector-eventual">Now visible</p>');
      if (!await c.actions.preview()) throw Error(c.getSnapshot().diagnostics.join('\n'));
      await new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes))); c.refreshTargets();
      const eventual = c.getSnapshot().currentTarget, owners = window.suiteFinalFixture.owners();
      const avatars = owners.filter((owner) => owner.target === 'component.account-avatar' && owner.locator.business.some((id) => id.namespace === 'account' && id.value === 'account-a'));
      const sidebar = avatars.find((owner) => owner.locator.calls.some((call) => call.site.includes('Shell-15')));
      if (!sidebar) throw Error('Topbar avatar unavailable: '+JSON.stringify(avatars.map((owner) => owner.locator)));
      c.actions.selectTarget({ kind: 'position', target: sidebar.target, locator: sidebar.locator });
      const exact = c.getSnapshot().currentTarget;
      c.actions.setScope('business'); const broad = c.getSnapshot().currentTarget;
      c.actions.setScope('position'); const restored = c.getSnapshot().selection.selector;
      const parent = c.getSnapshot().targetAncestors.at(-1); c.actions.selectTarget(parent.selector);
      c.actions.setScope('type'); c.actions.setScope('position'); const parentRestored = c.getSnapshot().selection.selector;
      const hidden = owners.find((owner) => owner.site?.includes('Inspector-hidden') && owner.roots.size);
      c.actions.selectTarget({ kind: 'position', target: hidden.target, locator: hidden.locator });
      const preciseHidden = c.getSnapshot().currentTarget;
      c.actions.selectTarget({ kind: 'business', target: hidden.target, identity: { namespace: 'inspector-fixture', value: 'hidden-control' } });
      const hiddenTarget = c.getSnapshot().currentTarget;
      window.suiteFinalFixture.actions.navigation.navigate('home'); await new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes))); c.refreshTargets();
      return { knownNull, eventual, avatars: avatars.map((owner) => ({ ownerId: owner.ownerId, calls: owner.locator.calls })), exact, broad, restored, expected: { kind: 'position', target: sidebar.target, locator: sidebar.locator }, parentRestored, parent: parent.selector, preciseHidden, hiddenTarget, afterUnmount: c.getSnapshot().currentTarget, afterAncestors: c.getSnapshot().targetAncestors };
    });
    assert.equal(state.knownNull.status, 'unsupported'); assert.equal(state.knownNull.sourcePath, 'Null.tsx'); assert.ok(state.knownNull.reason); assert.equal(state.eventual.status, 'resolved'); assert.equal(state.eventual.sourcePath, 'Null.tsx');
    assert.equal(state.exact.matchCount, 1); assert.equal(state.broad.status, 'resolved'); assert.equal(state.broad.matchCount, 3); assert.match(state.broad.name, /Alex/);
    assert.deepEqual(state.restored, state.expected); assert.deepEqual(state.parentRestored, state.parent);
    assert.ok(['hidden', 'unsupported'].includes(state.preciseHidden.status)); if (state.preciseHidden.status === 'unsupported') assert.match(state.preciseHidden.reason, /missing-repeat-key/);
    assert.equal(state.hiddenTarget.status, 'hidden', JSON.stringify(state.hiddenTarget)); assert.equal(state.hiddenTarget.matchCount, 1); assert.equal(state.afterUnmount.status, 'unmounted'); assert.equal(state.afterUnmount.ownerId, null); assert.deepEqual(state.afterAncestors, []);
    return state;
  });
  for (const language of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) await check(`locale_theme_320_${language}_${theme}`, async () => {
    await page.evaluate(async ({ language, theme }) => { window.suiteFinalFixture.actions.settings.patchAppearance('theme', theme); if (!await window.suiteFinalFixture.actions.settings.save()) throw Error('Theme configuration was not saved'); await window.suiteFinalFixture.setLanguage(language); }, { language, theme });
    await page.waitForFunction((theme) => window.suiteFinalFixture.snapshot.appearance.theme === theme && document.querySelector('.app-shell')?.getAttribute('data-theme') === theme, theme);
    await page.evaluate(() => { for (const notice of window.suiteFinalFixture.snapshot.notifications.items) window.suiteFinalFixture.actions.notifications.dismiss(notice.id); });
    await page.setViewportSize({ width: 320, height: 240 });
    const localizedEditor = page.getByRole('dialog', { name: language === 'zh-CN' ? 'UI 套件编辑器' : 'UI Suite Editor', exact: true });
    await localizedEditor.waitFor();
    const catalog = localizedEditor.getByRole('button', { name: language === 'zh-CN' ? /^目标目录/ : /^Target catalog/ });
    await catalog.scrollIntoViewIfNeeded();
    assert.equal(await catalog.isVisible(), true);
    const colors = await localizedEditor.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, heading: getComputedStyle(element.querySelector('h1')).color }));
    const background = colors.background.match(/\d+/g).slice(0, 3).map(Number), heading = colors.heading.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(theme === 'light' ? background.every((value) => value > 180) && heading.every((value) => value < 100) : background.every((value) => value < 100) && heading.every((value) => value > 100), JSON.stringify(colors));
    const screenshot = resolve(out, `${language}-${theme}-320.png`); await page.screenshot({ path: screenshot });
    const actualTheme = await page.locator('.app-shell').getAttribute('data-theme'); assert.equal(actualTheme, theme);
    return { screenshot, theme: actualTheme, colors };
  });
  await check('page_errors_and_actual_compiled_desktop_csp', async () => {
    assert.deepEqual(fixture.observedPageErrors, []); assert.deepEqual(fixture.observedCspViolations, []);
    if (process.env.PARADOX_TEST_NATIVE_CSP === '1') { assert.ok(fixture.contentSecurityPolicy); assert.deepEqual(fixture.observedSourceModuleRequests, []); }
    return { csp: fixture.contentSecurityPolicy, pageErrors: fixture.observedPageErrors, cspViolations: fixture.observedCspViolations, sourceModuleRequests: fixture.observedSourceModuleRequests };
  });
  }
} finally { await fixture.close(); await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
