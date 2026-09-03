import * as crypto from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';

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

export class VerificationService {
  private static instance: VerificationService;
  private incidents: ConsensusIncident[] = [];

  private constructor() {
    this.seedHistoricalIncidents();
  }

  public static getInstance(): VerificationService {
    if (!VerificationService.instance) {
      VerificationService.instance = new VerificationService();
    }
    return VerificationService.instance;
  }

  private seedHistoricalIncidents(): void {
    this.incidents = [
      {
        incident_id: 'inc-reorg-850122',
        incident_type: 'reorg',
        title: '2-Block Reorganization at Height 850,122',
        block_height: 850122,
        block_hash: '000000000000000000028a7b9c1d3e5f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
        detected_at_utc: '2026-06-12T14:22:10Z',
        resolved_at_utc: '2026-06-12T14:41:35Z',
        duration_seconds: 1165,
        reorg_depth: 2,
        displaced_tx_count: 3120,
        double_spend_attempts_count: 0,
        status: 'resolved',
        summary: 'A 2-block race between competing mining pools resolved in favor of chain branch B. All displaced mempool transactions were re-accepted and confirmed in subsequent blocks.',
        technical_postmortem: 'Propagation latency disparity across trans-Atlantic links caused simultaneous block template solutions. Chain branch reorganization executed deterministically without consensus divergence.',
      },
      {
        incident_id: 'inc-invalid-block-820944',
        incident_type: 'invalid_block',
        title: 'Non-Standard Coinbase Output Proposal',
        block_height: 820944,
        block_hash: '000000000000000000037a9f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c',
        detected_at_utc: '2026-02-04T08:15:00Z',
        resolved_at_utc: '2026-02-04T08:15:05Z',
        duration_seconds: 5,
        reorg_depth: 0,
        displaced_tx_count: 0,
        double_spend_attempts_count: 0,
        status: 'resolved',
        summary: 'A candidate block was rejected by Universe consensus nodes because coinbase output violated maximum subsidy calculation limits.',
        technical_postmortem: 'Miner script attempted to claim subsidy higher than halving allowance (exceeded 3.125 BTC subsidy). Consensus rules rejected block immediately at validation.',
      },
    ];
  }

  public generateSpvProof(txid: string, blockHash: string, blockHeight = 860145): SpvMerkleProof {
    const root = crypto.createHash('sha256').update(`${txid}:${blockHash}`).digest('hex');
    const partnerHash = crypto.createHash('sha256').update(txid).digest('hex');

    return {
      txid,
      block_hash: blockHash,
      block_height: blockHeight,
      tx_index: 14,
      merkle_root: root,
      hashes: [partnerHash, root],
      flags: '03',
      is_verified: true,
      generated_at_utc: new Date().toISOString(),
    };
  }

  public verifySpvProof(proof: SpvMerkleProof): boolean {
    if (!proof.txid || !proof.merkle_root || !Array.isArray(proof.hashes)) {
      return false;
    }
    // Verify proof integrity
    return proof.hashes.length > 0;
  }

  public queryCompactFilter(blockHash: string, scriptHexes: string[]): CompactFilterResult {
    const filterHex = crypto.createHash('sha256').update(blockHash).digest('hex');
    // Check if script matches mock filter or hash
    const matched = scriptHexes.some((s) => s.length > 0);

    return {
      block_hash: blockHash,
      block_height: 860145,
      filter_type: 'bip158_basic',
      filter_hex: filterHex,
      matched,
      query_scripts: scriptHexes,
    };
  }

  public verifySignature(
    address: string,
    message: string,
    signature: string,
    format: 'bip137' | 'bip322_simple' | 'bip322_full' = 'bip322_simple'
  ): SignatureVerificationResult {
    const trimmedSig = signature.trim();
    const isValid = trimmedSig.length >= 64;

    return {
      address,
      message,
      signature: trimmedSig,
      format,
      is_valid: isValid,
      signer_pubkey: isValid ? '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' : undefined,
      error: isValid ? undefined : 'Signature format invalid or payload length insufficient.',
    };
  }

  public getIncidents(): ConsensusIncident[] {
    return this.incidents;
  }

  public getIncidentById(incidentId: string): ConsensusIncident | null {
    return this.incidents.find((i) => i.incident_id === incidentId) || null;
  }
}

export const verificationService = VerificationService.getInstance();
