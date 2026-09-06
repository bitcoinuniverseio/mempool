import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SubmissionOverview {
  total_private_submissions_24h: number;
  active_accelerator_providers: number;
  verified_receipts_count: number;
  detected_out_of_band_txs_7d: number;
  average_acceleration_inclusion_blocks: number;
  recent_anomalies: any[];
}

/**
 * Reads for the private submission surfaces.
 *
 * Every call here returns what the intelligence API returned, or it errors.
 * There is deliberately no fallback value: an earlier revision answered a
 * failed request with an invented overview, an invented diagnosis, an invented
 * broadcast token whose status already read "relayed_to_pools", and an invented
 * receipt whose signature already read valid. A reader could not tell any of
 * those from a real answer, which is the one thing a submission and receipt
 * surface may never do. A request that does not reach the authority is an
 * error, and the surfaces say so.
 */
@Injectable({
  providedIn: 'root',
})
export class PrivateSubmissionApiService {
  private readonly baseUrl = '/api/v1/intelligence';

  constructor(private http: HttpClient) {}

  public getOverview$(): Observable<SubmissionOverview> {
    return this.http.get<SubmissionOverview>(`${this.baseUrl}/submission/overview`);
  }

  public diagnose$(txidOrHex: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/submission/diagnose`, { txid: txidOrHex });
  }

  public submitPrivate$(payload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/submission/private`, payload);
  }

  public getPrivateSubmission$(token: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/submission/private/${token}`);
  }

  public listAccelerators$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/accelerators/providers`);
  }

  public getAccelerator$(providerId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/accelerators/providers/${providerId}`);
  }

  public verifyReceipt$(receiptPayload: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/accelerators/receipts/verify`, receiptPayload);
  }

  public getTxOrdering$(txid: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/ordering/transactions/${txid}`);
  }

  public getBlockOrdering$(blockHash: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/ordering/blocks/${blockHash}`);
  }

  public listOrderingFindings$(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/ordering/findings`);
  }
}
