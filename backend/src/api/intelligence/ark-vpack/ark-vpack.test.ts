jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: { network: 'signet', call: async () => { throw new Error('offline'); } } }));
import arkVpackService from './ark-vpack.service';

describe('ArkVpackService', () => {
  it('reports installed codecs without inventing registered providers', () => {
    const overview = arkVpackService.getOverview();
    expect(overview.total_vpack_versions).toBeGreaterThanOrEqual(1);
    expect(overview.active_providers_count).toBe(0);
    expect(overview.registry_status).toBe('unconfigured');
    expect(overview.supported_implementations.length).toBeGreaterThanOrEqual(2);
    expect(overview.providers).toEqual([]);
  });

  it('should list implementations with dialect features', () => {
    const impls = arkVpackService.listImplementations();
    const arkade = impls.find((i) => i.implementation_id === 'arkade');
    expect(arkade).toBeDefined();
    expect(arkade?.dialect_features.fee_anchor_type).toBe('ephemeral_anchor_v3');
    expect(arkade?.supported_vpack_versions).toContain('mvv-native-proof-envelope-v1');

    const bark = impls.find((i) => i.implementation_id === 'bark');
    expect(bark).toBeDefined();
    expect(bark?.dialect_features.taproot_tree_style).toBe('script_path_multisig');
  });

  it('rejects malformed anchors and cannot verify an unavailable source', async () => {
    await expect(arkVpackService.verifyPublicAnchor('invalid_outpoint')).rejects.toMatchObject({ status: 400 });
    await expect(arkVpackService.verifyPublicAnchor('11'.repeat(32) + ':0')).rejects.toMatchObject({ status: 503 });
  });

  it('rejects arbitrary strings masquerading as a signed manifest', () => {
    const result = arkVpackService.verifyManifest({ provider_id: 'test', identity_key: '02' + '33'.repeat(32), server_signed_manifest: 'sig-data', vpack_version: 'v1' });
    expect(result.valid).toBe(false); expect(result.signature_verified).toBe(false); expect(result.signer_trusted).toBe(false);
  });

  it('rejects dialect conversion without a complete native proof', async () => {
    await expect(arkVpackService.translateDialect({ source_dialect: 'mvv', target_dialect: 'bark', package: {} })).rejects.toMatchObject({ code: 'missing-native-proof' });
  });

  it('requires actual package bytes and a valid fee scenario for exit planning', async () => {
    await expect(arkVpackService.planUnilateralExit({ vtxo_id: 'missing-package' })).rejects.toMatchObject({ status: 400 });
  });
});
