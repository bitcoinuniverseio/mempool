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

export class IntelligenceEventBus {
  private static instance: IntelligenceEventBus;
  private emitter: EventEmitter = new EventEmitter();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private eventRingBuffer: IntelligenceEventEnvelope[] = [];
  private maxRingBufferSize = 10000;
  private processedEventIds = new Set<string>();
  private maxProcessedIds = 50000;

  private constructor() {
    this.emitter.setMaxListeners(250);
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

      await execute();
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
