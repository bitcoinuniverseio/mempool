import { reservesService } from './reserves.service';
import crypto from 'crypto';

describe('ReservesService', () => {
  it('should return reserves overview with solvency metrics', () => {
    const overview = reservesService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.total_tracked_reserve_sats).toBeGreaterThan(0);
    expect(overview.total_tracked_liability_sats).toBeGreaterThan(0);
    expect(overview.overall_solvency_percentage).toBeGreaterThanOrEqual(100);
    expect(overview.providers.length).toBeGreaterThan(0);
    expect(overview.recent_snapshots.length).toBeGreaterThan(0);
  });

  it('should retrieve providers and single provider by id', () => {
    const providers = reservesService.getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);

    const first = providers[0];
    const found = reservesService.getProviderById(first.provider_id);
    expect(found).toBeDefined();
    expect(found?.name).toBe(first.name);

    const notFound = reservesService.getProviderById('nonexistent-id');
    expect(notFound).toBeUndefined();
  });

  it('should retrieve snapshots and filter by provider', () => {
    const snapshots = reservesService.getSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);

    const first = snapshots[0];
    const filtered = reservesService.getSnapshots(first.provider_id);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every(s => s.provider_id === first.provider_id)).toBe(true);

    const single = reservesService.getSnapshotById(first.snapshot_id);
    expect(single).toBeDefined();
    expect(single?.snapshot_id).toBe(first.snapshot_id);
  });

  it('should verify BIP127 proof package', () => {
    const res = reservesService.verifyProof({
      proof_type: 'bip127',
      bip127_proof: {
        expected_message: 'ProofOfReserves-2026-09-04',
        items: [
          {
            txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            vout: 0,
            amount_sats: 50000000,
            address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
            message: 'ProofOfReserves-2026-09-04',
            signature: '30440220...sig...',
            public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          },
        ],
      },
    });

    expect(res.verified).toBe(true);
    expect(res.proof_type).toBe('bip127');
    expect(res.total_verified_sats).toBe(50000000);
    expect(res.attestation_digest).toBeDefined();
  });

  it('should verify Merkle inclusion proof', () => {
    const leaf = crypto.createHash('sha256').update('leaf-data').digest('hex');
    const sibling = crypto.createHash('sha256').update('sibling-data').digest('hex');

    const h = crypto.createHash('sha256');
    if (leaf < sibling) {
      h.update(leaf + sibling);
    } else {
      h.update(sibling + leaf);
    }
    const root = h.digest('hex');

    const res = reservesService.verifyProof({
      proof_type: 'merkle_inclusion',
      merkle_proof: {
        merkle_root: root,
        leaf_hash: leaf,
        path: [sibling],
        index: 0,
        expected_liability_sats: 1000000,
      },
    });

    expect(res.verified).toBe(true);
    expect(res.total_verified_sats).toBe(1000000);
  });

  it('should reject invalid proof packages', () => {
    const res = reservesService.verifyProof({
      proof_type: 'bip127',
      bip127_proof: {
        expected_message: 'test',
        items: [],
      },
    });
    expect(res.verified).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
