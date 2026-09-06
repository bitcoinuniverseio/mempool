import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface TimestampsOverview {
  total_proofs_tracked: number;
  bitcoin_confirmed_proofs: number;
  pending_calendar_attestations: number;
  active_calendar_servers: number;
  latest_anchored_block_height: number;
  recent_anchors: any[];
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

  public getCalendars$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/calendars`);
  }

  public getBatches$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/anchors`);
  }

  public stampDigest$(digest: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/digests/stamp`, { digest });
  }

  public verifyProof$(proofData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/proofs/verify`, proofData);
  }

  public upgradeProof$(proofData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/proofs/upgrade`, proofData);
  }
}
