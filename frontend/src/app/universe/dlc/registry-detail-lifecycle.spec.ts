import {describe,it,expect,vi} from 'vitest';
import {BehaviorSubject,Subject} from 'rxjs';
import {convertToParamMap} from '@angular/router';
import {EcashCashuDetailComponent} from '../ecash/ecash-cashu-detail.component';
import {EcashFedimintDetailComponent} from '../ecash/ecash-fedimint-detail.component';
import {DlcEventDetailComponent} from './dlc-event-detail.component';
import {DlcOracleDetailComponent} from './dlc-oracle-detail.component';
describe('registry detail request ownership',()=>{
 for(const [Component,param,field,identity,method] of [
  [EcashCashuDetailComponent,'mintId','mint','mint_id','getCashuMintById$'],
  [EcashFedimintDetailComponent,'federationId','federation','federation_id','getFedimintFederationById$'],
  [DlcEventDetailComponent,'eventId','event','event_id','getEventById$'],
  [DlcOracleDetailComponent,'oracleId','oracle','oracle_id','getOracleById$'],
 ] as const)it(`${field}: cancels route/network/destroy, rejects identity substitution, shows source failures`,()=>{
  const route=new BehaviorSubject(convertToParamMap({[param]:'a'}));const network=new Subject<string>();const requests:Subject<any>[]=[];
  const load=vi.fn(()=>{const s=new Subject<any>();requests.push(s);return s;});
  const c:any=new Component({paramMap:route} as any,{[method]:load} as any,{markForCheck:vi.fn()} as any,{networkChanged$:network} as any);
  c.ngOnInit();const first=requests.at(-1)!;route.next(convertToParamMap({[param]:'b'}));expect(first.observed).toBe(false);first.next({[identity]:'a'});expect(c[field]).toBeNull();
  requests.at(-1)!.next({[identity]:'other'});expect(c.error).toContain('identifier');expect(c[field]).toBeNull();
  network.next('signet');requests.at(-1)!.next({[identity]:'b'});expect(c[field][identity]).toBe('b');
  network.next('mainnet');expect(c[field]).toBeNull();requests.at(-1)!.error({status:503,error:{error:'Source unavailable'}});expect(c.error).toBe('Source unavailable');
  const count=load.mock.calls.length;route.next(convertToParamMap({}));expect(load).toHaveBeenCalledTimes(count);expect(c[field]).toBeNull();expect(c.loading).toBe(false);
  route.next(convertToParamMap({[param]:'c'}));const last=requests.at(-1)!;c.ngOnDestroy();expect(last.observed).toBe(false);expect(c[field]).toBeNull();
 });
});
