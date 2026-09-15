import { describe,expect,it,vi } from 'vitest';
import { of,Subject } from 'rxjs';
import { DlcOracleVerifyComponent } from './dlc-oracle-verify.component';
function page(response:any=of({verified:true,errors:[]})){
 const api={verifyAnnouncement$:vi.fn(()=>response),verifyAttestation$:vi.fn(()=>response)};
 return {page:new DlcOracleVerifyComponent(api as any,{markForCheck:vi.fn()} as any),api};
}
describe('oracle verifier user actions',()=>{
 it('submits exact announcement and binds attestation to the separate signed announcement',()=>{
  const p=page();p.page.loadSample();p.page.verify('announcement');expect(p.api.verifyAnnouncement$).toHaveBeenCalledWith(JSON.parse(p.page.announcementInput));expect(p.page.result.verified).toBe(true);
  p.page.verify('attestation');expect(p.api.verifyAttestation$.mock.calls[0][0].announcement).toEqual(JSON.parse(p.page.announcementInput));
 });
 it('clears prior success on edits and malformed JSON',()=>{
  const p=page();p.page.loadSample();p.page.verify('announcement');p.page.edited();expect(p.page.result).toBeNull();p.page.announcementInput='{';p.page.verify('announcement');expect(p.page.result.verified).toBe(false);
 });
 it.each(['edit','sample','destroy'])('discards stale verification on %s',action=>{
  const pending=new Subject();const p=page(pending);p.page.loadSample();p.page.verify('announcement');if(action==='edit')p.page.edited();else if(action==='sample')p.page.loadSample();else p.page.ngOnDestroy();pending.next({verified:true});expect(p.page.result).toBeNull();
 });
 it('rejects ambiguous nested announcement input',()=>{const p=page();p.page.loadSample();p.page.attestationInput='{"announcement":{}}';p.page.verify('attestation');expect(p.api.verifyAttestation$).not.toHaveBeenCalled();expect(p.page.result.verified).toBe(false);});
});
