import { expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { LiquidObservatoryComponent } from './liquid-observatory.component';
it('clears the prior checkpoint and cancels stale reads when the selected source network changes',()=>{
 const main=new Subject<any>(),regtest=new Subject<any>();
 const api={getLiquidNode$:vi.fn((network:string)=>network==='liquidv1'?main:regtest)};
 const page=new LiquidObservatoryComponent(api as any,{setTitle:vi.fn()} as any);
 let state:any;const subscription=page.node$.subscribe(value=>state=value);
 main.next({network:'liquidv1',blockHeight:100});expect(state.node.blockHeight).toBe(100);
 page.network='elementsregtest';page.refreshNode();expect(state.node).toBeNull();expect(state.loading).toBe(true);
 main.next({network:'liquidv1',blockHeight:101});expect(state.node).toBeNull();
 regtest.next({network:'elementsregtest',blockHeight:103});expect(state.node.network).toBe('elementsregtest');
 subscription.unsubscribe();page.ngOnDestroy();
});
it('keeps source errors visible and never converts them into a zero balance or empty registry',()=>{
 const rpc=new Subject<any>();const page=new LiquidObservatoryComponent({getLiquidNode$:()=>rpc} as any,{setTitle:vi.fn()} as any);
 let state:any;const subscription=page.node$.subscribe(value=>state=value);rpc.error({error:{error:'Wrong source network'}});expect(state.node).toBeNull();expect(state.error).toBe('Wrong source network');subscription.unsubscribe();page.ngOnDestroy();
});
