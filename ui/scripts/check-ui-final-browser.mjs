import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserFixture } from './lib/ui-browser-fixture.mjs';
const out=resolve(fileURLToPath(new URL('../../.test-data/task-13/browser/',import.meta.url)),process.env.PARADOX_FINAL_EVIDENCE??'manual-run');
await mkdir(out,{recursive:true});
const report={rows:[]};
for(const name of ['custom_editor_then_recovery','complete_suite_switch_keeps_controllers','old_namespace_untouched']){
 const fixture=await createBrowserFixture({desktopBoundary:true,oldNamespaceBytes:{'paradox.ui-customization.v1':'{malformed legacy bytes\n','paradox.ui-customization.v1.recovery.keep':'{"kind":"paradox-ui-customization","enabled":true}','ui-customization-legacy.json':'opaque desktop-name marker'}});
 const {page}=fixture;
 try{
  page.setDefaultTimeout(4000);
  await page.waitForFunction(() => window.suiteFinalFixture?.controller.getActivation(), null, { timeout: 90000 });
  await page.evaluate(() => window.suiteFinalFixture.setLanguage('en-US'));
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
