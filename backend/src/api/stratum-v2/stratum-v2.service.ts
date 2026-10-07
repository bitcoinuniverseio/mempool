import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Sv2Acquisition, Sv2Source } from './stratum-v2.native-types';
import { configuredSv2Source } from './stratum-v2.source';
import { StratumV2EvidenceError } from './stratum-v2.evidence';
import { StratumV2JobDeclaration, StratumV2RoleStatus, StratumV2Template, Sv2Family, Sv2Page, Sv2Query } from './stratum-v2.types';
export { StratumV2EvidenceError } from './stratum-v2.evidence';
interface Capture { id: string; acquired: Sv2Acquisition; createdAt: number; }
const conflict = (): StratumV2EvidenceError => new StratumV2EvidenceError('sv2-cursor-invalidated', 'The captured SV2 source page expired or its epoch/checkpoint changed. Start a fresh read.', 409);
const input = (): StratumV2EvidenceError => new StratumV2EvidenceError('invalid-sv2-selector', 'SV2 selectors must be scalar supported network, limit 1..100 and a valid source-bound cursor.', 400);
/** Public observations of authenticated native roles and accepted message links. */
export class StratumV2Service {
  private readonly captures = new Map<string, Capture>();
  private readonly cursorKey = randomBytes(32);
  private readonly highwater = new Map<string, bigint>();
  private pending = 0;
  constructor(private readonly source: () => Sv2Source = configuredSv2Source, private readonly now = Date.now) {}
  /* IMPLEMENTATION-HANDOFF [WP-BE-011]
   * Authenticated operator-selected native snapshots supply bounded role,
   * template and accepted declaration observations. Profiles, exact header,
   * source epoch/generation, raw-body MAC and deadlines fail closed.
   * Remaining value is distinct from unobserved total coinbase; unknown
   * transaction lists, fees, weight, latency and mining outcomes remain null.
   * Pagination retains at most eight 1MiB captures for 30 seconds; every
   * continuation reacquires source evidence and rejects epoch/checkpoint
   * movement. A consumed or expired capture requires an explicit new read.
   * Acceptance remains pending actual source-to-API-to-UI negotiation,
   * template update, rejection, prevhash, disconnect, replay and restart
   * journeys on the independently qualified Signet or justified SV2 regtest
   * source. Controlled tests and isolated native roles are scoped evidence.
   * Rollback preserves native observation journals and source commitments;
   * unrelated operated mining roles and jobs are outside this reader.
   */

