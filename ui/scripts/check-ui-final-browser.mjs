import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out=resolve(fileURLToPath(new URL('../../.test-data/task-13/browser/',import.meta.url)),process.env.PARADOX_FINAL_EVIDENCE??'manual-run');
await mkdir(out,{recursive:true});
const report={rows:[]};
for(const name of ['custom_editor_then_recovery','complete_suite_switch_keeps_controllers','old_namespace_untouched','onboarding_source_modern','onboarding_source_immersive','onboarding_pending_failure_retry','trusted_preparation_failure'].filter(name=>!process.env.PARADOX_FINAL_CASE||new RegExp(process.env.PARADOX_FINAL_CASE).test(name))){
 const fixture=await createBrowserFixture({desktopBoundary:true,sourceFailure:name==='trusted_preparation_failure'?'Task11 mode-only trusted source preparation failure':null,oldNamespaceBytes:{'paradox.ui-customization.v1':'{malformed legacy bytes\n','paradox.ui-customization.v1.recovery.keep':'{"kind":"paradox-ui-customization","enabled":true}','ui-customization-legacy.json':'opaque desktop-name marker'}});
 const {page}=fixture;
 try{
  page.setDefaultTimeout(4000);
  await page.waitForFunction(failure => !!window.suiteFinalFixture?.controller && (failure || !!window.suiteFinalFixture.controller.getActivation()), name==='trusted_preparation_failure', { timeout: 90000 });
  await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
  if(name==='onboarding_pending_failure_retry') {
   await page.setViewportSize({width:320,height:240});
   const choice=page.locator('[data-style-choice]'), radio=choice.locator('input[value="modern"]');
   await radio.click(); await radio.evaluate(e=>e.dataset.probe='same-input');
   await page.evaluate(()=>{
    const native=window.__TAURI_INTERNALS__, original=native.invoke; let first=true;
    native.invoke=async(command,args)=>{
     if(command==='save_ui_suite_library'&&first){first=false;window.selectionSubmitted=true;await new Promise(resolve=>window.releaseSelectionFailure=resolve);throw new Error('Retry this selection');}
     return original(command,args);
    };
   });
   await choice.getByRole('button',{name:'Use this interface'}).click();
   await page.waitForFunction(()=>window.selectionSubmitted);
   assert.equal(await radio.isChecked(),true); assert.equal(await radio.getAttribute('data-probe'),'same-input');
   assert.equal(await choice.getByRole('button').isDisabled(),true);
   await page.evaluate(()=>window.releaseSelectionFailure());
   await page.waitForFunction(()=>window.suiteFinalFixture.controller.getSnapshot().pending===null);
   await choice.getByRole('alert').filter({hasText:'Retry this selection'}).waitFor();
   assert.equal(await radio.isChecked(),true); assert.equal(await radio.getAttribute('data-probe'),'same-input');
   assert.equal(await page.evaluate(()=>window.foundationDesktop.suiteLibrary.revision),0);
   await choice.getByRole('button',{name:'Use this interface'}).click();
   await page.waitForFunction(()=>!window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired);
   assert.deepEqual(await page.evaluate(()=>({revision:window.foundationDesktop.suiteLibrary.revision,active:window.foundationDesktop.suiteLibrary.active_suite_id})),{revision:1,active:'builtin.modern'});
   assert.deepEqual(fixture.observedPageErrors,[]); assert.deepEqual(fixture.observedCspViolations,[]);
   report.rows.push({name,checks:['pending_preserves_selected_input','failed_CAS_keeps_source_diagnostics','explicit_retry_same_revision'],failures:[]});
   console.log('PASS '+name); continue;
  }
  if(name==='trusted_preparation_failure') {
   const recovery=page.locator('#paradox-suite-recovery');
   await recovery.getByRole('dialog').waitFor({timeout:20000});
   assert.equal(await page.locator('.suite-loading').count(),0);
   assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getActivation()),null);
   await page.evaluate(()=>window.suiteFinalFixture.controller.recovery.openBuiltinEditor());
   await page.keyboard.press('Control+Shift+F12');
   await recovery.getByRole('dialog').waitFor();
   assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().suspended),true);
   assert.deepEqual(fixture.observedPageErrors,[]); assert.deepEqual(fixture.observedCspViolations,[]);
   report.rows.push({name,checks:['same_fixed_Recovery_without_carrier','no_fixed_loading_text','F12_without_SuiteProvider'],failures:[]});
   console.log('PASS '+name); continue;
  }
  if(name.startsWith('onboarding_source_')) {
   const id=name.replace('onboarding_source_','');
   await page.setViewportSize({width:320,height:240});
   const edit=await page.evaluate(id=>window.suiteFinalFixture.editOnboarding(id),id);
   assert.equal(edit.preview,true); assert.equal(edit.saved,true);
   const choice=page.locator('[data-style-choice]');
   await choice.getByRole('heading',{name:'Edited onboarding '+id}).waitFor();
   assert.equal(await choice.getByRole('radio').count(),2);
   assert.equal(await choice.locator('.style-preview-modern').count(),1,'modern static structure');
   assert.equal(await choice.locator('.style-preview-immersive').count(),1,'immersive static structure');
   await choice.getByRole('button').scrollIntoViewIfNeeded();
   const rect=await choice.getByRole('button').boundingBox();
   assert.ok(rect.y>=0&&rect.y+rect.height<=240,'confirmation scrolls into 320x240');
   await page.screenshot({path:resolve(out,`onboarding-${id}-320.png`)});
   for (const style of ['modern','immersive']) {
    const radio=choice.locator('input[value="'+style+'"]'); await radio.click(); assert.equal(await radio.isChecked(),true);
   }
   await choice.locator('input[value="immersive"]').focus(); await page.keyboard.press('ArrowLeft');
   assert.equal(await choice.locator('input[value="modern"]').isChecked(),true);
   await page.keyboard.press('Tab'); assert.equal(await choice.getByRole('button').evaluate(e=>e===document.activeElement),true);
   const saved=await page.evaluate(()=>({library:window.foundationDesktop.suiteLibrary,raw:Array.from(window.foundationDesktop.suiteRaw)}));
   await page.addInitScript(saved=>{window.foundationDesktop.suiteLibrary=saved.library;window.foundationDesktop.suiteRaw=new Uint8Array(saved.raw)},saved);
   await page.reload(); await page.waitForFunction(()=>window.suiteFinalFixture?.controller.getActivation());
   await page.evaluate(()=>window.suiteFinalFixture.setLanguage('en-US'));
   await choice.getByRole('heading',{name:'Edited onboarding '+id}).waitFor({timeout:15000});
   assert.equal(await page.evaluate(()=>window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired),false);
   assert.equal(await page.evaluate(()=>window.foundationDesktop.calls.filter(c=>c.command==='save_ui_suite_library').length),0);
   await page.setViewportSize({width:1240,height:720});
   await choice.locator('input[value="immersive"]').click(); await choice.getByRole('button',{name:'Use this interface'}).click();
   await page.waitForFunction(()=>window.suiteFinalFixture.controller.getSnapshot().selectedSuiteId==='builtin.immersive');
   assert.deepEqual(fixture.observedPageErrors,[]); assert.deepEqual(fixture.observedCspViolations,[]);
   report.rows.push({name,checks:['source_Preview_Save_reload','onboarding_source_ownership','320x240_both_radio_hits_and_keyboard','saved_restart_no_first_choice_no_write','explicit_confirm'],failures:[]});
   console.log('PASS '+name); continue;
  }
  const choice=page.locator('[data-style-choice]');
  await choice.getByRole('button',{name:'Use this interface'}).click();
  await page.waitForFunction(()=>!window.suiteFinalFixture.controller.getSnapshot().initialSelectionRequired);
  if(name==='custom_editor_then_recovery'){
   await page.keyboard.press('Control+Shift+F11');
   await page.getByRole('heading',{name:'UI Suite Editor',exact:true}).waitFor();
  }
  assert.equal(await page.evaluate(()=>window.foundationDesktop.calls.some(x=>/^(get|save|reset)_ui_customization$/.test(x.command))),false,'normal entry never invokes obsolete customization API');
  assert.equal(await page.evaluate(()=>!!window.suiteFinalFixture?.controller),true,'actual default entry exposes same-controller test observation');
  const result=await page.evaluate(name=>window.suiteFinalFixture.run(name),name);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(fixture.observedPageErrors,[]);
  assert.deepEqual(fixture.observedCspViolations,[]);
  if(process.env.PARADOX_TEST_NATIVE_CSP==='1') {
   assert.ok(fixture.contentSecurityPolicy);
   assert.deepEqual(fixture.observedSourceModuleRequests,[]);
  }
  report.rows.push({name,...result});console.log('PASS '+name);
 }catch(error){report.rows.push({name,failure:String(error)});console.error('FAIL '+name+' '+error);process.exitCode=1;}
 finally{report.rows.at(-1).csp=fixture.contentSecurityPolicy;report.rows.at(-1).errors=fixture.observedPageErrors;report.rows.at(-1).sourceRequests=fixture.observedSourceModuleRequests;report.rows.at(-1).cspViolations=fixture.observedCspViolations;await fixture.close();}
}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
