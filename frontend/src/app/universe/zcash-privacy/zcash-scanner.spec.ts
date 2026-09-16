import '@angular/compiler';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
import { Subject } from 'rxjs';
import { scanZcash } from '../../../resources/zcash-scanner/scanner.worker.js';
import { ZcashViewingKeyWorkspaceComponent } from './zcash-viewing-key-workspace.component';
import { ZcashScannerService } from './zcash-scanner.service';
const clone=(value:any)=>JSON.parse(JSON.stringify(value));
describe('actual local Zcash WASM',()=>{
 it('decrypts all20 independent public vectors exactly and wipes key memory',async()=>{
  const module=await WebAssembly.compile(await readFile('../frontend/src/resources/zcash-scanner/universe_zcash_scanner.wasm'));
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  const fixtures=JSON.parse(await readFile('../tools/zcash-scanner/fixtures.json','utf8'));
  for(const fixture of fixtures){const instance=await WebAssembly.instantiate(module,{});const input=clone(fixture);const result=scanZcash(instance,input);expect(result.received_zatoshis).toBe(fixture.expected_zatoshis);expect(result.notes_found).toBe(1);expect(result.balance_zatoshis).toBeNull();expect(result.scanned_blocks).toBe(0);expect(input.viewing_key).toBe('');expect(new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer).every(v=>v===0)).toBe(true);}
 });
 it('rejects ciphertext mutations and incorrect valid keys',async()=>{
  const module=await WebAssembly.compile(await readFile('src/resources/zcash-scanner/universe_zcash_scanner.wasm'));const fixtures=JSON.parse(await readFile('../tools/zcash-scanner/fixtures.json','utf8'));
  for(const index of [0,10]){const data=clone(fixtures[index]);data.outputs[0].ciphertext='00'+data.outputs[0].ciphertext.slice(2);expect(scanZcash(await WebAssembly.instantiate(module,{}),data).notes_found).toBe(0);const wrong=clone(fixtures[index]);wrong.viewing_key=fixtures[index+1].viewing_key;expect(scanZcash(await WebAssembly.instantiate(module,{}),wrong).notes_found).toBe(0);}
 });
 it('binds an official raw block to its hash, Merkle root, height and resume predecessor',async()=>{
  const module=await WebAssembly.compile(await readFile('src/resources/zcash-scanner/universe_zcash_scanner.wasm'));const fixtures=JSON.parse(await readFile('../tools/zcash-scanner/fixtures.json','utf8'));
  const hex=(await readFile('../tools/zcash-scanner/block-mainnet-415000.hex','utf8')).trim(),raw=Buffer.from(hex,'hex');const size=raw[140]===253?raw.readUInt16LE(141):raw[140],prefix=raw[140]===253?3:1;const hash=Buffer.from(createHash('sha256').update(createHash('sha256').update(raw.subarray(0,140+prefix+size)).digest()).digest()).reverse().toString('hex');
  const input={...fixtures[0],mode:'owned-blocks',start_height:415000,previous_hash:Buffer.from(raw.subarray(4,36)).reverse().toString('hex'),blocks:[{hash,hex}]};
  expect(scanZcash(await WebAssembly.instantiate(module,{}),clone(input))).toMatchObject({scanned_blocks:1,next_height:415001,last_hash:hash,balance_zatoshis:null});
  const altered=clone(input);altered.blocks[0].hex=hex.slice(0,-2)+(hex.endsWith('00')?'01':'00');const alteredInstance=await WebAssembly.instantiate(module,{});expect(()=>scanZcash(alteredInstance,altered)).toThrow();
 });
});
describe('viewing-key lifecycle and public request boundary',()=>{
 function fixture(){const network=new Subject<string>();let resolve:any;const promise=new Promise<any>(accept=>{resolve=accept});const cancel=vi.fn();const scanner={run:vi.fn(()=>({promise,cancel})),publicBlocks:vi.fn()};const component=new ZcashViewingKeyWorkspaceComponent({setTitle:vi.fn()} as any,scanner as any,{markForCheck:vi.fn()} as any,{networkChanged$:network} as any);return {component,scanner,network,resolve,cancel};}
 it.each(['edit','network','destroy','sample'])('discards stale results after %s',async action=>{const {component,network,resolve,cancel}=fixture();component.loadSample('sapling');let result:any;component.result$.subscribe(v=>result=v);const pending=component.scan();if(action==='edit')component.clear();if(action==='network')network.next('testnet');if(action==='destroy')component.ngOnDestroy();if(action==='sample')component.loadSample('orchard');resolve({notes_found:1});await pending;expect(result).toBeNull();expect(cancel).toHaveBeenCalled();if(action==='destroy')expect(component.viewingKey).toBe('');else component.ngOnDestroy();});
 it('never asks source for blocks in offline artifact mode',async()=>{const {component,scanner,resolve}=fixture();component.loadSample('orchard');const pending=component.scan();resolve({mode:'compact-artifact',notes_found:1});await pending;expect(scanner.publicBlocks).not.toHaveBeenCalled();component.ngOnDestroy();});
 it('only sends public interval parameters to same-origin source',async()=>{const fetchMock=vi.fn(async()=>({ok:true,text:async()=>JSON.stringify({mode:'owned-blocks',network:'mainnet',start_height:5,end_height:5,previous_hash:'00'.repeat(32),blocks:[{}]})}));vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('document',{baseURI:'https://example.test/'});try{await new ZcashScannerService().publicBlocks('mainnet',5,5,undefined,new AbortController().signal);const [url,options]=fetchMock.mock.calls[0] as any;expect(url.toString()).toBe('https://example.test/api/v1/zcash/privacy/blocks?network=mainnet&start=5&end=5');expect(options.body).toBeUndefined();}finally{vi.unstubAllGlobals();}});
 it('resumes from the previous result hash and discards a reorg result',async()=>{
  const result={mode:'owned-blocks',last_hash:'ab'.repeat(32),next_height:12};const scanner={run:vi.fn(()=>({promise:Promise.resolve(result),cancel:vi.fn()})),publicBlocks:vi.fn(async()=>({mode:'owned-blocks'}))};const network=new Subject<string>();const c=new ZcashViewingKeyWorkspaceComponent({setTitle:vi.fn()} as any,scanner as any,{markForCheck:vi.fn()} as any,{networkChanged$:network} as any);c.viewingKey='local-test-key';c.startHeight=11;await c.scan();expect(c.resume).toEqual({hash:result.last_hash,height:12});await c.scan(true);expect(scanner.publicBlocks.mock.calls[1].slice(0,4)).toEqual(['mainnet',12,12,result.last_hash]);scanner.publicBlocks.mockRejectedValueOnce(new Error('Prior checkpoint changed'));await c.scan(true);expect(c.resume).toBeNull();expect(c.error).toBe('Prior checkpoint changed');c.ngOnDestroy();
 });
});
