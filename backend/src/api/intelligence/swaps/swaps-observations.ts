import { createHash } from 'crypto';
import DB from '../../../database';
import config from '../../../config';
import { SwapContext, SwapSourceContext } from './swaps.models';
import { MAX_SATS } from '../utxo/utxo-evidence';

const hashPayload = (payload: object): string => createHash('sha256')
  .update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');

function validate(payload: any, context: SwapContext): void {
  const uint = (value: unknown, max = Number.MAX_SAFE_INTEGER): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.chain !== context.chain || payload.network !== context.network ||
      typeof payload.source_id !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(payload.source_id) ||
      typeof payload.observed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(payload.observed_at) || !Number.isFinite(Date.parse(payload.observed_at)) ||
      typeof payload.txid !== 'string' || !/^[0-9a-f]{64}$/.test(payload.txid) ||
      typeof payload.block_hash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.block_hash) ||
      !uint(payload.vout, 0xffffffff) || !uint(payload.block_height) || !uint(payload.value_sats, MAX_SATS) ||
      !['lockup-script-verified', 'invalid'].includes(payload.stage)) {
    throw new Error('Stored swap observation schema is invalid.');
  }
}

export interface SwapObservation {
  chain: 'bitcoin'; network: string; source_id: string; observed_at: string;
  txid: string; vout: number; block_hash: string; block_height: number;
  value_sats: number; stage: string; payload_hash: string;
}
export interface SwapObservationStore {
  save(context: SwapSourceContext, txid: string, vout: number, value: number, stage: string): Promise<void>;
  recent(context: SwapContext): Promise<SwapObservation[]>;
}

/** Reuses the existing durable event schema. No in-memory success fallback. */
export class DatabaseSwapObservations implements SwapObservationStore {
  /** @asyncUnsafe Storage failures must reach the service so it can disclose failed persistence. */
  public async save(context: SwapSourceContext, txid: string, vout: number, value: number, stage: string): Promise<void> {
    if (!config.DATABASE.ENABLED) throw new Error('Observation database is disabled.');
    const identity = `${context.chain}:${context.network}:${txid}:${vout}`;
    const eventId = createHash('sha256').update(`swap-observation-v1:${identity}`).digest('hex');
    const payload = { ...context, txid, vout, value_sats: value, stage };
    validate(payload, context);
    const json = JSON.stringify(payload);
    const hash = hashPayload(payload);
    await DB.query(`INSERT INTO intelligence_events
      (event_id, schema_version, event_type, network, source_id, source_sequence,
       observed_at, ingested_at, entity_type, entity_id, correlation_id, payload, payload_hash)
      VALUES (?, '1.0', 'swap_lockup_observation', ?, ?, ?, ?, ?, 'swap_lockup', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE observed_at=VALUES(observed_at), ingested_at=VALUES(ingested_at),
        source_sequence=VALUES(source_sequence), payload=VALUES(payload), payload_hash=VALUES(payload_hash)`,
    [eventId, `${context.chain}:${context.network}`, context.source_id, context.block_height,
      new Date(context.observed_at), new Date(), `${txid}:${vout}`, eventId, json, hash], 'silent');
  }

  /** @asyncUnsafe Storage/integrity failures must reach the overview's unavailable-storage boundary. */
  public async recent(context: SwapContext): Promise<SwapObservation[]> {
    if (!config.DATABASE.ENABLED) throw new Error('Observation database is disabled.');
    const [rows] = await DB.query<any[]>(`SELECT payload, payload_hash FROM intelligence_events
      WHERE network=? AND entity_type='swap_lockup' AND event_type='swap_lockup_observation'
      ORDER BY observed_at DESC LIMIT 100`, [`${context.chain}:${context.network}`], 'silent');
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('Stored swap observation result exceeds its bounds.');
    const identities = new Set<string>();
    return rows.map(row => {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      validate(payload, context);
      const identity = `${payload.txid}:${payload.vout}`;
      if (hashPayload(payload) !== row.payload_hash || identities.has(identity)) {
        throw new Error('Stored observation identity or payload integrity mismatch.');
      }
      identities.add(identity);
      return { ...payload, payload_hash: row.payload_hash };
    });
  }
}
