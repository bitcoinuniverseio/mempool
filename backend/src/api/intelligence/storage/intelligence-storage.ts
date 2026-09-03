import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import logger from '../../../logger';
import DB from '../../../database';
import config from '../../../config';
import { IntelligenceEventEnvelope } from '../events/event-envelope';

export interface StorageCheckpointManifest {
  checkpoint_id: string;
  network: string;
  block_height: number;
  block_hash: string;
  timestamp_utc: string;
  tx_count: number;
  total_weight: number;
  total_fee_sats: number;
  state_hash: string;
  archive_url?: string;
  manifest_checksum: string;
}

export interface MetricTimeSeriesPoint {
  timestamp_sec: number;
  value: number;
  count?: number;
}

export class IntelligenceStorage {
  private static instance: IntelligenceStorage;
  private storageDir: string;
  private inMemoryObservations: Map<string, IntelligenceEventEnvelope[]> = new Map();
  private maxInMemoryPerBucket = 5000;

  private constructor() {
    this.storageDir = path.resolve(process.cwd(), 'docker', 'data', 'intelligence');
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (e) {
      logger.debug(`IntelligenceStorage: local storage dir setup: ${e}`);
    }
  }

  public static getInstance(): IntelligenceStorage {
    if (!IntelligenceStorage.instance) {
      IntelligenceStorage.instance = new IntelligenceStorage();
    }
    return IntelligenceStorage.instance;
  }

  public async recordObservation(envelope: IntelligenceEventEnvelope): Promise<void> {
    const bucket = `${envelope.network}:${envelope.entity_type}`;
    let list = this.inMemoryObservations.get(bucket);
    if (!list) {
      list = [];
      this.inMemoryObservations.set(bucket, list);
    }
    list.push(envelope);
    if (list.length > this.maxInMemoryPerBucket) {
      list.shift();
    }

    if (config.DATABASE.ENABLED) {
      try {
        await DB.query(
          `INSERT INTO intelligence_events (
            event_id, schema_version, event_type, network, source_id,
            source_sequence, observed_at, ingested_at, entity_type,
            entity_id, correlation_id, payload, payload_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE payload_hash = VALUES(payload_hash)`,
          [
            envelope.event_id,
            envelope.schema_version,
            envelope.event_type,
            envelope.network,
            envelope.source_id,
            envelope.source_sequence,
            envelope.observed_at_utc,
            envelope.ingested_at_utc,
            envelope.entity_type,
            envelope.entity_id,
            envelope.correlation_id,
            JSON.stringify(envelope.payload),
            envelope.payload_hash,
          ],
          'silent'
        );
      } catch (err) {
        logger.debug(`IntelligenceStorage: DB record observation deferred: ${err}`);
      }
    }
  }

  public getRecentObservations(
    network: string,
    entityType: string,
    limit = 100
  ): IntelligenceEventEnvelope[] {
    const bucket = `${network}:${entityType}`;
    const list = this.inMemoryObservations.get(bucket) || [];
    return list.slice(-limit).reverse();
  }

  public async saveCheckpoint(manifest: StorageCheckpointManifest): Promise<string> {
    const serialized = JSON.stringify(manifest, null, 2);
    const filename = `checkpoint-${manifest.network}-${manifest.block_height}-${manifest.checkpoint_id}.json`;
    const filePath = path.join(this.storageDir, filename);

    try {
      fs.writeFileSync(filePath, serialized, 'utf-8');
    } catch (e) {
      logger.debug(`IntelligenceStorage: File write checkpoint: ${e}`);
    }

    if (config.DATABASE.ENABLED) {
      try {
        await DB.query(
          `INSERT INTO intelligence_checkpoints (
            checkpoint_id, network, block_height, block_hash, timestamp_utc,
            tx_count, total_weight, total_fee_sats, state_hash, manifest_checksum
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE state_hash = VALUES(state_hash)`,
          [
            manifest.checkpoint_id,
            manifest.network,
            manifest.block_height,
            manifest.block_hash,
            manifest.timestamp_utc,
            manifest.tx_count,
            manifest.total_weight,
            manifest.total_fee_sats,
            manifest.state_hash,
            manifest.manifest_checksum,
          ],
          'silent'
        );
      } catch (err) {
        logger.debug(`IntelligenceStorage: DB checkpoint deferred: ${err}`);
      }
    }

    return filePath;
  }

  public getCheckpoint(checkpointId: string): StorageCheckpointManifest | null {
    try {
      const files = fs.readdirSync(this.storageDir);
      const match = files.find((f) => f.includes(checkpointId));
      if (match) {
        const content = fs.readFileSync(path.join(this.storageDir, match), 'utf-8');
        return JSON.parse(content) as StorageCheckpointManifest;
      }
    } catch (e) {
      logger.debug(`IntelligenceStorage: Read checkpoint: ${e}`);
    }
    return null;
  }
}

export const intelligenceStorage = IntelligenceStorage.getInstance();
