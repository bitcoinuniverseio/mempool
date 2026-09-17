import config from '../../config';
import memPool from '../mempool';
import { RELAY_LIMITS, RelayEvidenceError, relayCollectorService, RelayCollectorService, TransactionRelayLifecycle } from '../intelligence/relay/relay-collector.service';
import { TEMPLATE_LIMITS, templateCollectorService, TemplateCollectorService } from '../intelligence/templates/template-collector.service';
import {
  BlockTemplateComparison,
  CandidateTemplate,
  NodeArrival,
  ObservationWindow,
  ObserverIdentity,
  ObserverNode,
  PropagationObservation,
} from './network-observatory.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class NetworkObservatoryEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

/** The owned telemetry this deployment has; injectable for tests. */
export interface ObservatoryReaders {
  relay: Pick<RelayCollectorService, 'getOverview' | 'getPropagationForTx'>;
  templates: Pick<TemplateCollectorService, 'getSources' | 'getTemplatesForHeight'>;
  /** The local mempool's txids, or null when the mempool is not enabled here. */
  localMempoolTxids: () => Set<string> | null;
}

type RelayOverview = Awaited<ReturnType<RelayCollectorService['getOverview']>>;

const SCOPE =
  'One observer: this backend\'s mempool poll of its owned Bitcoin Core node. Detection time is local poll time, not peer arrival time. Regions, clock offsets, inter-node latency and multi-observer propagation are not measured and are reported as null or unknown.';

/**
 * Observer, propagation and block-template evidence, read from the owned
 * telemetry this backend already collects: the relay collector's first-seen
 * mempool poll lifecycles and the template collector's candidate templates.
 *
 * The revision this replaces threw for every read; the one before that
 * answered from constants (four nodes in four regions, a timeline computed
 * from the request clock, three pool templates nobody had polled). This one
 * answers with what one local observer has actually recorded and labels it
 * as exactly that.
 */
export class NetworkObservatoryService {
  constructor(private readonly readers: ObservatoryReaders = {
    relay: relayCollectorService,
    templates: templateCollectorService,
    localMempoolTxids: () => (config.MEMPOOL.ENABLED ? new Set(Object.keys(memPool.getMempool())) : null),

  }) {}

