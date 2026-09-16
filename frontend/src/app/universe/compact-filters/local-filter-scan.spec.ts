import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyLocalFilter,scanFilterRange,scanScript } from './local-filter-scan';
import { decodeBasicFilter,matchesBasicFilter } from './bip158';
import { sha256 } from '@noble/hashes/sha2.js';
const rows=JSON.parse(readFileSync('../tools/compact-filters/bip158-testnet19.json','utf8')).slice(1);
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
function record(row:any[]){return{network:'test',block_height:row[0],block_hash:row[1],prev_filter_header:row[4],filter_bytes_hex:row[5],filter_header:row[6],element_count:decodeBasicFilter(row[5]).length,filter_hash:hex(sha256(sha256(Uint8Array.from(row[5].match(/../g), (x:any)=>parseInt(x,16)))).reverse())};}
it.each(rows.map((row:any[])=>({height:row[0],row})))('verifies official filter commitment at$height in browser implementation',({row})=>{verifyLocalFilter(record(row));for(const script of row[3].filter((x:string)=>x.length))expect(matchesBasicFilter(row[5],row[1],[Uint8Array.from(script.match(/../g),(x:any)=>parseInt(x,16))])).toBe(true);});
it('rejects altered filter headers and forged counts',()=>{expect(()=>verifyLocalFilter({...record(rows[0]),filter_header:'11'.repeat(32)})).toThrow();expect(()=>verifyLocalFilter({...record(rows[0]),element_count:2})).toThrow();});
it('retains exact range and network binding',()=>{const f=record(rows[0]);expect(()=>scanFilterRange([{network:'test',filters:[f]}],new Uint8Array([81]),0,1,'test')).toThrow();expect(()=>scanFilterRange([{network:'test',filters:[f]}],new Uint8Array([81]),0,0,'main')).toThrow();});
it('rejects unsupported descriptors and private key material locally',()=>{for(const input of ['wpkh(xpub/0/*)','xprv-secret','raw(0)','raw(gg)'])expect(()=>scanScript(input,'main')).toThrow();expect(scanScript('raw(51)','main')).toEqual(new Uint8Array([81]));});
it('keeps backend and frontend codec byte-identical',()=>{expect(readFileSync('src/app/universe/compact-filters/bip158.ts','utf8')).toBe(readFileSync('../backend/src/api/intelligence/compact-filters/bip158.ts','utf8'));});

import { vi } from 'vitest';
import { Subject } from 'rxjs';
import { LightClientScanComponent } from './light-client-scan.component';
it('scans official offline filter through the product without an HTTP request and clears stale result on edits',()=>{
 const api={getRanges$:vi.fn()};const page=new LightClientScanComponent({markForCheck:vi.fn()} as any,api as any);const f=record(rows[0]);page.network='test';page.startHeight=page.endHeight=0;page.descriptor='raw(51)';page.offlineRange=JSON.stringify([{network:'test',filters:[f]}]);page.startScan();expect(page.error).toBeNull();expect(page.scanResults.total_scanned).toBe(1);expect(page.scanResults.false_positives).toBe('Unconfirmed');expect(api.getRanges$).not.toHaveBeenCalled();page.edited();expect(page.scanResults).toBeNull();page.ngOnDestroy();
});
it('transmits only public heights/network in owned mode and cancels stale scan completion',()=>{
 const pending=new Subject<any>();const api={getRanges$:vi.fn(()=>pending)};const page=new LightClientScanComponent({markForCheck:vi.fn()} as any,api as any);page.descriptor='raw(51)';page.network='test';page.startHeight=page.endHeight=0;page.startScan();expect(api.getRanges$).toHaveBeenCalledWith(0,0,'test');page.cancelScan();pending.next([{network:'test',filters:[record(rows[0])]}]);expect(page.scanResults).toBeNull();expect(page.scanning).toBe(false);page.ngOnDestroy();
});
it('rejects unsupported descriptors before any owned public request',()=>{const api={getRanges$:vi.fn()};const page=new LightClientScanComponent({markForCheck:vi.fn()} as any,api as any);page.descriptor='wpkh(xpub/0/*)';page.startScan();expect(page.error).toContain('not implemented');expect(api.getRanges$).not.toHaveBeenCalled();page.ngOnDestroy();});
