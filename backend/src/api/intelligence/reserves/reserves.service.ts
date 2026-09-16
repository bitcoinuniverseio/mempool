import { providerDirectory, signedSnapshots } from './reserves-source';
import { verifyBip127 } from './bip127-proof';
import { verifyLiabilityProof } from './liability-proof';
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
  'The operator reserves trust registry or signed attestation source is not configured. Provider identity and snapshot evidence cannot be inferred from caller input.';

/** Pinned provider sources, committed liability inclusion and current owned UTXO proof checks. */export class ReservesService {
  private static instance: ReservesService;

  public static getInstance(): ReservesService {
    if (!ReservesService.instance) {
      ReservesService.instance = new ReservesService();
    }
    return ReservesService.instance;
  }

  public getOverview(): ReservesOverview {
    const providers=this.getProviders();
    const recent_snapshots=process.env.UNIVERSE_RESERVES_ATTESTATIONS ? this.getSnapshots().slice(-20).reverse() : [];
    return {attestation_source_status:process.env.UNIVERSE_RESERVES_ATTESTATIONS ? 'validated' : 'unconfigured',total_tracked_reserve_sats:null,total_tracked_liability_sats:null,overall_solvency_percentage:null,active_providers_count:providers.length,recent_snapshots,providers,last_updated:new Date().toISOString()};
  }
  public getProviders(): ReserveProvider[] {
    if(!process.env.UNIVERSE_RESERVES_TRUST_STORE) throw new ReservesEvidenceError('unavailable-attestation-ingest',attestationsUnavailable);
    try{return providerDirectory();}catch{throw new ReservesEvidenceError('invalid-trust-source','The operator reserves trust registry is invalid or unreadable.');}
  }
  public getProviderById(providerId:string):ReserveProvider|undefined{return this.getProviders().find(p=>p.provider_id===providerId);}
  public getSnapshots(providerId?:string):ReserveSnapshot[]{
    if(!process.env.UNIVERSE_RESERVES_ATTESTATIONS)throw new ReservesEvidenceError('unavailable-attestation-ingest',attestationsUnavailable);
    try{return signedSnapshots().filter(s=>!providerId||s.provider_id===providerId);}catch{throw new ReservesEvidenceError('invalid-attestation-source','The operator attestation source is invalid, expired, untrusted or unreadable.');}
  }
  public getSnapshotById(snapshotId:string):ReserveSnapshot|undefined{return this.getSnapshots().find(s=>s.snapshot_id===snapshotId);}
  public async verifyProof(req: VerificationRequest): Promise<VerificationResult> {
    if (!req || !['bip127','merkle_inclusion'].includes(req.proof_type)) throw new ReservesEvidenceError('invalid-proof', 'proof_type must be bip127 or merkle_inclusion.', 400);
    const evaluatedAt = new Date().toISOString();

    if (req.proof_type === 'bip127') {
      try { return { ...await verifyBip127(req.bip127_proof), proof_type:'bip127', evaluated_at:evaluatedAt }; }
      catch (error) { return { verified:false, proof_type:'bip127', total_verified_sats:0, verified_items_count:0, errors:[error instanceof Error ? error.message : 'BIP127 verification unavailable.'], attestation_digest:'', evaluated_at:evaluatedAt }; }
    }
    if (req.proof_type === 'merkle_inclusion') {
      try { return { ...verifyLiabilityProof(req.merkle_proof), proof_type: 'merkle_inclusion', evaluated_at: evaluatedAt }; }
      catch (error) { return { verified:false, proof_type:'merkle_inclusion', total_verified_sats:0, verified_items_count:0, inclusion_verified:false, authenticated_root:false, solvency_verified:false, included_liability_sats:0, errors:[error instanceof Error ? error.message : 'Invalid proof.'], attestation_digest:'', evaluated_at:evaluatedAt }; }
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
