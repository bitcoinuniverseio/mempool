import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { TaprootAssetsComponent } from './taproot-assets.component';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function setup() {
  const route = new BehaviorSubject(convertToParamMap({}));
  const network = { network: 'signet', networkChanged$: new Subject<string>() };
  const responses: Subject<any>[] = [];
  const api: any = { network: 'signet', getTaprootAssets$: () => of({assets:[]}), getTaprootAssetGroups$: () => of({groups:[]}),
    getTaprootAsset$: vi.fn(() => new Subject()), verifyTaprootProof$: vi.fn(() => { const response = new Subject(); responses.push(response); return response; }) };
  const page = new TaprootAssetsComponent(api, {paramMap:route} as any, {setTitle:vi.fn()} as any, network as any);
  page.ngOnInit(); page.proofAssetId = 'a'.repeat(64); page.proofData = 'AQ==';
  return {page,api,route,network,responses};
}
const valid = {valid:true,stage:'verified',asset_id:'a'.repeat(64),network:'signet',proof_sha256:bytesToHex(sha256(Uint8Array.of(1))),source:{network:'signet',genesis_hash:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',block_hash:'c'.repeat(64),block_height:103,tapd_block_hash:'c'.repeat(64),tapd_block_height:103,tapd_version:'0.6.0',observed_at:'2026-09-15T18:00:00Z'},anchor:{txid:'b'.repeat(64),block_hash:'c'.repeat(64),block_height:103}};
describe('Taproot Assets proof and directory evidence', () => {
  it('clears old detail immediately when route changes and cancels the obsolete source', () => {
    const {page,api,route}=setup(); const reads: Subject<any>[]=[];
    api.getTaprootAsset$.mockImplementation(()=>{const read=new Subject(); reads.push(read); return read;});
    let view:any;page.vm$.subscribe(value=>view=value);
    route.next(convertToParamMap({assetId:'a'.repeat(64)})); reads[0].next({name:'old asset'});expect(view.selected.name).toBe('old asset');
    route.next(convertToParamMap({assetId:'b'.repeat(64)}));expect(view.kind).toBe('loading');expect(view.selected).toBeUndefined();
    reads[0].next({name:'late obsolete asset'});expect(view.kind).toBe('loading');
    page.ngOnDestroy();expect(reads[1].observed).toBe(false);
  });
  it('requires a complete matching verdict before a verified label', () => {
    const {page,responses}=setup();page.verifyProof();responses[0].next({...valid,asset_id:'d'.repeat(64)});expect(page.proofState.value.kind).toBe('unavailable');
    page.verifyProof();responses[1].next(valid);expect(page.proofState.value.kind).toBe('valid');page.ngOnDestroy();
  });
  it('keeps invalid proofs distinct from unavailable verification', () => {
    const {page,responses}=setup();page.verifyProof();responses[0].next({valid:false,stage:'invalid-proof',error:'Signature mismatch'});expect(page.proofState.value.kind).toBe('invalid');
    page.verifyProof();responses[1].error({status:503,error:{error:'Owned verifier unavailable'}});expect(page.proofState.value).toMatchObject({kind:'unavailable',message:'Owned verifier unavailable'});page.ngOnDestroy();
  });
  it.each([{proof_sha256:'d'.repeat(64)},{network:'regtest'},{source:{...valid.source,genesis_hash:'0'.repeat(64)}},{source:{...valid.source,tapd_block_height:102}},{source:null}])('withholds success for a mismatched proof or source checkpoint %j', changes => {
    const {page,responses}=setup();page.verifyProof();responses[0].next({...valid,...changes});expect(page.proofState.value.kind).toBe('unavailable');page.ngOnDestroy();
  });
  it('validates the public identifier and bounded proof encoding before transmission', () => {
    const {page,api}=setup();page.proofAssetId='not an asset';page.verifyProof();expect(api.verifyTaprootProof$).not.toHaveBeenCalled();
    page.proofAssetId='a'.repeat(64);page.proofData='AQ=='.repeat(300000);page.verifyProof();expect(api.verifyTaprootProof$).not.toHaveBeenCalled();page.ngOnDestroy();
  });
  it('clears successful or pending verdicts on edits and ignores late replies', () => {
    const {page,responses}=setup();page.verifyProof();page.proofData='Ag==';page.invalidateProof();responses[0].next(valid);expect(page.proofState.value.kind).toBe('idle');expect(responses[0].observed).toBe(false);
    page.verifyProof();responses[1].next(valid);page.invalidateProof();expect(page.proofState.value.kind).toBe('idle');page.ngOnDestroy();
  });
  it('clears proof bytes and cancels verification on network changes', () => {
    const {page,api,network,responses}=setup();page.verifyProof();api.network='regtest';network.network='regtest';network.networkChanged$.next('regtest');responses[0].next(valid);expect(page.proofState.value.kind).toBe('idle');expect(page.proofData).toBe('');page.ngOnDestroy();
  });
});
