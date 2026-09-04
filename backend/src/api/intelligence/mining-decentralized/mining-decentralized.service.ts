import {
  DecentralizedMiningProtocol,
  DecentralizedMiningSource,
  DecentralizedMiningShare,
  DecentralizedMiningTemplate,
  DecentralizedMiningTemplateComparison,
  DecentralizedMiningPayoutEvidence,
  DecentralizedMiningOverviewResponse,
} from './mining-decentralized.models';

export class DecentralizedMiningService {
  private protocols: DecentralizedMiningProtocol[] = [];
  private sources: Map<string, DecentralizedMiningSource> = new Map();
  private shares: Map<string, DecentralizedMiningShare> = new Map();
  private templates: Map<string, DecentralizedMiningTemplate> = new Map();
  private payouts: Map<string, DecentralizedMiningPayoutEvidence> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    this.protocols = [
      {
        protocol_id: 'datum_gateway',
        name: 'DATUM Gateway',
        architecture: 'miner_selected_templates',
        current_version: 'v1.0.4',
        share_structure: 'Miner-built template with pool-mandated coinbase outputs',
        payout_mechanism: 'Direct pool coinbase reward split',
        description: 'Decentralized mining template architecture enabling hashrate owners to construct local blocks while delegating share coordination',
      },
      {
        protocol_id: 'p2pool_v2',
        name: 'P2Pool v2',
        architecture: 'linear_sharechain',
        current_version: 'v2.1.0-alpha',
        share_structure: 'Linear sharechain with deterministic PPLNS window',
        payout_mechanism: 'On-chain coinbase multi-output dispersion',
        description: 'Decentralized peer-to-peer sharechain that completely removes centralized pool operators',
      },
      {
        protocol_id: 'braidpool',
        name: 'Braidpool',
        architecture: 'dag_consensus',
        current_version: 'v0.3.0-prototype',
        share_structure: 'Directed Acyclic Graph of shares with multi-parent ancestry',
        payout_mechanism: 'Braid balance commitments and off-chain batch settlement',
        description: 'DAG-based share accounting platform eliminating share-orphaning and reducing payout variance',
      },
    ];

    const source1: DecentralizedMiningSource = {
      source_id: 'source-datum-rig-01',
      protocol_id: 'datum_gateway',
      endpoint: '127.0.0.1:8334',
      source_name: 'DATUM Primary Gateway (Ashburn)',
      is_active: true,
      current_height: 860500,
      share_target: '00000000000004a8000000000000000000000000000000000000000000000000',
      shares_accepted_count: 14820,
      shares_rejected_count: 22,
      stale_ratio_pct: 0.15,
      submission_latency_ms: 18,
      last_block_candidate_height: 860499,
      last_seen_at: '2026-09-04T05:00:00Z',
    };

    const source2: DecentralizedMiningSource = {
      source_id: 'source-p2pool-node-01',
      protocol_id: 'p2pool_v2',
      endpoint: 'p2pool.universe.local:9333',
      source_name: 'P2Pool v2 Reference Node',
      is_active: true,
      current_height: 860500,
      share_target: '0000000000001000000000000000000000000000000000000000000000000000',
      shares_accepted_count: 84200,
      shares_rejected_count: 180,
      stale_ratio_pct: 0.21,
      submission_latency_ms: 45,
      last_seen_at: '2026-09-04T05:00:00Z',
    };

    const source3: DecentralizedMiningSource = {
      source_id: 'source-braidpool-node-01',
      protocol_id: 'braidpool',
      endpoint: 'braid.universe.local:9888',
      source_name: 'Braidpool Experimental DAG Node',
      is_active: true,
      current_height: 860500,
      share_target: '0000000000002000000000000000000000000000000000000000000000000000',
      shares_accepted_count: 42100,
      shares_rejected_count: 95,
      stale_ratio_pct: 0.08,
      submission_latency_ms: 55,
      last_seen_at: '2026-09-04T05:00:00Z',
    };

    this.sources.set(source1.source_id, source1);
    this.sources.set(source2.source_id, source2);
    this.sources.set(source3.source_id, source3);

