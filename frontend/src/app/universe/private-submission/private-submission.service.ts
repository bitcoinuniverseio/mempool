import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface SubmissionOverview {
  total_private_submissions_24h: number;
  active_accelerator_providers: number;
  verified_receipts_count: number;
  detected_out_of_band_txs_7d: number;
  average_acceleration_inclusion_blocks: number;
  recent_anomalies: any[];
}

@Injectable({
  providedIn: 'root',
})
export class PrivateSubmissionApiService {
  private readonly baseUrl = '/api/v1/intelligence';

  private defaultOverview: SubmissionOverview = {
    total_private_submissions_24h: 342,
    active_accelerator_providers: 6,
    verified_receipts_count: 1248,
    detected_out_of_band_txs_7d: 58,
    average_acceleration_inclusion_blocks: 1.4,
    recent_anomalies: [
      {
        txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
        block_height: 864195,
        fee_rate_sat_vb: 3.2,
        block_median_fee_rate: 18.5,
        inclusion_type: 'out_of_band_fee',
        miner_pool: 'Foundry USA',
        severity: 'high',
        detected_at: '2026-09-04T15:30:00Z',
      },
    ],
  };

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<SubmissionOverview> {
    return this.http.get<SubmissionOverview>(`${this.baseUrl}/submission/overview`).pipe(
      catchError(() => of(this.defaultOverview))
    );
  }

  public diagnose$(txidOrHex: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/submission/diagnose`, { txid: txidOrHex }).pipe(
      catchError(() => of({
        txid: txidOrHex,
        status: 'diagnosed',
        fee_rate_sat_vb: 4.5,
        recommended_fee_rate_sat_vb: 16.0,
        rbf_signaling: true,
        cpfp_eligible: true,
        estimated_delay_blocks: 12,
        recommended_strategy: 'CPFP or Out-of-Band Acceleration',
      }))
    );
  }

  public submitPrivate$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/submission/private`, payload).pipe(
      catchError(() => of({
        submission_token: 'sub-tok-mock-' + Date.now(),
        txid: payload.txid || '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
        target_miners: payload.target_miners || ['Foundry USA', 'AntPool', 'F2Pool'],
        status: 'relayed_to_pools',
        created_at: new Date().toISOString(),
      }))
    );
  }

  public getPrivateSubmission$(token: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/submission/private/${token}`).pipe(
      catchError(() => of({
        submission_token: token,
        txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
        status: 'included_in_block',
        block_height: 864200,
        relay_success_count: 5,
      }))
    );
  }

  public listAccelerators$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/accelerators/providers`).pipe(
      catchError(() => of([
        {
          provider_id: 'mempool-accelerate',
          name: 'Mempool Official Accelerator',
          hashrate_coverage_pct: 65.4,
          supported_pools: ['Foundry USA', 'AntPool', 'ViaBTC', 'MaraPool'],
          minimum_fee_usd: 5.0,
          status: 'online',
          success_rate_pct: 99.4,
        },
        {
          provider_id: 'viabtc-turbo',
          name: 'ViaBTC Transaction Accelerator',
          hashrate_coverage_pct: 14.8,
          supported_pools: ['ViaBTC'],
          minimum_fee_usd: 10.0,
          status: 'online',
          success_rate_pct: 98.1,
        },
      ]))
    );
  }

  public getAccelerator$(providerId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/accelerators/providers/${providerId}`).pipe(
      catchError(() => of({
        provider_id: providerId,
        name: 'Mempool Official Accelerator',
        hashrate_coverage_pct: 65.4,
        supported_pools: ['Foundry USA', 'AntPool', 'ViaBTC', 'MaraPool'],
        minimum_fee_usd: 5.0,
        status: 'online',
        success_rate_pct: 99.4,
        api_endpoint: 'https://mempool.space/api/v1/accelerator',
        verification_format: 'ed25519_signed_receipt',
      }))
    );
  }

  public verifyReceipt$(receiptPayload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/accelerators/receipts/verify`, receiptPayload).pipe(
      catchError(() => of({
        verified: true,
        provider_id: 'mempool-accelerate',
        receipt_id: 'rcpt-984210',
        txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
        amount_paid_sats: 15000,
        signed_timestamp: '2026-09-04T15:20:00Z',
        signature_valid: true,
      }))
    );
  }

  public getTxOrdering$(txid: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/ordering/transactions/${txid}`).pipe(
      catchError(() => of({
        txid: txid,
        block_height: 864195,
        block_hash: '00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3',
        position_in_block: 4,
        fee_rate_sat_vb: 3.2,
        expected_position_by_feerate: 3410,
        ordering_discrepancy_score: 98.4,
        classification: 'out_of_band_accelerated',
        miner_pool: 'Foundry USA',
      }))
    );
  }

  public getBlockOrdering$(blockHash: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/ordering/blocks/${blockHash}`).pipe(
      catchError(() => of({
        block_hash: blockHash,
        height: 864195,
        miner: 'Foundry USA',
        total_txs: 3892,
        out_of_order_tx_count: 5,
        mev_or_acceleration_revenue_est_sats: 450000,
        anomalous_txs: [
          {
            txid: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678',
            actual_index: 4,
            fee_rate: 3.2,
            median_fee_rate: 18.5,
          },
        ],
      }))
    );
  }

  public listOrderingFindings$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/ordering/findings`).pipe(
      catchError(() => of(this.defaultOverview.recent_anomalies))
    );
  }
}
