jest.mock('../../blocks', () => ({ __esModule: true, default: { getCurrentBlockHeight: () => 860500 } }));
jest.mock('../../fee-api', () => ({ __esModule: true, default: { getRecommendedFee: () => ({ halfHourFee: 7 }) } }));

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as secp256k1 from 'tiny-secp256k1';
import offchainService, { manifestDigest, verifyManifestSignature } from './offchain.service';

describe('OffchainService', () => {
  beforeEach(() => { offchainService.resetForTests(); offchainService.registryPath = () => undefined; });

  it('has no operators or offers unless a registry is configured, and says so', () => {
    const overview = offchainService.getOverview();
    expect(overview).toMatchObject({ total_operators: 0, active_coinswap_makers: 0, active_statechains_count: null, operators: [], public_offers: [] });
    expect(overview.registry).toEqual({ configured: false, source: null, error: null });
    expect(offchainService.listOperators()).toEqual([]);
    expect(offchainService.getOperator('op-mercury-alpha')).toBeNull();
    expect(offchainService.getOperatorHistory('op-mercury-alpha')).toEqual([]);
  });

  it('reads operators and offers from the configured registry file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offchain-registry-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, JSON.stringify({ operators: [{ operator_id: 'op-1', protocol: 'mercury_statechain', operator_public_key: '02' + 'ab'.repeat(32), display_name: 'One' }], offers: [{ offer_id: 'offer-1', maker_id: 'op-1' }], history: { 'op-1': [{ event_type: 'manifest_published' }] } }));
    offchainService.registryPath = () => file;
    const overview = offchainService.getOverview();
    expect(overview.total_operators).toBe(1);
    expect(overview.registry.configured).toBe(true);
    expect(offchainService.getOperator('op-1')?.display_name).toBe('One');
    expect(offchainService.getOperatorHistory('op-1')).toHaveLength(1);
    expect(offchainService.listOffers().map(o => o.offer_id)).toEqual(['offer-1']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a broken registry file is reported, not replaced with samples', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offchain-registry-'));
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, '{ not json');
    offchainService.registryPath = () => file;
    const overview = offchainService.getOverview();
    expect(overview.total_operators).toBe(0);
    expect(overview.registry.configured).toBe(true);
    expect(overview.registry.error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('verifies a manifest only when its signature checks out against the operator key', () => {
    const privateKey = crypto.randomBytes(32);
    const publicKey = Buffer.from(secp256k1.pointFromScalar(privateKey, true)!);
    const manifest = { signature_scheme: 'schnorr' as const, schema_version: '1', protocol: 'mercury_statechain', operator_public_key: publicKey.toString('hex'), display_name: 'Signed', networks: ['signet'], endpoints: {}, supported_versions: ['v1'], backup_transaction_policy: 'decrementing', signature_count_endpoint: 'https://x/count', effective_from: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', nonce: 'n' };
    const schnorr = Buffer.from(secp256k1.signSchnorr(manifestDigest(manifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...manifest, signature: schnorr })).toEqual({ valid: true, scheme: 'schnorr', reason: null });
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr }).verified).toBe(true);
    const ecdsaManifest = { ...manifest, signature_scheme: 'ecdsa' as const };
    const ecdsa = Buffer.from(secp256k1.sign(manifestDigest(ecdsaManifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...ecdsaManifest, signature: ecdsa }).scheme).toBe('ecdsa');
    // A non-empty but wrong signature is not verified; neither is a tampered body.
    expect(offchainService.verifyManifest({ ...manifest, signature: 'ab'.repeat(64) })).toMatchObject({ verified: false });
    expect(offchainService.verifyManifest({ ...manifest, display_name: 'Tampered', signature: schnorr }).verified).toBe(false);
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr, expires_at: '2020-01-01T00:00:00Z' }).errors).toContain('Manifest has expired');
    expect(offchainService.verifyManifest({ protocol: 'x', operator_public_key: 'short', signature: 'sig' }).errors.length).toBeGreaterThan(0);
  });
  it('rejects unsigned legacy metadata and fabricated heights', async () => {
    await expect(offchainService.verifyTransferPackage({ statechain_id: 'x', backup_transactions: [{ locktime: 5, server_signature: 'anything' }], current_height: 999999 })).rejects.toThrow('Unsupported protocol proof');
    await expect(offchainService.verifyCoinswapPackage({ package_id: 'x', contracts: [{ timelock: 200 }, { timelock: 100 }] })).rejects.toThrow('Unsupported protocol proof');
  });
  it('never authorizes recovery from a supplied height or target locktime', () => {
    for (const height of [1, 999999999]) {
      expect(offchainService.generateRecoveryPlan({ protocol: 'statechain', entity_id: 'x', current_stage: 'ready', target_locktime: 5, current_height: height })).toMatchObject({ recovery_state: 'insufficient_artifacts', earliest_broadcast_height: 0, requires_fee_bump: false, unsigned_psbt_hex: null });
    }
  });
});