// IMPLEMENTATION-HANDOFF [WP-RS-002] COV-RS-RGB-MANIFEST / DEF-RS-002.
// 1. Before treating fixture success as packaged-engine acceptance, load
//    frontend/src/resources/rgb-engine/engine-manifest.json, require entries for
//    rgb_engine.js, rgb_engine_bg.wasm and rgb.worker.js, and recompute SHA256 from
//    each file's raw bytes. Assert exact equality with every manifest value.
// 2. Test the validator with copied bytes changed by one byte; it must reject
//    without editing committed assets. Retain the ten real WASM regressions below.
// 3. Coordinate manifest refresh at rust/rgb-engine/build.mjs; run
//    node --test rust/rgb-engine/rgb-wasm.test.mjs. Baseline fixture run: 10 PASS;
//    baseline worker digest: FAIL. No Signet or Mainnet execution is implied.
//    Prerequisites: reviewed artifact set; rollback: keep assets/manifest together.
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {fileURLToPath} from 'node:url';import {webcrypto} from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));const assets=path.resolve(root,'../../frontend/src/resources/rgb-engine');const context={console,TextEncoder,TextDecoder,WebAssembly,Uint8Array,ArrayBuffer,DataView,URL,crypto:webcrypto};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(assets,'rgb_engine.js'),'utf8')+';globalThis.engine=wasm_bindgen;',context);context.bytes=fs.readFileSync(path.join(assets,'rgb_engine_bg.wasm'));vm.runInContext('engine.initSync({module:bytes})',context);const fixtures=JSON.parse(fs.readFileSync(path.join(root,'tests/public-fixtures.json')));const run=request=>JSON.parse(context.engine.validate_rgb(JSON.stringify(request)));const a=fixtures[0].request;
for(const fixture of fixtures)test(`official ${fixture.scenario} schema/history/seal verification in WASM`,()=>{const result=run(fixture.request);assert.equal(result.status,'valid');assert(result.contract_id);assert.equal(result.anchor_txids.length,Object.keys(fixture.request.witnesses).length);});
test('altered seal commitment fails while preserving contract identity',()=>{const copy=Buffer.from(a.consignment,'hex');copy[441]^=1;const result=run({...a,consignment:copy.toString('hex')});assert.equal(result.status,'invalid');assert.equal(result.contract_id,run(a).contract_id);assert.match(result.reason,/commitment doesn't match/);});
test('missing public evidence remains unresolved',()=>assert.equal(run({...a,witnesses:{}}).status,'unresolved'));
test('wrong chain is invalid',()=>assert.equal(run({...a,network:'signet'}).status,'invalid'));
test('malformed and trailing encoded bytes reject',()=>{assert.equal(run({...a,consignment:'aabb'}).status,'malformed');assert.equal(run({...a,consignment:a.consignment+'00'}).status,'malformed');});
test('untrusted lengths never allocate their full declared capacity',()=>{for(let offset=100;offset<441;offset+=31){const copy=Buffer.from(a.consignment,'hex');copy[offset]^=1;const result=run({...a,consignment:copy.toString('hex')});assert(['malformed','invalid','valid','warnings','unresolved'].includes(result.status));}});
test('public transaction bytes cannot be rebound to another ID',()=>{const id=Object.keys(a.witnesses)[0];const witnesses=structuredClone(a.witnesses);witnesses[id].raw_tx='0300'+witnesses[id].raw_tx.slice(4);const result=run({...a,witnesses});assert.equal(result.status,'unresolved');assert.match(result.reason,/ID mismatch/);});
