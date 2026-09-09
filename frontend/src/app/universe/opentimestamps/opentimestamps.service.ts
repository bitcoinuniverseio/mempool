import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface TimestampsOverview {
  total_proofs_tracked: number;
  bitcoin_confirmed_proofs: number;
  pending_calendar_attestations: number;
  active_calendar_servers: number;
  latest_anchored_block_height: number;
  recent_anchors: any[];
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
@Injectable({
  providedIn: 'root',
})
export class OpenTimestampsApiService {
  private readonly baseUrl = '/api/v1/intelligence/timestamps';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<TimestampsOverview> {
    return this.http.get<TimestampsOverview>(`${this.baseUrl}/overview`);
  }

  /** The allowlisted calendars as the backend last observed them. */
  public getCalendars$(): Observable<any[]> {
    return this.http.get<{ calendars: any[] }>(`${this.baseUrl}/calendars`).pipe(map(res => res?.calendars ?? []));
  }

  /** Bitcoin blocks that anchored proofs stamped through this deployment. */
  public getBatches$(): Observable<any[]> {
    return this.http.get<{ anchors: any[] }>(`${this.baseUrl}/anchors`).pipe(map(res => res?.anchors ?? []));
  }

  public stampDigest$(digest: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/digests/stamp`, { digest });
  }

  public verifyProof$(proofData: TimestampVerifyRequest): Observable<TimestampVerificationResult> {
    return this.http.post<TimestampVerificationResult>(`${this.baseUrl}/proofs/verify`, proofData);
  }

  public upgradeProof$(proofData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/proofs/upgrade`, proofData);
  }
}
