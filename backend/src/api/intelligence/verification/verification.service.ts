export interface SpvMerkleProof {
  txid: string;
  block_hash: string;
  block_height: number;
  tx_index: number;
  merkle_root: string;
  hashes: string[];
  flags: string;
  is_verified: boolean;
  generated_at_utc: string;
}

export interface CompactFilterResult {
  block_hash: string;
  block_height: number;
  filter_type: 'bip158_basic';
  filter_hex: string;
  matched: boolean;
  query_scripts: string[];
}

export interface SignatureVerificationResult {
  address: string;
  message: string;
  signature: string;
  format: 'bip137' | 'bip322_simple' | 'bip322_full';
  is_valid: boolean;
  signer_pubkey?: string;
  error?: string;
}

export interface ConsensusIncident {
  incident_id: string;
  incident_type: 'reorg' | 'invalid_block' | 'stale_tip' | 'consensus_divergence';
  title: string;
  block_height: number;
  block_hash: string;
  detected_at_utc: string;
  resolved_at_utc: string;
  duration_seconds: number;
  reorg_depth: number;
  displaced_tx_count: number;
  double_spend_attempts_count: number;
  status: 'resolved' | 'investigating' | 'mitigated';
  summary: string;
  technical_postmortem: string;
}

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class VerificationEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const bitcoinReaderUnavailable =
  'Proof observations are unavailable. SPV inclusion proofs, proof verification and BIP158 compact filter queries require the owned Bitcoin reader (bitcoind gettxoutproof, verifytxoutproof and getblockfilter), which is not connected on this deployment.';

const signatureVerifierUnavailable =
  'Signature verification is unavailable. BIP137 and BIP322 verdicts require the owned message signature verifier (UNIVERSE_SIGNATURE_VERIFIER_ORIGIN), which is not connected on this deployment. No signature was checked.';

const incidentLedgerUnavailable =
  'Consensus incident observations are unavailable. Reorg, invalid block and stale tip incidents require the owned consensus incident ledger fed by the owned chain monitor (UNIVERSE_INCIDENT_LEDGER_ORIGIN), which is not connected on this deployment.';

/**
 * Proof, signature and consensus incident evidence.
 *
 * Every answer here used to be invented: an SPV proof whose merkle root was
 * the hash of the txid, a compact filter that matched any nonempty script, a
 * signature that was valid because it was long enough with the secp256k1
 * generator point as its signer, and two incidents with invented block
 * hashes. No owned Bitcoin reader, signature verifier or incident ledger is
 * connected, so each read reports the source it would need.
 */
export class VerificationService {
  private static instance: VerificationService;

  private constructor() {}

  public static getInstance(): VerificationService {
    if (!VerificationService.instance) {
      VerificationService.instance = new VerificationService();
    }
    return VerificationService.instance;
  }

  public generateSpvProof(txid: string, blockHash: string, blockHeight?: number): SpvMerkleProof {
    void txid; void blockHash; void blockHeight;
    throw new VerificationEvidenceError('unavailable-bitcoin-reader', bitcoinReaderUnavailable);
  }

  public verifySpvProof(proof: SpvMerkleProof): boolean {
    void proof;
    throw new VerificationEvidenceError('unavailable-bitcoin-reader', bitcoinReaderUnavailable);
  }

  public queryCompactFilter(blockHash: string, scriptHexes: string[]): CompactFilterResult {
    void blockHash; void scriptHexes;
    throw new VerificationEvidenceError('unavailable-bitcoin-reader', bitcoinReaderUnavailable);
  }

  public verifySignature(
    address: string,
    message: string,
    signature: string,
    format: 'bip137' | 'bip322_simple' | 'bip322_full' = 'bip322_simple'
  ): SignatureVerificationResult {
    void address; void message; void signature; void format;
    throw new VerificationEvidenceError('unavailable-signature-verifier', signatureVerifierUnavailable);
  }

  public getIncidents(): ConsensusIncident[] {
    throw new VerificationEvidenceError('unavailable-incident-ledger', incidentLedgerUnavailable);
  }

  public getIncidentById(incidentId: string): ConsensusIncident | null {
    void incidentId;
    throw new VerificationEvidenceError('unavailable-incident-ledger', incidentLedgerUnavailable);
  }
}

export const verificationService = VerificationService.getInstance();
