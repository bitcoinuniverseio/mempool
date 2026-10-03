import { EventEmitter } from 'events';
import logger from '../../../logger';
import {
  EventEnvelopeValidator,
  IntelligenceEventEnvelope,
} from './event-envelope';

export type EventConsumerHandler = (
  envelope: IntelligenceEventEnvelope,
  ack: () => void,
  nack: (error: Error) => void
) => Promise<void> | void;

export interface SubscriptionOptions {
  durableName?: string;
  maxRetries?: number;
  deadLetterOnFailure?: boolean;
}

export interface DeadLetterEntry {
  id: string;
  envelope: unknown;
  reason: string;
  quarantined_at: string;
  retry_count: number;
}

export interface IEventBusProvider {
  publish(subject: string, envelope: IntelligenceEventEnvelope): Promise<boolean> | boolean;
  subscribe(subject: string, handler: EventConsumerHandler, options?: SubscriptionOptions): () => void;
}

export class NatsJetStreamEventBusProvider implements IEventBusProvider {
  /* IMPLEMENTATION-HANDOFF [WP-BI-005] DEF-BI-005; COV-BI-005A/B/C/D/E.
   * Verified at 62dec461: connect() sets a boolean without a client/socket,
   * publish() returns true without a broker acknowledgement and subscribe() does
   * nothing. Even an invalid endpoint reports success. IntelligenceEventBus also
   * never delegates publish/subscribe to natsProvider. Product matrix REQ-DATA-01
   * offers NATS JetStream durability. Official sources: docs.nats.io Learn JetStream
   * publishing/pull consumers; exact SDK/server pin is an unresolved prerequisite.
   * 1. Pin the maintained official NATS Node SDK and compatible server release after
   *    the targeted compatibility check in intelligence-findings.md. Create a real
   *    authenticated TLS client; await readiness and return unavailable on failure.
   *    Validate operator credentials/config without logging secrets or raw URLs.
   * 2. Provision/bind network-separated streams and durable filtered pull consumers.
   *    Await JetStream publication acknowledgements using event_id as dedupe ID;
   *    bound payloads, in-flight messages and reconnect/backoff. Persist failure or
   *    publish intent before returning a durable-success result.
   * 3. ACK only after required consumer effects commit; NAK/transient redelivery and
   *    terminal dead-letter paths must survive restart. Implement drain/unsubscribe,
   *    max-delivery policy, durable cursor inspection and health/lag diagnostics.
   *    Never silently replace configured broker durability with process memory.
   * Dependencies: WP-BI-001 network scope, WP-BI-002 durable consumer effects; owning
   *    infrastructure/credentials and pinned SDK/server remain BLOCKED prerequisites.
   * Tests: events/event-envelope.test.ts and PROPOSED NEW events/nats-provider.integration.test.ts.
   *    Real isolated broker: unreachable/bad credentials fail; publish receipt,
   *    second-process consumption, restart, lost ACK, duplicate ID, retry/dead-letter,
   *    wrong-network denial and graceful drain all require authoritative readback.
   * Existing command: cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
   *    --runTestsByPath src/api/intelligence/events/event-envelope.test.ts
   * No broker integration PASS exists here. Rollback drains consumers, preserves
   *    streams/ACK cursors and stops publication if durable broker service is absent.
   */
  private natsClient: unknown = null;
  private isConnected = false;

  constructor(private natsUrl: string = process.env.NATS_URL || 'nats://localhost:4222') {}

  /** @asyncSafe Every path returns a boolean; the failure is logged here. */
  public async connect(): Promise<boolean> {
    try {
      logger.info(`NatsJetStreamEventBusProvider: Connecting to ${this.natsUrl}`);
      this.isConnected = true;
      return true;
    } catch (err) {
      logger.warn(`NatsJetStreamEventBusProvider: Connection deferred: ${err}`);
      this.isConnected = false;
      return false;
    }
  }

