import { randomUUID } from 'crypto';
import {
  TimestampOverview, TimestampCalendar, TimestampBatch, TimestampAnchorTransaction, TimestampVerificationResult,
  TimestampStampResult, TimestampUpgradeResult,
} from './opentimestamps.models';
import config from '../../../config';
import logger from '../../../logger';
import { TimestampEvidenceError } from './opentimestamps-errors';
import { TimestampBitcoinReader, TimestampProofRequest, verifyDetachedProof } from './opentimestamps-proof';
import { CalendarClient, CalendarDirectoryEntry, calendarDirectoryFromEnvironment } from './ots-calendar-client';
import {
  OtsTimestamp, mergeTimestamps, nonceCommitment, parseDetachedProofTree, serializeDetachedProof, walkTimestamp,
} from './ots-timestamp';
import { TimestampRecord, TimestampRecordStore, defaultTimestampRecordStore } from './opentimestamps-store';
export { TimestampEvidenceError } from './opentimestamps-errors';

interface CalendarHealthObservation {
  calendar_id: string;
  health_status: 'online' | 'degraded' | 'offline';
  observed_at: string;
  detail: string;
}

export interface OpenTimestampsServiceOptions {
  reader?: TimestampBitcoinReader;
  network?: string;
  calendars?: CalendarClient;
  store?: TimestampRecordStore;
  now?: () => Date;
  /** How long a stamp must be pending before the service asks calendars about it again. */
  upgradeAfterMs?: number;
  healthProbeTtlMs?: number;
}

/**
 * OpenTimestamps for this deployment.
 *
 * Stamping submits a nonced commitment to every allowlisted calendar and keeps
 * the proof the calendars returned. Upgrading asks those same calendars for the
 * Bitcoin attestation they promised, grafts it into the proof and verifies the
 * result with the owned Bitcoin reader. Overview, anchors and batches are
 * derived from the records this created, and from nothing else: a calendar's
 * own batch and transaction bookkeeping is not visible through its protocol,
 * so nothing here claims to know it.
 */
export class OpenTimestampsService {
  private readonly calendars: CalendarClient;
  private readonly store: TimestampRecordStore;
  private readonly now: () => Date;
  private readonly upgradeAfterMs: number;
  private readonly healthProbeTtlMs: number;
  private health = new Map<string, CalendarHealthObservation>();
  private healthProbedAt = 0;
  private reconciledAt = 0;
  private reconciling: Promise<{ examined: number; anchored: number }> | null = null;

  constructor(private readonly options: OpenTimestampsServiceOptions = {}) {
    this.calendars = options.calendars ?? new CalendarClient(calendarDirectoryFromEnvironment());
    this.store = options.store ?? defaultTimestampRecordStore();
    this.now = options.now ?? (() => new Date());
    this.upgradeAfterMs = options.upgradeAfterMs ?? 30 * 60 * 1000;
    this.healthProbeTtlMs = options.healthProbeTtlMs ?? 60 * 1000;
  }

  private get network(): string {
    return this.options.network ?? config.MEMPOOL.NETWORK;
  }

