import * as crypto from 'crypto';
import * as secp256k1 from 'tiny-secp256k1';
import { ecashService, EcashUnavailableError, claimDigest } from './ecash.service';

describe('ecash providers: configured mints and signed claims', () => {
  beforeEach(() => { ecashService.resetForTests(); ecashService.configuredMints = () => []; });

  it('is unavailable until a mint is configured, and federations need a client', async () => {
    await expect(ecashService.getMints()).rejects.toThrow(EcashUnavailableError);
    await expect(ecashService.getOverview()).rejects.toThrow(/UNIVERSE_ECASH_MINTS/);
    expect(() => ecashService.getFederations()).toThrow(/Fedimint client/);
  });

  it('reads each configured mint through its own NUT-06 and NUT-02 endpoints', async () => {
    ecashService.configuredMints = () => ['https://mint.example.org', 'https://down.example.org'];
    const identity = await import('../identity/developer-identity');
    jest.spyOn(identity, 'resolvePublicAddress').mockResolvedValue({ address: '203.0.113.5', family: 4 });
    ecashService.fetcher = async (url, _address, path) => {
      if (!url.hostname.startsWith('mint')) { return { status: null, json: null, error: 'ETIMEDOUT' }; }
      if (path === '/v1/info') { return { status: 200, json: { name: 'Example Mint', nuts: { '4': {}, '5': {}, '7': {} } }, error: null }; }
      return { status: 200, json: { keysets: [{ id: '00a1', unit: 'sat', active: true }, { id: '00b2', unit: 'sat', active: false }] }, error: null };
    };
    const mints = await ecashService.getMints();
    expect(mints[0]).toMatchObject({ name: 'Example Mint', nuts_supported: [4, 5, 7], active_keysets_count: 1, reachable: true, error: null });
    expect(mints[0].keysets).toHaveLength(2);
    expect(mints[1]).toMatchObject({ name: null, reachable: false, error: 'ETIMEDOUT', keysets: [] });
    expect(await ecashService.getMintById(mints[0].mint_id)).toMatchObject({ name: 'Example Mint' });
    expect(await ecashService.getMintById('mint-none')).toBeNull();
    const overview = await ecashService.getOverview();
    expect(overview).toMatchObject({ total_cashu_mints: 2, reachable_cashu_mints: 1, total_fedimint_federations: null, active_claims_count: null, federations: [] });
  });

  it('a claim is verified only by its signature, and nothing is registered', () => {
    const privateKey = crypto.randomBytes(32);
    const pubkey = Buffer.from(secp256k1.pointFromScalar(privateKey, true)!).toString('hex');
    const body = { provider_type: 'cashu_mint' as const, identifier: 'mint-1', domain: 'mint.example.org' };
    const signature = Buffer.from(secp256k1.signSchnorr(claimDigest(body), privateKey)).toString('hex');
    const verified = ecashService.verifyClaim({ ...body, operator_pubkey: pubkey, attestation_signature: signature });
    expect(verified).toMatchObject({ verified: true, scheme: 'schnorr', registered: false });
    expect(verified.verified_at).not.toBeNull();
    const forged = ecashService.verifyClaim({ ...body, operator_pubkey: pubkey, attestation_signature: crypto.randomBytes(64).toString('hex') });
    expect(forged).toMatchObject({ verified: false, verified_at: null });
    expect(forged.reason).toMatch(/does not verify/);
    expect(() => ecashService.verifyClaim({ domain: 'x' })).toThrow(/required/);
    expect(() => ecashService.verifyClaim({ ...body, provider_type: 'bank' as never, operator_pubkey: pubkey, attestation_signature: signature })).toThrow(/provider_type/);
  });
});
