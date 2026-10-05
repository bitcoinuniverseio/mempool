import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { UtxoEvidenceService } from './utxo-evidence.service';

const overview = () => ({ network: 'signet', block_height: 102, block_hash: 'ab'.repeat(32), total_utxos: 1, total_amount_sats: 1, muhash: 'cd'.repeat(32), bogo_size: '90', observed_at_utc: '2026-10-05T00:00:00.000Z', block_time: 1791158400, dormant_10yr_sats: null, uneconomical_at_10_sat_vb_sats: null, last_reconciled_utc: null, reconciled: false, projection_configured: false, source: { method: 'owned Core gettxoutsetinfo muhash via coinstatsindex', observed_at_utc: '2026-10-05T00:00:00.000Z', freshness_limit_ms: 30000 }, scope: 'Owned checkpoint; no circulating supply claim.' });
function harness(browser=false) {
  const changes=new Subject<string>(), requests:Subject<unknown>[]=[];
  const state:any={isBrowser:browser,network:'',env:{ROOT_NETWORK:'signet',NGINX_PROTOCOL:'http',NGINX_HOSTNAME:'localhost',NGINX_PORT:8999},networkChanged$:changes};
  const http={get:vi.fn(()=>{const request=new Subject<unknown>();requests.push(request);return request;})};
  const service=new UtxoEvidenceService(http as any,state), emissions:any[]=[];
  const sub=service.watch$('/api/v1/intelligence/utxo/overview').subscribe(x=>emissions.push(x));
  return {state,changes,requests,http,emissions,sub};
}
afterEach(()=>vi.useRealTimers());
describe('UTXO response and lifecycle boundary',()=>{
  it.each([{...overview(),network:'mainnet'},{...overview(),total_utxos:-1},{...overview(),muhash:'invalid'},{stage:'unavailable',error:'Not an observation.'}])('never publishes malformed or foreign evidence',value=>{const h=harness();h.requests[0].next(value);expect(h.emissions.at(-1).kind).toBe('unavailable');expect(h.emissions.at(-1).value).toBeNull();h.sub.unsubscribe();});
  it('ends pending loading at the bounded first-response deadline and cancels HTTP',()=>{vi.useFakeTimers();const h=harness();vi.advanceTimersByTime(15000);expect(h.emissions.at(-1).kind).toBe('unavailable');expect(h.requests[0].observed).toBe(false);h.requests[0].next(overview());expect(h.emissions.at(-1).kind).toBe('unavailable');h.sub.unsubscribe();});
  it('captures root Signet and cancels prior-context work, then recovers with actual-shaped evidence',()=>{const h=harness();h.requests[0].next(overview());expect(h.emissions.at(-1).value.network).toBe('signet');h.state.network='testnet4';h.changes.next('testnet4');expect(h.emissions.at(-1).kind).toBe('loading');expect(h.requests[0].observed).toBe(false);h.requests[0].next(overview());expect(h.emissions.at(-1).value).toBeNull();h.requests[1].next({...overview(),network:'testnet4'});expect(h.emissions.at(-1).kind).toBe('available');h.sub.unsubscribe();expect(h.requests[1].observed).toBe(false);});
  it('retains ordinary30second polling and retries after a malformed page',()=>{vi.useFakeTimers();const h=harness(true);h.requests[0].next({});expect(h.emissions.at(-1).kind).toBe('unavailable');vi.advanceTimersByTime(30000);expect(h.requests).toHaveLength(2);h.requests[1].next(overview());expect(h.emissions.at(-1).kind).toBe('available');h.sub.unsubscribe();vi.advanceTimersByTime(60000);expect(h.requests).toHaveLength(2);});
});
