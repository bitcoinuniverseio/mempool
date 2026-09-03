import { utxoIntelligenceService } from './utxo-intelligence.service';

describe('Product 5: UTXO Set and Supply Intelligence', () => {
  it('guarantees exact integer satoshis across supply and overview metrics', () => {
    const overview = utxoIntelligenceService.getOverview();
    expect(Number.isInteger(overview.total_utxos)).toBe(true);
    expect(Number.isInteger(overview.total_amount_sats)).toBe(true);
    expect(Number.isInteger(overview.dormant_10yr_sats)).toBe(true);
    expect(Number.isInteger(overview.uneconomical_at_10_sat_vb_sats)).toBe(true);
    expect(overview.total_amount_sats).toBeGreaterThan(1900000000000000); // > 19M BTC in sats
  });

  it('provides script type, age, and value cohorts with exact integer satoshis', () => {
    const cohorts = utxoIntelligenceService.getCohorts();
    expect(cohorts.script_types.length).toBeGreaterThanOrEqual(6);
    expect(cohorts.age_cohorts.length).toBeGreaterThanOrEqual(8);
    expect(cohorts.value_cohorts.length).toBeGreaterThanOrEqual(6);

    for (const script of cohorts.script_types) {
      expect(Number.isInteger(script.utxo_count)).toBe(true);
      expect(Number.isInteger(script.total_sats)).toBe(true);
    }
  });

  it('calculates economic thresholds across feerate bands (1 to 100 sat/vB)', () => {
    const thresholds = utxoIntelligenceService.getEconomicThresholds();
    expect(thresholds.length).toBeGreaterThanOrEqual(5);

    // Uneconomical outputs should monotonically increase with feerate
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i].feerate_sats_vb).toBeGreaterThan(thresholds[i - 1].feerate_sats_vb);
      expect(thresholds[i].uneconomical_utxo_count).toBeGreaterThan(thresholds[i - 1].uneconomical_utxo_count);
      expect(thresholds[i].uneconomical_sats).toBeGreaterThan(thresholds[i - 1].uneconomical_sats);
    }
  });

  it('provides spend transitions with coin days destroyed and net change', () => {
    const transitions = utxoIntelligenceService.getSpendTransitions(5);
    expect(transitions.length).toBe(5);
    for (const t of transitions) {
      expect(Number.isInteger(t.height)).toBe(true);
      expect(Number.isInteger(t.created_count)).toBe(true);
      expect(Number.isInteger(t.spent_count)).toBe(true);
      expect(Number.isInteger(t.created_sats)).toBe(true);
      expect(Number.isInteger(t.spent_sats)).toBe(true);
      expect(t.coin_days_destroyed).toBeGreaterThan(0);
    }
  });

  it('reconciles exactly against Bitcoin Core UTXO set summary', () => {
    const rec = utxoIntelligenceService.getReconciliation();
    expect(rec.reconciled).toBe(true);
    expect(rec.hash_serialized_2).toHaveLength(64);
    expect(rec.reorg_safe_checkpoint_height).toBe(rec.block_height - 6);
  });

  it('supports deterministic rollback during chain reorganizations', () => {
    const initialOverview = utxoIntelligenceService.getOverview();
    const rollbackSuccess = utxoIntelligenceService.rollbackToHeight(initialOverview.block_height - 2);
    expect(rollbackSuccess).toBe(true);

    const postRollbackOverview = utxoIntelligenceService.getOverview();
    expect(postRollbackOverview.block_height).toBe(initialOverview.block_height - 2);
    expect(postRollbackOverview.total_utxos).toBeLessThan(initialOverview.total_utxos);
  });
});
