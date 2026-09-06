import { createHash } from 'crypto';
import DB from '../../../database';
import config from '../../../config';
import { SwapContext, SwapSourceContext } from './swaps.models';

const hashPayload = (payload: object): string => createHash('sha256')
  .update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');

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
    return rows.map(row => {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (payload.chain !== context.chain || payload.network !== context.network ||
          hashPayload(payload) !== row.payload_hash) {
        throw new Error('Stored observation identity or payload integrity mismatch.');
      }
      return { ...payload, payload_hash: row.payload_hash };
    });
  }
}
