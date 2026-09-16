import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { LiquidUnblindWorkspaceComponent } from './liquid-unblind-workspace.component';
const result={assetId:'17'.repeat(32),valueSat:'15000001',rangeproofValid:true as const,surjectionproofValid:true as const};
function page(inspect=vi.fn().mockResolvedValue(result)){
 const networkChanged$=new Subject<string>();
 const component=new LiquidUnblindWorkspaceComponent({setTitle:vi.fn()} as any,{inspect} as any,{networkChanged$} as any,{markForCheck:vi.fn()} as any);
 component.blindingKey='2a'.repeat(32); component.outputHex='test-output';component.inputGenerators='one\ntwo';
 let current:unknown;component.result$.subscribe(value=>current=value);
 return {component,inspect,networkChanged$,current:()=>current};
}
describe('Liquid unblinding lifecycle',()=>{
 it('passes exact supplied output/context to local verifier and clears private key',async()=>{
  const p=page();await p.component.unblind();
  expect(p.inspect.mock.calls[0][0].outputHex).toBe('test-output');
  expect(p.inspect.mock.calls[0][0].inputGenerators).toEqual(['one','two']);
  expect(p.component.blindingKey).toBe('');expect(p.current()).toEqual(result);
  p.component.edited();expect(p.current()).toBeNull();p.component.ngOnDestroy();
 });
 it('clears old result before failed verification',async()=>{
  const p=page();await p.component.unblind();p.inspect.mockRejectedValue(new Error('Proof failed'));
  await p.component.unblind();expect(p.current()).toBeNull();expect(p.component.error).toBe('Proof failed');p.component.ngOnDestroy();
 });
 it.each(['edit','network','destroy'])('rejects stale completion after %s',async action=>{
  let resolve:(value:typeof result)=>void;
  const p=page(vi.fn().mockImplementation(()=>new Promise(done=>resolve=done)));
  const pending=p.component.unblind();
  if(action==='edit')p.component.edited();else if(action==='network')p.networkChanged$.next('liquidtestnet');else p.component.ngOnDestroy();
  resolve!(result);await pending;expect(p.current()).toBeNull();expect(p.component.blindingKey).toBe('');p.component.ngOnDestroy();
 });
});
