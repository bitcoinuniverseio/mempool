import {
  bitcoinCorePolicyAdapter,
  PackageAnalysisReport,
  NodePolicyProfile,
} from './bitcoin-core-policy-adapter';
import { PolicyExplainer, PolicyExplanation } from './policy-explainer';
import {
  InclusionForecaster,
  InclusionForecastProbabilities,
  ForecastModelCard,
} from './inclusion-forecast';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { eventBus } from '../events/intelligence-event-bus';
import mempool from '../../mempool';

export interface FullPolicyEvaluationResponse {
  evaluation_id: string;
  package_report: PackageAnalysisReport;
  explanations: PolicyExplanation[];
  forecast: InclusionForecastProbabilities;
  created_at: string;
}

export class PolicyLabService {
  private static instance: PolicyLabService;
  private savedEvaluations: Map<string, FullPolicyEvaluationResponse> = new Map();

  public static getInstance(): PolicyLabService {
    if (!PolicyLabService.instance) {
      PolicyLabService.instance = new PolicyLabService();
    }
    return PolicyLabService.instance;
  }

  public async evaluateTransactionOrPackage(
    rawTxs: string[]
  ): Promise<FullPolicyEvaluationResponse> {
    const report = await bitcoinCorePolicyAdapter.evaluatePackage(rawTxs);
    const evaluationId = EventEnvelopeValidator.generateUuidV7();

    const explanations: PolicyExplanation[] = [];
    for (const member of report.members) {
      if (!member.allowed || member.reject_reason) {
        const explanation = PolicyExplainer.explainVerdict(
          member.txid,
          member.reject_code,
          member.reject_reason
        );
        if (explanation) {
          explanations.push(explanation);
        }
      }
    }

    const forecast = InclusionForecaster.calculateForecast(
      report.package_feerate_sats_vb,
      report.package_feerate_sats_vb,
      report.total_vsize
    );

    const response: FullPolicyEvaluationResponse = {
      evaluation_id: evaluationId,
      package_report: report,
      explanations,
      forecast,
      created_at: new Date().toISOString(),
    };

    this.savedEvaluations.set(evaluationId, response);
    if (this.savedEvaluations.size > 200) {
      const firstKey = this.savedEvaluations.keys().next().value;
      if (firstKey) this.savedEvaluations.delete(firstKey);
    }

    // Publish event on intelligence event bus
    const envelope = EventEnvelopeValidator.createEnvelope({
      event_type: 'evaluated',
      network: report.network,
      source_id: 'policy-lab',
      entity_type: 'package',
      entity_id: report.package_id,
      payload: {
        package_id: report.package_id,
        allowed: report.overall_allowed,
        member_count: report.members.length,
        package_feerate: report.package_feerate_sats_vb,
        total_fees_sats: report.total_fees_sats,
        total_vsize: report.total_vsize,
        total_weight: report.total_weight,
      },
    });
    eventBus.publish('btc.bitcoin.mempool.evaluated', envelope);

    return response;
  }

  public getSavedEvaluation(id: string): FullPolicyEvaluationResponse | null {
    return this.savedEvaluations.get(id) || null;
  }

  public async getNodeProfiles(): Promise<NodePolicyProfile[]> {
    const primary = await bitcoinCorePolicyAdapter.getEffectivePolicyProfile();
    return [primary];
  }

  public getForecastForTxid(txid: string): InclusionForecastProbabilities {
    const mempoolTx = mempool.getMempool()[txid];
    if (mempoolTx) {
      return InclusionForecaster.calculateForecast(
        mempoolTx.feePerVsize,
        mempoolTx.feePerVsize,
        mempoolTx.vsize
      );
    }
    return InclusionForecaster.empiricalFallback(10);
  }

  public getCurrentForecastModelCard(): ForecastModelCard {
    return InclusionForecaster.getModelCard();
  }
}

export const policyLabService = PolicyLabService.getInstance();
