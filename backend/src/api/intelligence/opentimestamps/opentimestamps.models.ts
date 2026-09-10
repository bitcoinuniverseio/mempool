export type TimestampProofStatus =
  | 'digest_matches'
  | 'proof_structure_valid'
  | 'pending_calendar_attestation'
  | 'bitcoin_attestation_verified'
  | 'bitcoin_attestation_invalid'
  | 'file_mismatch'
  | 'proof_incomplete'
  | 'unsupported_operation'
  | 'unsupported_attestation'
  | 'bitcoin_attestation_reorg'
  | 'calendar_unavailable'
  | 'network_mismatch'
  | 'conflicting_attestations';

/**
 * A calendar on the allowlist, as this deployment has observed it. Health is
 * what the last contact found; the anchor figures count proofs made here that
 * the calendar anchored. A calendar's own queue depth and transactions are not
 * visible through its protocol, so those fields are null rather than guessed.
 */
export interface TimestampCalendar {
  calendar_id: string;
  name: string;
  url: string;
  protocol_revision: string;
  health_status: 'online' | 'degraded' | 'offline';
  health_observed_at: string | null;
  health_detail: string;
  /** Stamps made here that this calendar promised and has not yet anchored. */
  pending_attestations_count: number;
  anchored_proofs_count: number;
  average_anchor_lag_blocks: number | null;
  last_anchor_block_height: number | null;
  last_anchor_txid: string | null;
  mirror_calendars: string[];
}

/** One stamp made here: a batch of one digest, keyed by its record id. */
export interface TimestampBatch {
  batch_id: string;
  calendar_id: string;
  merkle_root: string;
  leaf_count: number;
  created_at_utc: string;
  anchor_block_height?: number;
  anchor_block_hash?: string;
  status: 'pending' | 'anchored' | 'failed';
  digest: string;
  network: string;
  last_error?: string;
}

/**
 * A Bitcoin block that anchored proofs made here through one calendar. An
 * OpenTimestamps proof commits to the block's Merkle root and never names the
 * calendar's transaction, so there is no txid to report.
 */
export interface TimestampAnchorTransaction {
  batch_id: string;
  block_hash: string;
  block_height: number;
  block_timestamp_utc: string;
  anchored_at: string;
  calendar_id: string;
  batch_count: number;
  leaf_count: number;
  merkle_root: string;
}

export interface TimestampStampResult {
  record_id: string;
  batch_id: string;
  digest: string;
  network: string;
  commitment: string;
  ots_proof_base64: string;
  status: 'pending';
  calendars_contacted: { calendar_id: string; url: string; status: 'pending' | 'unreachable'; error?: string }[];
  timestamp: string;
  notices: string[];
}

export interface TimestampUpgradeResult {
  upgraded: boolean;
  changed: boolean;
  ots_proof_base64: string;
  status: TimestampProofStatus;
  verified: boolean;
  verification: TimestampVerificationResult;
  /**
   * Per calendar: `pending` while it holds only a promise, `upgraded` when it
   * returned a Bitcoin attestation that the owned reader has not verified,
   * `verified` only after that attestation verified, `unreachable` otherwise.
   */
  calendars: { calendar_id?: string; calendar_url: string; status: 'pending' | 'upgraded' | 'verified' | 'unreachable'; detail: string }[];
  notices: string[];
}

export interface TimestampVerificationResult {
  status: TimestampProofStatus;
  verified: boolean;
  digest_matches: boolean | null;
  file_digest: string;
  file_hash_algorithm: 'sha1' | 'ripemd160' | 'sha256' | 'keccak256';
  network: string;
  attestation_type?: 'bitcoin';
  bitcoin_block_hash?: string;
  earliest_proven_block_height?: number;
  earliest_proven_time_utc?: string;
  bitcoin_txid?: string;
  calendar_attestations: {
    calendar_url: string;
    status: 'pending' | 'verified' | 'unreachable';
    attestation_time?: string;
  }[];
  operation_count: number;
  notices: string[];
  errors: string[];
}

export interface TimestampOverview {
  total_active_calendars: number;
  total_verified_anchors_count: number;
  total_digests_stamped_24h: number;
  latest_bitcoin_anchor_height: number;
  active_calendars: TimestampCalendar[];
  recent_batches: TimestampBatch[];
  recent_anchors: TimestampAnchorTransaction[];
  total_proofs_tracked: number;
  bitcoin_confirmed_proofs: number;
  pending_calendar_attestations: number;
  failed_submissions: number;
  active_calendar_servers: number;
  latest_anchored_block_height: number | null;
  network: string;
  /** False when the deployment named no calendar; stamping is unavailable then. */
  calendars_configured: boolean;
  /** Where the records live. Memory records do not survive a restart. */
  storage: 'mysql' | 'memory';
  generated_at: string;
}
