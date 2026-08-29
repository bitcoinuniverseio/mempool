import { Injectable } from '@angular/core';
import { StateService } from '@app/services/state.service';
import { ExplorerChain } from '@app/universe/universe.types';
import { EMPTY, Observable } from 'rxjs';

export interface UniverseLiveEnvelope {
  readonly schemaVersion: 'universe-websocket-v1';
  readonly chain: ExplorerChain;
  readonly network: 'mainnet';
  readonly channel:
    'chain-status' | 'mempool-snapshot' | 'confirmed-protocol-activity';
  readonly snapshotId: string;
  readonly sequenceAtomic: string;
  readonly observedAt: string;
  readonly completeness: 'complete' | 'partial' | 'unavailable';
  readonly data: unknown;
}

interface ResumeCursor {
  snapshotId: string;
  afterSequenceAtomic: string;
}

const CHANNELS = [
  'chain-status',
  'mempool-snapshot',
  'confirmed-protocol-activity',
] as const;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUniverseLiveEnvelope(
  value: unknown,
  expectedChain: ExplorerChain
): UniverseLiveEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schemaVersion !== 'universe-websocket-v1' ||
    value.chain !== expectedChain ||
    value.network !== 'mainnet' ||
    !CHANNELS.includes(value.channel as (typeof CHANNELS)[number]) ||
    typeof value.snapshotId !== 'string' ||
    !value.snapshotId ||
    value.snapshotId.length > 64 ||
    !DECIMAL.test(
      typeof value.sequenceAtomic === 'string' ? value.sequenceAtomic : ''
    ) ||
    typeof value.observedAt !== 'string' ||
    !['complete', 'partial', 'unavailable'].includes(String(value.completeness))
  ) {
    return null;
  }
  return value as unknown as UniverseLiveEnvelope;
}

@Injectable({ providedIn: 'root' })
export class UniverseWebsocketService {
  constructor(private readonly stateService: StateService) {}

  stream$(chain: ExplorerChain): Observable<UniverseLiveEnvelope> {
    if (!this.stateService.isBrowser || typeof WebSocket === 'undefined') {
      return EMPTY;
    }
    return new Observable<UniverseLiveEnvelope>((observer) => {
      const cursors = new Map<string, ResumeCursor>();
      let socket: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      let attempts = 0;

      const connect = (): void => {
        if (stopped) {
          return;
        }
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(
          `${protocol}//${location.host}/api/v1/universe/ws`
        );
        socket.addEventListener('open', () => {
          attempts = 0;
          socket?.send(
            JSON.stringify({
              type: 'subscribe',
              subscriptions: CHANNELS.map((channel) => ({
                chain,
                network: 'mainnet',
                channel,
                ...cursors.get(channel),
              })),
            })
          );
        });
        socket.addEventListener('message', (message) => {
          if (
            typeof message.data !== 'string' ||
            message.data.length > 1024 * 1024
          ) {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(message.data);
          } catch {
            return;
          }
          if (isRecord(parsed) && parsed.type === 'resync-required') {
            if (typeof parsed.channel === 'string') {
              cursors.delete(parsed.channel);
            }
            return;
          }
          const envelope = parseUniverseLiveEnvelope(parsed, chain);
          if (!envelope) {
            return;
          }
          cursors.set(envelope.channel, {
            snapshotId: envelope.snapshotId,
            afterSequenceAtomic: envelope.sequenceAtomic,
          });
          observer.next(envelope);
        });
        socket.addEventListener('close', (event) => {
          socket = null;
          if (stopped) {
            return;
          }
          if (event.code === 1008 || event.code === 1003) {
            observer.complete();
            return;
          }
          const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
          attempts += 1;
          reconnectTimer = setTimeout(connect, delay);
        });
      };

      connect();
      return () => {
        stopped = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        socket?.close(1000, 'view-closed');
      };
    });
  }
}