  public publish(subject: string, envelope: IntelligenceEventEnvelope): boolean {
    if (!this.isConnected) {
      return false;
    }
    logger.debug(`NatsJetStreamEventBusProvider: Published event ${envelope.event_id} to ${subject}`);
    return true;
  }

  public subscribe(
    subject: string,
    handler: EventConsumerHandler,
    options: SubscriptionOptions = {}
  ): () => void {
    logger.debug(`NatsJetStreamEventBusProvider: Subscribed to ${subject} (durable: ${options.durableName || 'none'})`);
    return () => {
      logger.debug(`NatsJetStreamEventBusProvider: Unsubscribed from ${subject}`);
    };
  }
}

export class IntelligenceEventBus {
  private static instance: IntelligenceEventBus;
  private emitter: EventEmitter = new EventEmitter();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private eventRingBuffer: IntelligenceEventEnvelope[] = [];
  private maxRingBufferSize = 10000;
  private processedEventIds = new Set<string>();
  private maxProcessedIds = 50000;
  private natsProvider: NatsJetStreamEventBusProvider | null = null;

  private constructor() {
    this.emitter.setMaxListeners(250);
    if (process.env.INTELLIGENCE_EVENT_BUS_PROVIDER === 'nats') {
      this.natsProvider = new NatsJetStreamEventBusProvider();
      void this.natsProvider.connect();
    }
  }

  public static getInstance(): IntelligenceEventBus {
    if (!IntelligenceEventBus.instance) {
      IntelligenceEventBus.instance = new IntelligenceEventBus();
    }
    return IntelligenceEventBus.instance;
  }

  public publish(
    subject: string,
    envelope: IntelligenceEventEnvelope
  ): boolean {
    /* IMPLEMENTATION-HANDOFF [WP-BI-005] DEF-BI-005; COV-BI-005B/C/D/E.
     * Verified: configured natsProvider is unused here; local wildcard delivery emits
     * only exact/prefix keys, so the templates stream's btc.*.template.* never matches.
     * The '*' branch emits (subject,envelope), while subscribe expects envelope only.
     * 1. Give IEventBusProvider a single asynchronous publish/subscribe contract and
     *    route every configured-provider operation through it; update all call sites
     *    to await durable acceptance and handle explicit unavailable outcomes.
     * 2. For explicitly selected in-process mode implement/test NATS token matching
     *    ('*' one token, '>' final suffix) with a consistent handler argument. Keep
     *    subject and envelope network equal and dedupe only after accepted publication;
     *    do not acknowledge failed delivery merely because event_id was seen earlier.
     * 3. Wire templates collector/stream annotations and expose bounded replay by
     *    event ID/cursor. Keep owner-scoped events isolated under WP-BI-004.
     * Dependencies: provider portion of WP-BI-005, WP-BI-001 and WP-BI-002 as applicable.
     * Sources: NATS official subject wildcard and JetStream acknowledgement docs;
     *    actual consumer at templates/templates.routes.ts.
     * Tests: add exact, middle wildcard, trailing wildcard, global, invalid pattern,
     *    duplicate/retry and network-mismatch cases to events/event-envelope.test.ts;
     *    run cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/events/event-envelope.test.ts
     * Acceptance includes the real template SSE journey and cross-process NATS path,
     *    not merely an EventEmitter unit assertion. Rollback retains durable cursors
     *    and stops consumers before any incompatible envelope/subject schema change.
     */
    const validation = EventEnvelopeValidator.validateEnvelope(envelope);
    if (!validation.valid) {
      this.quarantineEvent(envelope, `Envelope validation failed: ${validation.error}`);
      return false;
    }

    if (this.processedEventIds.has(envelope.event_id)) {
      logger.debug(`IntelligenceEventBus: Duplicate event ${envelope.event_id} skipped.`);
      return true;
    }

    this.processedEventIds.add(envelope.event_id);
    if (this.processedEventIds.size > this.maxProcessedIds) {
      const iter = this.processedEventIds.values();
      for (let i = 0; i < 1000; i++) {
        const item = iter.next();
        if (item.done) break;
        this.processedEventIds.delete(item.value);
      }
    }

    this.eventRingBuffer.push(envelope);
    if (this.eventRingBuffer.length > this.maxRingBufferSize) {
      this.eventRingBuffer.shift();
    }

    this.emitter.emit(subject, envelope);
    this.emitter.emit('*', subject, envelope);

    const parts = subject.split('.');
    for (let i = 1; i < parts.length; i++) {
      const wildcardSubject = parts.slice(0, i).join('.') + '.*';
      this.emitter.emit(wildcardSubject, envelope);
    }

    return true;
  }

