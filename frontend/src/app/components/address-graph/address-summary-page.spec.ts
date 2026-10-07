import { describe, expect, it, vi, afterEach } from 'vitest';
import { firstValueFrom, of, Subject } from 'rxjs';
import { exactSummaryBalance, mergeSummaryRows, readObservedSummaryPage$, SUMMARY_PAGE_DEADLINE_MS, validatedSummaryRows } from './address-summary-page';
const tip = 'a'.repeat(64), address = 'test-owned-address';
const row = (id: number, value = -97293, height = 10) => ({txid:id.toString(16).padStart(64,'0'), value, height, time:100, tx_position:1});
const stats = {tx_count:2,funded_txo_sum:100000,spent_txo_sum:97293} as any;
function api() { return {getBlockTipHash$:vi.fn().mockReturnValue(of(tip)),getAddress$:vi.fn().mockReturnValue(of({address,chain_stats:stats})),getAddressSummary$:vi.fn().mockReturnValue(of([row(1)]))} as any; }
afterEach(()=>vi.useRealTimers());
describe('request-bound compact summary paging',()=>{
 it('keeps negative atomic values and validates exact chart boundaries',()=>{
  expect(exactSummaryBalance([row(1)], stats)).toBe(2707n);
  expect(()=>exactSummaryBalance([row(1,Number.MAX_SAFE_INTEGER),row(2,Number.MAX_SAFE_INTEGER)])).toThrow('exact chart range');
  expect(()=>validatedSummaryRows([row(1,0.5)])).toThrow();
 });
 it('rejects duplicate, reordered and oversized provider pages',()=>{
  expect(()=>validatedSummaryRows([row(1),row(1)])).toThrow();
  expect(()=>validatedSummaryRows([row(1),row(2,1,11)])).toThrow();
  expect(()=>validatedSummaryRows(Array.from({length:5001},(_,i)=>row(i)))).toThrow();
 });
 it('deduplicates unchanged cursor boundary but rejects changed evidence and no progress',()=>{
  expect(mergeSummaryRows([row(1)],[row(1),row(2,10,9)]).map(r=>r.txid)).toEqual([row(1).txid,row(2).txid]);
  expect(()=>mergeSummaryRows([row(1)],[row(1,2)])).toThrow('changed');
  expect(()=>mergeSummaryRows([row(1)],[row(1)])).toThrow('no progress');
 });
 it('reads actual cursor with source tip before and after metadata and summary',async()=>{
  const mock=api(); const page=await firstValueFrom(readObservedSummaryPage$(mock,address,false,row(2).txid,tip,stats));
  expect(mock.getAddressSummary$).toHaveBeenCalledWith(address,row(2).txid);
  expect(mock.getBlockTipHash$).toHaveBeenCalledTimes(2);
  expect(page.rows[0].value).toBe(-97293);expect(page.anchor).toBe(tip);
 });
 it('rejects changed tip, identity or statistics instead of joining incompatible pages',async()=>{
  for(const kind of ['tip','address','stats']) {
   const mock=api();
   if(kind==='tip') {mock.getBlockTipHash$.mockReturnValueOnce(of(tip)).mockReturnValueOnce(of('b'.repeat(64)));}
   else {mock.getAddress$.mockReturnValue(of({address:kind==='address'?'different':address,chain_stats:{...stats,tx_count:kind==='stats'?3:2}}));}
   await expect(firstValueFrom(readObservedSummaryPage$(mock,address,false,undefined,tip,stats))).rejects.toThrow();
  }
 });
 it('bounds pending reads and cancels both independent HTTP requests',async()=>{
  vi.useFakeTimers();const mock=api(),metadata=new Subject(),summary=new Subject();
  mock.getAddress$.mockReturnValue(metadata);mock.getAddressSummary$.mockReturnValue(summary);
  const pending=firstValueFrom(readObservedSummaryPage$(mock,address,false));const rejection=expect(pending).rejects.toThrow('Timeout');
  expect(metadata.observed&&summary.observed).toBe(true);
  await vi.advanceTimersByTimeAsync(SUMMARY_PAGE_DEADLINE_MS);await rejection;
  expect(metadata.observed||summary.observed).toBe(false);
 });
});
