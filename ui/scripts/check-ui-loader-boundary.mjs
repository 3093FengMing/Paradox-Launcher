import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {loadApp} from './lib/hook-test-host.mjs';
const app=loadApp();
assert.match(app('../scripts/fixtures/node-loader-css-control.ts').default,/\.ui-notice-viewport/);
assert.throws(()=>app('../scripts/fixtures/node-loader-executable-query-control.ts'),/Cannot resolve .*notices\.ts\?unexpected/);
for(const file of ['check-launch-cancellation.mjs','check-loader-compatibility.mjs','lib/hook-test-host.mjs']){
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 assert.ok(source.includes("/\\.css(?:\\?|$)/.test(name) ? name.split('?')[0] : name"),file);
}
console.log('PASS CSS-only notices.css?inline normalization and original executable-query resolution failure');
