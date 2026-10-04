import { afterEach, describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { TimeMachineComponent } from './time-machine.component';
import { IntelligenceApiService } from './intelligence-api.service';
import { networkScopedUrl } from '@app/services/network-prefix.interceptor';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const block = 'c'.repeat(64), ids = ['1'.repeat(64)], digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(block + ':' + ids.join(','))));
  const state: any = {network: '', env: {ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool'}, isBrowser: true, networkChanged$: new Subject<string>()};
  const summary = {state_hash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), checkpoint_block_hash: block, total_transactions: 1, target_block_height: 10, coverage_status: 'partial'};
  const file = new ArrayBuffer(12), parsed = new Subject<any>();
  const api = {getTimeMachineCoverage$: vi.fn(() => of(null)), exportHistoryParquet$: vi.fn(() => of(file)), exportHistory$: vi.fn()};
  const reader = {read: vi.fn(() => parsed)}, page = new (TimeMachineComponent as any)(api, {markForCheck() {}}, state, reader);
  page.ngOnInit(); page.currentState = summary;
  const link: any = {click: vi.fn()}; vi.stubGlobal('document', {createElement: vi.fn(() => link)});
  const blob = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-parquet'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return {page, state, summary, file, ids, parsed, api, reader, link, blob, revoke};
}
describe('retained Parquet download evidence', () => {
  it('requests the selected native binary format through the existing network interceptor', () => {
    const state: any = {network: 'testnet4', isBrowser: true, env: {ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool'}}, post = vi.fn(() => of(new ArrayBuffer(0)));
    const api = new IntelligenceApiService({post: (url, body, options) => post(networkScopedUrl(url, state), body, options)} as any, state, {} as any);
    api.exportHistoryParquet$('a'.repeat(64)).subscribe();
    expect(post).toHaveBeenCalledWith('/testnet4/api/v1/intelligence/history/exports', {state_hash: 'a'.repeat(64), format: 'parquet'}, {responseType: 'arraybuffer'});
  });
  it('downloads the original Parquet bytes only after full summary and membership verification', async () => {
    const {page, summary, file, ids, parsed, reader, link, blob, revoke} = await setup();
    page.exportData('parquet'); expect(reader.read).toHaveBeenCalledWith(file, 'signet');
    parsed.next({format: 'parquet', state: summary, txids: ids}); await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());
    const actual = blob.mock.calls[0][0] as Blob; expect(actual.type).toBe('application/vnd.apache.parquet'); expect(new Uint8Array(await actual.arrayBuffer())).toEqual(new Uint8Array(file));
    expect(link.download).toBe('mempool-state-' + summary.state_hash + '.parquet'); expect(revoke).toHaveBeenCalledWith('blob:owned-parquet'); page.ngOnDestroy();
  });
  it('rejects a same-hash foreign replay summary and substituted membership', async () => {
    const {page, summary, parsed, link} = await setup();
    page.exportData('parquet'); parsed.next({format: 'parquet', state: {...summary, target_block_height: 11}, txids: ['1'.repeat(64)]}); expect(page.exportError).toMatch(/does not match/);
    page.exportData('parquet'); parsed.next({format: 'parquet', state: summary, txids: ['2'.repeat(64)]}); await vi.waitFor(() => expect(page.exporting).toBe(false)); expect(link.click).not.toHaveBeenCalled(); expect(page.exportError).toMatch(/membership/); page.ngOnDestroy();
  });
  it('cancels pending parsing when source context changes', async () => {
    const {page, state, summary, parsed, link} = await setup();
    page.exportData('parquet'); expect(parsed.observers).toHaveLength(1); state.network = 'testnet4'; state.networkChanged$.next('testnet4');
    expect(parsed.observers).toHaveLength(0); parsed.next({format: 'parquet', state: summary, txids: ['1'.repeat(64)]}); await Promise.resolve(); expect(link.click).not.toHaveBeenCalled(); expect(page.currentState).toBeNull(); page.ngOnDestroy();
  });
});
