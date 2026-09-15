import { expect, it, vi } from 'vitest';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { readUtxoPages } from './read-utxo-pages';
const target = { key: 'a', accounts: ['Account'], chain: 'bitcoin', network: 'signet', address: 'address' };
const row = (vout: number) => ({ chain: 'bitcoin', network: 'signet', txid: 'a'.repeat(64), vout, valueAtomic: '1000', confirmationsAtomic: '1', scriptType: 'p2wpkh', assets: [], warnings: [], assetState: 'proven', coinbase: false, pending: false, spent: false });
const page = (utxos: any[], nextCursor: string | null = null) => ({ ...target, account: target, utxos, nextCursor, sourceState: 'proven', warnings: [] });
it('follows pagination beyond the old 50 cap and deduplicates repeated outpoints', async () => {
  const api = { getUtxos$: vi.fn().mockReturnValueOnce(of(page(Array.from({length: 60}, (_, i) => row(i)), 'next'))).mockReturnValueOnce(of(page([row(59), row(60)]))) };
  const result = await firstValueFrom(readUtxoPages(api as any, target));
  expect(result.utxos).toHaveLength(61);
  expect(api.getUtxos$.mock.calls[1][3]).toBe('next');
  expect(result.status).toBe('All returned pages read');
});
it('preserves prior pages but names failed continuation as partial', async () => {
  const api = { getUtxos$: vi.fn().mockReturnValueOnce(of(page([row(0)], 'next'))).mockReturnValueOnce(throwError(() => Error('private upstream detail')))};
  const result = await firstValueFrom(readUtxoPages(api as any, target));
  expect(result.utxos).toHaveLength(1); expect(result.status).toContain('incomplete');
  expect(JSON.stringify(result)).not.toContain('private upstream');
});
it('rejects mismatched network and terminates repeating cursor', async () => {
  const wrong = await firstValueFrom(readUtxoPages({getUtxos$: () => of({...page([row(0)]), network:'mainnet'})} as any,target));
  expect(wrong.utxos).toHaveLength(0); expect(wrong.status).toContain('incomplete');
  const api = {getUtxos$: vi.fn(() => of(page([row(0)],'same')))};
  const repeated = await firstValueFrom(readUtxoPages(api as any,target));
  expect(api.getUtxos$).toHaveBeenCalledTimes(2); expect(repeated.status).toContain('incomplete');
});
it('unsubscribe cancels the active page read', () => {
  const pending = new Subject<any>(); const api = {getUtxos$: () => pending};
  const sub = readUtxoPages(api as any,target).subscribe(); expect(pending.observed).toBe(true);
  sub.unsubscribe(); expect(pending.observed).toBe(false);
});
