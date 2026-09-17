import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { PulseState, UniversePulseService, protocolIdsOf } from '@app/universe/universe-pulse.service';
import { sharesOf } from '@app/universe/pulse/pulse.component';
import { stripEntries } from '@app/universe/protocol-strip/protocol-strip.component';
import type { StateService } from '@app/services/state.service';
import type { UniverseApiService } from '@app/universe/universe-api.service';
import type {
  ExplorerTransactionAssetFlow,
  TransactionBatchItem,
  TransactionBatchResponse,
} from '@app/universe/universe.types';

function flow(patch: Partial<ExplorerTransactionAssetFlow> = {}): ExplorerTransactionAssetFlow {
  return {
    schemaVersion: 'universe-transaction-asset-flow-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    txid: 'a'.repeat(64),
    status: 'confirmed',
    inputs: [],
    outputs: [],
    actions: [],
    sourceEvidence: [],
    complete: true,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
    ...patch,
  };
}

describe('protocolIdsOf', () => {
  it('finds nothing in an empty flow', () => {
    expect(protocolIdsOf(flow())).toEqual([]);
  });

  it('collects protocols from both sides and from actions', () => {
    const ids = protocolIdsOf(
      flow({
        inputs: [{ asset: { protocolId: 'ordinals' } }] as never,
        outputs: [{ asset: { protocolId: 'runes' } }] as never,
        actions: [{ protocolId: 'rare_sats' }] as never,
      }),
    );
    expect(ids).toEqual(['ordinals', 'rare_sats', 'runes']);
  });

  it('deduplicates and sorts', () => {
    const ids = protocolIdsOf(
      flow({
        inputs: [{ asset: { protocolId: 'runes' } }] as never,
        outputs: [{ asset: { protocolId: 'runes' } }] as never,
      }),
    );
    expect(ids).toEqual(['runes']);
  });

  it('tolerates missing collections', () => {
    expect(protocolIdsOf({} as ExplorerTransactionAssetFlow)).toEqual([]);
  });
});

describe('sharesOf', () => {
  const names = new Map([['runes', 'RUNES']]);

  it('floors percentages so a rare protocol is never rounded into significance', () => {
    const shares = sharesOf(
      { checked: 1000, protocolCounts: new Map([['runes', 4]]) } as never,
      names,
    );
    expect(shares[0].percent).toBe(0);
    expect(shares[0].count).toBe(4);
  });

  it('reports zero percent when nothing has been checked', () => {
    const shares = sharesOf(
      { checked: 0, protocolCounts: new Map([['runes', 0]]) } as never,
      names,
    );
    expect(shares[0].percent).toBe(0);
  });

  it('sorts by count, then by id for a stable order', () => {
    const shares = sharesOf(
      {
        checked: 10,
        protocolCounts: new Map([
          ['ordinals', 3],
          ['runes', 3],
          ['rare_sats', 5],
        ]),
      } as never,
      new Map(),
    );
    expect(shares.map((share) => share.protocolId)).toEqual(['rare_sats', 'ordinals', 'runes']);
  });

  it('falls back to the protocol id when the registry has no name', () => {
    const shares = sharesOf({ checked: 1, protocolCounts: new Map([['x', 1]]) } as never, new Map());
    expect(shares[0].displayName).toBe('x');
  });
});

describe('stripEntries', () => {
  const supported = [
    { id: 'runes', shortName: 'RUNES' },
    { id: 'ordinals', shortName: 'Ordinals' },
  ] as never;

  it('lists every supported protocol with a measured zero once a sample exists', () => {
    const entries = stripEntries(supported, { observation: 'observed', checked: 3, protocolCounts: new Map() } as never);
    expect(entries.map((entry) => entry.protocolId).sort()).toEqual(['ordinals', 'runes']);
    expect(entries.every((entry) => entry.count === 0)).toBe(true);
  });

  /**
   * The Signet strip said it was reading arrivals against four protocols and
   * showed four zeros while the authority had never answered: a zero nobody
   * measured. Before a sample exists there is no count to show.
   */
  it.each(['unknown', 'unavailable'] as const)('shows no count at all while the observation is %s', (observation) => {
    const entries = stripEntries(supported, { observation, checked: 0, protocolCounts: new Map() } as never);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.count === null)).toBe(true);
  });

  it('keeps the last counts when the sample is stale', () => {
    const entries = stripEntries(supported, {
      observation: 'stale', checked: 9, protocolCounts: new Map([['ordinals', 2]]),
    } as never);
    expect(entries[0]).toMatchObject({ protocolId: 'ordinals', count: 2 });
    expect(entries[1]).toMatchObject({ protocolId: 'runes', count: 0 });
  });

  it('puts the busiest protocol first', () => {
    const entries = stripEntries(supported, {
      observation: 'observed', checked: 7, protocolCounts: new Map([['ordinals', 7]]),
    } as never);
    expect(entries[0].protocolId).toBe('ordinals');
  });
});