  public subscribe(
    subject: string,
    handler: EventConsumerHandler,
    options: SubscriptionOptions = {}
  ): () => void {
    const maxRetries = options.maxRetries ?? 3;

    const listener = async (envelope: IntelligenceEventEnvelope) => {
      let attempts = 0;
      const execute = async () => {
        attempts++;
        try {
          await handler(
            envelope,
            () => {
              // Ack
            },
            (error: Error) => {
              throw error;
            }
          );
        } catch (err) {
          if (attempts <= maxRetries) {
            logger.warn(
              `IntelligenceEventBus: Consumer retry ${attempts}/${maxRetries} for event ${envelope.event_id}: ${err}`
            );
            setTimeout(execute, 50 * Math.pow(2, attempts));
          } else {
            logger.err(
              `IntelligenceEventBus: Consumer failed after ${maxRetries} attempts for event ${envelope.event_id}: ${err}`
            );
            if (options.deadLetterOnFailure !== false) {
              this.quarantineEvent(
                envelope,
                `Consumer failed after max retries: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }
      };

      // The emitter invokes this listener without awaiting it, so a rejection
      // escaping here would surface as an unhandled rejection instead of as a
      // failed delivery. Deliveries report their own outcome; this is the
      // bookkeeping around them.
      try {
        await execute();
      } catch (err) {
        logger.err(`IntelligenceEventBus: delivery bookkeeping failed for ${subject}: ${err}`);
      }
    };

    this.emitter.on(subject, listener);
    return () => this.emitter.off(subject, listener);
  }

  public quarantineEvent(envelope: unknown, reason: string): void {
    const entry: DeadLetterEntry = {
      id: EventEnvelopeValidator.generateUuidV7(),
      envelope,
      reason,
      quarantined_at: new Date().toISOString(),
      retry_count: 0,
    };
    this.deadLetterQueue.push(entry);
    if (this.deadLetterQueue.length > 2000) {
      this.deadLetterQueue.shift();
    }
    logger.warn(`IntelligenceEventBus: Event quarantined into dead-letter store: ${reason}`);
  }

  public getDeadLetterQueue(): readonly DeadLetterEntry[] {
    return this.deadLetterQueue;
  }

  public clearDeadLetter(id: string): boolean {
    const idx = this.deadLetterQueue.findIndex((entry) => entry.id === id);
    if (idx >= 0) {
      this.deadLetterQueue.splice(idx, 1);
      return true;
    }
    return false;
  }

  public replayRecent(
    subjectFilter?: string,
    sinceTimestamp?: number
  ): IntelligenceEventEnvelope[] {
    return this.eventRingBuffer.filter((env) => {
      if (sinceTimestamp && Date.parse(env.observed_at_utc) < sinceTimestamp) {
        return false;
      }
      if (subjectFilter && subjectFilter !== '*') {
        const expected = EventEnvelopeValidator.buildSubject(
          env.network,
          env.entity_type,
          env.event_type
        );
        if (!expected.includes(subjectFilter.replace('*', ''))) {
          return false;
        }
      }
      return true;
    });
  }

  public getRingBufferSize(): number {
    return this.eventRingBuffer.length;
  }
}

export const eventBus = IntelligenceEventBus.getInstance();
