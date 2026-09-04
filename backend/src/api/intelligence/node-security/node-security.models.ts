export type AdvisoryExposureState =
  | 'affected'
  | 'affected_but_mitigated'
  | 'fixed'
  | 'not_affected'
  | 'configuration_not_exposed'
  | 'unknown_fork'
  | 'unknown_build'
  | 'stale_inventory'
  | 'unverifiable';

export type ArtifactVerificationState =
  | 'version_reported'
  | 'binary_hash_recorded'
  | 'official_checksum_matched'
  | 'release_signature_verified'
  | 'source_commit_matched'
  | 'container_digest_matched'
  | 'reproducible_build_verified'
  | 'unverified'
  | 'conflicting';

export interface SecurityAdvisory {
  advisory_id: string;
  project: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cve_id?: string;
  affected_versions: string;
  fixed_versions: string;
  affected_configuration?: string[];
  affected_platforms?: string[];
  attack_preconditions: string;
  impact_summary: string;
  mitigation: string;
  published_at_utc: string;
  source_url: string;
  signature_status: 'pgp_verified' | 'unverified';
}

export interface NodeInventoryItem {
  node_id: string;
  software: string;
  version: string;
  source_commit: string;
  build_hash: string;
  os_arch: string;
  network: string;
  rpc_exposure_boundary: 'localhost_only' | 'private_subnet' | 'public_authenticated';
  tor_enabled: boolean;
  i2p_enabled: boolean;
  bip324_v2_transport: boolean;
  asmap_active: boolean;
  pruned: boolean;
  wallet_enabled: boolean;
  external_signer: boolean;
  last_verified_utc: string;
  exposure_status: AdvisoryExposureState;
}

export interface SoftwareRelease {
  release_id: string;
  project: string;
  version: string;
  release_date_utc: string;
  official_tarball_sha256: string;
  signature_verified: boolean;
  release_notes_url: string;
  eol_status: 'supported' | 'maintenance' | 'end_of_life';
}

export interface UpgradeWavePlan {
  plan_id: string;
  target_software: string;
  from_version: string;
  target_version: string;
  nodes_count: number;
  intermediate_versions_required: string[];
  configuration_changes_required: {
    option: string;
    action: 'renamed' | 'removed' | 'added';
    notes: string;
  }[];
  canary_stages: {
    stage_number: number;
    node_ids: string[];
    verification_wait_minutes: number;
  }[];
  rollback_boundary: string;
  estimated_downtime_seconds: number;
}

export interface NodeSecurityOverview {
  total_fleet_nodes_monitored: number;
  healthy_nodes_count: number;
  exposed_advisories_count: number;
  eol_nodes_count: number;
  latest_software_releases: SoftwareRelease[];
  active_advisories: SecurityAdvisory[];
  fleet_summary: NodeInventoryItem[];
}
