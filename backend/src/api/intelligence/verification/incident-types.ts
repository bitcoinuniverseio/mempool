export interface IncidentSourceProfile {
  source_id: string;
  independence_id: string;
  implementation: 'bitcoin-core';
  source_revision: string | null;
  binary_sha256: string;
  configuration_sha256: string;
  genesis_hash: string;
  block_one_hash: string;
  signet_challenge: string | null;
}
export interface IncidentProfile {
  schema: 'universe-incident-profile-v1';
  network: 'mainnet' | 'testnet' | 'testnet4' | 'signet';
  stale_after_seconds: number;
  sources: IncidentSourceProfile[];
}
export interface IncidentHeader { height: number; hash: string; parent: string; timestamp: number }
export interface IncidentObservation {
  source_id: string;
  observed_at_utc: string;
  headers: IncidentHeader[];
}
export interface ConsensusIncident {
  incident_id: string;
  incident_type: 'reorg' | 'invalid_block' | 'stale_tip' | 'consensus_divergence' | 'node_tip_divergence';
  title: string;
  block_height: number;
  block_hash: string;
  detected_at_utc: string;
  resolved_at_utc: string | null;
  duration_seconds: number | null;
  reorg_depth: number | null;
  displaced_tx_count: number | null;
  double_spend_attempts_count: number | null;
  status: 'resolved' | 'investigating' | 'mitigated';
  summary: string;
  technical_postmortem: string;
  source_ids: string[];
  evidence: { before: IncidentHeader[]; after: IncidentHeader[]; common_ancestor: IncidentHeader | null };
  timeline: { observed_at_utc: string; stage: 'detected' | 'matching-tip-observed'; source_ids: string[] }[];
}
export interface IncidentResponse {
  schema: 'universe-incident-observations-v1';
  network: IncidentProfile['network'];
  profile: IncidentProfile;
  profile_sha256: string;
  observed_at_utc: string;
  incidents: ConsensusIncident[];
  count: number;
  sources: { source_id: string; status: 'observed' | 'unavailable'; checkpoint: IncidentHeader | null; observed_at_utc: string | null }[];
  coverage: {
    started_at_utc: string; last_observed_at_utc: string | null;
    retained_header_limit: 128; retained_incident_limit: 256;
    observation_count: number; gaps: { at_utc: string; reason: 'restart' | 'source-unavailable' | 'ancestor-outside-window' }[];
    complete_monitoring: false; global_consensus_verified: false;
    invalid_block_validation: 'unavailable'; consensus_validation: 'unavailable'; displaced_transactions: 'unmeasured'; double_spend_attempts: 'unmeasured';
  };
}
