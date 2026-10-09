import { createHash } from 'crypto';
import { UtxoReconstructionV4Service } from '../api/bitcoin/utxo-reconstruction-v4.service';
import { ReconstructionV4Source } from '../api/bitcoin/utxo-reconstruction-v4.source';
import {
  GlobalReconstructionSnapshot,
  ReconstructionAcquisitionError,
} from '../api/bitcoin/utxo-reconstruction.source';
import { ReconstructionV4Binding } from '../api/bitcoin/utxo-reconstruction-v4.types';
const hash = (character: string): string => character.repeat(64),
  zero = {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  };
function setup(): {
  service: UtxoReconstructionV4Service;
  source: ReconstructionV4Source;
  binding: ReconstructionV4Binding;
  now: number;
} {
  const f = {
    service: null as unknown as UtxoReconstructionV4Service,
    source: null as unknown as ReconstructionV4Source,
    binding: {
      network: 'signet',
      releaseSha: 'a'.repeat(40),
      configurationSha256: hash('b'),
    },
    now: Date.parse('2026-10-09T12:00:00Z'),
  };
  const snapshot: GlobalReconstructionSnapshot = {
    sourceId: hash('c'),
    scriptPubKey: '0014' + 'd'.repeat(40),
    mempoolIdentity: createHash('sha256')
      .update(JSON.stringify({ ids: [], sequence: 1 }))
      .digest('hex'),
    checkpoint: {
      network: 'signet',
      genesisHash: hash('f'),
      blockHeight: 20,
      blockHash: hash('a'),
      signetChallenge: '51',
      verifiedAt: new Date(f.now).toISOString(),
    },
    summary: {
      address: 'address',
      chain_stats: { ...zero },
      mempool_stats: { ...zero },
    },
    globalMempool: { transactionCount: 0, sequenceAtomic: '1', txids: [] },
    canonicalAnchor: { heightAtomic: '20', blockHash: hash('a') },
  };
  f.source = {
    snapshot: jest.fn(async () => structuredClone(snapshot)),
    confirmedSnapshot: jest.fn(async () => ({
      ...structuredClone(snapshot),
      mempoolIdentity: null,
    })),
    history: jest.fn(async () => []),
    mempool: jest.fn(async () => []),
    verifyHistoryBlocks: jest.fn(async () => undefined),
    verifyOutputs: jest.fn(async () => undefined),
    globalTransactions: jest.fn(async () => []),
  };
  f.service = new UtxoReconstructionV4Service(
    f.source,
    'signet',
    () => f.now,
    () => f.binding
  );
  return f;
}
const signal = (): AbortSignal => new AbortController().signal;
const clear = (source: ReconstructionV4Source): void => {
  for (const method of Object.values(source)) {
    (method as jest.Mock).mockClear();
  }
};
const noReads = (source: ReconstructionV4Source): void => {
  for (const method of Object.values(source)) {
    expect(method).not.toHaveBeenCalled();
  }
};
it('zero-source inspection preserves exact original observation, checkpoint, cursor and fixed60min expiry across observer windows', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  clear(f.source);
  f.now += 11 * 60000;
  const state = f.service.inspect('address', created.sessionId, f.binding);
  expect(state).toMatchObject({
    cursor: 0,
    busy: false,
    expiresAt: created.expiresAt,
    binding: f.binding,
    lastSuccessfulObservation: {
      observedAt: created.observedAt,
      checkpoint: created.latestObservedTip,
      progress: created.progress,
    },
  });
  expect(state).not.toHaveProperty('result');
  expect(state).not.toHaveProperty('items');
  expect(JSON.stringify(state).length).toBeLessThan(4096);
  noReads(f.source);
  state.lastSuccessfulObservation.progress.confirmedTransactionsProcessed = 99;
  state.lastSuccessfulObservation.checkpoint.blockHash = hash('b');
  expect(
    f.service.inspect('address', created.sessionId, f.binding)
      .lastSuccessfulObservation
  ).toMatchObject({
    checkpoint: created.latestObservedTip,
    progress: created.progress,
  });
});
it('missing/foreign session, address, network, profile and revision never read any source', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  clear(f.source);
  expect(() =>
    f.service.inspect('other', created.sessionId, f.binding)
  ).toThrow('not found');
  expect(() => f.service.inspect('address', 'missing', f.binding)).toThrow(
    'not found'
  );
  for (const expected of [
    { ...f.binding, network: 'mainnet' },
    { ...f.binding, configurationSha256: hash('d') },
    { ...f.binding, releaseSha: 'd'.repeat(40) },
  ])
    {expect(() =>
      f.service.inspect('address', created.sessionId, expected)
    ).toThrow('profile changed');}
  f.binding.configurationSha256 = hash('d');
  expect(() =>
    f.service.inspect('address', created.sessionId, f.binding)
  ).toThrow('profile changed');
  noReads(f.source);
});
it('inspection exposes busy without duplicate admission, then stores the original successful cursor for lost-response replay', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  (f.source.history as jest.Mock).mockImplementationOnce(
    (): Promise<never[]> =>
      new Promise((resolve) => {
        release = (): void => resolve([]);
        entered();
      })
  );
  const next = f.service.next('address', created.sessionId, 0, signal());
  await waiting;
  const before = f.service.inspect('address', created.sessionId, f.binding);
  expect(before.busy).toBe(true);
  expect(before.cursor).toBe(0);
  expect(before.lastSuccessfulObservation.observedAt).toBe(created.observedAt);
  await expect(
    f.service.next('address', created.sessionId, 0, signal())
  ).rejects.toMatchObject({ status: 409 });
  release();
  const committed = await next;
  const state = f.service.inspect('address', created.sessionId, f.binding);
  expect(state).toMatchObject({
    busy: false,
    cursor: 1,
    replayCursor: 0,
    lastSuccessfulObservation: { cursor: 1, observedAt: committed.observedAt },
  });
  const replay = await f.service.next(
    'address',
    created.sessionId,
    0,
    signal()
  );
  expect(replay.cursor).toBe(1);
});
it('confirmed history deadline leaves exact cursor and prior proof retryable, without fabricated current observation or raw diagnostics', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  f.now += 1000;
  (f.source.history as jest.Mock).mockRejectedValueOnce(
    new ReconstructionAcquisitionError(
      'confirmed-history',
      undefined,
      'DEADLINE'
    )
  );
  await expect(
    f.service.next('address', created.sessionId, 0, signal())
  ).rejects.toMatchObject({ status: 504 });
  clear(f.source);
  const state = f.service.inspect('address', created.sessionId, f.binding);
  expect(state).toMatchObject({
    status: 'PARTIAL',
    cursor: 0,
    busy: false,
    lastSuccessfulObservation: {
      observedAt: created.observedAt,
      progress: created.progress,
    },
    lastOperationError: {
      cursor: 0,
      status: 504,
      code: 'DEADLINE',
      phase: 'confirmed-history',
    },
  });
  noReads(f.source);
  const resumed = await f.service.next(
    'address',
    created.sessionId,
    state.cursor,
    signal()
  );
  expect(resumed.cursor).toBe(1);
  expect(
    f.service.inspect('address', created.sessionId, f.binding)
      .lastOperationError
  ).toBeNull();
});
it('cancelled and complete state reads contain no output list and expiry is never extended', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  let current = created;
  for (let i = 0; i < 8 && current.status === 'PARTIAL'; i++)
    {current = await f.service.next(
      'address',
      created.sessionId,
      current.cursor,
      signal()
    );}
  expect(current.status).toBe('COMPLETE_AT_OBSERVED_TIP');
  clear(f.source);
  const complete = f.service.inspect('address', created.sessionId, f.binding);
  expect(complete.resultAvailable).toBe(true);
  expect(complete).not.toHaveProperty('result');
  noReads(f.source);
  f.service.cancel('address', created.sessionId);
  const cancelled = f.service.inspect('address', created.sessionId, f.binding);
  expect(cancelled).toMatchObject({
    status: 'CANCELLED',
    retainedBytes: 0,
    resultAvailable: false,
    expiresAt: created.expiresAt,
    lastSuccessfulObservation: { observedAt: current.observedAt },
  });
  f.now = Date.parse(created.expiresAt);
  expect(() =>
    f.service.inspect('address', created.sessionId, f.binding)
  ).toThrow('not found');
  noReads(f.source);
});
it('unqualified runtime binding and arbitrary source diagnostics are not disclosed', async () => {
  const f = setup(),
    created = await f.service.create('address', signal());
  (f.source.history as jest.Mock).mockRejectedValueOnce(
    new ReconstructionAcquisitionError(
      'https://private-origin/credential',
      undefined,
      'private-credential'
    )
  );
  await expect(
    f.service.next('address', created.sessionId, 0, signal())
  ).rejects.toBeDefined();
  const state = f.service.inspect('address', created.sessionId, f.binding);
  expect(state.lastOperationError?.code).toBe('SOURCE_OR_CONTEXT_UNAVAILABLE');
  expect(state.lastOperationError).not.toHaveProperty('phase');
  expect(JSON.stringify(state)).not.toContain('credential');
  f.binding.releaseSha = 'unqualified';
  expect(() =>
    f.service.inspect('address', created.sessionId, f.binding)
  ).toThrow('binding unavailable');
});

it('profile/revision drift blocks next before any source call, not only inspection', async () => {
  const f=setup(),created=await f.service.create('address',signal());clear(f.source);
  f.binding.releaseSha='d'.repeat(40);
  await expect(f.service.next('address',created.sessionId,0,signal())).rejects.toMatchObject({status:409});noReads(f.source);
});

it('legacy unversioned creation/next remains usable, but cannot present qualified inspection', async () => {
  const f=setup(), legacy=new UtxoReconstructionV4Service(f.source,'signet',()=>f.now,()=>undefined);
  const created=await legacy.create('address',signal());
  const next=await legacy.next('address',created.sessionId,created.cursor,signal());expect(next.cursor).toBe(1);
  clear(f.source);expect(()=>legacy.inspect('address',created.sessionId,f.binding)).toThrow('binding unavailable');noReads(f.source);
});
