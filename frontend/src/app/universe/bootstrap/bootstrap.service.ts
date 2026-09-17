import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, startWith, map, distinctUntilChanged } from 'rxjs';
import { StateService } from '@app/services/state.service';

// These models mirror backend/src/api/intelligence/bootstrap/bootstrap.models.ts.

export type NodeBootstrapChainstatePhase =
  | 'traditional_ibd'
  | 'snapshot_loading'
  | 'snapshot_active_syncing_to_tip'
  | 'snapshot_at_tip'
  | 'background_validation'
  | 'snapshot_validated_pending_cleanup'
  | 'fully_validated'
  | 'snapshot_failed'
  | 'unknown';

export type NodeBootstrapVerificationState =
  | 'pending'
  | 'verifying'
  | 'valid'
  | 'invalid'
  | 'unavailable';

export type NodeBootstrapSnapshotStatus =
  | 'pinned_core'
  | 'unverified'
  | 'pending'
  | 'verifying'
  | 'invalid'
  | 'unavailable';

/** A catalogue entry joined with its pinned commitment and latest verification run. */
export interface AssumeUtxoSnapshot {
  snapshot_id: string;
  network: string;
  height: number;
  block_hash: string;
  coins_count: number | null;
  base_utxo_hash: string | null;
  sha256_checksum: string;
  file_size_bytes: number;
  release_version: string;
  /** pinned_core only after a verification run over the bytes reached valid. */
  status: NodeBootstrapSnapshotStatus;
  download_url?: string;
  producer_id: string;
  pinned_commitment: boolean;
  latest_verification_id: string | null;
  latest_verification_state: NodeBootstrapVerificationState | null;
}

export interface NodeChainstateObservation {
  node_id: string;
  client_version: string;
  dual_chainstate_active: boolean;
  background_ibd_height: number | null;
  snapshot_chainstate_height: number | null;
  tip_height: number;
  sync_percent: number;
  estimated_time_to_validation_completion_sec: number | null;
  current_phase: string;
  observed_at: string;
}

export type BootstrapSubfeatureStatus = 'available' | 'unavailable';

export interface BootstrapOverview {
  total_snapshots: number | null;
  configured_nodes_count: number;
  dual_chainstate_nodes_count: number;
  recommended_snapshot_height: number | null;
  snapshot_catalogue_status: BootstrapSubfeatureStatus;
  snapshot_catalogue_reason: string | null;
  verification_store_status: BootstrapSubfeatureStatus;
  verification_store_reason: string | null;
  planning_status: BootstrapSubfeatureStatus;
  operator_status: BootstrapSubfeatureStatus;
  operator_reason: string | null;
  featured_snapshots: AssumeUtxoSnapshot[];
  observed_nodes: NodeChainstateObservation[];
}

export type NodeBootstrapCheckStatus = 'pending' | 'valid' | 'invalid' | 'not-evaluated';

export interface NodeBootstrapCheck {
  status: NodeBootstrapCheckStatus;
  expected?: string | number | null;
  observed?: string | number | null;
  reason?: string;
}

export const BOOTSTRAP_VERIFICATION_CHECKS = [
  'file_size',
  'sha256',
  'manifest_signature',
  'network_magic',
  'base_block_hash',
  'base_height',
  'coins_count',
  'utxo_commitment',
] as const;
export type NodeBootstrapCheckName = (typeof BOOTSTRAP_VERIFICATION_CHECKS)[number];

/** One verification run over the actual snapshot bytes; pending until the run reaches a final state. */
export interface NodeBootstrapVerification {
  verification_id: string;
  snapshot_id: string;
  network: string;
  state: NodeBootstrapVerificationState;
  valid: boolean;
  status: string;
  requested_at: string;
  started_at?: string;
  finished_at?: string;
  checks: Record<NodeBootstrapCheckName, NodeBootstrapCheck>;
  evidence: {
    source_kind: 'file' | 'https' | null;
    source_ref: string | null;
    bytes_read: number;
    header_format: 'versioned' | 'legacy' | null;
    snapshot_version: number | null;
    core_node_id: string | null;
    core_block_hash_at_height: string | null;
    pinned_commitment_source: string | null;
  };
  checkpoints: { at: string; stage: string; detail?: string }[];
  /** What the caller typed in. Compared and reported, never the authority. */
  caller_inputs: {
    sha256: string | null;
    utxo_hash: string | null;
    height: number | null;
    matched: boolean | null;
  };
  reason?: string;
  details: string;
}

export const BOOTSTRAP_TERMINAL_VERIFICATION_STATES: readonly NodeBootstrapVerificationState[] = ['valid', 'invalid', 'unavailable'];

