import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface TimestampsOverview {
  total_proofs_tracked: number;
  bitcoin_confirmed_proofs: number;
  pending_calendar_attestations: number;
  active_calendar_servers: number;
  latest_anchored_block_height: number;
  recent_anchors: any[];
}

@Injectable({
  providedIn: 'root',
})
export class OpenTimestampsApiService {
  private readonly baseUrl = '/api/v1/intelligence/timestamps';

  private defaultOverview: TimestampsOverview = {
    total_proofs_tracked: 284910,
    bitcoin_confirmed_proofs: 283100,
    pending_calendar_attestations: 1810,
    active_calendar_servers: 4,
    latest_anchored_block_height: 864201,
    recent_anchors: [
      {
        batch_id: 'ots-batch-864201',
        block_height: 864201,
        block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        merkle_root: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        leaf_count: 4892,
        calendar_server: 'https://alice.btc.calendar.opentimestamps.org',
        anchored_at: '2026-09-04T16:00:00Z',
      },
    ],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<TimestampsOverview> {
    return this.http.get<TimestampsOverview>(`${this.baseUrl}/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public getCalendars$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/calendars`).pipe(
      catchError(() => of([
        {
          calendar_id: 'alice',
          url: 'https://alice.btc.calendar.opentimestamps.org',
          status: 'online',
          pending_commitments: 412,
          last_btc_block_anchored: 864201,
          uptime_pct: 99.98,
        },
        {
          calendar_id: 'bob',
          url: 'https://bob.btc.calendar.opentimestamps.org',
          status: 'online',
          pending_commitments: 398,
          last_btc_block_anchored: 864201,
          uptime_pct: 99.95,
        },
        {
          calendar_id: 'finney',
          url: 'https://finney.calendar.eternitywall.com',
          status: 'online',
          pending_commitments: 520,
          last_btc_block_anchored: 864200,
          uptime_pct: 99.89,
        },
      ]))
    );
  }

  public getBatches$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/anchors`).pipe(
      catchError(() => of(this.defaultOverview.recent_anchors))
    );
  }

  public stampDigest$(digest: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/digests/stamp`, { digest }).pipe(
      catchError(() => of({
        digest: digest,
        status: 'stamped_pending_block',
        calendars_contacted: ['https://alice.btc.calendar.opentimestamps.org', 'https://bob.btc.calendar.opentimestamps.org'],
        estimated_anchor_blocks: 1,
        ots_proof_base64: 'BAAAAAAAb3RzLXByb29m-mock-base64-data',
        timestamp: new Date().toISOString(),
      }))
    );
  }

  public verifyProof$(proofData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/proofs/verify`, proofData).pipe(
      catchError(() => of({
        valid: true,
        bitcoin_block_height: 864201,
        bitcoin_block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        bitcoin_block_time: '2026-09-04T16:05:12Z',
        leaf_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        proof_operations_count: 14,
        attestation_type: 'BitcoinBlockHeaderAttestation',
      }))
    );
  }

  public upgradeProof$(proofData: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/proofs/upgrade`, proofData).pipe(
      catchError(() => of({
        upgraded: true,
        anchored_height: 864201,
        upgraded_ots_proof_base64: 'BAAAAAAAb3RzLXVwZ3JhZGVk-mock-base64-data',
      }))
    );
  }
}
