import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { UniverseWebsocketService } from './universe-websocket.service';
import { parseUniverseLiveEnvelope } from '@app/universe/universe-websocket.service';

const envelope = {
  schemaVersion: 'universe-websocket-v1',
  chain: 'dogecoin',
  network: 'mainnet',
  channel: 'mempool-snapshot',
  snapshotId: 'snapshot-1',
  sequenceAtomic: '9',
  observedAt: '2026-08-29T00:00:00.000Z',
  completeness: 'complete',
  data: { countAtomic: '1' },
};

describe('parseUniverseLiveEnvelope', () => {
  it('accepts an exact envelope for the requested chain', () => {
    expect(parseUniverseLiveEnvelope(envelope, 'dogecoin')).toEqual(envelope);
  });

  it('accepts only the network the chain is configured to', () => {
    expect(parseUniverseLiveEnvelope({ ...envelope, network: 'testnet' }, 'dogecoin')).toBeNull();
    expect(parseUniverseLiveEnvelope({ ...envelope, network: 'testnet' }, 'dogecoin', 'testnet')).toEqual({ ...envelope, network: 'testnet' });
    expect(parseUniverseLiveEnvelope(envelope, 'dogecoin', 'testnet')).toBeNull();
  });

  it('rejects cross-chain, unsafe sequence, and unknown-channel messages', () => {
    expect(parseUniverseLiveEnvelope(envelope, 'zcash')).toBeNull();
    expect(
      parseUniverseLiveEnvelope(
        { ...envelope, sequenceAtomic: '1e9' },
        'dogecoin'
      )
    ).toBeNull();
    expect(
      parseUniverseLiveEnvelope({ ...envelope, channel: 'admin' }, 'dogecoin')
    ).toBeNull();
  });
});

class SocketFixture {
  static sockets: SocketFixture[] = [];
  sent: Record<string, unknown>[] = [];
  closed = false;
  listeners = new Map<string, ((event: any) => void)[]>();
  constructor(readonly url: string) { SocketFixture.sockets.push(this); }
  addEventListener(name: string, listener: (event: any) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) || []), listener]);
  }
  send(body: string): void { this.sent.push(JSON.parse(body)); }
  close(code: number): void { this.closed = true; this.fire('close', { code }); }
  fire(name: string, event: any = {}): void { this.listeners.get(name)?.forEach(fn => fn(event)); }
  frame(network: string, sequence = '1', snapshotId = 'snapshot-1', channel = 'mempool-snapshot', data: unknown = { countAtomic: '1' }): void {
    this.fire('message', { data: JSON.stringify({ ...envelope, chain: 'bitcoin', network, sequenceAtomic: sequence, snapshotId,
      channel, data, observedAt: new Date().toISOString() }) });
  }
}

