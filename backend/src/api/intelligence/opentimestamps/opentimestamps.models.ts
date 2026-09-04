export type TimestampProofStatus =
  | 'digest_matches'
  | 'proof_structure_valid'
  | 'pending_calendar_attestation'
  | 'bitcoin_attestation_verified'
  | 'bitcoin_attestation_invalid'
  | 'file_mismatch'
  | 'proof_incomplete'
  | 'unsupported_operation'
  | 'calendar_unavailable'
  | 'network_mismatch'
  | 'conflicting_attestations';

export interface TimestampCalendar {
  calendar_id: string;
  name: string;
  url: string;
  protocol_revision: string;
  health_status: 'online' | 'degraded' | 'offline';
  pending_attestations_count: number;
  average_anchor_lag_blocks: number;
  last_anchor_block_height: number;
  last_anchor_txid: string;
  mirror_calendars: string[];
}

export interface TimestampBatch {
  batch_id: string;
  calendar_id: string;
  merkle_root: string;
  leaf_count: number;
  created_at_utc: string;
  anchor_block_height?: number;
  anchor_txid?: string;
  status: 'pending' | 'anchored';
}

export interface TimestampAnchorTransaction {
  txid: string;
  block_hash: string;
  block_height: number;
  block_timestamp_utc: string;
  op_return_payload_hex: string;
  calendar_id: string;
  batch_count: number;
}

export interface TimestampVerificationResult {
  status: TimestampProofStatus;
  verified: boolean;
  digest_matches: boolean;
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
}
