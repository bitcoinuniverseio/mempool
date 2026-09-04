import { ecashService } from './ecash.service';

describe('EcashService', () => {
  it('should return overview with mints and federations', () => {
    const overview = ecashService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.total_cashu_mints).toBeGreaterThan(0);
    expect(overview.total_fedimint_federations).toBeGreaterThan(0);
    expect(overview.total_verified_guardians).toBeGreaterThan(0);
  });

  it('should fetch Cashu mint by ID with supported NUTs', () => {
    const mint = ecashService.getMintById('mint-minibits');
    expect(mint).not.toBeNull();
    expect(mint?.nuts_supported).toContain(0);
    expect(mint?.keysets.length).toBeGreaterThan(0);
  });

  it('should fetch Fedimint federation by ID with guardian quorum', () => {
    const fed = ecashService.getFederationById('fed-mutiny-net');
    expect(fed).not.toBeNull();
    expect(fed?.guardians_count).toBe(5);
    expect(fed?.threshold).toBe(3);
    expect(fed?.modules).toContain('mint');
  });

  it('should register signed provider claims', () => {
    const claim = ecashService.registerClaim({
      provider_type: 'cashu_mint',
      identifier: 'mint-macadamia',
      domain: 'mint.macadamia.cash',
      operator_pubkey: '0289a1c2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123456789abcd',
      attestation_signature: 'abcdef1234567890',
    });
    expect(claim.claim_id).toBeDefined();
    expect(claim.verified_at).toBeDefined();
  });
});
