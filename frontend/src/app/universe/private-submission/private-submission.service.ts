import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Mirrors backend/src/api/intelligence/private-submission/private-submission.models.ts. */
export type SubmissionMethod =
  | 'public_p2p'
  | 'privatebroadcast_tor'
  | 'privatebroadcast_i2p'
  | 'privatebroadcast_tor_exit'
  | 'configured_private_relay'
  | 'configured_accelerator'
  | 'direct_miner_submission'
  | 'unknown';

export interface SubmissionCapabilities {
  public_p2p_enabled: boolean;
  privatebroadcast_tor_enabled: boolean;
  privatebroadcast_i2p_enabled: boolean;
  core_version: string;
  tor_active: boolean;
  i2p_active: boolean;
  queue_limit: number;
  current_queue_count: number;
}

export type PrivateBroadcastStatus = 'queued' | 'acknowledged' | 'aborted' | 'broadcast_completed' | 'failed';

export interface PrivateBroadcastRecord {
  submission_token: string;
  txid: string;
  method: SubmissionMethod;
  network: string;
  queued_at_utc: string;
  status: PrivateBroadcastStatus;
  retry_count: number;
  can_abort: boolean;
  last_error?: string;
}

export interface AcceleratorProvider {
  provider_id: string;
  identity_key: string;
  name: string;
  supported_networks: string[];
  submission_modes: SubmissionMethod[];
  minimum_fee_sats: number;
  maximum_tx_vsize: number;
  payment_methods: string[];
  partner_mining_claims: string[];
  status_endpoint: string;
  health_status: 'online' | 'degraded' | 'offline';
  effective_from: string;
  expires_at: string;
  provider_signature: string;
}

/** The backend's 503 body when an integration is absent: { stage, error }. */
export interface SubmissionUnavailable {
  stage: string;
  error: string;
}

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

  public getCapabilities$(): Observable<SubmissionCapabilities> {
    return this.http.get<SubmissionCapabilities>(`${this.baseUrl}/submission/capabilities`);
  }

  public submitPrivate$(payload: { raw_tx: string; method: SubmissionMethod }): Observable<PrivateBroadcastRecord> {
    return this.http.post<PrivateBroadcastRecord>(`${this.baseUrl}/submission/private`, payload);
  }

  public getPrivateSubmission$(token: string): Observable<PrivateBroadcastRecord> {
    return this.http.get<PrivateBroadcastRecord>(`${this.baseUrl}/submission/private/${encodeURIComponent(token)}`);
  }

  public abortPrivate$(token: string): Observable<{ success: boolean; status: string }> {
    return this.http.post<{ success: boolean; status: string }>(`${this.baseUrl}/submission/private/${encodeURIComponent(token)}/abort`, {});
  }

  /** The service contract is an envelope, { providers: [...] }, never a bare array. */
  public listAccelerators$(): Observable<{ providers: AcceleratorProvider[] }> {
    return this.http.get<{ providers: AcceleratorProvider[] }>(`${this.baseUrl}/accelerators/providers`);
  }

  public getAccelerator$(providerId: string): Observable<AcceleratorProvider> {
    return this.http.get<AcceleratorProvider>(`${this.baseUrl}/accelerators/providers/${encodeURIComponent(providerId)}`);
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
