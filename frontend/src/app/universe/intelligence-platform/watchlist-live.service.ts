import { Injectable } from '@angular/core';
import { EMPTY, Observable, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OwnerKeyService } from './owner-key.service';

export interface WatchlistLiveState { status: string; notification?: Record<string, unknown> }

/** Owner credentials travel in a same-origin websocket message, never the URL. */
@Injectable({ providedIn: 'root' })
export class WatchlistLiveService {
  constructor(private readonly state: StateService, private readonly owner: OwnerKeyService) {}

  stream(): Observable<WatchlistLiveState> {
    return this.owner.key$.pipe(switchMap(key => {
      if (!key || !this.state.isBrowser) return EMPTY;
      const network = this.state.network || 'mainnet';
      const prefix = this.state.network && this.state.network !== this.state.env.ROOT_NETWORK ? '/' + this.state.network : '';
      return new Observable<WatchlistLiveState>(observer => {
        let socket: WebSocket | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let stopped = false;
        let attempts = 0;
        let cursor: string | undefined;
        const connect = () => {
          let ready = false;
          observer.next({ status: 'Connecting live notifications' });
          socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${prefix}/api/v1/ws`);
          socket.addEventListener('open', () => socket?.send(JSON.stringify({ action: 'watchlist-subscribe', api_key: key, ...(cursor ? { cursor } : {}) })));
          socket.addEventListener('message', event => {
            if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) return;
            let value;
            try { value = JSON.parse(event.data); } catch { return; }
            if (!value || typeof value !== 'object') return;
            if (value['watchlist-ready']?.network === network) {
              ready = true;
              attempts = 0;
              observer.next({ status: 'Live notifications connected' });
            }
            const notification = value['watchlist-notification'];
            if (ready && notification && typeof notification.notification_id === 'string') {
              cursor = notification.notification_id;
              observer.next({ status: 'Live notifications connected', notification });
            }
            if (value['watchlist-error']) {
              observer.next({ status: 'Live notifications unavailable: ' + String(value['watchlist-error'].code || 'subscription rejected') });
              stopped = true;
              socket?.close();
            }
          });
          socket.addEventListener('close', () => {
            if (stopped) return;
            observer.next({ status: 'Live connection interrupted; reconnecting' });
            timer = setTimeout(connect, Math.min(15000, 500 * 2 ** Math.min(attempts++, 5)));
          });
          socket.addEventListener('error', () => socket?.close());
        };
        connect();
        return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close(); };
      });
    }));
  }
}