  /** @asyncSafe Every rejection is translated to the typed error. */
  private async overview(): Promise<RelayOverview> {
    try {
      return await this.readers.relay.getOverview();
    } catch (e) {
      if (e instanceof RelayEvidenceError) {
        throw new NetworkObservatoryEvidenceError(e.code, e.message, e.status);
      }
      throw new NetworkObservatoryEvidenceError('unavailable-owned-node', 'The owned node observation could not be read: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private identity(overview: RelayOverview): ObserverIdentity {
    return {
      observerId: overview.collection.observer_id,
      observers: 1,
      clockOffsetMs: null,
      clockUncertaintyMs: null,
      method: overview.source.method,
    };
  }

  private window(overview: RelayOverview): ObservationWindow {
    return {
      observedAtUtc: overview.source.observed_at_utc,
      ageMs: overview.source.age_ms,
      freshnessLimitMs: overview.source.freshness_limit_ms,
      retentionMs: RELAY_LIMITS.retentionMs,
      retainedTransactions: overview.collection.retained_transactions,
      lastPollUtc: overview.collection.last_poll_utc,
      lastCompletePollUtc: overview.collection.last_complete_poll_utc,
      collection: overview.collection.status as ObservationWindow['collection'],
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async $getNodes(): Promise<ObserverNode[]> {
    const overview = await this.overview();
    const local = this.readers.localMempoolTxids();
    return overview.sensors.map(sensor => ({
      id: sensor.id,
      name: sensor.name,
      region: 'unknown',
      clientVersion: sensor.client_version,
      protocolVersion: sensor.protocol_version,
      fullRbf: sensor.full_rbf,
      minRelayFeeRate: sensor.min_relay_feerate,
      clockOffsetMs: null,
      connectedPeers: sensor.connected_peers_count,
      mempoolTxCount: local ? local.size : null,
      status: overview.collection.status === 'observing' ? 'online' : 'degraded',
      network: sensor.network,
      observedAtUtc: sensor.last_heartbeat,
      policySourceAvailable: sensor.policy_source_available,
      scope: SCOPE,
    }));
  }

  private arrivals(record: TransactionRelayLifecycle, observerName: string): NodeArrival[] {
    const first = Date.parse(record.first_observed_utc);
    return record.events.map(event => ({
      nodeId: event.source_id,
      nodeName: observerName,
      arrivedAt: Date.parse(event.observed_at_utc),
      deltaFromFirstMs: Math.max(0, Date.parse(event.observed_at_utc) - first),
      accepted: event.payload.presence === 'present',
      presence: event.payload.presence,
      completePoll: event.payload.complete_poll,
      previousCompletePollUtc: event.payload.previous_complete_poll_utc,
    }));
  }

  /**
   * The lifecycle of one transaction as this observer saw it, or the most
   * recently observed one when no txid is given. A transaction this
   * observer never retained is 'not-observed'; an observer that has not
   * polled yet is 'no-observations'. Neither is invented.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  public async $getPropagation(txid?: string): Promise<PropagationObservation> {
    const overview = await this.overview();
    const observer = this.identity(overview);
    const window = this.window(overview);
    const base = { network: config.MEMPOOL.NETWORK, observer, window, medianLatencyMs: null, p95LatencyMs: null, spreadDeltaMs: null, scope: SCOPE } as const;
    let record: TransactionRelayLifecycle | null = null;
    if (txid !== undefined) {
      try {
        record = this.readers.relay.getPropagationForTx(txid);
      } catch (e) {
        if (e instanceof RelayEvidenceError && e.code === 'transaction-not-observed') {
          return { ...base, txid: txid.toLowerCase(), state: 'not-observed', firstSeenTimestamp: null, lastSeenTimestamp: null, nodeObservations: [], expiresAtUtc: null };
        }
        if (e instanceof RelayEvidenceError) { throw new NetworkObservatoryEvidenceError(e.code, e.message, e.status); }
        throw e;
      }
    } else {
      record = overview.recent_propagation_sample[0] ?? null;
      if (!record) {
        return { ...base, txid: null, state: 'no-observations', firstSeenTimestamp: null, lastSeenTimestamp: null, nodeObservations: [], expiresAtUtc: null };
      }
    }
    const observerName = overview.sensors[0]?.name ?? 'Owned Bitcoin Core node';
    return {
      ...base,
      txid: record.txid,
      state: 'observed',
      firstSeenTimestamp: Date.parse(record.first_observed_utc),
      lastSeenTimestamp: Date.parse(record.last_observed_utc),
      nodeObservations: this.arrivals(record, observerName),
      expiresAtUtc: record.retention.expires_at_utc,
    };
  }

  /**
   * The candidate templates recorded for the latest height, compared with
   * each other and with the local mempool. A deployment whose collector has
   * not recorded a template yet says so rather than listing none.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  public async $getTemplates(): Promise<BlockTemplateComparison> {
    const sources = this.readers.templates.getSources().map(source => ({
      sourceId: source.source_id, name: source.name, status: source.status, lastTemplateAt: source.last_template_at, lastError: source.last_error,
    }));
    const observer: ObserverIdentity = {
      observerId: 'owned-template-collector-' + config.MEMPOOL.NETWORK,
      observers: 1,
      clockOffsetMs: null,
      clockUncertaintyMs: null,
      method: 'owned Core getblocktemplate on a cold schedule and this backend\'s next-block projection',
    };
    const retention = { templates: TEMPLATE_LIMITS.templates, txidsPerTemplate: TEMPLATE_LIMITS.txidsInResponse };
    const scope = 'Templates from the owned Core node and this backend\'s projection only; no pool template is observed. Fee-rate spread across pools is not measured.';
    const all = this.readers.templates.getTemplatesForHeight();
    if (!all.length) {
      return { network: config.MEMPOOL.NETWORK, state: 'no-templates-observed', blockHeight: null, generatedAt: null, candidateTemplates: [], consensusMempoolTxCount: null, missingFromLocalCount: null, feeRateSpreadSatVb: null, sources, observer, retention, scope };
    }
    const height = Math.max(...all.map(template => template.height));
    // The latest template per source at the latest height; older heights are history, not candidates.
    const latestBySource = new Map<string, (typeof all)[number]>();
    for (const template of all) {
      if (template.height !== height) { continue; }
      const previous = latestBySource.get(template.source_id);
      if (!previous || Date.parse(template.observed_at_utc) >= Date.parse(previous.observed_at_utc)) { latestBySource.set(template.source_id, template); }
    }
    const candidates = [...latestBySource.values()];
    const local = this.readers.localMempoolTxids();
    const counts = new Map<string, number>();
    for (const template of candidates) { for (const id of template.txids) { counts.set(id, (counts.get(id) ?? 0) + 1); } }
    const missing = new Set<string>();
    const candidateTemplates: CandidateTemplate[] = candidates.map(template => {
      const notLocal = local ? template.txids.filter(id => !local.has(id)) : null;
      for (const id of notLocal ?? []) { missing.add(id); }
      return {
        poolName: template.source_name,
        templateId: template.template_id,
        sourceId: template.source_id,
        sourceType: template.source_type,
        observedAtUtc: template.observed_at_utc,
        prevBlockHash: template.prev_block_hash,
        txCount: template.tx_count,
        totalWeight: template.total_weight,
        totalFeesSats: String(template.total_fees_sats),
        expectedMedianFeeRate: null,
        uniqueTxids: template.txids.filter(id => counts.get(id) === 1).slice(0, 200),
        missingFromLocalMempool: notLocal ? notLocal.length : null,
      };
    });
    return {
      network: config.MEMPOOL.NETWORK,
      state: 'observed',
      blockHeight: height,
      generatedAt: Math.max(...candidates.map(template => Date.parse(template.observed_at_utc))),
      candidateTemplates,
      consensusMempoolTxCount: local ? local.size : null,
      missingFromLocalCount: local ? missing.size : null,
      feeRateSpreadSatVb: null,
      sources,
      observer,
      retention,
      scope,
    };
  }
}

export const networkObservatoryService = new NetworkObservatoryService();
