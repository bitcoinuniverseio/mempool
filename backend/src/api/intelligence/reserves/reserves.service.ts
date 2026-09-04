import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  ReserveProvider,
  ReserveSnapshot,
  VerificationRequest,
  VerificationResult,
  ReservesOverview,
} from './reserves.models';

export class ReservesService {
  private static instance: ReservesService;
  private eventBus = IntelligenceEventBus.getInstance();

  private providers: ReserveProvider[] = [];
  private snapshots: ReserveSnapshot[] = [];

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): ReservesService {
    if (!ReservesService.instance) {
      ReservesService.instance = new ReservesService();
    }
    return ReservesService.instance;
  }

  private seedInitialData(): void {
    this.providers = [
      {
        provider_id: 'prov-bitreserve-custody',
        name: 'BitReserve Custody Ltd',
        category: 'custodian',
        attestation_frequency: 'daily',
        total_reserve_sats: 450000000000,
        total_liability_sats: 442000000000,
        solvency_ratio_percentage: 101.81,
        last_attestation_height: 860395,
        last_attestation_utc: new Date(Date.now() - 3600000).toISOString(),
        proof_standard: 'bip127',
        website_url: 'https://bitreserve.example.com',
        status: 'active',
      },
      {
        provider_id: 'prov-apex-exchange',
        name: 'Apex Global Exchange',
        category: 'exchange',
        attestation_frequency: 'daily',
        total_reserve_sats: 1250000000000,
        total_liability_sats: 1245000000000,
        solvency_ratio_percentage: 100.4,
        last_attestation_height: 860390,
        last_attestation_utc: new Date(Date.now() - 7200000).toISOString(),
        proof_standard: 'merkle_sum_tree',
        website_url: 'https://apex.example.com',
        status: 'active',
      },
      {
        provider_id: 'prov-wrapped-sats-bridge',
        name: 'Wrapped Bitcoin Federated Bridge',
        category: 'wrapped_token_custody',
        attestation_frequency: 'daily',
        total_reserve_sats: 82000000000,
        total_liability_sats: 82000000000,
        solvency_ratio_percentage: 100.0,
        last_attestation_height: 860400,
        last_attestation_utc: new Date(Date.now() - 1800000).toISOString(),
        proof_standard: 'bip127',
        website_url: 'https://wbridge.example.com',
        status: 'active',
      },
    ];

    this.snapshots = [
      {
        snapshot_id: 'snap-860395-bitreserve',
        provider_id: 'prov-bitreserve-custody',
        block_height: 860395,
        block_hash: '000000000000000000018a38b556b2cfd29cfd7b2787e38466b0f02359489ef0',
        timestamp_utc: new Date(Date.now() - 3600000).toISOString(),
        total_reserve_sats: 450000000000,
        total_liability_sats: 442000000000,
        solvency_ratio: 1.0181,
        merkle_root: '7e8f52f360982bb8a7e025816d28c89b70b5ee682ad4e031b40280f53f669db6',
        utxo_count: 320,
        signature_count: 320,
        verified_onchain: true,
      },
      {
        snapshot_id: 'snap-860390-apex',
        provider_id: 'prov-apex-exchange',
        block_height: 860390,
        block_hash: '000000000000000000021c479e43b1aa05fbe6089cd88f39105437894ea74c21',
        timestamp_utc: new Date(Date.now() - 7200000).toISOString(),
        total_reserve_sats: 1250000000000,
        total_liability_sats: 1245000000000,
        solvency_ratio: 1.004,
        merkle_root: '89a71b26859e0a293678da40179a9ef1c9b6342890cd18f6735ae15849cfb288',
        utxo_count: 850,
        signature_count: 850,
        verified_onchain: true,
      },
      {
        snapshot_id: 'snap-860400-wbridge',
        provider_id: 'prov-wrapped-sats-bridge',
        block_height: 860400,
        block_hash: '000000000000000000030da42345ef1300998341df9043219082348a94bcdd99',
        timestamp_utc: new Date(Date.now() - 1800000).toISOString(),
        total_reserve_sats: 82000000000,
        total_liability_sats: 82000000000,
        solvency_ratio: 1.0,
        merkle_root: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        utxo_count: 42,
        signature_count: 42,
        verified_onchain: true,
      },
    ];
  }

  public getOverview(): ReservesOverview {
    const totalReserves = this.providers.reduce((sum, p) => sum + p.total_reserve_sats, 0);
    const totalLiabilities = this.providers.reduce((sum, p) => sum + p.total_liability_sats, 0);
    const overallRatio = totalLiabilities > 0 ? (totalReserves / totalLiabilities) * 100 : 100;

    return {
      total_tracked_reserve_sats: totalReserves,
      total_tracked_liability_sats: totalLiabilities,
      overall_solvency_percentage: Math.round(overallRatio * 100) / 100,
      active_providers_count: this.providers.filter(p => p.status === 'active').length,
      recent_snapshots: this.snapshots,
      providers: this.providers,
      last_updated: new Date().toISOString(),
    };
  }

  public getProviders(): ReserveProvider[] {
    return this.providers;
  }

  public getProviderById(providerId: string): ReserveProvider | undefined {
    return this.providers.find(p => p.provider_id === providerId);
  }

  public getSnapshots(providerId?: string): ReserveSnapshot[] {
    if (providerId) {
      return this.snapshots.filter(s => s.provider_id === providerId);
    }
    return this.snapshots;
  }

  public getSnapshotById(snapshotId: string): ReserveSnapshot | undefined {
    return this.snapshots.find(s => s.snapshot_id === snapshotId);
  }

  public verifyProof(req: VerificationRequest): VerificationResult {
    const evaluatedAt = new Date().toISOString();
    const errors: string[] = [];

    if (req.proof_type === 'bip127') {
      if (!req.bip127_proof || !req.bip127_proof.items || req.bip127_proof.items.length === 0) {
        return {
          verified: false,
          proof_type: 'bip127',
          total_verified_sats: 0,
          verified_items_count: 0,
          errors: ['No proof items provided in BIP127 verification payload.'],
          attestation_digest: '',
          evaluated_at: evaluatedAt,
        };
      }

      let totalSats = 0;
      let validCount = 0;

      for (const item of req.bip127_proof.items) {
        if (!item.signature || !item.public_key || !item.txid) {
          errors.push(`Malformed proof item for outpoint ${item.txid}:${item.vout}`);
          continue;
        }
        totalSats += item.amount_sats;
        validCount++;
      }

      const hash = crypto.createHash('sha256');
      hash.update(req.bip127_proof.expected_message || '');
      hash.update(totalSats.toString());
      const digest = hash.digest('hex');

      return {
        verified: errors.length === 0 && validCount > 0,
        proof_type: 'bip127',
        total_verified_sats: totalSats,
        verified_items_count: validCount,
        errors,
        attestation_digest: digest,
        evaluated_at: evaluatedAt,
      };
    }

    if (req.proof_type === 'merkle_inclusion') {
      if (!req.merkle_proof) {
        return {
          verified: false,
          proof_type: 'merkle_inclusion',
          total_verified_sats: 0,
          verified_items_count: 0,
          errors: ['Merkle proof payload missing.'],
          attestation_digest: '',
          evaluated_at: evaluatedAt,
        };
      }

      const mp = req.merkle_proof;
      let currentHash = mp.leaf_hash;

      for (const sibling of mp.path) {
        const h = crypto.createHash('sha256');
        if (currentHash < sibling) {
          h.update(currentHash + sibling);
        } else {
          h.update(sibling + currentHash);
        }
        currentHash = h.digest('hex');
      }

      const verified = currentHash.toLowerCase() === mp.merkle_root.toLowerCase();
      if (!verified) {
        errors.push('Calculated Merkle root does not match declared root.');
      }

      return {
        verified,
        proof_type: 'merkle_inclusion',
        total_verified_sats: mp.expected_liability_sats || 0,
        verified_items_count: 1,
        errors,
        attestation_digest: currentHash,
        evaluated_at: evaluatedAt,
      };
    }

    return {
      verified: false,
      proof_type: req.proof_type,
      total_verified_sats: 0,
      verified_items_count: 0,
      errors: ['Unsupported proof verification standard.'],
      attestation_digest: '',
      evaluated_at: evaluatedAt,
    };
  }
}

export const reservesService = ReservesService.getInstance();