/** The service under a controllable arrivals feed and a controllable authority. */
function harness(options: { network?: string } = {}): {
  service: UniversePulseService;
  transactions$: BehaviorSubject<{ txid: string }[] | null>;
  networkChanged$: Subject<string>;
  requests: { batch: string[]; response: Subject<TransactionBatchResponse> }[];
  state: () => PulseState;
  arrive: (...txids: string[]) => void;
  answer: (index: number, results: TransactionBatchItem[]) => Promise<void>;
  fail: (index: number) => Promise<void>;
  tick: () => Promise<void>;
  stateService: { network: string; transactions$: BehaviorSubject<{ txid: string }[] | null> };
} {
  const transactions$ = new BehaviorSubject<{ txid: string }[] | null>(null);
  const networkChanged$ = new Subject<string>();
  const stateService = {
    isBrowser: true,
    network: options.network ?? '',
    networkChanged$,
    transactions$,
    isTabHidden$: of(false),
  };
  const requests: { batch: string[]; response: Subject<TransactionBatchResponse> }[] = [];
  const api = {
    getTransactionFlows$: (batch: string[]) => {
      const response = new Subject<TransactionBatchResponse>();
      requests.push({ batch: batch.slice(), response });
      return response;
    },
  };
  const service = new UniversePulseService(stateService as unknown as StateService, api as unknown as UniverseApiService);
  let current!: PulseState;
  service.state$.subscribe((value) => { current = value; });
  const tick = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(2500); };
  return {
    service, transactions$, networkChanged$, requests, stateService,
    state: () => current,
    arrive: (...txids) => stateService.transactions$.next(txids.map((txid) => ({ txid }))),
    answer: async (index, results) => { requests[index].response.next({ results }); requests[index].response.complete(); await vi.advanceTimersByTimeAsync(0); },
    fail: async (index) => { requests[index].response.error(new Error('controlled authority outage')); await vi.advanceTimersByTimeAsync(0); },
    tick,
  };
}

function txid(seed: number): string {
  return seed.toString(16).padStart(64, '0');
}

function ok(id: string, protocolIds: string[] = []): TransactionBatchItem {
  return {
    txid: id, status: 'ok',
    flow: flow({ txid: id, actions: protocolIds.map((protocolId) => ({ protocolId })) as never }),
  };
}

function refused(id: string, status: TransactionBatchItem['status'] = 'unavailable'): TransactionBatchItem {
  return { txid: id, status, flow: null };
}

