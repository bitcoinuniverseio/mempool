import { RbfHistoryState } from './rbf-history-state';
import { BehaviorSubject, Subject } from 'rxjs';
import { WebsocketService } from './websocket.service';
import { StateService } from './state.service';
import { ApiService } from './api.service';
import { TransferState } from '@angular/core';
import { CacheService } from './cache.service';
import { WebsocketResponse } from '@interfaces/websocket.interface';
import { FeeEstimateState } from './fee-estimate';
import { LiveFeedFreshness } from './live-feed-freshness';

class MockSocket {
  static sockets: MockSocket[] = [];
  readyState = 0;
  onopen: (event: unknown) => void;
  onmessage: (event: { data: string }) => void;
  onerror: (event: unknown) => void;
  onclose: (event: { wasClean: boolean }) => void;
  sent: string[] = [];
  constructor(readonly url: string) { MockSocket.sockets.push(this); }
  open(): void { this.readyState = 1; this.onopen?.({}); }
  frame(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = 3; this.onclose?.({ wasClean: true }); }
}

function proof(network: string) {
  return { schemaVersion: 'universe-live-observation-v1', chain: 'bitcoin', network, status: 'ready',
    observedAt: new Date().toISOString(), tip: { height: 100, hash: 'a'.repeat(64) }, reason: null };
}
function chainFrame(network: string) {
  return { blocks: [{ height: 100, id: 'a'.repeat(64) }], mempoolInfo: { loaded: true, size: 12 },
    tx: { txid: 'tx' }, 'address-transactions': [{ txid: 'address' }], liveObservation: proof(network),
    backendInfo: { gitCommit: 'first', chainSync: { chain: network === 'mainnet' ? 'main' : network } } };
}

