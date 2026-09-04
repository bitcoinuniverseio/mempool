import { templateCollectorService } from './template-collector.service';

describe('Product 4: Mining Template and Inclusion Observatory', () => {
  it('collects candidate templates from multiple sources (Core GBT, Stratum V2, DATUM)', () => {
    const sources = templateCollectorService.getSources();
    expect(sources.length).toBeGreaterThanOrEqual(3);

    const types = sources.map((s) => s.source_type);
    expect(types).toContain('core_gbt');
    expect(types).toContain('stratum_v2');
    expect(types).toContain('datum');

    const templates = templateCollectorService.getTemplatesForHeight(860145);
    expect(templates.length).toBeGreaterThanOrEqual(2);
    for (const tmpl of templates) {
      expect(tmpl.height).toBe(860145);
      expect(tmpl.fingerprint_hash).toBeDefined();
      expect(tmpl.total_fees_sats).toBeGreaterThan(0);
      expect(tmpl.total_weight).toBeGreaterThan(0);
    }
  });

  it('computes structured diffs between candidate templates across sources', () => {
    const templates = templateCollectorService.getTemplatesForHeight(860145);
    const diff = templateCollectorService.computeTemplateDiff(
      templates[0].template_id,
      templates[1].template_id
    );

    expect(diff.template_a_id).toBe(templates[0].template_id);
    expect(diff.template_b_id).toBe(templates[1].template_id);
    expect(diff.similarity_score).toBeGreaterThan(0.5);
    expect(diff.similarity_score).toBeLessThanOrEqual(1.0);
    expect(typeof diff.fee_delta_sats).toBe('number');
    expect(diff.explanation).not.toContain('censored');
    expect(diff.explanation).not.toContain('miner rejected');
  });

  it('compares mined block against candidate template with objective non-accusatory findings', () => {
    const blockHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';
    const comparison = templateCollectorService.compareMinedBlock(blockHash);

    expect(comparison.block_hash).toBe(blockHash);
    expect(comparison.best_template_id).toBeDefined();
    expect(comparison.fee_differential_sats).toBeGreaterThanOrEqual(0);
    expect(comparison.observed_difference_reason).toBeDefined();
    expect(comparison.observed_difference_reason).not.toContain('censored');
    expect(comparison.observed_difference_reason).not.toContain('miner rejected');
  });

  it('extracts reproducible deterministic policy fingerprints for each template source', () => {
    const fps = templateCollectorService.getPolicyFingerprints();
    expect(fps.length).toBeGreaterThanOrEqual(3);
    for (const fp of fps) {
      expect(fp.source_id).toBeDefined();
      expect(fp.fingerprint_hash).toHaveLength(64);
      expect(fp.sigops_budget_adherence).toBe(true);
    }
  });
});
