import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { WatchlistLiveService } from './watchlist-live.service';

class Socket {
  static sockets: Socket[] = [];
  listeners = new Map<string, ((event: any) => void)[]>();
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) { Socket.sockets.push(this); }
  addEventListener(type: string, listener: (event: any) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; this.emit('close', {}); }
  emit(type: string, event: any) { this.listeners.get(type)?.forEach(listener => listener(event)); }
  message(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Socket.sockets = []; });
describe('owner live notification transport', () => {
  it('authenticates in the message, validates ready network, resumes persisted IDs and closes on key removal', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('location', { protocol: 'https:', host: 'owned.example' });
    const key = new BehaviorSubject<string | null>('uip_live_disposable');
    const service = new WatchlistLiveService({ isBrowser: true, network: 'signet', env: { ROOT_NETWORK: 'mainnet' } } as never, { key$: key } as never);
    const rows: unknown[] = [];
    const sub = service.stream().subscribe(update => { if (update.notification) rows.push(update.notification); });
    const first = Socket.sockets[0];
    first.emit('open', {});
    expect(first.url).toBe('wss://owned.example/signet/api/v1/ws');
    expect(JSON.parse(first.sent[0])).toMatchObject({ action: 'watchlist-subscribe', api_key: 'uip_live_disposable' });
    first.message({ 'watchlist-ready': { network: 'mainnet' } });
    first.message({ 'watchlist-notification': { notification_id: 'wrong' } });
    expect(rows).toEqual([]);
    first.message({ 'watchlist-ready': { network: 'signet' } });
    first.message({ 'watchlist-notification': { notification_id: 'persisted' } });
    expect(rows).toHaveLength(1);
    first.close();
    vi.advanceTimersByTime(500);
    Socket.sockets[1].emit('open', {});
    expect(JSON.parse(Socket.sockets[1].sent[0]).cursor).toBe('persisted');
    key.next(null);
    expect(Socket.sockets[1].closed).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(Socket.sockets).toHaveLength(2);
    sub.unsubscribe();
  });
});
