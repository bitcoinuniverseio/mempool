import * as crypto from 'crypto';

export interface IntelligenceEventEnvelope<T = Record<string, unknown>> {
  event_id: string;
  schema_version: string;
  event_type: string;
  network: string;
  source_id: string;
  source_sequence: number;
  source_software: string;
  source_version: string;
  observed_at_utc: string;
  clock_offset_ms: number;
  clock_uncertainty_ms: number;
  ingested_at_utc: string;
  entity_type: string;
  entity_id: string;
  correlation_id: string;
  coverage_epoch: string;
  payload: T;
  payload_hash: string;
}

export interface EventEnvelopeInput<T = Record<string, unknown>> {
  event_type: string;
  network: string;
  source_id: string;
  source_sequence?: number;
  source_software?: string;
  source_version?: string;
  observed_at_utc?: string;
  clock_offset_ms?: number;
  clock_uncertainty_ms?: number;
  entity_type: string;
  entity_id: string;
  correlation_id?: string;
  coverage_epoch?: string;
  payload: T;
}

export class EventEnvelopeValidator {
  private static sequenceCounter = 0;

  public static generateUuidV7(): string {
    const now = Date.now();
    const bytes = crypto.randomBytes(16);

    // 48-bit timestamp
    bytes[0] = (now / 0x10000000000) & 0xff;
    bytes[1] = (now / 0x100000000) & 0xff;
    bytes[2] = (now / 0x1000000) & 0xff;
    bytes[3] = (now / 0x10000) & 0xff;
    bytes[4] = (now / 0x100) & 0xff;
    bytes[5] = now & 0xff;

    // Version 7: 0111 in bits 12-15 of time_hi_and_version
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    // Variant 1: 10 in bits 6-7 of clock_seq_hi_and_reserved
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  public static computePayloadHash(payload: unknown): string {
    const serialized = JSON.stringify(payload, Object.keys(payload as object).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  public static createEnvelope<T extends Record<string, unknown>>(
    input: EventEnvelopeInput<T>,
    schemaVersion = '1.0.0'
  ): IntelligenceEventEnvelope<T> {
    this.assertIntegerAmounts(input.payload);

    const now = new Date();
    const observedAt = input.observed_at_utc || now.toISOString();
    const ingestedAt = now.toISOString();

    const sequence = input.source_sequence !== undefined
      ? Math.trunc(input.source_sequence)
      : ++this.sequenceCounter;

    const payloadHash = this.computePayloadHash(input.payload);
    const correlationId = input.correlation_id || this.generateUuidV7();
    const coverageEpoch = input.coverage_epoch || `epoch-${observedAt.slice(0, 10)}`;

    return {
      event_id: this.generateUuidV7(),
      schema_version: schemaVersion,
      event_type: input.event_type,
      network: input.network,
      source_id: input.source_id,
      source_sequence: sequence,
      source_software: input.source_software || 'Universe Core Node Observer',
      source_version: input.source_version || '27.1.0',
      observed_at_utc: observedAt,
      clock_offset_ms: Math.trunc(input.clock_offset_ms ?? 0),
      clock_uncertainty_ms: Math.trunc(input.clock_uncertainty_ms ?? 1),
      ingested_at_utc: ingestedAt,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      correlation_id: correlationId,
      coverage_epoch: coverageEpoch,
      payload: input.payload,
      payload_hash: payloadHash,
    };
  }

  public static buildSubject(network: string, domain: string, event: string): string {
    const cleanNetwork = network.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanEvent = event.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    return `btc.${cleanNetwork}.${cleanDomain}.${cleanEvent}`;
  }

  public static assertIntegerAmounts(obj: unknown, path = ''): void {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.assertIntegerAmounts(obj[i], `${path}[${i}]`);
      }
      return;
    }

    const record = obj as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const currentPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();

      const isSatAmount =
        lowerKey.endsWith('_sats') ||
        lowerKey.endsWith('_satoshis') ||
        lowerKey === 'sats' ||
        lowerKey === 'amount_sat' ||
        lowerKey === 'fee_sats' ||
        lowerKey === 'total_sats' ||
        lowerKey === 'value_sats';

      const isWeight =
        lowerKey.endsWith('_weight') ||
        lowerKey === 'weight' ||
        lowerKey.endsWith('_wu') ||
        lowerKey === 'vsize' ||
        lowerKey.endsWith('_vsize') ||
        lowerKey === 'vbytes';

      if ((isSatAmount || isWeight) && typeof value === 'number') {
        if (!Number.isInteger(value)) {
          throw new Error(
            `Integer constraint violation at '${currentPath}': value ${value} must be an integer satoshi or weight unit.`
          );
        }
      }

      if (typeof value === 'object' && value !== null) {
        this.assertIntegerAmounts(value, currentPath);
      }
    }
  }

  public static validateEnvelope(envelope: IntelligenceEventEnvelope): { valid: boolean; error?: string } {
    if (!envelope.event_id || typeof envelope.event_id !== 'string') {
      return { valid: false, error: 'Missing or invalid event_id' };
    }
    if (!envelope.schema_version || typeof envelope.schema_version !== 'string') {
      return { valid: false, error: 'Missing or invalid schema_version' };
    }
    if (!envelope.event_type || typeof envelope.event_type !== 'string') {
      return { valid: false, error: 'Missing or invalid event_type' };
    }
    if (!envelope.network || typeof envelope.network !== 'string') {
      return { valid: false, error: 'Missing or invalid network' };
    }
    if (!envelope.source_id || typeof envelope.source_id !== 'string') {
      return { valid: false, error: 'Missing or invalid source_id' };
    }
    if (typeof envelope.source_sequence !== 'number' || !Number.isInteger(envelope.source_sequence)) {
      return { valid: false, error: 'source_sequence must be an integer' };
    }
    if (!envelope.observed_at_utc || Number.isNaN(Date.parse(envelope.observed_at_utc))) {
      return { valid: false, error: 'observed_at_utc must be a valid UTC timestamp' };
    }
    if (typeof envelope.clock_offset_ms !== 'number' || !Number.isInteger(envelope.clock_offset_ms)) {
      return { valid: false, error: 'clock_offset_ms must be an integer' };
    }
    if (typeof envelope.clock_uncertainty_ms !== 'number' || !Number.isInteger(envelope.clock_uncertainty_ms)) {
      return { valid: false, error: 'clock_uncertainty_ms must be an integer' };
    }
    if (!envelope.entity_type || typeof envelope.entity_type !== 'string') {
      return { valid: false, error: 'Missing or invalid entity_type' };
    }
    if (!envelope.entity_id || typeof envelope.entity_id !== 'string') {
      return { valid: false, error: 'Missing or invalid entity_id' };
    }
    if (!envelope.payload_hash || typeof envelope.payload_hash !== 'string') {
      return { valid: false, error: 'Missing or invalid payload_hash' };
    }

    try {
      this.assertIntegerAmounts(envelope.payload);
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }

    return { valid: true };
  }
}
