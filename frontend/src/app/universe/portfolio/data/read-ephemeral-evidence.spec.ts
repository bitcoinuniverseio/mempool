import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { readEphemeralEvidence } from './read-ephemeral-evidence';
import { portfolioAssetKey } from '@app/shared/universe-portfolio-v2.types';

const context = { chain: 'bitcoin', network: 'signet', address: 'a' };
const envelope = { ...context, chainTip: null };
const summary = { account: context, envelope, schemaVersion: 'universe-portfolio-v2-summary-v1', aggregateState: 'proven' };
const identity = (id: string) => ({ chain: 'bitcoin', network: 'signet', protocol: 'runes', assetType: 'fungible', assetId: id });
const holding = (id: string) => ({ holding: { identity: identity(id), assetKey: portfolioAssetKey(identity(id) as any), sourceState: 'proven', quantityAtomic: '9007199254740993' }, locations: [] });
const page = (rows: any[], nextCursor: string | null) => ({ account: context, envelope, schemaVersion: 'universe-portfolio-v2-holdings-v1', sourceState: 'proven', holdings: rows, nextCursor });
const activity = { ...context, account: context, schemaVersion: 'universe-portfolio-activity-v2', sourceState: 'proven', checkpoint: null, events: [], nextCursor: null };
function api() { return { getSummary$: vi.fn(() => of(summary)), getHoldings$: vi.fn((_chain, _network, _address, cursor) => of(page([holding(cursor ? 'second' : 'first')], cursor ? null : 'opaque-cursor'))), getActivity$: vi.fn(() => of(activity)) }; }
describe('bounded ephemeral evidence read', () => {
  it('retains a long name holding with its exact serialized identity and atomic quantity', async () => {
    const assetId = 'op_names:name:b64.' + Buffer.from('b'.repeat(251) + '.btc', 'utf8').toString('base64url');
    expect(assetId).toHaveLength(358);
    const row = holding(assetId);
    row.holding.identity = {...row.holding.identity, protocol:'op_names', assetType:'name'};
    row.holding.quantityAtomic = '1';
    row.holding.assetKey = `bitcoin:signet:op_names:name:${assetId}`;
    const service = api(); service.getHoldings$.mockReturnValue(of(page([row], null)));
    const result = await firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
    expect(result.holdings?.holdings).toEqual([row]);
    expect(result.summary.aggregateState).toBe('proven');
    expect(result.warnings).toEqual([]);
  });
  it('traverses opaque continuation and merges both scoped pages without changing exact quantities', async () => {
    const service = api(); const result = await firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
    expect(service.getHoldings$.mock.calls.map(c => c[3])).toEqual([undefined, 'opaque-cursor']);
    expect(result.holdings?.holdings).toHaveLength(2); expect(result.holdings?.holdings[0].holding.quantityAtomic).toBe('9007199254740993'); expect(result.warnings).toEqual([]);
  });
  it('retains an accepted page and independent activity when continuation fails', async () => {
    const service = api(); service.getHoldings$.mockImplementation((_chain, _network, _address, cursor) => cursor ? throwError(() => Error('private upstream payload')) as any : of(page([holding('first')], 'opaque-cursor')));
    const result = await firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
    expect(result.summary.aggregateState).toBe('partial'); expect(result.holdings?.holdings).toHaveLength(1); expect(result.activity).not.toBeNull(); expect(result.warnings.join(' ')).toContain('incomplete'); expect(result.warnings.join(' ')).not.toContain('private upstream');
  });
  it('rejects foreign summary and foreign page identity', async () => {
    const service = api(); service.getSummary$.mockReturnValue(of({ ...summary, account: { ...context, network: 'mainnet' } }) as any);
    await expect(firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'))).rejects.toThrow('summary identity');
    service.getSummary$.mockReturnValue(of(summary)); service.getHoldings$.mockReturnValue(of({ ...page([], null), envelope: { ...envelope, network: 'mainnet' } }) as any);
    const result = await firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
    expect(result.holdings).toBeNull(); expect(result.summary.aggregateState).toBe('partial'); expect(result.warnings.join(' ')).toContain('unavailable');
  });
  it('does not merge a continuation from a changed checkpoint', async () => {
    const service = api(); service.getHoldings$.mockImplementation((_chain, _network, _address, cursor) => of(cursor ? { ...page([holding('second')], null), envelope: { ...envelope, chainTip: { chain: 'bitcoin', network: 'signet', heightAtomic: '1', blockHash: 'aa'.repeat(32), reorgEpoch: '1' } } } : page([holding('first')], 'opaque-cursor')) as any);
    const result = await firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
    expect(result.holdings?.holdings).toHaveLength(1); expect(result.summary.aggregateState).toBe('partial'); expect(result.warnings.join(' ')).toContain('incomplete');
  });
  it('times out a summary that never answers and cancels the pending read', async () => {
    vi.useFakeTimers();
    try {
      const service = api(), pending = new Subject<any>(); service.getSummary$.mockReturnValue(pending as any);
      const read = firstValueFrom(readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a'));
      const rejected = expect(read).rejects.toThrow('Timeout');
      await vi.advanceTimersByTimeAsync(15000); await rejected; expect(pending.observed).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('teardown cancels HTTP continuation and never emits stale evidence', async () => {
    const service = api(), pending = new Subject<any>(), received = vi.fn(); service.getHoldings$.mockReturnValue(pending as any);
    const sub = readEphemeralEvidence(service as any, 'bitcoin', 'signet', 'a').subscribe(received);
    await Promise.resolve(); expect(pending.observed).toBe(true); sub.unsubscribe(); expect(pending.observed).toBe(false); pending.next(page([], null)); await Promise.resolve(); expect(received).not.toHaveBeenCalled();
  });
});
