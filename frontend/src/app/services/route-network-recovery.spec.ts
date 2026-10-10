// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Subject, Subscription } from 'rxjs';
import { NavigationStart, NavigationCancel, NavigationError, Router } from '@angular/router';
import { networkRouteUrls$, StateService } from './state.service';
interface NetworkFixture {
  events: Subject<unknown>; state: { network: string; networkChanged$: Subject<string>; env: { BASE_MODULE: string; ROOT_NETWORK: string } };
  urls: string[]; sub: Subscription;
  start(id: number, url: string): void; setActive(id: number): void; settle(): void;
}
function fixture(): NetworkFixture {
  const events=new Subject<unknown>();let active:{id:number}|null=null;
  const router={events,url:'/address/accepted',getCurrentNavigation:()=>active,lastSuccessfulNavigation:{id:1,finalUrl:{toString:()=>'/address/accepted'}}} as Router;
  const state={env:{BASE_MODULE:'mempool',ROOT_NETWORK:''},network:'',networkChanged$:new Subject<string>()};const urls:string[]=[];
  const sub=networkRouteUrls$(router).subscribe(url=>{urls.push(url);StateService.prototype.setNetworkBasedonUrl.call(state as never,url);});
  return {events,state,urls,sub,start(id:number,url:string): void {active={id};events.next(new NavigationStart(id,url));},setActive(id:number): void {active={id};},settle(): void {active=null;}};
}
describe('shared selected network cancellation recovery',()=>{
  it.each(['cancel','error'])('restores the accepted Mainnet URL after latest %s, never the rejected target',kind=>{
    const f=fixture();f.start(2,'/signet/address/rejected');expect(f.state.network).toBe('signet');f.settle();
    f.events.next(kind==='cancel'?new NavigationCancel(2,'/signet/address/rejected','guard'):new NavigationError(2,'/signet/address/rejected',new Error('guard')));
    expect(f.state.network).toBe('');expect(f.urls).toEqual(['/signet/address/rejected','/address/accepted']);f.sub.unsubscribe();expect(f.events.observed).toBe(false);
  });
  it('ignores stale cancellation after a newer start, and before its start listener when the Router already owns it',()=>{
    const f=fixture();f.start(2,'/signet/address/a');f.setActive(3);f.events.next(new NavigationCancel(2,'/signet/address/a','superseded'));expect(f.state.network).toBe('signet');expect(f.urls).toHaveLength(1);
    f.start(3,'/testnet/address/b');f.events.next(new NavigationError(2,'/signet/address/a',new Error('late')));expect(f.state.network).toBe('testnet');expect(f.urls).toHaveLength(2);f.sub.unsubscribe();
  });
});
