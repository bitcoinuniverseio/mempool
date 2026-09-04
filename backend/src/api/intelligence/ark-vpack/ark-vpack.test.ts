import arkVpackService from './ark-vpack.service';

describe('ArkVpackService', () => {
  it('should return overview with active versions and providers', () => {
    const overview = arkVpackService.getOverview();
    expect(overview.total_vpack_versions).toBeGreaterThanOrEqual(1);
    expect(overview.active_providers_count).toBeGreaterThanOrEqual(2);
    expect(overview.supported_implementations.length).toBeGreaterThanOrEqual(2);
    expect(overview.providers.length).toBeGreaterThanOrEqual(2);
  });

  it('should list implementations with dialect features', () => {
    const impls = arkVpackService.listImplementations();
    const arkade = impls.find((i) => i.implementation_id === 'arkade');
    expect(arkade).toBeDefined();
    expect(arkade?.dialect_features.fee_anchor_type).toBe('ephemeral_anchor_v3');
    expect(arkade?.supported_vpack_versions).toContain('v0.1.0-mvv');

    const bark = impls.find((i) => i.implementation_id === 'bark');
    expect(bark).toBeDefined();
    expect(bark?.dialect_features.taproot_tree_style).toBe('script_path_multisig');
  });

  it('should verify public anchor format and on-chain existence', () => {
    const valid = arkVpackService.verifyPublicAnchor('3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c:0');
    expect(valid.verified).toBe(true);
    expect(valid.exists_onchain).toBe(true);
    expect(valid.confirmations).toBeGreaterThan(0);

    const invalid = arkVpackService.verifyPublicAnchor('invalid_outpoint');
    expect(invalid.verified).toBe(false);
    expect(invalid.errors).toContain('Anchor outpoint must be in txid:vout format');
  });

  it('should verify ASP signed capability manifests', () => {
    const valid = arkVpackService.verifyManifest({
      provider_id: 'asp-test-01',
      identity_key: '02' + '33'.repeat(32),
      vpack_version: 'v0.1.0-mvv',
      server_signed_manifest: 'sig-data',
    });
    expect(valid.valid).toBe(true);

    const invalid = arkVpackService.verifyManifest({
      provider_id: '',
      identity_key: '',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain('provider_id is required');
  });

  it('should translate native dialect to minimal viable vtxo', () => {
    const res = arkVpackService.translateDialect(
      {
        vtxo_id: 'vtxo-custom-01',
        amount_sats: 250000,
        exit_delay_blocks: 288,
      },
      'arkade'
    );
    expect(res.success).toBe(true);
    expect(res.minimal_viable_vtxo.amount_sats).toBe(250000);
    expect(res.fields_preserved).toContain('amount_sats');
    expect(res.unilateral_exit_viable).toBe(true);

    const unsupported = arkVpackService.translateDialect({}, 'unknown_dialect');
    expect(unsupported.success).toBe(false);
  });

  it('should generate unilateral exit plan with CSV delays and fee anchor', () => {
    const plan = arkVpackService.planUnilateralExit('vtxo-887412-001', 864195);
    expect(plan.vtxo_id).toBe('vtxo-887412-001');
    expect(plan.csv_delay_blocks).toBe(512);
    expect(plan.fee_anchor_available).toBe(true);
    expect(plan.exit_stages.length).toBe(2);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});