  /**
   * Every record read or write goes through here so a database that is down
   * answers as an unavailable record store, not as an internal error.
   * @asyncUnsafe The route turns the rejection into an exact HTTP answer.
   */
  private async records<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TimestampEvidenceError) {throw error;}
      logger.warn(`OpenTimestamps record store failed: ${error instanceof Error ? error.message : error}`);
      throw new TimestampEvidenceError('unavailable-record-store', 'Timestamp evidence is unavailable. The timestamp record store did not answer.');
    }
  }

  private get reader(): TimestampBitcoinReader {
    return this.options.reader ?? {
      $getBlockHash: (height: number) => import('../../bitcoin/bitcoin-api-factory').then(module => module.default.$getBlockHash(height)),
      $getBlockHeader: (hash: string) => import('../../bitcoin/bitcoin-api-factory').then(module => module.default.$getBlockHeader(hash)),
    };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getOverview(): Promise<TimestampOverview> {
    this.scheduleReconciliation();
    const [stats, calendars, anchors, recent] = await Promise.all([
      this.records(() => this.store.stats()), this.listCalendars(), this.listAnchors(), this.records(() => this.store.recent(10)),
    ]);
    const active = calendars.calendars.filter(calendar => calendar.health_status !== 'offline');
    return {
      total_active_calendars: active.length,
      total_verified_anchors_count: stats.anchored,
      total_digests_stamped_24h: stats.stamped_24h,
      latest_bitcoin_anchor_height: stats.latest_anchor_height ?? 0,
      active_calendars: active,
      recent_batches: recent.map(toBatch),
      recent_anchors: anchors.anchors.slice(0, 10),
      total_proofs_tracked: stats.total,
      bitcoin_confirmed_proofs: stats.anchored,
      pending_calendar_attestations: stats.pending,
      failed_submissions: stats.failed,
      active_calendar_servers: active.length,
      latest_anchored_block_height: stats.latest_anchor_height,
      network: this.network,
      calendars_configured: this.calendars.configured,
      storage: this.store.kind,
      generated_at: this.now().toISOString(),
    };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async listCalendars(): Promise<{ calendars: TimestampCalendar[] }> {
    await this.probeHealth();
    const [anchored, pending] = await this.recordsForCalendars();
    return { calendars: this.calendars.list().map(entry => this.describeCalendar(entry, anchored, pending)) };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getCalendar(calendarId: string): Promise<TimestampCalendar | undefined> {
    const entry = this.calendars.byId(calendarId);
    if (!entry) {return undefined;}
    await this.probeHealth();
    const [anchored, pending] = await this.recordsForCalendars();
    return this.describeCalendar(entry, anchored, pending);
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  private recordsForCalendars(): Promise<[TimestampRecord[], TimestampRecord[]]> {
    return Promise.all([
      this.records(() => this.store.anchored(200)),
      this.records(() => this.store.pendingForUpgrade(this.now().toISOString(), 500)),
    ]);
  }

  /**
   * Bitcoin blocks that anchored a proof made here, one row per calendar and
   * block. An OpenTimestamps proof commits to a block's Merkle root and does
   * not name the transaction, so no txid is reported. @asyncUnsafe */
  public async listAnchors(): Promise<{ anchors: TimestampAnchorTransaction[] }> {
    this.scheduleReconciliation();
    const records = await this.records(() => this.store.anchored(500));
    const byKey = new Map<string, TimestampAnchorTransaction>();
    for (const record of records) {
      if (record.anchor_block_height === undefined || !record.anchor_block_hash) {continue;}
      for (const contact of record.calendars.filter(contact => contact.status === 'anchored')) {
        const key = `${contact.calendar_id}:${record.anchor_block_height}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.batch_count += 1;
          existing.leaf_count += 1;
          continue;
        }
        byKey.set(key, {
          batch_id: key,
          block_hash: record.anchor_block_hash,
          block_height: record.anchor_block_height,
          block_timestamp_utc: record.anchor_time_utc ?? '',
          anchored_at: record.anchor_time_utc ?? record.updated_at,
          calendar_id: contact.calendar_id,
          batch_count: 1,
          leaf_count: 1,
          merkle_root: record.commitment_hex,
        });
      }
    }
    return { anchors: [...byKey.values()].sort((a, b) => b.block_height - a.block_height) };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async getBatch(batchId: string): Promise<TimestampBatch | undefined> {
    if (typeof batchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(batchId)) {return undefined;}
    const record = await this.records(() => this.store.get(batchId));
    return record ? toBatch(record) : undefined;
  }

  /** Submit a sha256 digest to every allowlisted calendar and keep the proof. @asyncUnsafe */
  public async stampDigest(digestHex: string): Promise<TimestampStampResult> {
    if (typeof digestHex !== 'string' || !/^[0-9a-f]{64}$/i.test(digestHex)) {
      throw new TimestampEvidenceError('invalid-input', 'A 32-byte SHA256 digest in hexadecimal is required.', 400);
    }
    this.requireCalendars();
    const digest = Buffer.from(digestHex.toLowerCase(), 'hex');
    const { commitment, timestamp } = nonceCommitment(digest);
    const leaf = timestamp.operations[0].result.operations[0].result;
    const submittedAt = this.now().toISOString();
    const contacts: TimestampRecord['calendars'] = [];
    const answers = await Promise.all(this.calendars.list().map(async entry => {
      try {
        const answer = await this.calendars.submit(entry, commitment);
        contacts.push({ calendar_id: entry.calendar_id, url: entry.url, status: 'pending', contacted_at: this.now().toISOString() });
        this.observeHealth(entry, 'online', 'accepted a digest submission');
        return answer;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        contacts.push({ calendar_id: entry.calendar_id, url: entry.url, status: 'unreachable', contacted_at: this.now().toISOString(), error: message });
        this.observeHealth(entry, 'offline', message);
        return null;
      }
    }));
    const accepted = answers.filter((answer): answer is OtsTimestamp => answer !== null);
    if (!accepted.length) {
      throw new TimestampEvidenceError('calendar-unreachable', `No allowlisted calendar accepted the digest: ${contacts.map(contact => `${contact.calendar_id} (${contact.error})`).join('; ')}. No proof was created.`);
    }
    for (const answer of accepted) {mergeTimestamps(leaf, answer);}
    const proof = serializeDetachedProof(digest, timestamp);
    const record: TimestampRecord = {
      record_id: randomUUID(), digest_hex: digestHex.toLowerCase(), algorithm: 'sha256', network: this.network,
      commitment_hex: commitment.toString('hex'), proof_base64: proof.toString('base64'), status: 'pending',
      calendars: contacts, submitted_at: submittedAt, updated_at: submittedAt,
    };
    await this.records(() => this.store.insert(record));
    return {
      record_id: record.record_id, batch_id: record.record_id, digest: record.digest_hex, network: record.network,
      commitment: record.commitment_hex, ots_proof_base64: record.proof_base64, status: 'pending',
      calendars_contacted: contacts.map(contact => ({ calendar_id: contact.calendar_id, url: contact.url, status: contact.status === 'unreachable' ? 'unreachable' as const : 'pending' as const, error: contact.error })),
      timestamp: submittedAt,
      notices: [
        'The calendars have promised a Bitcoin attestation and have not yet made one. Upgrade this proof after the calendars have anchored, typically within a few hours.',
        ...(contacts.some(contact => contact.status === 'unreachable') ? ['At least one allowlisted calendar did not accept the submission; the proof carries the calendars that did.'] : []),
      ],
    };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  public async verifyProof(proofPayload: TimestampProofRequest): Promise<TimestampVerificationResult> {
    this.requireProof(proofPayload);
    return verifyDetachedProof(proofPayload, this.reader, this.network);
  }

  /**
   * Replace pending calendar promises in a proof with the attestations those
   * calendars now hold, then verify the result. Only allowlisted calendars are
   * contacted; a promise from any other host stays in the proof untouched and
   * is reported as unreachable. @asyncUnsafe */
  public async upgradeProof(proofData: { ots_proof?: string; proof?: string; digest?: string; network?: string }): Promise<TimestampUpgradeResult> {
    this.requireProof(proofData);
    const encoded = (proofData.ots_proof ?? proofData.proof ?? '').replace(/[ \t\r\n]/g, '');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) || !encoded) {
      throw new TimestampEvidenceError('invalid-proof', 'The .ots proof is not valid base64.', 400);
    }
    const bytes = Buffer.from(encoded, 'base64');
    const parsed = parseDetachedProofTree(bytes);
    const before = bytes.toString('base64');
    const outcome = await this.upgradeTree(parsed.timestamp);
    const upgradedBytes = serializeDetachedProof(parsed.digest, parsed.timestamp);
    const request: TimestampProofRequest = { ots_proof: upgradedBytes.toString('base64') };
    if (proofData.digest !== undefined) {request.digest = proofData.digest;}
    if (proofData.network !== undefined) {request.network = proofData.network;}
    const verification = await verifyDetachedProof(request, this.reader, this.network);
    const calendars = settleCalendars(outcome.calendars, verification.verified);
    if (parsed.algorithm === 'sha256') {
      for (const record of await this.records(() => this.store.findByDigest(parsed.digest.toString('hex'), this.network))) {
        if (record.status === 'pending' && verification.verified) {
          await this.markAnchored(record, request.ots_proof as string, verification, calendars);
        }
      }
    }
    return {
      upgraded: outcome.upgraded,
      changed: request.ots_proof !== before,
      ots_proof_base64: request.ots_proof as string,
      status: verification.status,
      verified: verification.verified,
      verification,
      calendars,
      notices: outcome.notices,
    };
  }

  /**
   * Run reconciliation once in the background. A read that triggers it
   * answers from the records as they are, so a slow calendar can never hold
   * an overview past the gateway's deadline; the next read sees the result.
   */
  private scheduleReconciliation(): void {
    if (this.reconciling) {return;}
    this.reconciling = this.reconcilePending().catch(error => {
      logger.warn(`OpenTimestamps reconciliation failed: ${error instanceof Error ? error.message : error}`);
      return { examined: 0, anchored: 0 };
    }).finally(() => { this.reconciling = null; });
  }

  private requireCalendars(): void {
    if (!this.calendars.configured) {
      throw new TimestampEvidenceError('unconfigured-calendar', 'Stamping is unavailable. This deployment names no OpenTimestamps calendar for its network (UNIVERSE_OPENTIMESTAMPS_CALENDARS), and no public calendar is substituted.');
    }
  }

  /**
   * Ask calendars about stamps that have waited long enough. Bounded so a read
   * never turns into a crawl: a handful of records, at most once every few
   * minutes, and each calendar call has its own deadline. @asyncUnsafe */
  public async reconcilePending(): Promise<{ examined: number; anchored: number }> {
    const nowMs = this.now().getTime();
    if (nowMs - this.reconciledAt < 5 * 60 * 1000) {return { examined: 0, anchored: 0 };}
    this.reconciledAt = nowMs;
    const olderThan = new Date(nowMs - this.upgradeAfterMs).toISOString();
    let examined = 0;
    let anchored = 0;
    let pending: TimestampRecord[];
    try {
      pending = await this.store.pendingForUpgrade(olderThan, 10);
    } catch (error) {
      logger.warn(`OpenTimestamps reconciliation could not read pending records: ${error instanceof Error ? error.message : error}`);
      return { examined, anchored };
    }
    for (const record of pending) {
      examined += 1;
      try {
        const tree = parseDetachedProofTree(Buffer.from(record.proof_base64, 'base64'));
        const outcome = await this.upgradeTree(tree.timestamp);
        record.last_upgrade_attempt_at = this.now().toISOString();
        if (outcome.upgraded) {
          const proof = serializeDetachedProof(tree.digest, tree.timestamp).toString('base64');
          const verification = await verifyDetachedProof({ ots_proof: proof }, this.reader, this.network);
          if (verification.verified) {
            await this.markAnchored(record, proof, verification, settleCalendars(outcome.calendars, true));
            anchored += 1;
            continue;
          }
          record.proof_base64 = proof;
        }
        record.updated_at = this.now().toISOString();
        await this.store.update(record);
      } catch (error) {
        record.last_error = error instanceof Error ? error.message : String(error);
        record.last_upgrade_attempt_at = this.now().toISOString();
        record.updated_at = record.last_upgrade_attempt_at;
        await this.store.update(record).catch(() => undefined);
      }
    }
    return { examined, anchored };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  private async upgradeTree(root: OtsTimestamp): Promise<{ upgraded: boolean; calendars: TimestampUpgradeResult['calendars']; notices: string[] }> {
    const targets: { node: OtsTimestamp; uri: string; entry: CalendarDirectoryEntry | undefined }[] = [];
    walkTimestamp(root, node => {
      for (const attestation of node.attestations) {
        if (attestation.kind === 'pending') {targets.push({ node, uri: attestation.uri, entry: this.calendars.match(attestation.uri) });}
      }
    });
    const calendars: TimestampUpgradeResult['calendars'] = [];
    const notices: string[] = [];
    let upgraded = false;
    if (!targets.length) {notices.push('The proof carries no pending calendar attestation to upgrade.');}
    for (const target of targets) {
      if (!target.entry) {
        calendars.push({ calendar_url: target.uri, status: 'unreachable', detail: 'not on the calendar allowlist; not contacted' });
        continue;
      }
      try {
        const answer = await this.calendars.upgrade(target.entry, target.node.message);
        if (!answer) {
          calendars.push({ calendar_id: target.entry.calendar_id, calendar_url: target.uri, status: 'pending', detail: 'the calendar has not anchored this commitment yet' });
          this.observeHealth(target.entry, 'online', 'answered an upgrade request');
          continue;
        }
        target.node.attestations = target.node.attestations.filter(attestation => !(attestation.kind === 'pending' && attestation.uri === target.uri));
        mergeTimestamps(target.node, answer);
        upgraded = true;
        // The attestation is in the proof now; whether it holds is the verifier's answer, not the calendar's.
        calendars.push({ calendar_id: target.entry.calendar_id, calendar_url: target.uri, status: 'upgraded', detail: 'returned a Bitcoin attestation, not yet verified' });
        this.observeHealth(target.entry, 'online', 'returned an attestation');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        calendars.push({ calendar_id: target.entry.calendar_id, calendar_url: target.uri, status: 'unreachable', detail: message });
        this.observeHealth(target.entry, 'offline', message);
      }
    }
    return { upgraded, calendars, notices };
  }

  /** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
  private async markAnchored(record: TimestampRecord, proof: string, verification: TimestampVerificationResult, calendars: TimestampUpgradeResult['calendars']): Promise<void> {
    record.proof_base64 = proof;
    record.status = 'anchored';
    record.anchor_block_height = verification.earliest_proven_block_height;
    record.anchor_block_hash = verification.bitcoin_block_hash;
    record.anchor_time_utc = verification.earliest_proven_time_utc;
    record.updated_at = this.now().toISOString();
    record.last_upgrade_attempt_at = record.updated_at;
    delete record.last_error;
    for (const contact of record.calendars) {
      const outcome = calendars.find(calendar => calendar.calendar_id === contact.calendar_id);
      if (outcome?.status === 'verified') {contact.status = 'anchored';}
    }
    await this.records(() => this.store.update(record));
  }

  /** A calendar answers 404 for a commitment it never saw; that answer proves reachability without a side effect. @asyncUnsafe */
  private async probeHealth(): Promise<void> {
    const nowMs = this.now().getTime();
    if (nowMs - this.healthProbedAt < this.healthProbeTtlMs) {return;}
    this.healthProbedAt = nowMs;
    await Promise.all(this.calendars.list().map(async entry => {
      try {
        await this.calendars.upgrade(entry, Buffer.alloc(32));
        this.observeHealth(entry, 'online', 'answered a reachability probe');
      } catch (error) {
        this.observeHealth(entry, 'offline', error instanceof Error ? error.message : String(error));
      }
    }));
  }

  private observeHealth(entry: CalendarDirectoryEntry, health: 'online' | 'offline', detail: string): void {
    this.health.set(entry.calendar_id, { calendar_id: entry.calendar_id, health_status: health, observed_at: this.now().toISOString(), detail });
  }

  private describeCalendar(entry: CalendarDirectoryEntry, anchored: TimestampRecord[], pending: TimestampRecord[]): TimestampCalendar {
    const observation = this.health.get(entry.calendar_id);
    const mine = anchored.filter(record => record.calendars.some(contact => contact.calendar_id === entry.calendar_id && contact.status === 'anchored'));
    const promised = pending.filter(record => record.calendars.some(contact => contact.calendar_id === entry.calendar_id && contact.status === 'pending'));
    const latest = mine.reduce<TimestampRecord | null>((best, record) => (!best || (record.anchor_block_height ?? 0) > (best.anchor_block_height ?? 0)) ? record : best, null);
    return {
      calendar_id: entry.calendar_id,
      name: entry.name,
      url: entry.url,
      protocol_revision: 'opentimestamps-calendar-v1',
      health_status: observation?.health_status ?? 'degraded',
      health_observed_at: observation?.observed_at ?? null,
      health_detail: observation?.detail ?? 'not yet observed',
      pending_attestations_count: promised.length,
      anchored_proofs_count: mine.length,
      average_anchor_lag_blocks: null,
      last_anchor_block_height: latest?.anchor_block_height ?? null,
      last_anchor_txid: null,
      mirror_calendars: [],
    };
  }

  private requireProof(value: { ots_proof?: string; proof?: string }): void {
    const proof = value?.ots_proof ?? value?.proof;
    if (typeof proof !== 'string' || proof.trim().length === 0) {
      throw new TimestampEvidenceError('invalid-input', 'A nonempty .ots proof is required.', 400);
    }
  }
}

/**
 * A calendar's contribution is `verified` only once the whole upgraded proof
 * verified against the owned reader; verification checks every Bitcoin
 * attestation in the proof, so a failure leaves each contribution at `upgraded`.
 */
function settleCalendars(calendars: TimestampUpgradeResult['calendars'], verified: boolean): TimestampUpgradeResult['calendars'] {
  return calendars.map(calendar => calendar.status === 'upgraded' && verified
    ? { ...calendar, status: 'verified' as const, detail: 'returned its Bitcoin attestation, verified against the owned reader' }
    : calendar);
}

function toBatch(record: TimestampRecord): TimestampBatch {
  return {
    batch_id: record.record_id,
    calendar_id: record.calendars.filter(contact => contact.status !== 'unreachable').map(contact => contact.calendar_id).join(','),
    merkle_root: record.commitment_hex,
    leaf_count: 1,
    created_at_utc: record.submitted_at,
    anchor_block_height: record.anchor_block_height,
    anchor_block_hash: record.anchor_block_hash,
    status: record.status,
    digest: record.digest_hex,
    network: record.network,
    last_error: record.last_error,
  };
}

/**
 * Built on first use, so the calendar allowlist and the record store are read
 * when the process is configured rather than when this module is imported.
 */
let instance: OpenTimestampsService | undefined;
const lazy = new Proxy({} as OpenTimestampsService, {
  get(_target, property: keyof OpenTimestampsService) {
    instance ??= new OpenTimestampsService();
    const value = instance[property];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});
export default lazy;