export type NodeBootstrapPlanRejection =
  | 'unsupported-network'
  | 'unsupported-version'
  | 'node-capability-missing'
  | 'node-not-observed'
  | 'capacity-not-measured'
  | 'stale-measurement'
  | 'insufficient-capacity'
  | 'no-compatible-snapshot'
  | 'snapshot-not-verified'
  | 'chainstate-not-eligible'
  | 'durable-store-unavailable'
  | 'unavailable-node-source';

/** A feasibility statement. Nothing in it has been executed; every number is measured or a stated assumption. */
export interface NodeBootstrapPlan {
  plan_id: string;
  network: string;
  node_id: string;
  node_version: string;
  target_height: number;
  measurement_status: 'measured';
  measured: {
    node_observed_at: string;
    current_phase: NodeBootstrapChainstatePhase;
    tip_height: number;
    headers: number;
    blocks_on_disk_bytes: number;
    capacity: {
      method: 'statfs' | 'configured';
      measured_at: string;
      free_bytes: number;
      total_bytes: number | null;
    };
    supports_loadtxoutset: boolean;
  };
  selected_snapshot: {
    snapshot_id: string;
    height: number;
    block_hash: string;
    core_version: string;
    size_bytes: number;
    sha256: string;
    utxo_commitment: string;
    verification_id: string;
    verified_at: string;
  };
  requirements: {
    snapshot_file_bytes: number;
    chainstate_estimate_bytes: number;
    headroom_bytes: number;
    required_bytes: number;
    free_bytes: number;
    feasible: true;
  };
  assumptions: string[];
  caller_declared: {
    available_disk_gb: number | null;
    bandwidth_mbps: number | null;
    matches_measurement: boolean | null;
  };
  estimates: {
    snapshot_download_hours: number | null;
    ibd_download_hours: number | null;
    basis: string;
  };
  expected_transitions: NodeBootstrapChainstatePhase[];
  actions_not_executed: string[];
  rollback_instructions: string[];
  created_at: string;
}

export interface BootstrapPlanRequest {
  target_height?: number;
  available_disk_gb?: number;
  bandwidth_mbps?: number;
}

export interface BootstrapVerificationRequest {
  height: number;
  sha256?: string;
  utxo_hash?: string;
}

/** The typed failure body every bootstrap route answers with: { stage, error }. */
export interface BootstrapFailureBody {
  stage?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class BootstrapApiService {
  private apiBaseUrl = '';

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.apiBaseUrl =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
  }

  get network(): string {return this.stateService.network || this.stateService.env?.ROOT_NETWORK || 'mainnet';}
  get networkChanged$() {
    return this.stateService.networkChanged$.pipe(startWith(this.network),map(() => this.network),distinctUntilChanged());
  }
  private get networkPrefix() {
    const network =
      this.stateService.network || this.stateService.env.ROOT_NETWORK;
    return network === this.stateService.env.ROOT_NETWORK ? '' : '/' + network;
  }

  getOverview$(): Observable<BootstrapOverview> {
    return this.httpClient.get<BootstrapOverview>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/overview`
    );
  }

  getSnapshots$(): Observable<AssumeUtxoSnapshot[]> {
    return this.httpClient.get<AssumeUtxoSnapshot[]>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/snapshots`
    );
  }

  getSnapshotByHeightOrHash$(
    heightOrHash: string
  ): Observable<AssumeUtxoSnapshot> {
    return this.httpClient.get<AssumeUtxoSnapshot>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/snapshots/${encodeURIComponent(heightOrHash)}`
    );
  }

  /** The signed manifest of a catalogue snapshot, served as JSON by the backend. */
  snapshotManifestUrl(reference: string): string {
    return `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/snapshots/${encodeURIComponent(reference)}/manifest`;
  }

  // The backend mounts this as /verifications. The path this used to name
  // has no route at all, so every verification request was a 404 and the page
  // rendered its error branch, which used to report the snapshot as valid.
  // The answer is a durable run record, 202 while pending or verifying.
  verifySnapshotChecksum$(req: BootstrapVerificationRequest): Observable<NodeBootstrapVerification> {
    return this.httpClient.post<NodeBootstrapVerification>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/verifications`,
      req
    );
  }

  getVerification$(verificationId: string): Observable<NodeBootstrapVerification> {
    return this.httpClient.get<NodeBootstrapVerification>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/verifications/${encodeURIComponent(verificationId)}`
    );
  }

  generateBootstrapPlan$(req: BootstrapPlanRequest): Observable<NodeBootstrapPlan> {
    return this.httpClient.post<NodeBootstrapPlan>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/plans`,
      req
    );
  }

  getNodeChainstates$(): Observable<NodeChainstateObservation[]> {
    return this.httpClient.get<NodeChainstateObservation[]>(
      `${this.apiBaseUrl}${this.networkPrefix}/api/v1/intelligence/bootstrap/chainstates`
    );
  }
}
