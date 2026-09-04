import compactFiltersService from './compact-filters.service';

describe('CompactFiltersService', () => {
  it('should return overview with active filter providers and checkpoints', () => {
    const overview = compactFiltersService.getOverview();
    expect(overview.total_providers).toBeGreaterThanOrEqual(2);
    expect(overview.healthy_providers).toBeGreaterThanOrEqual(1);
    expect(overview.recent_checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(overview.active_conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('should list and retrieve filter providers by ID', () => {
    const provs = compactFiltersService.listProviders();
    expect(provs.length).toBeGreaterThanOrEqual(2);

    const first = provs[0];
    const retrieved = compactFiltersService.getProvider(first.provider_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.supports_compact_filters).toBe(true);
    expect(retrieved?.service_flags).toContain('NODE_COMPACT_FILTERS');
  });

  it('should retrieve block filter with basic filter properties', () => {
    const filter = compactFiltersService.getBlockFilter('000000000000000000018a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d');
    expect(filter).toBeDefined();
    expect(filter?.filter_type).toBe('basic_0x00');
    expect(filter?.includes_spent_prevouts).toBe(true);
    expect(filter?.includes_outputs).toBe(true);
    expect(filter?.excludes_op_return).toBe(true);
  });

  it('should execute verification runs and detect multi-peer consensus vs conflict', () => {
    const agreeingRun = compactFiltersService.createVerification({
      start_height: 860000,
      end_height: 860100,
      providers: ['filter-peer-us-east', 'filter-peer-eu-central'],
    });
    expect(agreeingRun.all_agree).toBe(true);
    expect(agreeingRun.conflicts_found).toBe(0);
    expect(agreeingRun.status).toBe('completed');
    expect(agreeingRun.manifest_hash.length).toBe(64);

    const conflictingRun = compactFiltersService.createVerification({
      start_height: 860400,
      end_height: 860500,
      providers: ['filter-peer-us-east', 'filter-peer-experimental-sg'],
    });
    expect(conflictingRun.all_agree).toBe(false);
    expect(conflictingRun.conflicts_found).toBe(1);
    expect(conflictingRun.status).toBe('discrepancy_detected');
  });
});
