import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer, of } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';

export interface TimestampAnchor {
  batch_id: string;
  calendar_id: string;
  block_height: number;
  block_hash: string;
  anchored_at: string;
  leaf_count: number;
  merkle_root: string;
}

export interface TimestampCalendar {
  calendar_id: string;
  name: string;
  url: string;
  health_status: 'online' | 'degraded' | 'offline';
  health_observed_at: string | null;
  health_detail: string;
  anchored_proofs_count: number;
  last_anchor_block_height: number | null;
}

export interface TimestampsOverview {
  total_proofs_tracked: number;
  bitcoin_confirmed_proofs: number;
  pending_calendar_attestations: number;
  failed_submissions: number;
  active_calendar_servers: number;
  latest_anchored_block_height: number | null;
  active_calendars: TimestampCalendar[];
  recent_anchors: TimestampAnchor[];
  network: string;
  /** False when the deployment names no calendar for this network; stamping is unavailable then. */
  calendars_configured: boolean;
  storage: 'mysql' | 'memory';
  generated_at: string;
}

export interface TimestampStampResult {
  record_id: string;
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
  status: TimestampVerificationResult['status'];
  verified: boolean;
  verification: TimestampVerificationResult;
  /** `upgraded` is an attestation the calendar returned that the owned reader did not verify. */
  calendars: { calendar_id?: string; calendar_url: string; status: 'pending' | 'upgraded' | 'verified' | 'unreachable'; detail: string }[];
  notices: string[];
}

export type TimestampNetwork = 'mainnet' | 'testnet' | 'testnet4' | 'signet' | 'regtest';

export interface TimestampVerifyRequest {
  proof?: string;
  ots_proof?: string;
  digest?: string;
  network?: TimestampNetwork;
}

export interface TimestampVerificationResult {
  status: 'bitcoin_attestation_verified' | 'pending_calendar_attestation' | 'bitcoin_attestation_invalid'
    | 'file_mismatch' | 'proof_incomplete' | 'unsupported_operation' | 'unsupported_attestation'
    | 'calendar_unavailable' | 'network_mismatch' | 'conflicting_attestations' | 'bitcoin_attestation_reorg'
    | 'digest_matches' | 'proof_structure_valid';
  verified: boolean;
  digest_matches: boolean | null;
  file_digest: string;
  file_hash_algorithm: 'sha1' | 'ripemd160' | 'sha256' | 'keccak256';
  network: TimestampNetwork;
  earliest_proven_block_height?: number;
  earliest_proven_time_utc?: string;
  bitcoin_block_hash?: string;
  attestation_type?: 'bitcoin';
  operation_count: number;
  calendar_attestations: { calendar_url: string; status: 'pending' | 'verified' | 'unreachable'; attestation_time?: string }[];
  notices: string[];
  errors: string[];
}

/**
 * Reads and submissions for the OpenTimestamps surfaces.
 *
 * Every call here returns what the intelligence API returned, or it errors.
 * There is deliberately no fallback value. The revision this replaces answered
 * a failed request with an invented one, and on this surface that meant a proof
 * verification returning valid with a Bitcoin block height and hash, an upgrade
 * returning upgraded with an invented proof, and a stamp returning a base64
 * string whose own contents said mock. A timestamp proof is a claim about when
 * something existed; a reader who cannot tell a checked proof from an unchecked
 * one has nothing.
 */
/**
 * Every request goes to the backend of the selected Bitcoin network, the way
 * the rest of the explorer does: `/api/v1/...` for the root network and
 * `/signet/api/v1/...` for Signet, which the gateway routes to that network's
 * own backend, calendar and record store. Reads follow a network switch and
 * cancel the previous request; a stamp or upgrade is sent to the network that
 * was selected when the user acted and is never replayed.
 */
@Injectable({
  providedIn: 'root',
})
export class OpenTimestampsApiService {
  constructor(private http: HttpClient, private stateService: StateService) {}

  /** The selected Bitcoin network, as the API names it. */
  public get network(): TimestampNetwork {
    return (this.stateService.network || 'mainnet') as TimestampNetwork;
  }

  public getOverview$(): Observable<TimestampsOverview> {
    return this.scoped((base, network) => this.http.get<TimestampsOverview>(`${base}/overview`).pipe(map(res => this.sameNetwork(res, network))));
  }

  /** The allowlisted calendars as the backend last observed them. */
  public getCalendars$(): Observable<TimestampCalendar[]> {
    return this.scoped(base => this.http.get<{ calendars: TimestampCalendar[] }>(`${base}/calendars`).pipe(map(res => res?.calendars ?? [])));
  }

  /** Bitcoin blocks that anchored proofs stamped through this deployment. */
  public getBatches$(): Observable<TimestampAnchor[]> {
    return this.scoped(base => this.http.get<{ anchors: TimestampAnchor[] }>(`${base}/anchors`).pipe(map(res => res?.anchors ?? [])));
  }

  public stampDigest$(digest: string): Observable<TimestampStampResult> {
    const network = this.network;
    return this.http.post<TimestampStampResult>(`${this.baseFor(network)}/digests/stamp`, { digest }).pipe(map(res => this.sameNetwork(res, network)));
  }

  public verifyProof$(proofData: TimestampVerifyRequest): Observable<TimestampVerificationResult> {
    return this.http.post<TimestampVerificationResult>(`${this.baseFor(this.network)}/proofs/verify`, proofData);
  }

  /** The upgrade names the selected network so the verifier answers `network_mismatch` rather than a foreign verdict. */
  public upgradeProof$(proofData: { ots_proof: string; digest?: string }): Observable<TimestampUpgradeResult> {
    const network = this.network;
    return this.http.post<TimestampUpgradeResult>(`${this.baseFor(network)}/proofs/upgrade`, { ...proofData, network });
  }

  private baseFor(network: string): string {
    const prefix = network && network !== 'mainnet' && network !== this.stateService.env?.ROOT_NETWORK ? '/' + network : '';
    return `${prefix}/api/v1/intelligence/timestamps`;
  }

  /** Re-subscribes at a network switch, cancelling the previous request. */
  private scoped<T>(request: (base: string, network: TimestampNetwork) => Observable<T>): Observable<T> {
    return defer(() => (this.stateService.networkChanged$ ?? of(this.stateService.network)).pipe(
      startWith(this.stateService.network),
      map(() => this.network),
      distinctUntilChanged(),
      switchMap(network => request(this.baseFor(network), network)),
    ));
  }

  private sameNetwork<T extends { network?: string }>(value: T, network: TimestampNetwork): T {
    if (value?.network !== undefined && value.network !== network) {
      throw new Error('timestamp-network-mismatch');
    }
    return value;
  }
}