    const tmpl1: DecentralizedMiningTemplate = {
      template_id: 'tmpl-datum-860500',
      protocol_id: 'datum_gateway',
      source_id: source1.source_id,
      height: 860500,
      tx_count: 3840,
      total_weight: 3992000,
      total_fees_sats: 14250000,
      coinbase_payout_outputs_count: 2,
      coinbase_tags: ['/DATUM-GATEWAY-1.0/', '/UNIVERSE-MINING/'],
      miner_controlled_ratio_pct: 98.4,
      author_provenance: 'locally_constructed',
      template_fingerprint: 'e89a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885d',
      created_at: '2026-09-04T04:45:00Z',
    };
    this.templates.set(tmpl1.template_id, tmpl1);

    const share1: DecentralizedMiningShare = {
      share_id: 'share-datum-860500-001',
      protocol_id: 'datum_gateway',
      source_id: source1.source_id,
      height: 860500,
      parent_share_ids: ['share-datum-860500-000'],
      miner_payout_script: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
      work_value: 482000,
      share_target: source1.share_target,
      difficulty: 16384,
      template_id: tmpl1.template_id,
      states: ['observed', 'locally_verified', 'accepted_by_coordinator', 'contributed_to_payout'],
      is_valid: true,
      mined_at: '2026-09-04T04:50:00Z',
    };

    const share2: DecentralizedMiningShare = {
      share_id: 'share-braid-860500-042',
      protocol_id: 'braidpool',
      source_id: source3.source_id,
      height: 860500,
      parent_share_ids: ['share-braid-860500-040', 'share-braid-860500-041'],
      miner_payout_script: '0014389a0c5c4f24fef7d8b584a7e937d5718a209b0b',
      work_value: 320000,
      share_target: source3.share_target,
      difficulty: 8192,
      template_id: 'tmpl-braid-860500',
      states: ['observed', 'locally_verified', 'propagated'],
      is_valid: true,
      mined_at: '2026-09-04T04:52:00Z',
    };

    this.shares.set(share1.share_id, share1);
    this.shares.set(share2.share_id, share2);

    const payout1: DecentralizedMiningPayoutEvidence = {
      payout_id: 'payout-datum-block-860490',
      protocol_id: 'datum_gateway',
      block_height: 860490,
      payout_commitment: '38a12781b0a8806292b0c1692df82e66a3458c0c9b0e271ecba32fbe1f6004b5',
      coinbase_txid: '72a6b22b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9',
      settlement_type: 'coinbase_output',
      amount_sats: 312500000,
      recipient_script: share1.miner_payout_script,
      verified_on_chain: true,
      confirmed_at: '2026-09-04T03:10:00Z',
    };
    this.payouts.set(payout1.payout_id, payout1);
  }

  public getOverview(): DecentralizedMiningOverviewResponse {
    return {
      protocols: this.protocols,
      total_active_sources: Array.from(this.sources.values()).filter((s) => s.is_active).length,
      total_observed_shares: this.shares.size + 140000,
      recent_shares: Array.from(this.shares.values()),
      recent_templates: Array.from(this.templates.values()),
      sources: Array.from(this.sources.values()),
      recent_payouts: Array.from(this.payouts.values()),
    };
  }

  public listProtocols(): DecentralizedMiningProtocol[] {
    return this.protocols;
  }

  public listSources(): DecentralizedMiningSource[] {
    return Array.from(this.sources.values());
  }

  public listShares(): DecentralizedMiningShare[] {
    return Array.from(this.shares.values());
  }

  public getShare(shareId: string): DecentralizedMiningShare | undefined {
    return this.shares.get(shareId);
  }

  public listTemplates(): DecentralizedMiningTemplate[] {
    return Array.from(this.templates.values());
  }

  public getTemplate(templateId: string): DecentralizedMiningTemplate | undefined {
    return this.templates.get(templateId);
  }

  public listPayouts(): DecentralizedMiningPayoutEvidence[] {
    return Array.from(this.payouts.values());
  }

  public compareTemplates(): DecentralizedMiningTemplateComparison {
    return {
      height: 860500,
      template_a_id: 'tmpl-datum-860500',
      template_b_id: 'tmpl-pool-central-860500',
      shared_txs_count: 3650,
      exclusive_txs_a_count: 190,
      exclusive_txs_b_count: 140,
      similarity_ratio: 0.945,
      fee_difference_sats: 240000,
    };
  }
}

export default new DecentralizedMiningService();
