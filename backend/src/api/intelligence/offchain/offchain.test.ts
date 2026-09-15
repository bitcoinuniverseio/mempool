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
    const manifest = { schema_version: '1', protocol: 'mercury_statechain', operator_public_key: publicKey.toString('hex'), display_name: 'Signed', networks: ['signet'], endpoints: {}, supported_versions: ['v1'], backup_transaction_policy: 'decrementing', signature_count_endpoint: 'https://x/count', effective_from: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', nonce: 'n' };
    const schnorr = Buffer.from(secp256k1.signSchnorr(manifestDigest(manifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...manifest, signature: schnorr })).toEqual({ valid: true, scheme: 'schnorr', reason: null });
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr }).verified).toBe(true);
    const ecdsa = Buffer.from(secp256k1.sign(manifestDigest(manifest), privateKey)).toString('hex');
    expect(verifyManifestSignature({ ...manifest, signature: ecdsa }).scheme).toBe('ecdsa');
    // A non-empty but wrong signature is not verified; neither is a tampered body.
    expect(offchainService.verifyManifest({ ...manifest, signature: 'ab'.repeat(64) })).toMatchObject({ verified: false });
    expect(offchainService.verifyManifest({ ...manifest, display_name: 'Tampered', signature: schnorr }).verified).toBe(false);
    expect(offchainService.verifyManifest({ ...manifest, signature: schnorr, expires_at: '2020-01-01T00:00:00Z' }).errors).toContain('Manifest has expired');
    expect(offchainService.verifyManifest({ protocol: 'x', operator_public_key: 'short', signature: 'sig' }).errors.length).toBeGreaterThan(0);
  });
  it('should verify statechain transfer packages and detect locktime violations', () => {
    const valid = offchainService.verifyTransferPackage({
      statechain_id: 'sc-test-01',
      deposit_amount_sats: 1000000,
      backup_transactions: [
        {
          statechain_id: 'sc-test-01',
          iteration: 1,
          locktime: 865000,
          txid: '01'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig1',
          is_valid_locktime_decrement: true,
        },
        {
          statechain_id: 'sc-test-01',
          iteration: 2,
          locktime: 864000,
          txid: '02'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig2',
          is_valid_locktime_decrement: true,
        },
      ],
      server_signature_count: 2,
      current_height: 860500,
    });
    expect(valid.is_valid).toBe(true);
    expect(valid.signatures_reconciled).toBe(true);
    expect(valid.recoverable_state).toBe('recoverable_after_height');

    const locktimeViolation = offchainService.verifyTransferPackage({
      statechain_id: 'sc-test-02',
      deposit_amount_sats: 1000000,
      backup_transactions: [
        {
          statechain_id: 'sc-test-02',
          iteration: 1,
          locktime: 864000,
          txid: '01'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig1',
          is_valid_locktime_decrement: true,
        },
        {
          statechain_id: 'sc-test-02',
          iteration: 2,
          locktime: 865000, // Invalid: increased locktime
          txid: '02'.repeat(32),
          input_outpoint: '00'.repeat(32) + ':0',
          output_address: 'bc1q...',
          output_value_sats: 998000,
          fee_sats: 2000,
          server_signature: 'sig2',
          is_valid_locktime_decrement: false,
        },
      ],
      server_signature_count: 2,
      current_height: 860500,
    });
    expect(locktimeViolation.is_valid).toBe(false);
    expect(locktimeViolation.errors.length).toBeGreaterThan(0);
  });

  it('should verify coinswap timelock ordering and detect reversed locks', () => {
    const valid = offchainService.verifyCoinswapPackage({
      package_id: 'pkg-swap-01',
      maker_id: 'op-teleport-beta',
      swap_amount_sats: 500000,
      contracts: [
        {
          role: 'forward_contract',
          txid: '11'.repeat(32),
          timelock: 861000,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: true,
        },
        {
          role: 'backward_contract',
          txid: '22'.repeat(32),
          timelock: 860800,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: true,
        },
      ],
    });
    expect(valid.is_valid).toBe(true);

    const reversed = offchainService.verifyCoinswapPackage({
      package_id: 'pkg-swap-02',
      maker_id: 'op-teleport-beta',
      swap_amount_sats: 500000,
      contracts: [
        {
          role: 'forward_contract',
          txid: '11'.repeat(32),
          timelock: 860500,
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: false,
        },
        {
          role: 'backward_contract',
          txid: '22'.repeat(32),
          timelock: 860900, // Invalid: backward has larger timelock than forward
          hashlock: 'hash1',
          value_sats: 500000,
          is_valid_timeout_order: false,
        },
      ],
    });
    expect(reversed.is_valid).toBe(false);
    expect(reversed.errors).toContain(
      'Forward contract timelock must be strictly greater than backward contract timelock for safe recovery'
    );
  });

  it('recovery plans state timing from real heights and never hand out a constant PSBT', () => {
    const now = offchainService.generateRecoveryPlan({ protocol: 'statechain', entity_id: 'sc-test-01', current_stage: 'locktime_expired', target_locktime: 860000 });
    expect(now).toMatchObject({ recovery_state: 'recoverable_now', requires_fee_bump: true, suggested_fee_rate_sats_vb: 7, unsigned_psbt_hex: null, earliest_broadcast_height: 860000 });
    const later = offchainService.generateRecoveryPlan({ protocol: 'coinswap', entity_id: 'cs-1', current_stage: 'x', target_locktime: 870000 });
    expect(later.recovery_state).toBe('recoverable_after_height');
    expect(later.action_guidance).toContain('870000');
    const unknown = offchainService.generateRecoveryPlan({ protocol: 'coinswap', entity_id: 'cs-1', current_stage: 'x' });
    expect(unknown.recovery_state).toBe('unknown');
  });

  it('coinswap packages never report watchtower coverage this deployment cannot see', () => {
    const result = offchainService.verifyCoinswapPackage({ package_id: 'p', maker_id: 'm', swap_amount_sats: 1, contracts: [{ role: 'forward_contract', timelock: 200 }, { role: 'backward_contract', timelock: 100 }] });
    expect(result.is_valid).toBe(true);
    expect(result.watchtower_coverage_verified).toBe(false);
  });
});
