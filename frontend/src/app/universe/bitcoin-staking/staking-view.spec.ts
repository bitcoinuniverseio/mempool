import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { BitcoinStakingApiService } from './bitcoin-staking.service';
import { StakingEvidenceComponent } from './staking-evidence.component';
import { observeStaking, slashingLabel, reconciliationLabel } from './staking-view';
const cdr = {markForCheck: vi.fn()} as unknown as ChangeDetectorRef;
describe('staking truthful source boundaries', () => {
  it('never converts unknown slashing or mismatched amounts into health or equality', () => {
    expect(slashingLabel(undefined)).toBe('Unknown');expect(slashingLabel(false)).toBe('Not reported slashed');
    expect(reconciliationLabel({total_btc_stake_sat:10,total_consumer_voting_power_sat:9})).toBe('Reported totals differ');
    expect(reconciliationLabel({})).toBe('Unknown');
  });
  it('cancels old reads, clears state, survives errors for subsequent networks and unsubscribes', () => {
    const networks = new BehaviorSubject('signet'); const pending: Subject<number>[]=[]; const reset=vi.fn(); const next=vi.fn();const error=vi.fn();
    const sub=observeStaking(networks,reset,()=>{const s=new Subject<number>();pending.push(s);return s;},next,error);
    pending[0].next(1);networks.next('regtest');expect(pending[0].observed).toBe(false);expect(reset).toHaveBeenCalledTimes(2);
    pending[1].error(Error('missing'));networks.next('signet');expect(pending).toHaveLength(3);expect(error).toHaveBeenCalledOnce();sub.unsubscribe();expect(pending[2].observed).toBe(false);
  });
  it('requires explicit response network and requested source identity', () => {
    const changed = new Subject<string>();let response:any={network:'mainnet',delegation_id:'x'};
    const get=vi.fn((_url: string)=>of(response)); const api=new BitcoinStakingApiService({get} as unknown as HttpClient,{isBrowser:true,network:'signet',networkChanged$:changed} as unknown as StateService);
    const error=vi.fn();api.getDelegationById$('x').subscribe({error});expect(error).toHaveBeenCalledOnce();expect(get.mock.calls[0][0]).toContain('/signet/api/');
    response={network:'signet',delegation_id:'other'};api.getDelegationById$('x').subscribe({error});expect(error).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable EOTS as unavailable, and rejects an unsupported true verdict', () => {
    let response:any=throwError(()=>({status:503,error:{error:'Owned EOTS verifier unavailable'}}));
    const api={networkChanges$:of('signet'),getEvidence$:()=>of([]),verifyEvidence$:()=>response};const c=new StakingEvidenceComponent(api as unknown as BitcoinStakingApiService,cdr);c.ngOnInit();
    c.verifyEvidence();expect(c.report).toBeNull();expect(c.error).toContain('unavailable');
    response=of({verified:true,status:'equivocation_proven'});c.verifyEvidence();expect(c.report).toBeNull();expect(c.error).toContain('supported cryptographic');
  });
  it('cancels verification on edit/sample/destroy and clears sample signatures', () => {
    const pending=new Subject();const c=new StakingEvidenceComponent({verifyEvidence$:()=>pending} as unknown as BitcoinStakingApiService,cdr);
    c.verifyEvidence();c.clearReport();expect(pending.observed).toBe(false);expect(c.verifying).toBe(false);
    c.verifyEvidence();c.loadSample();expect(pending.observed).toBe(false);expect(c.sigA).toBe('');expect(c.sigB).toBe('');
    c.verifyEvidence();c.ngOnDestroy();expect(pending.observed).toBe(false);
  });
});
