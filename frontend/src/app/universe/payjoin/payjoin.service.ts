import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface PayjoinDirectory {
  directory_id: string;
  url: string;
  ohttp_key_hash: string;
  bip77_supported: boolean;
  bip78_supported: boolean;
  latency_ms: number;
  last_tested_at: string;
}

export interface PayjoinProposalAnalysisResult {
  analysis_id: string;
  protocol_version: 'BIP78' | 'BIP77';
  inputs_added_by_receiver: number;
  receiver_contributed_sats: number;
  original_fee_sats: number;
  proposal_fee_sats: number;
  fee_delta_sats: number;
  effective_feerate_sats_vb: number;
  heuristics_broken: string[];
  privacy_score_gain: number;
  is_valid: boolean;
  validation_messages: string[];
}

export interface PayjoinCompatibilityEntry {
  software: string;
  role: 'sender' | 'receiver' | 'both';
  bip78_v1_http: boolean;
  bip77_v2_ohttp: boolean;
  status: 'production' | 'testing' | 'planned';
  notes: string;
}

export interface PayjoinPlaygroundSession {
  session_id: string;
  step: 'original_created' | 'proposal_generated' | 'signed_and_broadcast';
  sender_address: string;
  receiver_address: string;
  amount_sats: number;
  original_txid?: string;
  payjoin_txid?: string;
  events_trace: { timestamp: string; phase: string; details: string }[];
}

export interface PayjoinOverview {
  active_directories_count: number;
  total_payjoins_detected_24h: number;
  common_input_heuristic_breaks_24h: number;
  compatibility_catalog: PayjoinCompatibilityEntry[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class PayjoinApiService {
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

  getOverview$(): Observable<PayjoinOverview> {
    return this.httpClient.get<PayjoinOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/overview`
    );
  }

  getDirectories$(): Observable<PayjoinDirectory[]> {
    return this.httpClient.get<PayjoinDirectory[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/directories`
    );
  }

  getCompatibility$(): Observable<PayjoinCompatibilityEntry[]> {
    return this.httpClient.get<PayjoinCompatibilityEntry[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/compatibility`
    );
  }

  analyzeProposal$(originalPsbt: string, proposalPsbt: string): Observable<PayjoinProposalAnalysisResult> {
    return this.httpClient.post<PayjoinProposalAnalysisResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/analyze`,
      { original_psbt: originalPsbt, proposal_psbt: proposalPsbt }
    );
  }

  createPlaygroundSession$(amountSats: number): Observable<PayjoinPlaygroundSession> {
    return this.httpClient.post<PayjoinPlaygroundSession>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/playground/sessions`,
      { amount_sats: amountSats }
    );
  }

  advancePlaygroundSession$(sessionId: string): Observable<PayjoinPlaygroundSession> {
    return this.httpClient.post<PayjoinPlaygroundSession>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/playground/sessions/${sessionId}/advance`,
      {}
    );
  }
}
