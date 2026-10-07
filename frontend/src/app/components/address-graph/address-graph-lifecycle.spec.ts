// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { AddressGraphComponent } from './address-graph.component';
const tip='a'.repeat(64),address='test-owned-address';
const row=(id:number)=>({txid:id.toString(16).padStart(64,'0'),value:1,height:6000-id,time:100,tx_position:1});
function setup() {
 const network=new BehaviorSubject('');
 const stats={tx_count:5001,funded_txo_sum:5001,spent_txo_sum:0};
 const api={getBlockTipHash$:vi.fn().mockReturnValue(of(tip)),getAddress$:vi.fn().mockReturnValue(of({address,chain_stats:stats})),getAddressSummary$:vi.fn()};
 const prices={getPriceByBulk$:vi.fn().mockReturnValue(throwError(()=>Error('unavailable')))};
 const c=new AddressGraphComponent('en-US',{network:'',networkChanged$:network,isAnyTestnet:()=>false,isBrowser:true} as any,api as any,{} as any,{transform:String} as any,{markForCheck:vi.fn()} as any,{} as any,prices as any,{transform:String} as any,{} as any);
 c.address=address;c.stats=stats as any;
 return {c,api,prices,network};
}
describe('balance history paging consumer lifecycle',()=>{
 it('renders BTC without prices, retains partial data after earlier failure and retries exact cursor',()=>{
  const {c,api,prices,network}=setup(); const first=Array.from({length:5000},(_,i)=>row(i+1));
  api.getAddressSummary$.mockReturnValueOnce(of(first)).mockReturnValueOnce(throwError(()=>Error('provider unavailable'))).mockReturnValueOnce(of([row(5001)]));
  c.ngOnChanges({address:{} as any});
  expect(c.loadedCount).toBe(5000);expect(c.historyComplete).toBe(false);expect(c.isLoading).toBe(false);expect(c.data.length).toBe(5001);
  expect(prices.getPriceByBulk$).not.toHaveBeenCalled();
  c.loadEarlier();expect(c.loadedCount).toBe(5000);expect(c.error).toBeNull();expect(c.historyError).toContain('provider unavailable');
  c.loadEarlier();expect(api.getAddressSummary$).toHaveBeenLastCalledWith(address,first[4999].txid);
  expect(c.loadedCount).toBe(5001);expect(c.historyComplete).toBe(true);expect(c.historyError).toBeNull();
  c.onLegendSelectChanged({selected:{Balance:true,Fiat:true}});
  expect(c.fiatError).toContain('BTC history remains available');expect(c.data.length).toBe(5002);expect(c.fiatData).toEqual([]);
  prices.getPriceByBulk$.mockReturnValue(of(Array.from({length:5001},()=>({price:{USD:100}}))) as any);
  c.retryFiat();expect(c.fiatError).toBeNull();expect(c.fiatData.length).toBe(5001);
  c.chartInstance={clear:vi.fn()};network.next('signet');expect(c.chartInstance.clear).toHaveBeenCalledOnce();
  expect(c.data).toEqual([]);expect(c.fiatData).toEqual([]);expect(c.chartOptions).toEqual({});expect(c.expectedCount).toBeNull();expect(c.checkpoint).toBeNull();expect(c.historyComplete).toBe(false);expect(c.fiatError).toBeNull();
  c.ngOnDestroy();
 });
 it('retains last valid aggregate on unsafe replacement then clears failure on valid recovery',()=>{
  const {c}=setup();const aggregate=new Subject<any>();c.addressSummary$=aggregate;c.stats=undefined;c.ngOnChanges({addressSummary$:{} as any});
  aggregate.next([row(1)]);expect(c.loadedCount).toBe(1);
  aggregate.next([{...row(2),value:0.5}]);expect(c.loadedCount).toBe(1);expect(c.historyError).toContain('unavailable');
  aggregate.next([row(2)]);expect(c.loadedCount).toBe(1);expect(c.historyError).toBeNull();expect(c.checkpoint).toBeNull();expect(c.historyComplete).toBe(false);c.ngOnDestroy();expect(aggregate.observed).toBe(false);
 });
 it('guards duplicate pending pages and cancels pending source reads on network change and destroy',()=>{
  const {c,api,network}=setup();const pending=new Subject();api.getAddressSummary$.mockReturnValue(pending);
  c.ngOnChanges({address:{} as any});c.loadEarlier();expect(api.getAddressSummary$).toHaveBeenCalledOnce();expect(pending.observed).toBe(true);
  network.next('signet');expect(pending.observed).toBe(false);expect(c.error).toContain('Network changed');expect(c.loadedCount).toBe(0);
  c.reloadHistory();expect(pending.observed).toBe(true);c.ngOnDestroy();expect(pending.observed).toBe(false);c.reloadHistory();expect(api.getAddressSummary$).toHaveBeenCalledTimes(2);
 });
});