describe('UniversePulseService observation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /**
   * The service started with authorityAnswering true, before anything had
   * been asked, and an empty queue never asked; the strip then claimed to be
   * reading arrivals while the public Signet page had no feed at all.
   */
  it('starts unknown with nothing arrived and no stream connected', async () => {
    const h = harness();
    h.service.start();
    await h.tick();
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0, lastSampleAt: null });
    expect(h.requests).toHaveLength(0);
    h.service.stop();
  });

  it('stays unknown while arrivals are queued but nothing has been resolved', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1), txid(2));
    await h.tick();
    expect(h.requests).toHaveLength(1);
    expect(h.state().observation).toBe('unknown');
    // Items the authority does not know about are not evidence either way.
    await h.answer(0, [refused(txid(1), 'not-found'), refused(txid(2), 'invalid')]);
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0 });
    h.service.stop();
  });

  it('is unavailable when the first batch is refused by the authority, whatever the transport said', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1), txid(2));
    await h.tick();
    await h.answer(0, [refused(txid(1)), refused(txid(2), 'unconfigured')]);
    expect(h.state()).toMatchObject({ observation: 'unavailable', checked: 0, lastSampleAt: null });
    h.service.stop();
  });

  it('counts only the valid resolved items of a mixed batch', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1), txid(2), txid(3));
    await h.tick();
    await h.answer(0, [ok(txid(1), ['runes']), refused(txid(2)), ok(txid(3))]);
    expect(h.state()).toMatchObject({ observation: 'observed', checked: 2, withAssets: 1 });
    expect(h.state().protocolCounts.get('runes')).toBe(1);
    expect(h.state().lastSampleAt).not.toBeNull();
    h.service.stop();
  });

  it('records a measured zero as observed', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.answer(0, [ok(txid(1))]);
    expect(h.state()).toMatchObject({ observation: 'observed', checked: 1, withAssets: 0 });
    expect(h.state().protocolCounts.size).toBe(0);
    h.service.stop();
  });

  it('tallies activity per protocol within the checked denominator', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1), txid(2));
    await h.tick();
    await h.answer(0, [ok(txid(1), ['runes', 'ordinals']), ok(txid(2), ['runes'])]);
    expect(h.state().checked).toBe(2);
    expect(h.state().protocolCounts.get('runes')).toBe(2);
    expect(h.state().protocolCounts.get('ordinals')).toBe(1);
    expect(h.state().recent.map((event) => event.txid)).toEqual([txid(2), txid(1)]);
    h.service.stop();
  });

  it('marks the sample stale, keeping its counts and time, when the authority fails after a sample', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.answer(0, [ok(txid(1), ['runes'])]);
    const sampledAt = h.state().lastSampleAt;
    h.arrive(txid(2));
    await h.tick();
    await h.answer(1, [refused(txid(2))]);
    expect(h.state()).toMatchObject({ observation: 'stale', checked: 1, lastSampleAt: sampledAt });
    expect(h.state().protocolCounts.get('runes')).toBe(1);
    h.service.stop();
  });

  it('needs several transport failures in a row before it stops claiming the authority answers', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.answer(0, [ok(txid(1))]);
    for (let round = 1; round <= 3; round += 1) {
      h.arrive(txid(10 + round));
      await h.tick();
      await h.fail(round);
      expect(h.state().observation).toBe(round < 3 ? 'observed' : 'stale');
    }
    h.service.stop();
  });

  it('recovers to observed on the next resolved item', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.answer(0, [refused(txid(1))]);
    expect(h.state().observation).toBe('unavailable');
    h.arrive(txid(2));
    await h.tick();
    await h.answer(1, [ok(txid(2), ['runes'])]);
    expect(h.state()).toMatchObject({ observation: 'observed', checked: 1 });
    h.service.stop();
  });

  it('never asks about the same arrival twice within a sample', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.fail(0);
    h.arrive(txid(1), txid(2));
    await h.tick();
    expect(h.requests[1].batch).toEqual([txid(2)]);
    h.service.stop();
  });

  it('stops sampling at the session ceiling and says so', async () => {
    const h = harness();
    h.service.start();
    // 4000 resolved: 160 batches of 25.
    for (let batch = 0; batch < 160; batch += 1) {
      const ids = Array.from({ length: 25 }, (_, i) => txid(batch * 25 + i + 1));
      h.arrive(...ids);
      await h.tick();
      await h.answer(batch, ids.map((id) => ok(id)));
    }
    expect(h.state().checked).toBe(4000);
    h.arrive(txid(5000));
    await h.tick();
    expect(h.requests).toHaveLength(160);
    expect(h.state().ceilingReached).toBe(true);
    h.service.stop();
  });

  it('discards a resolution in flight when the network switches', async () => {
    const h = harness({ network: '' });
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    await h.answer(0, [ok(txid(1), ['runes'])]);
    h.arrive(txid(2));
    await h.tick();
    expect(h.requests).toHaveLength(2);

    // The state service swaps its arrivals feed before announcing the switch.
    h.stateService.network = 'signet';
    h.stateService.transactions$ = new BehaviorSubject<{ txid: string }[] | null>(null);
    h.networkChanged$.next('signet');
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0 });

    await h.answer(1, [ok(txid(2), ['runes'])]);
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0 });

    // The new feed is the one sampled now, and the old txid is not "seen".
    h.arrive(txid(2));
    await h.tick();
    expect(h.requests).toHaveLength(3);
    expect(h.requests[2].batch).toEqual([txid(2)]);
    await h.answer(2, [ok(txid(2), ['ordinals'])]);
    expect(h.state()).toMatchObject({ observation: 'observed', checked: 1 });
    expect(h.state().protocolCounts.get('runes')).toBeUndefined();
    h.service.stop();
  });

  it('ignores a completion that arrives after stop, even once a new sample has started', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1));
    await h.tick();
    h.service.stop();
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0 });

    h.service.start();
    await h.answer(0, [ok(txid(1), ['runes'])]);
    expect(h.state()).toMatchObject({ observation: 'unknown', checked: 0 });

    // The new sample is not blocked by the old request's bookkeeping.
    h.arrive(txid(1));
    await h.tick();
    expect(h.requests).toHaveLength(2);
    h.service.stop();
  });

  it('publishes one denominator that the strip shares', async () => {
    const h = harness();
    h.service.start();
    h.arrive(txid(1), txid(2), txid(3));
    await h.tick();
    await h.answer(0, [ok(txid(1), ['runes']), ok(txid(2)), refused(txid(3))]);
    const entries = stripEntries([{ id: 'runes', shortName: 'RUNES' }, { id: 'ordinals', shortName: 'Ordinals' }] as never, h.state());
    expect(h.state().checked).toBe(2);
    expect(entries.map((entry) => entry.count)).toEqual([1, 0]);
    expect(entries.reduce((sum, entry) => sum + (entry.count ?? 0), 0)).toBeLessThanOrEqual(h.state().checked);
    h.service.stop();
  });
});
