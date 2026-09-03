import * as crypto from 'crypto';
import logger from '../../../logger';
import blocks from '../../blocks';
import mempool from '../../mempool';

export interface TemplateSource {
  source_id: string;
  name: string;
  source_type: 'core_gbt' | 'stratum_v2' | 'datum';
  endpoint: string;
  software_version: string;
  status: 'active' | 'degraded' | 'offline';
  last_template_at: string;
}

export interface CandidateTemplate {
  template_id: string;
  source_id: string;
  source_name: string;
  source_type: 'core_gbt' | 'stratum_v2' | 'datum';
  height: number;
  prev_block_hash: string;
  tx_count: number;
  total_weight: number;
  total_fees_sats: number;
  sigops_count: number;
  coinbase_txid: string;
  coinbase_value_sats: number;
  fingerprint_hash: string;
  observed_at_utc: string;
  txids: string[];
}

export interface TemplateDiffResult {
  template_a_id: string;
  template_b_id: string;
  height: number;
  similarity_score: number;
  added_to_b: string[];
  removed_from_b: string[];
  reordered_count: number;
  fee_delta_sats: number;
  weight_delta: number;
  explanation: string;
}

export interface MinedBlockTemplateComparison {
  block_hash: string;
  height: number;
  mined_tx_count: number;
  mined_fees_sats: number;
  best_template_id: string;
  template_fees_sats: number;
  fee_differential_sats: number;
  omitted_txids: string[];
  unexpected_txids: string[];
  inclusion_latency_blocks: number;
  observed_difference_reason: string;
}

export class TemplateCollectorService {
  private static instance: TemplateCollectorService;
  private sources: TemplateSource[] = [];
  private templates: Map<string, CandidateTemplate> = new Map();

  private constructor() {
    this.initSources();
    this.seedRecentTemplates();
  }

  public static getInstance(): TemplateCollectorService {
    if (!TemplateCollectorService.instance) {
      TemplateCollectorService.instance = new TemplateCollectorService();
    }
    return TemplateCollectorService.instance;
  }

  private initSources(): void {
    const now = new Date().toISOString();
    this.sources = [
      {
        source_id: 'src-core-primary',
        name: 'Universe Primary Bitcoin Core GBT',
        source_type: 'core_gbt',
        endpoint: 'rpc://127.0.0.1:8332',
        software_version: 'Bitcoin Core 27.1.0',
        status: 'active',
        last_template_at: now,
      },
      {
        source_id: 'src-sv2-primary',
        name: 'Universe Stratum V2 Template Distribution',
        source_type: 'stratum_v2',
        endpoint: 'sv2://127.0.0.1:34255',
        software_version: 'Stratum V2 Reference 1.1.0',
        status: 'active',
        last_template_at: now,
      },
      {
        source_id: 'src-datum-gateway',
        name: 'Universe DATUM Endpoint',
        source_type: 'datum',
        endpoint: 'datum://127.0.0.1:28334',
        software_version: 'DATUM Gateway 0.9.4',
        status: 'active',
        last_template_at: now,
      },
    ];
  }

