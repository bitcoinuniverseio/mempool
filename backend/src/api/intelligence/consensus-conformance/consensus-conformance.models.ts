export type MismatchClassification =
  | 'serialization_difference'
  | 'parse_acceptance_difference'
  | 'consensus_acceptance_difference'
  | 'policy_difference'
  | 'error_code_difference'
  | 'unsupported_feature'
  | 'resource_exhaustion'
  | 'crash'
  | 'timeout'
  | 'test_harness_difference'
  | 'unknown'
  | 'none';

export type FormalProofStatus =
  | 'specified'
  | 'executable'
  | 'differentially_checked'
  | 'formally_modeled'
  | 'machine_proved'
  | 'proof_with_assumptions'
  | 'proof_failed'
  | 'stale'
  | 'unsupported';

export interface ConsensusImplementation {
  implementation_id: string;
  name: string;
  language: string;
  version: string;
  source_commit: string | null;
  build_hash: string;
  supported_targets: string[];
  is_reference_implementation: boolean;
  health_status: 'configured';
}

export interface ConsensusTarget {
  target_id: string;
  name: string;
  description: string;
  input_schema: string;
  consensus_critical: boolean;
  implementations_supported_count: number;
}

export interface ConsensusCase {
  case_id: string;
  target: string;
  title: string;
  mismatch_class: MismatchClassification;
  severity: 'unassessed';
  reproduction_command: string;
  input_hex_sample: string;
  minimized_size_bytes: number | null;
  original_size_bytes: number;
  implementation_outcomes: {
    implementation_id: string;
    status: 'accepted' | 'rejected' | 'crash' | 'timeout' | 'unsupported';
    error_or_result: string;
    execution_time_ms: number;
  }[];
  created_at_utc: string;
  quarantine_status: 'public' | 'responsible_disclosure_quarantine';
}

export interface FormalArtifact {
  artifact_id: string;
  project: 'Hornet' | 'btc-verified' | 'libbitcoinkernel';
  title: string;
  scope: string;
  proof_status: FormalProofStatus;
  source_commit: string | null;
  toolchain: string;
  theorem_statement: string;
  assumptions: string[];
  verification_command: string;
  last_verified_at: string;
}

export interface ConformanceCampaign {
  campaign_id: string;
  target_id: string;
  total_inputs_evaluated: number;
  divergences_found: number;
  crashes_detected: number | null;
  seed: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  started_at_utc: string;
  completed_at_utc?: string;
}

export interface ConsensusConformanceOverview {
  total_implementations_evaluated: number;
  total_consensus_targets: number;
  total_differential_cases: number;
  divergences_classified_count: number;
  machine_proved_formal_theorems_count: number;
  implementations: ConsensusImplementation[];
  targets: ConsensusTarget[];
  recent_cases: ConsensusCase[];
  formal_artifacts: FormalArtifact[];
}