describe('shared Universe scoped socket lifecycle', () => {
  let changes: Subject<string>;
  let service: UniverseWebsocketService;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    SocketFixture.sockets = []; changes = new Subject();
    vi.stubGlobal('WebSocket', SocketFixture); vi.stubGlobal('location', { protocol: 'https:', host: 'explorer.test' });
    service = new UniverseWebsocketService({ isBrowser: true, network: '', networkChanged$: changes, env: {} } as never);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('shares one socket per chain and replaces scope without old replay or late cross-network frames', () => {
    const received: string[] = [];
    const one = service.stream$('bitcoin').subscribe(frame => received.push(frame.network));
    const two = service.stream$('bitcoin').subscribe(); expect(SocketFixture.sockets).toHaveLength(1);
    const old = SocketFixture.sockets[0]; old.fire('open'); old.frame('mainnet');
    changes.next('signet'); expect(old.closed).toBe(true);
    const signet = SocketFixture.sockets[1]; signet.fire('open');
    expect((signet.sent[0].subscriptions as any[]).every(item => item.network === 'signet' && !item.snapshotId)).toBe(true);
    old.frame('mainnet'); signet.frame('mainnet'); signet.frame('signet');
    expect(received).toEqual(['mainnet', 'signet']);
    one.unsubscribe(); expect(signet.closed).toBe(false); two.unsubscribe(); expect(signet.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('makes unsupported scope explicit without mainnet fallback or retry storms', () => {
    const subscription = service.stream$('bitcoin').subscribe(); changes.next('signet');
    const socket = SocketFixture.sockets[1]; socket.fire('open');
    socket.fire('message', { data: JSON.stringify({ type: 'scope-unavailable', chain: 'bitcoin', network: 'signet', reason: 'bitcoin-network-unavailable' }) });
    socket.close(1008); vi.advanceTimersByTime(60000);
    expect(service.status$.value.bitcoin).toMatchObject({ network: 'signet', status: 'unavailable', reason: 'bitcoin-network-unavailable' });
    expect(SocketFixture.sockets).toHaveLength(2); subscription.unsubscribe();
  });
  it('resumes the matching scope, rejects duplicates and reacquires latest snapshot for a gap', () => {
    const received: string[] = [];
    const subscription = service.stream$('bitcoin').subscribe(frame => received.push(frame.sequenceAtomic));
    const first = SocketFixture.sockets[0]; first.fire('open'); first.frame('mainnet'); first.frame('mainnet');
    expect(received).toEqual(['1']); first.close(1006); vi.advanceTimersByTime(500);
    const resumed = SocketFixture.sockets[1]; resumed.fire('open');
    expect((resumed.sent[0].subscriptions as any[]).find(x => x.channel === 'mempool-snapshot')).toMatchObject({ snapshotId: 'snapshot-1', afterSequenceAtomic: '1' });
    resumed.frame('mainnet', '5'); expect(received).toEqual(['1']);
    expect(service.status$.value.bitcoin.status).toBe('resync-required');
    expect((resumed.sent[1].subscriptions as any[]).find(x => x.channel === 'mempool-snapshot').snapshotId).toBeUndefined();
    resumed.frame('mainnet', '5'); expect(received).toEqual(['1', '5']); subscription.unsubscribe();
  });
  it('bounds silence and ages live proof using its producer timestamp', () => {
    const subscription = service.stream$('bitcoin').subscribe();
    const socket = SocketFixture.sockets[0]; socket.fire('open'); vi.advanceTimersByTime(5000);
    expect(service.status$.value.bitcoin.status).toBe('unavailable'); socket.frame('mainnet');
    for (const channel of ['chain-status', 'candidate-buckets', 'confirmed-protocol-activity']) {socket.frame('mainnet', '1', 'snapshot-1', channel);}
    expect(service.status$.value.bitcoin.status).toBe('live'); vi.advanceTimersByTime(120000);
    expect(service.status$.value.bitcoin).toMatchObject({ status: 'unavailable', reason: 'expired-observation' });
    subscription.unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores every callback from a replaced connection in the same scope', () => {
    const received: string[] = [];
    const subscription = service.stream$('bitcoin').subscribe(frame => received.push(frame.sequenceAtomic));
    const old = SocketFixture.sockets[0]; old.fire('open'); old.frame('mainnet'); old.close(1006);
    vi.advanceTimersByTime(500);
    const current = SocketFixture.sockets[1]; current.fire('open'); current.frame('mainnet', '2');
    const sent = current.sent.length;
    old.fire('open'); old.frame('mainnet', '99'); old.fire('error'); old.fire('close', { code: 1008 });
    expect(received).toEqual(['1', '2']);
    expect(current.sent).toHaveLength(sent);
    expect(service.status$.value.bitcoin.status).toBe('live');
    vi.advanceTimersByTime(1000); expect(SocketFixture.sockets).toHaveLength(2);
    current.close(1006); vi.advanceTimersByTime(500);
    const resumed = SocketFixture.sockets[2]; resumed.fire('open');
    expect((resumed.sent[0].subscriptions as any[]).find(item => item.channel === 'mempool-snapshot')).toMatchObject({ snapshotId: 'snapshot-1', afterSequenceAtomic: '2' });
    subscription.unsubscribe(); expect(resumed.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('expires each channel independently even when other channels keep publishing fresh data', () => {
    const subscription = service.stream$('bitcoin').subscribe();
    const socket = SocketFixture.sockets[0]; socket.fire('open');
    for (const channel of ['chain-status', 'mempool-snapshot', 'candidate-buckets', 'confirmed-protocol-activity']) {socket.frame('mainnet', '1', 'snapshot-1', channel, { observedAt: new Date().toISOString() });}
    expect(service.status$.value.bitcoin.status).toBe('live');
    vi.advanceTimersByTime(119000);
    for (const channel of ['chain-status', 'candidate-buckets', 'confirmed-protocol-activity']) {socket.frame('mainnet', '2', 'snapshot-1', channel, { observedAt: new Date().toISOString() });}
    vi.advanceTimersByTime(1000);
    expect(service.status$.value.bitcoin).toMatchObject({ status: 'unavailable', channel: 'mempool-snapshot', reason: 'expired-observation', channels: { 'chain-status': { status: 'live' }, 'mempool-snapshot': { status: 'unavailable' } } });
    socket.frame('mainnet', '2', 'snapshot-1', 'mempool-snapshot', { observedAt: new Date().toISOString() });
    expect(service.status$.value.bitcoin.status).toBe('live');
    subscription.unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not let another channel upgrade unavailable source completeness or a pending resync', () => {
    const subscription = service.stream$('bitcoin').subscribe();
    const socket = SocketFixture.sockets[0]; socket.fire('open');
    socket.fire('message', { data: JSON.stringify({ ...envelope, chain: 'bitcoin', observedAt: new Date().toISOString(), completeness: 'unavailable' }) });
    socket.frame('mainnet', '1', 'snapshot-1', 'chain-status');
    expect(service.status$.value.bitcoin).toMatchObject({ status: 'unavailable', channel: 'mempool-snapshot', reason: 'source-unavailable' });
    socket.fire('message', { data: JSON.stringify({ type: 'resync-required', chain: 'bitcoin', network: 'mainnet', channel: 'mempool-snapshot' }) });
    socket.frame('mainnet', '2', 'snapshot-1', 'chain-status');
    expect(service.status$.value.bitcoin).toMatchObject({ status: 'resync-required', channel: 'mempool-snapshot' });
    changes.next('signet'); const next = SocketFixture.sockets[1]; next.fire('open'); next.frame('signet');
    expect(service.status$.value.bitcoin).toMatchObject({ network: 'signet', status: 'live', channels: { 'mempool-snapshot': { status: 'live' } } });
    subscription.unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
});
