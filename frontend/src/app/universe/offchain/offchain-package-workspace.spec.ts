import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { OffchainPackageWorkspaceComponent, publicOffchainPackage } from './offchain-package-workspace.component';
import { OFFCHAIN_SIGNED_SAMPLE } from './offchain-signed-sample';
describe('public offchain verification', () => {
  it.each(['statechain','coinswap'] as const)('accepts only public %s fixture fields',kind=>{
    expect(publicOffchainPackage(JSON.stringify(OFFCHAIN_SIGNED_SAMPLE[kind]),kind).network).toBe('regtest');
    expect(()=>publicOffchainPackage(JSON.stringify({...OFFCHAIN_SIGNED_SAMPLE[kind],private_key:'not transmitted'}),kind)).toThrow('Unsupported package');
  });
  it('rejects legacy arithmetic-only package and hidden nested fields',()=>{
    expect(()=>publicOffchainPackage('{"maker_contract_locktime":1,"taker_contract_locktime":2}','coinswap')).toThrow();
    const sample=JSON.parse(JSON.stringify(OFFCHAIN_SIGNED_SAMPLE.statechain));sample.backup_transactions[0].seed='not transmitted';
    expect(()=>publicOffchainPackage(JSON.stringify(sample),'statechain')).toThrow('Unknown fields');
  });
  function fixture(){const result=new Subject<any>(), network=new Subject<string>();const api={verifyStatechainTransfer$:vi.fn(()=>result),verifyCoinswapPackage$:vi.fn(()=>result)};const component=new OffchainPackageWorkspaceComponent(api as any,{markForCheck:vi.fn()} as any,{networkChanged$:network} as any);return {component,result,network,api};}
  it('clears stale success and unsubscribes on edit, sample, network and destroy',()=>{
    for(const action of ['edit','sample','network','destroy']){
      const {component,result,network}=fixture();component.loadSample();component.verifyPackage();expect(result.observed).toBe(true);
      if(action==='edit')component.clear();if(action==='sample')component.loadSample();if(action==='network')network.next('signet');if(action==='destroy')component.ngOnDestroy();
      result.next({is_valid:true});expect(component.report).toBeNull();expect(component.verifying).toBe(false);expect(result.observed).toBe(false);
      if(action!=='destroy')component.ngOnDestroy();
    }
  });
  it('renders API contract results and keeps unavailable source distinct',()=>{
    const {component,result,api}=fixture();component.kind='coinswap';component.loadSample();component.verifyPackage();expect(api.verifyCoinswapPackage$).toHaveBeenCalledOnce();
    result.next({is_valid:true,protocol_verified:null,recovery_state:'unknown'});expect(component.report.protocol_verified).toBeNull();
    component.verifyPackage();result.error({error:{error:'Owned node unavailable'}});expect(component.report).toBeNull();expect(component.error).toBe('Owned node unavailable');component.ngOnDestroy();
  });
  it('does not transmit rejected fields',()=>{const {component,api}=fixture();component.packageInput='{"secret":"private"}';component.verifyPackage();expect(api.verifyStatechainTransfer$).not.toHaveBeenCalled();component.ngOnDestroy();});
});
