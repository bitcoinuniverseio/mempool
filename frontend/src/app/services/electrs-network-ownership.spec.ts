import { describe, it, expect, vi } from 'vitest';
import { Subject, of, firstValueFrom } from 'rxjs';
vi.mock('@app/bitcoin.utils', () => ({ calcScriptHash$: vi.fn(async () => 'hash') }));
import { ElectrsApiService } from './electrs-api.service';

describe('Electrs request identity', () => {
  it('preserves height zero', () => {
    const http = { get: vi.fn(() => of([])) };
    const service = new ElectrsApiService(http as any, { isBrowser: true, env: {}, networkChanged$: new Subject() } as any);
    service.listBlocks$(0).subscribe();
    expect(http.get).toHaveBeenCalledWith('/api/blocks/0');
  });
  it('uses the owned compact-summary path cursor across selected networks without a full-history after_txid query', () => {
    const networkChanged$ = new Subject<string>();
    const http = { get: vi.fn(() => of([])) };
    const service = new ElectrsApiService(http as any, { isBrowser: true, env: { ROOT_NETWORK: 'mainnet' }, networkChanged$ } as any);
    const cursor = 'b'.repeat(64);
    networkChanged$.next('signet');
    service.getAddressSummary$('tb1qowned').subscribe();
    service.getAddressSummary$('tb1qowned', cursor).subscribe();
    expect(http.get.mock.calls[0]).toEqual(['/signet/api/address/tb1qowned/txs/summary']);
    expect(http.get.mock.calls[1]).toEqual(['/signet/api/address/tb1qowned/txs/summary/' + cursor]);
    networkChanged$.next('mainnet');
    service.getAddressSummary$('bc1qowned', cursor).subscribe();
    expect(http.get.mock.calls[2]).toEqual(['/api/address/bc1qowned/txs/summary/' + cursor]);
  });
  it('keeps compact script-summary continuation on its network while async hashing completes', async () => {
    const networkChanged$ = new Subject<string>();
    const http = { get: vi.fn(() => of([])) };
    const service = new ElectrsApiService(http as any, { isBrowser: true, env: { ROOT_NETWORK: 'mainnet' }, networkChanged$ } as any);
    networkChanged$.next('signet');
    const response = firstValueFrom(service.getScriptHashSummary$('51', 'c'.repeat(64)));
    networkChanged$.next('testnet');
    await response;
    expect(http.get).toHaveBeenCalledWith('/signet/api/scripthash/hash/txs/summary/' + 'c'.repeat(64));
  });
  it('keeps all asynchronous script reads on the network captured before hashing', async () => {
    const networkChanged$ = new Subject<string>();
    const http = { get: vi.fn(() => of([])), post: vi.fn(() => of([])) };
    const service = new ElectrsApiService(http as any, { isBrowser: true, env: {}, networkChanged$ } as any);
    networkChanged$.next('signet');
    const reads = [service.getScriptHash$('51'), service.getScriptHashTransactions$('51'), service.getScriptHashesTransactions$(['51']), service.getScriptHashSummary$('51'), service.getScriptHashUtxos$('51'), service.getScriptHashesSummary$(['51'])].map(x => firstValueFrom(x));
    networkChanged$.next('testnet');
    await Promise.all(reads);
    for (const call of [...http.get.mock.calls, ...http.post.mock.calls]) expect(call[0]).toMatch(/^\/signet\/api\//);
  });
});