  private values(family: Sv2Family, acquired: Sv2Acquisition): any[] {
    const snapshot = acquired.snapshot;
    if (family === 'roles') return snapshot.roles;
    if (family === 'templates') return snapshot.links.map(link => {
      const previousBlockHash = Buffer.from(link.prevHashLE, 'hex').reverse().toString('hex');
      return { eventId: link.eventId, templateId: link.templateIdAtomic, channelId: link.channelIdAtomic, blockHeight: null,
        coinbaseValueRemainingSats: link.coinbaseValueRemainingSats, coinbaseTxValueSats: null, declaredTxCount: link.transactionCountAtomic,
        poolSelectedTxCount: null, feeRateDeltaSatVb: null, totalWeight: null, previousBlockHash,
        status: previousBlockHash === snapshot.core.checkpoint.blockHash ? 'observed-current' : 'unverified-history', observedAt: link.observedAt, generatedAt: null };
    });
    return snapshot.links.map(link => ({ eventId: link.eventId, jobId: link.jobIdAtomic, templateId: link.templateIdAtomic,
      requestId: link.requestIdAtomic, channelId: link.channelIdAtomic, minerDeclaredTxids: null, poolModifiedTxids: null,
      acceptedByPool: true, latencyMs: null, declarationObservedAt: link.declarationSuccess.observedAt, acceptanceObservedAt: link.observedAt }));
  }
  private encode(capture: Capture, family: Sv2Family, offset: number): string {
    const snapshot = capture.acquired.snapshot;
    const payload = Buffer.from(JSON.stringify({ id: capture.id, family, offset, profile: snapshot.profileSha256, epoch: snapshot.sourceEpoch,
      generation: snapshot.sourceGenerationAtomic, raw: capture.acquired.rawSha256 })).toString('base64url');
    return payload + '.' + createHmac('sha256', this.cursorKey).update(payload).digest('hex');
  }
  private decode(token: string, family: Sv2Family): { capture: Capture; offset: number } {
    try {
      if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(token)) throw input();
      const [payload, mac] = token.split('.');
      if (!timingSafeEqual(Buffer.from(mac, 'hex'), createHmac('sha256', this.cursorKey).update(payload).digest())) throw input();
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), capture = this.captures.get(parsed.id);
      if (!capture) throw conflict();
      if (parsed.family !== family || !Number.isInteger(parsed.offset) || parsed.offset < 1 || parsed.offset >= this.values(family, capture.acquired).length || token !== this.encode(capture, family, parsed.offset)) throw input();
      return { capture, offset: parsed.offset };
    } catch (error) { if (error instanceof StratumV2EvidenceError) throw error; throw input(); }
  }
  /** Every continuation performs a fresh authenticated source fence. @asyncSafe */
  async $getPage<T>(family: Sv2Family, query: Sv2Query = {}, signal?: AbortSignal): Promise<Sv2Page<T>> {
    if (query.network !== undefined && (typeof query.network !== 'string' || !['signet', 'regtest'].includes(query.network))) throw input();
    if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(query.limit))) throw input();
    if (query.cursor !== undefined && typeof query.cursor !== 'string') throw input();
    const limit = query.limit === undefined ? 100 : Number(query.limit), now = this.now();
    for (const [id, capture] of this.captures) if (now - capture.createdAt >= 30000 || now < capture.createdAt) this.captures.delete(id);
    const continuation = query.cursor === undefined ? null : this.decode(query.cursor as string, family);
    if (this.pending >= 8 || !continuation && this.captures.size + this.pending >= 8) throw new StratumV2EvidenceError('sv2-reader-capacity', 'The bounded SV2 reader is at capacity. Retry after captured pages expire.', 429);
    this.pending++;
    const controller = new AbortController(), abort = (): void => controller.abort(), timer = setTimeout(abort, 15000);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    try {
      if (controller.signal.aborted) throw new StratumV2EvidenceError('sv2-source-deadline', 'The SV2 observation was cancelled.', 504);
      const fresh = await this.source().read(controller.signal);
      if (controller.signal.aborted) throw new StratumV2EvidenceError('sv2-source-deadline', 'The SV2 observation exceeded its deadline.', 504);
      if (query.network !== undefined && query.network !== fresh.snapshot.profile.network) throw input();
      const sourceKey = fresh.snapshot.profileSha256 + ':' + fresh.snapshot.sourceEpoch, generation = BigInt(fresh.snapshot.sourceGenerationAtomic);
      const priorGeneration = this.highwater.get(sourceKey);
      if (priorGeneration !== undefined && generation < priorGeneration) throw new StratumV2EvidenceError('sv2-generation-regressed', 'The authenticated SV2 source generation moved backwards.');
      this.highwater.delete(sourceKey); this.highwater.set(sourceKey, generation);
      if (this.highwater.size > 8) this.highwater.delete(this.highwater.keys().next().value!);
      let capture: Capture, offset = 0;
      if (continuation) {
        capture = continuation.capture; offset = continuation.offset;
        const old = capture.acquired.snapshot, current = fresh.snapshot;
        if (this.now() - capture.createdAt >= 30000 || current.profileSha256 !== old.profileSha256 || current.sourceEpoch !== old.sourceEpoch ||
          BigInt(current.sourceGenerationAtomic) < BigInt(old.sourceGenerationAtomic) || current.core.checkpoint.blockHash !== old.core.checkpoint.blockHash ||
          current.core.checkpoint.heightAtomic !== old.core.checkpoint.heightAtomic) { this.captures.delete(capture.id); throw conflict(); }
      } else {
        if (fresh.bytes > 1048576 || [...this.captures.values()].reduce((sum, item) => sum + item.acquired.bytes, 0) + fresh.bytes > 8 * 1048576) throw new StratumV2EvidenceError('sv2-reader-capacity', 'The bounded SV2 reader byte capacity is exhausted.', 429);
        capture = { id: randomBytes(16).toString('hex'), acquired: fresh, createdAt: this.now() };
      }
      const snapshot = capture.acquired.snapshot, values = this.values(family, capture.acquired);
      const hasMore = offset + limit < values.length;
      if (hasMore) this.captures.set(capture.id, capture); else this.captures.delete(capture.id);
      return { schemaVersion: 'universe-sv2-observatory-v1', source: { profile: snapshot.profile, profileSha256: snapshot.profileSha256,
        sourceEpoch: snapshot.sourceEpoch, sourceGenerationAtomic: snapshot.sourceGenerationAtomic, observedAt: snapshot.observedAt,
        core: snapshot.core, retention: snapshot.retention, rawSnapshotSha256: capture.acquired.rawSha256, latestVerifiedAt: fresh.snapshot.observedAt },
        items: values.slice(offset, offset + limit), total: values.length, totalScope: 'captured-retained-observations', completeHistory: false,
        nextCursor: hasMore ? this.encode(capture, family, offset + limit) : null };
    } finally { this.pending--; clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async $getRoles(): Promise<StratumV2RoleStatus[]> { return (await this.$getPage<StratumV2RoleStatus>('roles')).items; }
  async $getTemplates(): Promise<StratumV2Template[]> { return (await this.$getPage<StratumV2Template>('templates')).items; }
  async $getDeclarations(): Promise<StratumV2JobDeclaration[]> { return (await this.$getPage<StratumV2JobDeclaration>('declarations')).items; }
}
export const stratumV2Service = new StratumV2Service();
