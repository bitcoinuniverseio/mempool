import { Injectable } from '@angular/core';
import { StateService } from '@app/services/state.service';
import { ExplorerChain, ExplorerNetwork } from '@app/universe/universe.types';
import { resolveChainNetwork } from '@app/universe/chain-network';
import { EMPTY, Observable, BehaviorSubject, of, startWith, distinctUntilChanged, switchMap, share } from 'rxjs';

export interface UniverseStreamState {
  chain: ExplorerChain; network: string; status: 'connecting' | 'live' | 'reconnecting' | 'unavailable' | 'resync-required'; reason: string | null;
  channel?: string;
  channels?: Readonly<Record<string, { status: UniverseStreamState['status']; reason: string | null; observedAt?: string; completeness?: string }>>;
}

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
    typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) ||
    !['complete', 'partial', 'unavailable'].includes(String(value.completeness))
  ) {
    return null;
  }
  return value as unknown as UniverseLiveEnvelope;
}

@Injectable({ providedIn: 'root' })
export class UniverseWebsocketService {
  readonly status$ = new BehaviorSubject<Readonly<Record<string, UniverseStreamState>>>({});
  private readonly streams = new Map<ExplorerChain, Observable<UniverseLiveEnvelope>>();
  constructor(private readonly stateService: StateService) {}

