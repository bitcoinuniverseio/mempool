import { Injectable } from '@angular/core';
import { StateService } from '@app/services/state.service';
import { ExplorerChain, ExplorerNetwork } from '@app/universe/universe.types';
import { resolveChainNetwork } from '@app/universe/chain-network';
import { EMPTY, Observable } from 'rxjs';

export interface UniverseLiveEnvelope {
  readonly schemaVersion: 'universe-websocket-v1';
  readonly chain: ExplorerChain;
  readonly network: ExplorerNetwork;
  readonly channel:
    'chain-status' | 'mempool-snapshot' | 'candidate-buckets'
    | 'confirmed-protocol-activity';
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
  'candidate-buckets',
  'confirmed-protocol-activity',
] as const;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUniverseLiveEnvelope(
  value: unknown,
  expectedChain: ExplorerChain,
  expectedNetwork: ExplorerNetwork = 'mainnet'
): UniverseLiveEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schemaVersion !== 'universe-websocket-v1' ||
    value.chain !== expectedChain ||
    value.network !== expectedNetwork ||
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

  /**
   * IMPLEMENTATION-HANDOFF [API-05] API-05-WS | F-FE-002 | FAIL.
   * Current stream$ fixes Bitcoin to mainnet even when Signet is selected.
   * Configured Dogecoin testnet is sent, but the current producer rejects any
   * network other than mainnet; close 1008 completes this stream silently.
   * Evidence: frontend-source-reproductions.json FE-WS-BTC/DOGE-SCOPE.
   * Governing producer: backend-apis@a3361bdb0d9f06587dca7ae3b8065783f3b2d3f8,
   * src/universe-explorer/websocket/universe-websocket.service.ts#subscription.
   * 1. After API-04 reconciles supported subscriptions, resolve the selected
   *    Bitcoin/configured chain network for each subscription. Keep the
   *    same-origin /api/v1/universe/ws transport; never substitute Mainnet.
   * 2. Until that exact network is offered, publish an explicit unavailable
   *    stream state to the live page while keeping valid REST polling usable.
   *    Merely changing the string to signet fails 1008 and is not a repair.
   * 3. Coordinate producer stream keys, polling, envelopes, status and resume
   *    cursors with API-04. Partition/reset by chain+network+channel+snapshot;
   *    cancel old connections and reject late cross-context/duplicate frames.
   * 4. Surface invalid-subscription and outage separately; bound reconnects.
   *    On resync-required refresh an authoritative snapshot before resuming,
   *    rather than silently clearing a cursor while leaving old rows current.
   * 5. Extend universe-websocket.service.spec.ts, chain-network-consumers.spec.ts
   *    and live/live-buffer.spec.ts for unsupported networks, reconnect/resume,
   *    sequence gaps, invalidation, switch cancellation and fresh recovery.
   *    Run npm test -- those paths, frontend lint/build, then real supported
   *    Signet (or documented Testnet) REST+WS consumer acceptance.
   * Dependencies: API-02, API-03, API-04. Rollback producer and consumers as one
   *    compatible set; unsupported networks stay explicit, never Mainnet data.
   * Preparation only; no executable behavior changed here.
   */
  stream$(chain: ExplorerChain): Observable<UniverseLiveEnvelope> {
    if (!this.stateService.isBrowser || typeof WebSocket === 'undefined') {
      return EMPTY;
    }
    // Bitcoin live frames stay on mainnet as before; every other chain
    // subscribes to and accepts only its configured network.
    const resolved = resolveChainNetwork(chain, 'mainnet', this.stateService.env);
    // No socket is opened for a chain whose configured network is invalid:
    // subscribing under a substitute network would stream another network.
    // The stream stays silent rather than failing, so a page polling beside it
    // keeps running and shows the configuration error its own reads raise.
    if (!resolved.available) {
      return EMPTY;
    }
    const network = resolved.network;
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
                network,
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
          const envelope = parseUniverseLiveEnvelope(parsed, chain, network);
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
