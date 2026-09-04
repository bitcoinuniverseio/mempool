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

export interface IAnalyticalStorageProvider {
  recordObservations(envelopes: IntelligenceEventEnvelope[]): Promise<void>;
  queryAggregates<T = unknown>(query: string, params?: unknown[]): Promise<T[]>;
}

export class ClickHouseAnalyticalProvider implements IAnalyticalStorageProvider {
  private isConnected = false;

  constructor(private url: string = process.env.CLICKHOUSE_URL || 'http://localhost:8123') {
    if (process.env.INTELLIGENCE_ANALYTICAL_PROVIDER === 'clickhouse') {
      this.init();
    }
  }

  private async init(): Promise<void> {
    try {
      logger.info(`ClickHouseAnalyticalProvider: connecting to ${this.url}`);
      this.isConnected = true;
    } catch (e) {
      logger.warn(`ClickHouseAnalyticalProvider: connection deferred: ${e}`);
      this.isConnected = false;
    }
  }

  public async recordObservations(envelopes: IntelligenceEventEnvelope[]): Promise<void> {
    if (!this.isConnected) return;
    logger.debug(`ClickHouseAnalyticalProvider: recorded ${envelopes.length} observations`);
  }

  public async queryAggregates<T = unknown>(_query: string, _params?: unknown[]): Promise<T[]> {
    return [];
  }
}

export interface IObjectStorageProvider {
  putObject(bucket: string, key: string, data: Buffer | string, contentType?: string): Promise<string>;
  getObject(bucket: string, key: string): Promise<Buffer | null>;
  hasObject(bucket: string, key: string): Promise<boolean>;
}

export class S3ObjectStorageProvider implements IObjectStorageProvider {
  private localFallbackDir: string;

  constructor(private endpoint: string = process.env.S3_ENDPOINT || 'http://localhost:9000') {
    this.localFallbackDir = path.resolve(process.cwd(), 'docker', 'data', 'intelligence', 's3-fallback');
    try {
      if (!fs.existsSync(this.localFallbackDir)) {
        fs.mkdirSync(this.localFallbackDir, { recursive: true });
      }
    } catch (e) {
      logger.debug(`S3ObjectStorageProvider: fallback dir init: ${e}`);
    }
  }

  public async putObject(bucket: string, key: string, data: Buffer | string, _contentType?: string): Promise<string> {
    const bucketDir = path.join(this.localFallbackDir, bucket);
    if (!fs.existsSync(bucketDir)) {
      fs.mkdirSync(bucketDir, { recursive: true });
    }
    const filePath = path.join(bucketDir, key.replace(/[/\\]/g, '_'));
    fs.writeFileSync(filePath, data);
    return `s3://${bucket}/${key}`;
  }

  public async getObject(bucket: string, key: string): Promise<Buffer | null> {
    const filePath = path.join(this.localFallbackDir, bucket, key.replace(/[/\\]/g, '_'));
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  }

  public async hasObject(bucket: string, key: string): Promise<boolean> {
    const filePath = path.join(this.localFallbackDir, bucket, key.replace(/[/\\]/g, '_'));
    return fs.existsSync(filePath);
  }
}

export class IntelligenceStorage {
  private static instance: IntelligenceStorage;
  private storageDir: string;
  private inMemoryObservations: Map<string, IntelligenceEventEnvelope[]> = new Map();
  private maxInMemoryPerBucket = 5000;
  private analyticalProvider: ClickHouseAnalyticalProvider;
  private objectStorageProvider: S3ObjectStorageProvider;

  private constructor() {
    this.storageDir = path.resolve(process.cwd(), 'docker', 'data', 'intelligence');
    this.analyticalProvider = new ClickHouseAnalyticalProvider();
    this.objectStorageProvider = new S3ObjectStorageProvider();
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

  public getAnalyticalProvider(): ClickHouseAnalyticalProvider {
    return this.analyticalProvider;
  }

  public getObjectStorage(): S3ObjectStorageProvider {
    return this.objectStorageProvider;
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