  private report(chain: ExplorerChain, network: string, status: UniverseStreamState['status'], reason: string = null, channel?: string): void {
    this.status$.next({ ...this.status$.value, [chain]: { chain, network, status, reason, channel } });
  }

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
    if (!this.streams.has(chain)) {
      const contexts = this.stateService.networkChanged$ || of(this.stateService.network);
      this.streams.set(chain, contexts.pipe(startWith(this.stateService.network), distinctUntilChanged(),
        switchMap(selected => this.scopedStream$(chain, (selected || 'mainnet') as ExplorerNetwork)), share()));
    }
    return this.streams.get(chain);
  }

  private scopedStream$(chain: ExplorerChain, selected: ExplorerNetwork): Observable<UniverseLiveEnvelope> {
    const resolved = resolveChainNetwork(chain, selected, this.stateService.env);
    // No socket is opened for a chain whose configured network is invalid:
    // subscribing under a substitute network would stream another network.
    // The stream stays silent rather than failing, so a page polling beside it
    // keeps running and shows the configuration error its own reads raise.
    if (!resolved.available) {
      this.report(chain, '', 'unavailable', resolved.reason);
      return EMPTY;
    }
    const network = resolved.network;
    return new Observable<UniverseLiveEnvelope>((observer) => {
      this.report(chain, network, 'connecting');
      const cursors = new Map<string, ResumeCursor>();
      let socket: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      let attempts = 0;
      let initialTimer: ReturnType<typeof setTimeout> | null = null;
      let generation = 0;
      const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const channelStates: Record<string, { status: UniverseStreamState['status']; reason: string | null; observedAt?: string; completeness?: string }> = {};
      const clearTimers = (): void => {
        if (initialTimer) {clearTimeout(initialTimer); initialTimer = null;}
        for (const timer of expiryTimers.values()) {clearTimeout(timer);}
        expiryTimers.clear();
      };
      const reportChannels = (): void => {
        const entries = Object.entries(channelStates);
        const blocked = entries.find(([, state]) => state.status === 'resync-required') || entries.find(([, state]) => state.status === 'unavailable');
        const state = blocked?.[1];
        this.status$.next({ ...this.status$.value, [chain]: { chain, network, status: state?.status || 'live', reason: state?.reason || null, channel: blocked?.[0], channels: { ...channelStates } } });
      };

      const connect = (): void => {
        if (stopped) {
          return;
        }
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const connectionGeneration = ++generation;
        const connection = new WebSocket(
          `${protocol}//${location.host}/api/v1/universe/ws`
        );
        socket = connection;
        const current = (): boolean => !stopped && socket === connection && generation === connectionGeneration;
        initialTimer = setTimeout(() => {
          if (!current()) {return;}
          for (const channel of CHANNELS) {
            if (!channelStates[channel]) {channelStates[channel] = { status: 'unavailable', reason: 'observation-timeout' };}
          }
          reportChannels();
        }, 5000);
        connection.addEventListener('open', () => {
          if (!current()) {return;}
          connection.send(
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
        connection.addEventListener('message', (message) => {
          if (!current()) {return;}
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
          if (isRecord(parsed) && parsed.type === 'scope-unavailable' && parsed.chain === chain && parsed.network === network) {
            this.report(chain, network, 'unavailable', String(parsed.reason || 'scope-unavailable'));
            return;
          }
          if (isRecord(parsed) && parsed.type === 'resync-required' && parsed.chain === chain && parsed.network === network) {
            if (CHANNELS.includes(parsed.channel as (typeof CHANNELS)[number])) {
              channelStates[String(parsed.channel)] = { status: 'resync-required', reason: 'snapshot-replaced' };
              reportChannels();
              cursors.delete(String(parsed.channel));
              const timer = expiryTimers.get(String(parsed.channel));
              if (timer) {clearTimeout(timer); expiryTimers.delete(String(parsed.channel));}
            }
            return;
          }
          const envelope = parseUniverseLiveEnvelope(parsed, chain, network);
          if (!envelope) {
            return;
          }
          const previous = cursors.get(envelope.channel);
          if (previous && previous.snapshotId === envelope.snapshotId && BigInt(envelope.sequenceAtomic) <= BigInt(previous.afterSequenceAtomic)) {return;}
          if (previous && (previous.snapshotId !== envelope.snapshotId || BigInt(envelope.sequenceAtomic) > BigInt(previous.afterSequenceAtomic) + 1n)) {
            channelStates[envelope.channel] = { status: 'resync-required', reason: 'sequence-gap' };
            const timer = expiryTimers.get(envelope.channel);
            if (timer) {clearTimeout(timer); expiryTimers.delete(envelope.channel);}
            reportChannels();
            cursors.delete(envelope.channel);
            connection.send(JSON.stringify({ type: 'subscribe', subscriptions: CHANNELS.map(channel => ({ chain, network, channel, ...cursors.get(channel) })) }));
            return;
          }
          attempts = 0;
          const previousTimer = expiryTimers.get(envelope.channel);
          if (previousTimer) {clearTimeout(previousTimer); expiryTimers.delete(envelope.channel);}
          // Publication time proves transport activity, not the age of a retained source snapshot.
          const payload = isRecord(envelope.data) ? envelope.data : null;
          const snapshot = payload && isRecord(payload.snapshot) ? payload.snapshot : payload;
          const health = payload && isRecord(payload.health) ? payload.health : null;
          const node = health && isRecord(health.node) ? health.node : null;
          const sourceTime = snapshot && typeof snapshot.observedAt === 'string' ? snapshot.observedAt : node && typeof node.observedAt === 'string' ? node.observedAt : envelope.observedAt;
          const age = Date.now() - Date.parse(sourceTime);
          const expired = !Number.isFinite(age) || age >= 120000 || age < -5000;
          channelStates[envelope.channel] = { status: envelope.completeness === 'unavailable' || expired ? 'unavailable' : 'live', reason: expired ? 'expired-observation' : envelope.completeness === 'unavailable' ? 'source-unavailable' : null, observedAt: sourceTime, completeness: envelope.completeness };
          reportChannels();
          if (!expired && envelope.completeness !== 'unavailable') {
            expiryTimers.set(envelope.channel, setTimeout(() => {
              if (!current()) {return;}
              channelStates[envelope.channel] = { ...channelStates[envelope.channel], status: 'unavailable', reason: 'expired-observation' };
              expiryTimers.delete(envelope.channel);
              reportChannels();
            }, Math.max(0, 120000 - age)));
          }
          cursors.set(envelope.channel, {
            snapshotId: envelope.snapshotId,
            afterSequenceAtomic: envelope.sequenceAtomic,
          });
          observer.next(envelope);
        });
        connection.addEventListener('error', () => {
          if (!current()) {return;}
          this.report(chain, network, 'unavailable', 'transport-error');
        });
        connection.addEventListener('close', (event) => {
          if (!current()) {return;}
          socket = null;
          clearTimers();
          if (stopped) {
            return;
          }
          if (event.code === 1008 || event.code === 1003) {
            if (this.status$.value[chain]?.status !== 'unavailable') {this.report(chain, network, 'unavailable', 'invalid-subscription');}
            observer.complete();
            return;
          }
          this.report(chain, network, 'reconnecting', 'disconnected');
          for (const channel of CHANNELS) {delete channelStates[channel];}
          const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
          attempts += 1;
          reconnectTimer = setTimeout(connect, delay);
        });
      };

      connect();
      return () => {
        stopped = true;
        generation += 1;
        clearTimers();
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        const closing = socket;
        socket = null;
        closing?.close(1000, 'view-closed');
      };
    });
  }
}