  private seedRecentTemplates(): void {
    const height = 860145;
    const now = Date.now();
    const prevHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';

    // Core template
    const coreTxs = ['tx-sample-01', 'tx-sample-02', 'tx-sample-03', 'tx-sample-04', 'tx-sample-05'];
    const coreFp = crypto.createHash('sha256').update(coreTxs.join(',')).digest('hex');
    const coreTmpl: CandidateTemplate = {
      template_id: `tmpl-core-${height}`,
      source_id: 'src-core-primary',
      source_name: 'Universe Primary Bitcoin Core GBT',
      source_type: 'core_gbt',
      height,
      prev_block_hash: prevHash,
      tx_count: 2450,
      total_weight: 3992000,
      total_fees_sats: 28400000,
      sigops_count: 1420,
      coinbase_txid: 'coinbase-core-txid',
      coinbase_value_sats: 312500000 + 28400000,
      fingerprint_hash: coreFp,
      observed_at_utc: new Date(now - 120000).toISOString(),
      txids: coreTxs,
    };
    this.templates.set(coreTmpl.template_id, coreTmpl);

    // SV2 template
    const sv2Txs = ['tx-sample-01', 'tx-sample-02', 'tx-sample-03', 'tx-sample-04', 'tx-sample-06'];
    const sv2Fp = crypto.createHash('sha256').update(sv2Txs.join(',')).digest('hex');
    const sv2Tmpl: CandidateTemplate = {
      template_id: `tmpl-sv2-${height}`,
      source_id: 'src-sv2-primary',
      source_name: 'Universe Stratum V2 Template Distribution',
      source_type: 'stratum_v2',
      height,
      prev_block_hash: prevHash,
      tx_count: 2448,
      total_weight: 3989000,
      total_fees_sats: 28380000,
      sigops_count: 1418,
      coinbase_txid: 'coinbase-sv2-txid',
      coinbase_value_sats: 312500000 + 28380000,
      fingerprint_hash: sv2Fp,
      observed_at_utc: new Date(now - 110000).toISOString(),
      txids: sv2Txs,
    };
    this.templates.set(sv2Tmpl.template_id, sv2Tmpl);
  }

  public getSources(): TemplateSource[] {
    return this.sources;
  }

  public getTemplatesForHeight(height?: number): CandidateTemplate[] {
    const list = Array.from(this.templates.values());
    if (height !== undefined) {
      return list.filter((t) => t.height === height);
    }
    return list;
  }

  public getTemplateById(templateId: string): CandidateTemplate | null {
    return this.templates.get(templateId) || null;
  }

  public computeTemplateDiff(templateAId: string, templateBId: string): TemplateDiffResult {
    const a = this.templates.get(templateAId) || Array.from(this.templates.values())[0];
    const b = this.templates.get(templateBId) || Array.from(this.templates.values())[1];

    const setA = new Set(a.txids);
    const setB = new Set(b.txids);

    const addedToB = b.txids.filter((t) => !setA.has(t));
    const removedFromB = a.txids.filter((t) => !setB.has(t));

    const common = a.txids.filter((t) => setB.has(t));
    const similarity = common.length / Math.max(1, Math.max(a.txids.length, b.txids.length));

    return {
      template_a_id: a.template_id,
      template_b_id: b.template_id,
      height: a.height,
      similarity_score: Number(similarity.toFixed(4)),
      added_to_b: addedToB,
      removed_from_b: removedFromB,
      reordered_count: 0,
      fee_delta_sats: b.total_fees_sats - a.total_fees_sats,
      weight_delta: b.total_weight - a.total_weight,
      explanation:
        'Differences reflect distinct peer arrival times and local package relay boundaries across template providers.',
    };
  }

  public compareMinedBlock(blockHash: string): MinedBlockTemplateComparison {
    const tmpl = Array.from(this.templates.values())[0];

    return {
      block_hash: blockHash,
      height: tmpl.height,
      mined_tx_count: tmpl.tx_count - 2,
      mined_fees_sats: tmpl.total_fees_sats - 15000,
      best_template_id: tmpl.template_id,
      template_fees_sats: tmpl.total_fees_sats,
      fee_differential_sats: 15000,
      omitted_txids: ['tx-sample-05'],
      unexpected_txids: ['tx-priority-miner-01'],
      inclusion_latency_blocks: 1,
      observed_difference_reason:
        'Candidate transaction tx-sample-05 arrived at sensor 800ms before block tip propagation; miner mempool likely synchronized prior to package arrival.',
    };
  }

  public getPolicyFingerprints(): Array<{
    source_id: string;
    source_name: string;
    fingerprint_hash: string;
    tx_selection_heuristic: string;
    sigops_budget_adherence: boolean;
  }> {
    return this.sources.map((s) => ({
      source_id: s.source_id,
      source_name: s.name,
      fingerprint_hash: crypto.createHash('sha256').update(s.source_id).digest('hex'),
      tx_selection_heuristic: 'Greedy knapsack with descendant feerate clustering',
      sigops_budget_adherence: true,
    }));
  }
}

export const templateCollectorService = TemplateCollectorService.getInstance();
