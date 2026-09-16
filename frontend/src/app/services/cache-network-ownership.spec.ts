import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { CacheService } from './cache.service';

describe('block cache network ownership', () => {
  const create = () => new CacheService({ blocks$: new Subject(), chainTip$: new Subject(), networkChanged$: new Subject() } as any, { blockAuditLoaded: {}, blockSummaryLoaded: {} } as any);
  it('bounds priorities and evicts future heights when the tip is stale', () => {
    const cache = create();
    for (let height = 1; height <= 551; height++) cache.addBlockToCache({ id: String(height), height } as any);
    const bump = cache.bumpBlockPriority.bind(cache); let calls = 0;
    cache.bumpBlockPriority = height => { if (++calls > 1000) throw new Error('nonterminating eviction'); bump(height); };
    expect(() => cache.clearBlocks()).not.toThrow();
    expect(Object.keys(cache.blockCache).length).toBeLessThanOrEqual(550);
    for (let n = 0; n < 500; n++) cache.bumpBlockPriority(551);
    expect(cache.blockPriorities.length).toBeLessThanOrEqual(550);
  });
  it('removes the displaced hash when a height is replaced', () => {
    const cache = create();
    cache.addBlockToCache({ id: 'before', height: 10 } as any);
    cache.addBlockToCache({ id: 'after', height: 10 } as any);
    expect(cache.blockHashCache.before).toBeUndefined();
    expect(cache.getCachedBlock(10).id).toBe('after');
  });
  it('preserves the latest fifty blocks while evicting older entries', () => {
    const cache = create(); cache.tip = 600;
    for (let height = 600; height >= 0; height--) cache.addBlockToCache({ id: String(height), height } as any);
    cache.clearBlocks();
    expect(Object.keys(cache.blockCache)).toHaveLength(550);
    for (let height = 551; height <= 600; height++) expect(cache.getCachedBlock(height)).toBeDefined();
  });
  it('ignores an old network response without clearing the replacement request', async () => {
    const networkChanged$ = new Subject<string>();
    const old = new Subject<any[]>(); const fresh = new Subject<any[]>();
    const api = { getBlocks$: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh), blockAuditLoaded: {}, blockSummaryLoaded: {} };
    const cache = new CacheService({ blocks$: new Subject(), chainTip$: new Subject(), networkChanged$ } as any, api as any);
    networkChanged$.next('');
    const first = cache.loadBlock(10);
    networkChanged$.next('signet');
    const second = cache.loadBlock(10);
    old.next([{ id: 'old', height: 10 }]); await first;
    expect(cache.getCachedBlock(10)).toBeUndefined();
    expect(cache.blockLoading[10]).toBe(true);
    fresh.next([{ id: 'fresh', height: 10 }]); await second;
    expect(cache.getCachedBlock(10).id).toBe('fresh');
    expect(cache.blockLoading[10]).toBeUndefined();
  });
});
