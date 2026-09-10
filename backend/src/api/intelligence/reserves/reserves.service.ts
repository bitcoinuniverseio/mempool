import crypto from 'crypto';
import {
  ReserveProvider,
  ReserveSnapshot,
  VerificationRequest,
  VerificationResult,
  ReservesOverview,
} from './reserves.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class ReservesEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const attestationsUnavailable =
  'Reserve observations are unavailable. Provider directories, attestation snapshots and solvency ratios require the owned attestation ingest (signed BIP127 and Merkle-sum attestations checked against the owned Bitcoin UTXO reader), which is not connected on this deployment.';

/**
 * Proof-of-reserves evidence.
 *
 * Providers, snapshots and solvency figures are observations and need the
 * owned attestation ingest; a deployment without one gets a 503 that names it.
 * The proof verifier stays: it computes over the caller's own payload and
 * observes nothing.
 */
export class ReservesService {
  private static instance: ReservesService;

  public static getInstance(): ReservesService {
    if (!ReservesService.instance) {
      ReservesService.instance = new ReservesService();
    }
    return ReservesService.instance;
  }

  public getOverview(): ReservesOverview {
    throw new ReservesEvidenceError('unavailable-attestation-ingest', attestationsUnavailable);
  }

  public getProviders(): ReserveProvider[] {
    throw new ReservesEvidenceError('unavailable-attestation-ingest', attestationsUnavailable);
  }

  public getProviderById(_providerId: string): ReserveProvider | undefined {
    throw new ReservesEvidenceError('unavailable-attestation-ingest', attestationsUnavailable);
  }

  public getSnapshots(_providerId?: string): ReserveSnapshot[] {
    throw new ReservesEvidenceError('unavailable-attestation-ingest', attestationsUnavailable);
  }

  public getSnapshotById(_snapshotId: string): ReserveSnapshot | undefined {
    throw new ReservesEvidenceError('unavailable-attestation-ingest', attestationsUnavailable);
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

      for (const item of req.bip127_proof.items) {
        if (!item.signature || !item.public_key || !item.txid) {
          errors.push(`Malformed proof item for outpoint ${item.txid}:${item.vout}`);
        }
      }
      if (errors.length) {
        return {
          verified: false,
          proof_type: 'bip127',
          total_verified_sats: 0,
          verified_items_count: 0,
          errors,
          attestation_digest: '',
          evaluated_at: evaluatedAt,
        };
      }
      // A well-formed item is not a verified one: the signature has to be checked
      // against its key and the outpoint against the owned UTXO set, and neither
      // verifier is connected here. Reporting a total as verified would invent it.
      throw new ReservesEvidenceError('unavailable-verifier',
        'BIP127 attestations are not verified on this deployment. Checking each item signature against its public key and each outpoint against the owned Bitcoin UTXO reader requires the owned attestation verifier, which is not connected. No reserve was verified.');
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
