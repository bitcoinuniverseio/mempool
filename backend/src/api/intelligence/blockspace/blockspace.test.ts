import { blockspaceService } from './blockspace.service';

describe('BlockspaceService', () => {
  it('should return overview with current regime and composition', () => {
    const overview = blockspaceService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.current_regime).toBeDefined();
    expect(overview.taxonomy_classes.length).toBeGreaterThan(0);
    expect(overview.composition_timeseries.length).toBeGreaterThan(0);
    expect(overview.median_feerate_24h).toBeGreaterThan(0);
  });

  it('should return taxonomy semantic classes', () => {
    const taxonomy = blockspaceService.getTaxonomy();
    expect(taxonomy.length).toBeGreaterThanOrEqual(4);
    const hasMonetary = taxonomy.some(t => t.category === 'monetary');
    const hasArbitrary = taxonomy.some(t => t.category === 'arbitrary_data');
    expect(hasMonetary).toBe(true);
    expect(hasArbitrary).toBe(true);
  });

  it('should return blockspace composition timeseries with specified limit', () => {
    const comp = blockspaceService.getComposition(3);
    expect(comp.length).toBeLessThanOrEqual(3);
    expect(comp[0].total_weight).toBeGreaterThan(0);
  });

  it('should return detected fee and demand regimes', () => {
    const regimes = blockspaceService.getRegimes();
    expect(regimes.length).toBeGreaterThan(0);
    expect(regimes[0].regime_type).toBeDefined();
  });

  it('should return transaction semantic classification and evidence', () => {
    const txid = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const evidence = blockspaceService.getTxSemantics(txid);
    expect(evidence).toBeDefined();
    expect(evidence.txid).toBe(txid);
    expect(evidence.primary_class).toBeDefined();
    expect(evidence.secondary_tags.length).toBeGreaterThan(0);
  });
});
