import { SpvProofReader } from './spv-proof';
import { VerificationEvidenceError } from './verification-errors';
import { verifyMessageSignature } from './message-signature';
import { coreFilterSource } from '../compact-filters/core-filter-source';
import { matchesBasicFilter } from '../compact-filters/bip158';
import { CompactFiltersEvidenceError } from '../compact-filters/compact-filters.service';
import config from '../../../config';
import { configuredIncidentMonitor } from './incident-monitor';
export { ConsensusIncident } from './incident-types';
export { VerificationEvidenceError } from './verification-errors';
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

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */

/**
 * Proof, signature and consensus incident evidence.
 *
 * Every answer here used to be invented: an SPV proof whose merkle root was
 * the hash of the txid, a compact filter that matched any nonempty script, a
 * signature that was valid because it was long enough with the secp256k1
 * generator point as its signer, and two incidents with invented block
 * hashes. SPV inclusion uses owned Core and an independent Merkle decoder.
 * Incident reads require registered operator-pinned node observations and a
 * durable bounded ledger. Unknown transaction effects and consensus verdicts
 * remain unavailable; an empty retained window proves no global agreement.
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

  public async generateSpvProof(txid: string, blockHash: string, blockHeight?: number, network?: string) {
    return new SpvProofReader().generate({ txid, block_hash: blockHash, block_height: blockHeight, network });
  }

  public async verifySpvProof(proof: unknown) {
    return new SpvProofReader().verify(proof);
  }

  public async queryCompactFilter(blockHash: string, scriptHexes: string[], network: string = config.MEMPOOL.NETWORK) {
    if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash) || !Array.isArray(scriptHexes) || !scriptHexes.length || scriptHexes.length > 1000
      || scriptHexes.some(value => typeof value !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/i.test(value)) || scriptHexes.join('').length > 2000000) {
      throw new VerificationEvidenceError('invalid-filter-query', 'Provide a block hash and 1 to 1000 bounded hexadecimal scripts, at most 1 MB total.', 400);
    }
    try {
      const filter = await coreFilterSource.getBlock(blockHash, network === 'mainnet' ? 'main' : network === 'testnet' ? 'test' : network);
      return { block_hash: blockHash, block_height: filter.block_height, filter_type: 'bip158_basic', filter_hex: filter.filter_bytes_hex,
        matched: matchesBasicFilter(filter.filter_bytes_hex, blockHash, scriptHexes.map(value => Buffer.from(value, 'hex'))), query_scripts: scriptHexes,
        network, filter_header: filter.filter_header, source: filter.source, content_recomputed: false, peer_agreement: null,
        verification_scope: 'Owned active-chain basic-filter index and header-link readback, with local BIP158 matching. Matches can be false positives; this does not establish a transaction or balance.' };
    } catch (error) {
      if (error instanceof CompactFiltersEvidenceError) throw new VerificationEvidenceError(error.code, error.message, error.status);
      throw new VerificationEvidenceError('unavailable-filter-index', 'The owned basic filter source could not establish a matching verdict.');
    }
  }

  public async verifySignature(
    address: string,
    message: string,
    signature: string,
    format: 'bip137' | 'bip322_simple' | 'bip322_full' = 'bip322_simple', network?: string
  ) {
    return verifyMessageSignature(address, message, signature, format, network);
  }

  /** @asyncUnsafe Bounded source and ledger errors are normalized by the route. */
  public async getIncidents(network: string = config.MEMPOOL.NETWORK) {
    return (await configuredIncidentMonitor()).observe(network);
  }

  /** @asyncUnsafe Bounded source and ledger errors are normalized by the route. */
  public async getIncidentById(incidentId: string, network: string = config.MEMPOOL.NETWORK) {
    if (!/^[0-9a-f]{64}$/.test(incidentId)) throw new VerificationEvidenceError('invalid-incident-id', 'Supply an observed incident identifier.', 400);
    const response = await this.getIncidents(network);
    const incident = response.incidents.find(row => row.incident_id === incidentId);
    return incident ? { ...incident, schema: response.schema, network: response.network, profile_sha256: response.profile_sha256,
      profile: response.profile, observed_at_utc: response.observed_at_utc, sources: response.sources, coverage: response.coverage } : null;
  }
}

export const verificationService = VerificationService.getInstance();
