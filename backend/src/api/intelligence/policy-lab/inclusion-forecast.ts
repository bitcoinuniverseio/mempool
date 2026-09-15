import mempool from '../../mempool';
import config from '../../../config';
export class PolicyEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}
export interface InclusionForecastProbabilities {
  next_block: null; two_blocks: null; three_blocks: null; six_blocks: null; twelve_blocks: null; twenty_four_blocks: null;
  confidence_interval: null; is_fallback: false; model_version: string; calculated_at: string;
  scope: string; network: string; observed_transactions: number | null; observed_vsize_ahead: number | null;
  queue_capacity_blocks: number | null; unavailable_reason: string | null;
}
export interface ForecastModelCard {
  version: string; name: string; description: string; algorithm: string; features: string[]; training_coverage: null;
  evaluation_metrics: { brier_score: null; calibration_error: null; sample_size: null; validation_status: 'not-calibrated' };
  limitations: string[]; last_calibrated_at: null;
}
export class InclusionForecaster {
  public static readonly activeModelVersion = 'observed-feerate-queue-v1';
  public static getModelCard(version = this.activeModelVersion): ForecastModelCard {
    if (version !== this.activeModelVersion) throw new PolicyEvidenceError('unknown-model-version', 'This forecast model version is not available.', 404);
    return { version, name: 'Observed feerate queue calculation', description: 'A bounded calculation over the synchronized local mempool snapshot. No trained or calibrated probability model is available.',
      algorithm: 'Sum virtual sizes with strictly higher individual feerate, then divide by 1,000,000 vB nominal block capacity.',
      features: ['effective_feerate_sats_vb', 'observed_vsize_ahead', 'candidate_vsize'], training_coverage: null,
      evaluation_metrics: {brier_score:null,calibration_error:null,sample_size:null,validation_status:'not-calibrated'}, last_calibrated_at:null,
      limitations:['Queue position is a heuristic, not confirmation probability or a time guarantee.','Ignores miner selection, package dependencies, ties, new arrivals, reserved capacity and transaction validity.','Snapshot source is the configured local mempool; no independent chain or completeness proof is established by this calculation.'] };
  }
  public static unavailable(reason: string): InclusionForecastProbabilities {
    return { next_block:null,two_blocks:null,three_blocks:null,six_blocks:null,twelve_blocks:null,twenty_four_blocks:null,confidence_interval:null,is_fallback:false,
      model_version:this.activeModelVersion,calculated_at:new Date().toISOString(),network:config.MEMPOOL.NETWORK,
      scope:'Observed feerate queue heuristic only; calibrated probabilities and confidence intervals are unavailable.',observed_transactions:null,observed_vsize_ahead:null,queue_capacity_blocks:null,unavailable_reason:reason };
  }
  public static snapshot(): Record<string, any> {
    try {
      if (!mempool.isInSync()) throw new Error();
      const snapshot = mempool.getMempool();
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length > 200000) throw new Error();
      return snapshot;
    } catch { throw new PolicyEvidenceError('unavailable-mempool-source', 'A bounded synchronized mempool snapshot is unavailable.'); }
  }
  public static calculateForecast(effectiveFeerate: number, packageFeerate?: number, vsize = 140, snapshot = this.snapshot()): InclusionForecastProbabilities {
    if (!Number.isFinite(effectiveFeerate) || effectiveFeerate < 0 || packageFeerate !== undefined && (!Number.isFinite(packageFeerate) || packageFeerate < 0) || !Number.isSafeInteger(vsize) || vsize <= 0) throw new PolicyEvidenceError('invalid-forecast-input', 'Finite nonnegative feerates and positive integer virtual size are required.',400);
    const rate=Math.max(effectiveFeerate,packageFeerate??effectiveFeerate);let ahead=0;
    const rows=Object.values(snapshot);
    for(const row of rows) {
      if (!row || !Number.isFinite(row.feePerVsize) || row.feePerVsize<0 || !Number.isSafeInteger(row.vsize) || row.vsize<=0) throw new PolicyEvidenceError('unavailable-mempool-source','The mempool snapshot contains incomplete fee or size evidence.');
      if(row.feePerVsize>rate) ahead+=row.vsize;
      if(!Number.isSafeInteger(ahead+vsize)) throw new PolicyEvidenceError('unavailable-mempool-source','The observed queue exceeds the bounded size range.');
    }
    return {...this.unavailable(''),unavailable_reason:null,observed_transactions:rows.length,observed_vsize_ahead:ahead,queue_capacity_blocks:(ahead+vsize)/1000000};
  }
  public static empiricalFallback(_effectiveFeerate: number): InclusionForecastProbabilities { return this.unavailable('No calibrated empirical fallback is available.'); }
}
