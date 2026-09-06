import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface AssumeUtxoSnapshot {
  snapshot_id: string;
  height: number;
  block_hash: string;
  coins_count: number;
  base_utxo_hash: string;
  sha256_checksum: string;
  file_size_bytes: number;
  release_version: string;
  status: 'pinned_core' | 'community_verified' | 'unverified';
  download_url?: string;
}

export interface NodeChainstateObservation {
  node_id: string;
  client_version: string;
  dual_chainstate_active: boolean;
  background_ibd_height: number;
  snapshot_chainstate_height: number;
  tip_height: number;
  sync_percent: number;
  estimated_time_to_validation_completion_sec: number;
}

export interface BootstrapOverview {
  total_snapshots: number;
  configured_nodes_count: number;
  dual_chainstate_nodes_count: number;
  recommended_snapshot_height: number;
  featured_snapshots: AssumeUtxoSnapshot[];
  observed_nodes: NodeChainstateObservation[];
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

  getOverview$(): Observable<BootstrapOverview> {
    return this.httpClient.get<BootstrapOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/overview`
    );
  }

  getSnapshots$(): Observable<AssumeUtxoSnapshot[]> {
    return this.httpClient.get<AssumeUtxoSnapshot[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/snapshots`
    );
  }

  getSnapshotByHeightOrHash$(heightOrHash: string): Observable<AssumeUtxoSnapshot> {
    return this.httpClient.get<AssumeUtxoSnapshot>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/snapshots/${encodeURIComponent(heightOrHash)}`
    );
  }

  // The backend mounts this as /verifications. The path this used to name
  // has no route at all, so every verification request was a 404 and the page
  // rendered its error branch, which used to report the snapshot as valid.
  verifySnapshotChecksum$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/verifications`,
      req
    );
  }

  generateBootstrapPlan$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/plans`,
      req
    );
  }

  getNodeChainstates$(): Observable<NodeChainstateObservation[]> {
    return this.httpClient.get<NodeChainstateObservation[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/bootstrap/chainstates`
    );
  }
}