describe('base WebsocketService scoped ingress with real RxJS WebSocketSubject', () => {
  let fee: FeeEstimateState;
  let live: LiveFeedFreshness;
  let service: WebsocketService;
  let fields: Record<string, unknown>;
  let channels: Map<string, BehaviorSubject<unknown>>;
  let state: StateService;
  let callbacks: (() => void)[];
  let init: Subject<WebsocketResponse>;
  let rbf: Subject<never[]>;
  function build(network = 'signet', browser = true, bootstrap?: unknown): void {
    channels = new Map(); callbacks = []; init = new Subject(); rbf = new Subject();
    fee = new FeeEstimateState(network); live = new LiveFeedFreshness();
    const rbfHistoryState = new RbfHistoryState();
    fields = { rbfHistoryState, network, isBrowser: browser, env: { ROOT_NETWORK: '' }, latestBlockHeight: -1,
      networkChanged$: new Subject<string>(), resetBlocks: vi.fn(), addBlock: vi.fn(),
      updateChainTip: vi.fn(), resetChainTip: vi.fn(),
      retryLiveFeed: () => { fee.retry(); live.retry(); }, acceptFeeEstimate: (value: unknown) => fee.accept(value),
      acceptLiveObservation: (value: string) => live.accept(value), invalidateLiveObservation: () => live.offline() };
    state = new Proxy(fields, { get(target, key: string) {
      if (key in target) return target[key];
      if (key.endsWith('$')) { if (!channels.has(key)) channels.set(key, new BehaviorSubject(undefined)); return channels.get(key); }
      return undefined;
    } }) as unknown as StateService;
    (fields.networkChanged$ as Subject<string>).subscribe(selected => {
      fields.network = selected; fee.reset(selected); live.reset(); (fields.rbfHistoryState as RbfHistoryState).reset();
    });
    vi.stubGlobal('WebSocket', MockSocket);
    vi.stubGlobal('document', { location: { protocol: 'https:', hostname: 'owned.test', port: '' } });
    vi.stubGlobal('window', { location: { reload: vi.fn() }, setTimeout: (callback: () => void, delay: number) => {
      callbacks.push(callback); return setTimeout(callback, delay);
    } });
    service = new WebsocketService(state, { getInitData$: () => init, getRbfList$: () => rbf } as unknown as ApiService,
      { get: () => bootstrap } as unknown as TransferState, {} as CacheService);
  }
  function switchTo(network: string): void { (fields.networkChanged$ as Subject<string>).next(network); }
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z')); MockSocket.sockets = []; });
  afterEach(() => { fee.destroy(); live.destroy(); vi.clearAllTimers(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('quarantines same-frame fresh RBF data and only recovers from an explicit owner marker plus new data', () => {
    build(); const socket = MockSocket.sockets[0]; socket.open();
    const marker = { schemaVersion: 'universe-rbf-history-availability-v1', status: 'unavailable', reason: 'snapshot-oversize' };
    socket.frame({ ...chainFrame('signet'), rbfHistoryAvailability: marker, rbfLatest: [], rbfLatestSummary: [], rbfInfo: { tx: { txid: 'old' } }, txReplaced: { txid: 'old' } });
    expect(channels.get('rbfLatest$')).toBeUndefined(); expect(channels.get('txRbfInfo$')).toBeUndefined();
    const history = fields.rbfHistoryState as RbfHistoryState;
    expect(history.summary$.value.status).toBe('unavailable');
    socket.frame({ rbfLatestSummary: [] }); expect(history.summary$.value.status).toBe('unavailable');
    socket.frame({ rbfHistoryAvailability: { ...marker, status: 'available', reason: null } });
    expect(history.summary$.value.status).toBe('unavailable');
    socket.frame({ rbfLatestSummary: [] }); expect(history.summary$.value).toEqual({ status: 'ready', value: [] });
  });

  it('preserves a live scoped replacement fact but never cached txReplaced or history during quarantine', () => {
    build(); const socket = MockSocket.sockets[0]; socket.open();
    const marker = { schemaVersion: 'universe-rbf-history-availability-v1', status: 'unavailable', reason: 'snapshot-oversize' };
    socket.frame({ rbfHistoryAvailability: marker, txReplaced: { txid: 'a'.repeat(64) }, rbfTransaction: { txid: 'b'.repeat(64) } });
    expect(channels.get('txReplaced$')).toBeUndefined();
    socket.frame({ ...chainFrame('signet'), rbfHistoryAvailability: marker, rbfTransaction: { txid: 'b'.repeat(64) }, txReplaced: { txid: 'a'.repeat(64) }, rbfLatestSummary: [] });
    expect(channels.get('txReplaced$')?.value).toEqual({ txid: 'b'.repeat(64) });
    expect((fields.rbfHistoryState as RbfHistoryState).summary$.value.status).toBe('unavailable');
  });

  it('does not borrow wrong-network quarantine or late old-socket RBF data', () => {
    build(); const old = MockSocket.sockets[0]; old.open(); const history = fields.rbfHistoryState as RbfHistoryState;
    old.frame({ rbfLatestSummary: [] }); expect(history.summary$.value.status).toBe('ready');
    old.frame({ ...chainFrame('mainnet'), rbfHistoryAvailability: { schemaVersion: 'universe-rbf-history-availability-v1', status: 'unavailable', reason: 'snapshot-invalid' } }); expect(history.summary$.value.status).toBe('ready');
    switchTo(''); const fresh = MockSocket.sockets[1]; fresh.open(); expect(history.summary$.value.status).toBe('loading');
    old.frame({ rbfLatestSummary: [] }); expect(history.summary$.value.status).toBe('loading'); fresh.frame({ ...chainFrame('mainnet'), rbfLatestSummary: [] }); expect(history.summary$.value.status).toBe('ready');
  });

  it('coalesces concurrent SSR summary attempts and contains failed REST history without unhandled rejection', async () => {
    build('signet', false); const first = service.initRbfSummary(), second = service.initRbfSummary();
    expect(rbf.observers).toHaveLength(1); rbf.error({ status: 503, error: { error: 'rbf_history_unavailable' } }); await Promise.all([first, second]);
    expect((fields.rbfHistoryState as RbfHistoryState).summary$.value.status).toBe('unavailable'); expect(channels.get('rbfLatestSummary$')).toBeUndefined();
  });

  it.each(['live', 'fee', 'sync', 'top'])('rejects explicit wrong scope %s before blocks, mempool or address mutation on the correctly scoped socket', kind => {
    build(); const socket = MockSocket.sockets[0]; socket.open();
    const frame = chainFrame('signet') as Record<string, unknown>;
    if (kind === 'live') frame.liveObservation = proof('mainnet');
    if (kind === 'fee') frame.feeEstimate = { ...proof('mainnet'), schemaVersion: 'universe-fee-estimate-v1' };
    if (kind === 'sync') frame.backendInfo = { gitCommit: 'wrong', chainSync: { chain: 'main' } };
    if (kind === 'top') frame.network = 'mainnet';
    socket.frame(frame);
    expect(fields.resetBlocks).not.toHaveBeenCalled(); expect(fields.updateChainTip).not.toHaveBeenCalled();
    expect(channels.get('mempoolInfo$')).toBeUndefined(); expect(channels.get('mempoolTransactions$')).toBeUndefined();
    expect(channels.get('backendInfo$')).toBeUndefined();
    socket.frame(chainFrame('signet')); expect(fields.resetBlocks).toHaveBeenCalledTimes(1);
  });
  it('validates bootstrap before assigning backend or chain state and asks scoped socket for fresh init after refusal', () => {
    build('signet', true, { response: { backend: 'wrong', body: chainFrame('mainnet') } });
    expect(fields.resetBlocks).not.toHaveBeenCalled(); expect(channels.get('backend$')).toBeUndefined();
    const socket = MockSocket.sockets[0]; socket.open();
    expect(socket.sent.map(value => JSON.parse(value))).toContainEqual({ action: 'init' });
  });
  it('accepts the Core test alias only for Bitcoin testnet and rejects contradictory testnet4 metadata', () => {
    build('testnet'); const socket = MockSocket.sockets[0]; socket.open();
    socket.frame({ ...chainFrame('testnet'), backendInfo: { gitCommit: 'first', chainSync: { chain: 'test' } } });
    expect(fields.resetBlocks).toHaveBeenCalledTimes(1);
    socket.frame({ ...chainFrame('testnet'), backendInfo: { gitCommit: 'first', chainSync: { chain: 'testnet4' } } });
    expect(fields.resetBlocks).toHaveBeenCalledTimes(1);
  });
  it('uses real RxJS unsubscription to suppress old socket next/error/complete after rapid A to B to A', () => {
    build(''); const old = MockSocket.sockets[0]; old.open(); old.frame(chainFrame('mainnet'));
    switchTo('signet'); switchTo(''); const current = MockSocket.sockets[2]; current.open();
    const calls = (fields.resetBlocks as ReturnType<typeof vi.fn>).mock.calls.length;
    old.frame(chainFrame('mainnet')); old.onerror?.({}); old.onclose?.({ wasClean: true });
    expect(fields.resetBlocks).toHaveBeenCalledTimes(calls); expect(MockSocket.sockets).toHaveLength(3);
    expect(current.readyState).toBe(1);
    current.frame(chainFrame('mainnet')); expect(fields.resetBlocks).toHaveBeenCalledTimes(calls + 1);
  });
  it('does not let already queued old ping/retry closures close or invalidate the replacement context', () => {
    build(); const old = MockSocket.sockets[0]; old.open(); old.frame(chainFrame('signet'));
    const oldPing = callbacks.at(-1); oldPing(); const oldExpiry = callbacks.at(-1);
    service.goOffline(); const oldRetry = callbacks.at(-1);
    switchTo(''); switchTo('signet'); const current = MockSocket.sockets[2]; current.open(); current.frame(chainFrame('signet'));
    const before = channels.get('connectionState$').value;
    oldPing(); oldExpiry(); oldRetry();
    expect(MockSocket.sockets).toHaveLength(3); expect(current.readyState).toBe(1);
    expect(channels.get('connectionState$').value).toBe(before);
  });
  it('keeps auxiliary messages usable without treating them or invalid versioned metadata as fresh chain proof', () => {
    build(); const socket = MockSocket.sockets[0]; socket.open();
    socket.frame({ 'address-transactions': [{ txid: 'scoped-auxiliary' }] });
    expect(channels.get('mempoolTransactions$').value).toEqual({ txid: 'scoped-auxiliary' });
    expect(fields.resetBlocks).not.toHaveBeenCalled();
    const accepted = vi.spyOn(state, 'acceptLiveObservation');
    socket.frame({ ...chainFrame('signet'), liveObservation: { ...proof('signet'), tip: null } });
    expect(accepted).not.toHaveBeenCalled();
    socket.frame(chainFrame('signet')); expect(accepted).toHaveBeenCalledTimes(1);
  });
  it('bounds missing observation and never lets a metadata-free payload inherit prior currentness', () => {
    build(); const socket = MockSocket.sockets[0]; socket.open();
    socket.frame({ 'address-transactions': [{ txid: 'auxiliary' }] });
    vi.advanceTimersByTime(5001);
    expect(live.state$.value.status).toBe('error');
    socket.frame(chainFrame('signet'));
    expect(live.state$.value.status).toBe('data');
    socket.frame({ blocks: [{ height: 101, id: 'b'.repeat(64) }] });
    expect(live.state$.value.status).toBe('stale');
    vi.advanceTimersByTime(1);
    socket.frame(chainFrame('signet'));
    expect(live.state$.value.status).toBe('data');
  });
  it('rejects late SSR init and RBF HTTP completions after A to B to A', async () => {
    build('', false); const pending = service.initRbfSummary(); switchTo('signet'); switchTo('');
    init.next(chainFrame('mainnet') as unknown as WebsocketResponse); rbf.next([]); await pending;
    expect(fields.resetBlocks).not.toHaveBeenCalled(); expect(channels.get('rbfLatestSummary$')).toBeUndefined();
  });
});
