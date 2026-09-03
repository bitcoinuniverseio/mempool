import { bitcoinCorePolicyAdapter } from './bitcoin-core-policy-adapter';
import { PolicyExplainer } from './policy-explainer';
import { InclusionForecaster } from './inclusion-forecast';
import { policyLabService } from './policy-lab.service';

describe('Product 1: Transaction Package, Policy, and Inclusion Lab', () => {
  const sampleTxHex = '02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100f2052a0100000043410496b538e853519c726a2c91e61ec11600ae1390813a627c66fb8be794bbe3e67020e17e572e632024f6655f4f4b822d159ced5da51657edffd7940761c7f536a5ac00000000';

  it('evaluates raw transaction package and derives topology and profile', async () => {
    const report = await bitcoinCorePolicyAdapter.evaluatePackage([sampleTxHex]);
    expect(report.package_id).toBeDefined();
    expect(report.members.length).toBe(1);
    expect(report.members[0].vsize).toBeGreaterThan(0);
    expect(report.members[0].weight).toBeGreaterThan(0);
    expect(report.node_profile.network).toBeDefined();
  });

  it('explains missing input rejections with consensus scope and remediation', () => {
    const explanation = PolicyExplainer.explainVerdict(
      'test-txid-01',
      'bad-txns-inputs-missingorspent',
      'Inputs missing or already spent'
    );
    expect(explanation).not.toBeNull();
    expect(explanation?.scope).toBe('consensus');
    expect(explanation?.plain_language_reason).toContain('do not exist or were already spent');
    expect(explanation?.remediations.length).toBeGreaterThan(0);
  });

  it('explains insufficient fee rejections with CPFP and RBF remediation paths', () => {
    const explanation = PolicyExplainer.explainVerdict(
      'test-txid-02',
      'insufficient fee',
      'min relay fee not met, 500 < 1000'
    );
    expect(explanation).not.toBeNull();
    expect(explanation?.scope).toBe('local_policy');
    const actions = explanation?.remediations.map((r) => r.action);
    expect(actions).toContain('cpfp');
    expect(actions).toContain('rbf');
  });

  it('calculates calibrated discrete-time survival forecasts with confidence intervals', () => {
    const forecastHighFee = InclusionForecaster.calculateForecast(25);
    expect(forecastHighFee.next_block).toBeGreaterThan(0.70);
    expect(forecastHighFee.twenty_four_blocks).toBe(1.0);
    expect(forecastHighFee.confidence_interval[0]).toBeLessThanOrEqual(forecastHighFee.next_block);
    expect(forecastHighFee.confidence_interval[1]).toBeGreaterThanOrEqual(forecastHighFee.next_block);
    expect(forecastHighFee.is_fallback).toBe(false);

    const forecastLowFee = InclusionForecaster.calculateForecast(1.1);
    expect(forecastLowFee.next_block).toBeLessThan(forecastHighFee.next_block);
  });

  it('provides deterministic empirical fallback when model is unavailable', () => {
    const fallback = InclusionForecaster.empiricalFallback(5.0);
    expect(fallback.is_fallback).toBe(true);
    expect(fallback.next_block).toBeGreaterThan(0);
    expect(fallback.two_blocks).toBeGreaterThanOrEqual(fallback.next_block);
  });

  it('returns valid model card satisfying calibration error <= 0.05 and Brier score benchmark', () => {
    const card = InclusionForecaster.getModelCard();
    expect(card.version).toBeDefined();
    expect(card.evaluation_metrics.calibration_error).toBeLessThanOrEqual(0.05);
    expect(card.evaluation_metrics.brier_score).toBeLessThanOrEqual(0.05);
    expect(card.features.length).toBeGreaterThan(3);
  });

  it('orchestrates end-to-end policy evaluation via service', async () => {
    const response = await policyLabService.evaluateTransactionOrPackage([sampleTxHex]);
    expect(response.evaluation_id).toBeDefined();
    expect(response.package_report.members.length).toBe(1);
    expect(response.forecast.model_version).toBeDefined();

    const retrieved = policyLabService.getSavedEvaluation(response.evaluation_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.evaluation_id).toBe(response.evaluation_id);
  });
});
