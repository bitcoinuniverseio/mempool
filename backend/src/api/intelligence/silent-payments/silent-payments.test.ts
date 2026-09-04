import { silentPaymentsService } from './silent-payments.service';

describe('SilentPaymentsService', () => {
  it('should return coverage overview with indexed block manifests', () => {
    const coverage = silentPaymentsService.getCoverageOverview();
    expect(coverage).toBeDefined();
    expect(coverage.latest_indexed_height).toBeGreaterThan(800000);
    expect(coverage.total_indexed_blocks).toBeGreaterThan(0);
    expect(coverage.support_claims.length).toBeGreaterThan(0);
  });

  it('should return block manifest and bundle for valid height', () => {
    const manifest = silentPaymentsService.getBlockManifest(860400);
    expect(manifest).not.toBeNull();
    expect(manifest?.height).toBe(860400);
    expect(manifest?.num_sp_outputs).toBeGreaterThan(0);

    const bundle = silentPaymentsService.getBlockBundle(860400);
    expect(bundle).not.toBeNull();
    expect(bundle?.spent_outpoints.length).toBeGreaterThan(0);
  });

  it('should validate BIP352 silent payment addresses correctly', () => {
    const dummySp1 = 'sp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
    const valid = silentPaymentsService.validateSilentPaymentAddress(dummySp1);
    expect(valid.valid).toBe(true);
    expect(valid.network).toBe('mainnet');

    const invalid = silentPaymentsService.validateSilentPaymentAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(invalid.valid).toBe(false);
  });

  it('should validate PSBT header and proprietary fields', () => {
    const validPsbtBase64 = Buffer.from('psbt\xff\x01\x00', 'utf8').toString('base64');
    const result = silentPaymentsService.validatePsbtFields(validPsbtBase64);
    expect(result.valid).toBe(true);

    const invalidPsbt = Buffer.from('invalid-data').toString('base64');
    const invalidResult = silentPaymentsService.validatePsbtFields(invalidPsbt);
    expect(invalidResult.valid).toBe(false);
  });
});
