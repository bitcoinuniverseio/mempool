import { EventEmitter } from 'events';
import logger from '../../../logger';
import config from '../../../config';
import { createHash } from 'crypto';
import fs from 'fs';
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
  publish(subject: string, envelope: IntelligenceEventEnvelope): Promise<boolean>;
  subscribe(subject: string, handler: EventConsumerHandler, options?: SubscriptionOptions): Promise<() => void>;
}

export function validSubject(subject: string, pattern: boolean): boolean {
  const tokens = subject.split('.');
  return tokens.length > 0 && tokens.every((token, index) => /^[A-Za-z0-9_-]+$/.test(token) || pattern && (token === '*' || token === '>' && index === tokens.length - 1));
}
export function subjectMatches(pattern: string, subject: string): boolean {
  if (pattern === '*') return true; // Existing global local subscription contract.
  if (!validSubject(pattern, true) || !validSubject(subject, false)) return false;
  const filter = pattern.split('.'), tokens = subject.split('.');
  for (let index = 0; index < filter.length; index++) {
    if (filter[index] === '>') return index < tokens.length;
    if (index >= tokens.length || filter[index] !== '*' && filter[index] !== tokens[index]) return false;
  }
  return filter.length === tokens.length;
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
  private natsClient: any = null;
  private js: any = null;
  private manager: any = null;
  private ready: Promise<boolean> | null = null;
  private subscriptions = new Set<() => void>();
  private consumerTasks = new Set<Promise<void>>();
  private activeConsumers = new Set<string>();
  private readonly stream = 'INTELLIGENCE_' + config.MEMPOOL.NETWORK.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  constructor(private natsUrl = process.env.NATS_URL || 'nats://localhost:4222') {}
  /** @asyncSafe open converts transport/configuration failure into unavailable. */
  public connect(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = this.open().then(connected => { if (!connected) this.ready = null; return connected; });
    return this.ready;
  }
  private async open(): Promise<boolean> {
    try {
      const endpoint = new URL(this.natsUrl);
      const loopback = ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname);
      if (!loopback && endpoint.protocol !== 'tls:') throw new Error('NATS requires TLS');
      if (endpoint.username || endpoint.password) throw new Error('NATS URL must omit credentials');
      const { connect } = require('@nats-io/transport-node');
      const { jetstream, jetstreamManager } = require('@nats-io/jetstream');
      this.natsClient = await connect({ servers: this.natsUrl, timeout: 5000, maxReconnectAttempts: 10, reconnectTimeWait: 1000, user: process.env.NATS_USER, pass: process.env.NATS_PASSWORD, tls: endpoint.protocol === 'tls:' ? { ca: process.env.NATS_CA ? fs.readFileSync(process.env.NATS_CA).toString() : undefined } : undefined });
      this.manager = await jetstreamManager(this.natsClient);
      try {
        const info = await this.manager.streams.info(this.stream);
        if (info.config.storage !== 'file' || info.config.subjects?.length !== 1 || info.config.subjects[0] !== `btc.${config.MEMPOOL.NETWORK}.>` || info.config.max_bytes <= 0 || info.config.max_bytes > 268435456 || info.config.max_msg_size <= 0 || info.config.max_msg_size > 262144) throw new Error('Incompatible intelligence stream');
      }
      catch (error) {
        if ((error as any).code !== '404' && (error as any).apiError?.()?.code !== 404) throw error;
        await this.manager.streams.add({ name: this.stream, subjects: [`btc.${config.MEMPOOL.NETWORK}.>`], storage: 'file', max_bytes: 268435456, max_msg_size: 262144, max_age: 72 * 3600 * 1e9, duplicate_window: 120 * 1e9 });
      }
      this.js = jetstream(this.natsClient);
      return true;
    } catch {
      logger.warn('NATS intelligence provider unavailable');
      if (this.natsClient) await this.natsClient.close().catch(() => undefined);
      this.natsClient = null;
      return false;
    }
  }
  public async publish(subject: string, envelope: IntelligenceEventEnvelope): Promise<boolean> {
    if (!validSubject(subject, false) || !EventEnvelopeValidator.validateEnvelope(envelope).valid || !subject.startsWith(`btc.${config.MEMPOOL.NETWORK}.`) || envelope.network !== config.MEMPOOL.NETWORK || !await this.connect()) return false;
    const bytes = Buffer.from(JSON.stringify(envelope));
    if (bytes.length > 262144) return false;
    try { await this.js.publish(subject, bytes, { msgID: envelope.event_id, timeout: 5000 }); return true; }
    catch { return false; }
  }
  public async subscribe(subject: string, handler: EventConsumerHandler, options: SubscriptionOptions = {}): Promise<() => void> {
    if (!validSubject(subject, true) || !subject.startsWith(`btc.${config.MEMPOOL.NETWORK}.`)) throw new Error('NATS subscription network mismatch');
    if (options.maxRetries !== undefined && (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 0 || options.maxRetries > 20)) throw new Error('Invalid consumer retry bound');
    let stopped = false;
    let messages: any;
    const stop = () => { stopped = true; messages?.stop(); this.subscriptions.delete(stop); };
    this.subscriptions.add(stop);
    try {
      if (!await this.connect()) throw new Error('NATS unavailable');
      const durable = options.durableName ?? 'stream_' + EventEnvelopeValidator.generateUuidV7().replace(/-/g,'');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(durable)) throw new Error('Invalid durable name');
      try {
        const info=await this.manager.consumers.info(this.stream, durable);
        if(info.config.filter_subject!==subject || info.config.ack_policy !== 'explicit' || info.config.max_ack_pending !== 1 || info.config.max_deliver !== -1 || info.config.ack_wait !== 30 * 1e9) throw new Error('Incompatible consumer delivery contract');
      }
      catch (error) {
        if ((error as any).code !== '404' && (error as any).apiError?.()?.code !== 404) throw error;
        await this.manager.consumers.add(this.stream, { ...(options.durableName ? {durable_name:durable,deliver_policy:'all'} : {name:durable,deliver_policy:'new',inactive_threshold:60*1e9}), filter_subject: subject, ack_policy: 'explicit', ack_wait: 30 * 1e9, max_ack_pending: 1, max_deliver: -1 });
      }
      const consumer = await this.js.consumers.get(this.stream, durable);
      this.activeConsumers.add(durable);
      messages = await consumer.consume({ max_messages: 1 });
      if (stopped) { messages.stop(); return stop; }
      const task = (async () => {
      for await (const message of messages) {
        if (stopped) break;
        try {
          const attempts = message.info.deliveryCount - 1;
          if (attempts > (options.maxRetries ?? 3)) {
            // Quarantine malformed bytes too, without storing an unbounded original payload.
            const digest = createHash('sha256').update(message.data).digest('hex');
            await this.js.publish(`btc.${config.MEMPOOL.NETWORK}.deadletter.failed`, Buffer.from(JSON.stringify({ payload_digest: digest, source_subject: message.subject, source_sequence: message.info.streamSequence, reason: 'consumer_retry_limit', consumer: durable })), { msgID: durable + ':' + message.info.streamSequence, timeout: 5000 });
            message.term();
            continue;
          }
          const envelope = JSON.parse(Buffer.from(message.data).toString());
          if (!EventEnvelopeValidator.validateEnvelope(envelope).valid || envelope.network !== config.MEMPOOL.NETWORK) throw new Error('Invalid broker envelope');
          let acknowledged = false;
          let failure: Error | undefined;
          await handler(envelope, () => { acknowledged = true; }, error => { failure = error; });
          if (failure) throw failure;
          if (!acknowledged) throw new Error('Consumer effects were not acknowledged');
          await message.ackAck({ timeout: 5000 });
        } catch { message.nak(1000); }
      }
      })().catch(() => { if(!stopped)logger.warn('NATS intelligence consumer unavailable');stop(); });
      this.consumerTasks.add(task);
      task.finally(() => { this.consumerTasks.delete(task); this.activeConsumers.delete(durable); }).catch(() => undefined);
      return stop;
    } catch(error) { stop();throw error; }
  }
  /** @asyncUnsafe Stream callers report replay unavailable rather than accepting an invented cursor. */
  public async replayRecent(subject: string): Promise<IntelligenceEventEnvelope[]> {
    if (!await this.connect()) throw new Error('NATS unavailable');
    const info=await this.manager.streams.info(this.stream);
    const last=info.state.last_seq;
    const events:IntelligenceEventEnvelope[]=[];
    for(let sequence=Math.max(info.state.first_seq,last-999);sequence<=last;sequence++) {
      try {
        const message=await this.manager.streams.getMessage(this.stream,{seq:sequence});
        if (!message) continue;
        if(!subjectMatches(subject,message.subject))continue;
        const envelope=JSON.parse(Buffer.from(message.data).toString());
        if (!EventEnvelopeValidator.validateEnvelope(envelope).valid || envelope.network !== config.MEMPOOL.NETWORK) {
          throw new Error('Stored event replay contains an invalid or unverifiable envelope.');
        }
        events.push(envelope);
      } catch(error) { if((error as any).apiError?.()?.code!==404)throw error; }
    }
    return events;
  }
  public async diagnostics(): Promise<{ available: boolean; network: string; messages?: number; bytes?: number; consumers?: Array<{ name: string; pending: number; ack_pending: number; ack_floor: number }> }> {
    const network = config.MEMPOOL.NETWORK;
    if (!await this.connect() || this.natsClient?.isClosed()) return { available: false, network };
    try {
      const info = await this.manager.streams.info(this.stream);
      const consumers: Array<{name: string; pending: number; ack_pending: number; ack_floor: number}> = [];
      for (const name of [...this.activeConsumers].slice(0, 32)) {
        const consumer = await this.manager.consumers.info(this.stream, name);
        consumers.push({ name, pending: consumer.num_pending, ack_pending: consumer.num_ack_pending, ack_floor: consumer.ack_floor.stream_seq });
      }
      return { available: true, network, messages: info.state.messages, bytes: info.state.bytes, consumers };
    } catch { return { available: false, network }; }
  }
  /** @asyncUnsafe Shutdown bounds and handles drain failure. */
  public async drain(): Promise<void> {
    for (const stop of this.subscriptions) stop();
    const client = this.natsClient;
    let timeout: NodeJS.Timeout | undefined;
    const completed = await Promise.race([
      Promise.all([...this.consumerTasks]).then(() => true),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 4000); }),
    ]);
    if (timeout) clearTimeout(timeout);
    this.natsClient = null;
    this.js = null;
    this.manager = null;
    this.ready = null;
    if (client && !client.isClosed()) {
      if (completed) await client.drain();
      else { await client.close(); throw new Error('NATS consumer drain deadline exceeded'); }
    }
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

  public async publish(
    subject: string,
    envelope: IntelligenceEventEnvelope
  ): Promise<boolean> {
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

    if (subject.split('.')[1] !== envelope.network || !validSubject(subject, false)) return false;
    if (this.natsProvider) return this.natsProvider.publish(subject, envelope);
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

    for (const pattern of this.emitter.eventNames()) {
      if (typeof pattern === 'string' && subjectMatches(pattern, subject)) this.emitter.emit(pattern, envelope);
    }

    return true;
  }

  public async subscribe(
    subject: string,
    handler: EventConsumerHandler,
    options: SubscriptionOptions = {}
  ): Promise<() => void> {
    if (!validSubject(subject, true)) throw new Error('Invalid subject pattern');
    if (this.natsProvider) return this.natsProvider.subscribe(subject, handler, options);
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
        if (!subjectMatches(subjectFilter, expected)) {
          return false;
        }
      }
      return true;
    });
  }

  public async replayStored(subject: string): Promise<IntelligenceEventEnvelope[]> {
    return this.natsProvider ? this.natsProvider.replayRecent(subject) : this.replayRecent(subject);
  }
  /** @asyncUnsafe Shutdown bounds and handles drain failure. */
  public async drain(): Promise<void> { await this.natsProvider?.drain(); }
  public async providerDiagnostics(): Promise<unknown> {
    return this.natsProvider ? this.natsProvider.diagnostics() : { available: true, network: config.MEMPOOL.NETWORK, provider: 'memory', durable: false };
  }
  public getRingBufferSize(): number {
    return this.eventRingBuffer.length;
  }
}

export const eventBus = IntelligenceEventBus.getInstance();
