import { describe,expect,it,vi } from 'vitest';
import { Subject,of,throwError } from 'rxjs';
import { SimplicityVerifyComponent } from './simplicity-verify.component';
describe('formal artifact verdict rendering state',()=>{
 function page(response:any){return new SimplicityVerifyComponent({verifyFormalProof$:vi.fn(()=>response)} as any,{markForCheck:vi.fn()} as any);}
 it('uses the actual verified/proof_state backend contract',()=>{
  const p=page(of({verified:true,proof_state:'proof_checked',message:'Exact closed claim checked'}));p.verifyProof();expect(p.result.verified).toBe(true);expect(p.result.proof_state).toBe('proof_checked');p.edited();expect(p.result).toBeNull();
 });
 it('retains unsupported verdicts as unverified',()=>{
  const p=page(of({verified:false,proof_state:'unsupported_proof_system',message:'No kernel'}));p.verifyProof();expect(p.result.verified).toBe(false);expect(p.result.message).toBe('No kernel');
 });
 it.each(['edit','sample','destroy'])('discards pending results after %s',action=>{
  const result=new Subject();const p=page(result);p.verifyProof();if(action==='edit')p.edited();else if(action==='sample')p.loadSample();else p.ngOnDestroy();
  result.next({verified:true});expect(p.result).toBeNull();expect(p.verifying).toBe(false);
 });
 it('clears previous success on malformed data or checker errors',()=>{
  const p=page(throwError(()=>({error:{stage:'checker-unavailable',error:'Owned checker missing'}})));p.verifyProof();expect(p.result.verified).toBe(false);expect(p.result.message).toBe('Owned checker missing');
  p.manifestInput='{';p.verifyProof();expect(p.result.message).toBe('Malformed or oversized JSON manifest');
 });
 it('loads the bound Lean profile and cancels the previous in-flight checker',()=>{
  const result=new Subject();const p=page(result);p.verifyProof();p.loadLeanSample();const sample=JSON.parse(p.manifestInput);expect(sample).toMatchObject({proof_system:'lean4',proof_profile:'simplicity-u32-equality-v1',kernel_revision:'lean-4.24.0',statement:'(42 : UInt32) = (42 : UInt32)'});result.next({verified:true});expect(p.result).toBeNull();expect(p.verifying).toBe(false);p.ngOnDestroy();
 });
});
