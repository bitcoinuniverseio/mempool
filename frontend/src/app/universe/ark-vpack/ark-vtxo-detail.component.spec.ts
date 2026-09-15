import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '../universe-api.service';
import { ArkVtxoDetailComponent, checkedVtxo } from './ark-vtxo-detail.component';
const record = { vtxoId:'test-id', network:'signet', batchId:'test-batch', amountSats:'500000', userPubkey:'11'.repeat(32), aspPubkey:'22'.repeat(32), timelockExpiryBlocks:100, treeDepth:1, treeIndex:0, status:'settled' };
describe('Ark VTXO detail source boundaries', () => {
  it.each([{...record,vtxoId:'other'}, {...record,network:'mainnet'}, {...record,network:undefined}, {...record,amountSats:'1.5'}, {...record,timelockExpiryBlocks:-1}])('rejects unbound or malformed metadata', value => {
    expect(() => checkedVtxo(value,'test-id','signet')).toThrow();
  });
  it('accepts only structurally bound provider metadata, not an exit proof', () => {
    expect(checkedVtxo(record,'test-id','signet')).toEqual(record);
  });
  it('clears on route/network switch, reports real transport errors and cancels on destroy', () => {
    const params = new BehaviorSubject(convertToParamMap({vtxoId:'test-id'}));
    const network = new Subject<string>(); const state = {network:'signet',networkChanged$:network};
    const requests: Subject<unknown>[] = []; const api = { getArkVtxo$:vi.fn(() => {const s=new Subject();requests.push(s);return s;}) };
    const c = new ArkVtxoDetailComponent({paramMap:params} as unknown as ActivatedRoute,api as unknown as UniverseApiService,state as unknown as StateService);
    c.ngOnInit(); let latest:any; c.vm$.subscribe(x=>latest=x);
    requests[0].next(record); expect(latest.kind).toBe('ready');
    params.next(convertToParamMap({vtxoId:'next-id'})); expect(latest.kind).toBe('loading');expect(latest.value).toBeUndefined();expect(requests[0].observed).toBe(false);
    requests[1].error({status:503,error:{error:'Owned arkd unavailable'}});expect(latest.error).toBe('Owned arkd unavailable');
    state.network='regtest';network.next('regtest');expect(latest.kind).toBe('loading');
    c.ngOnDestroy();expect(requests[2].observed).toBe(false);
  });
});
