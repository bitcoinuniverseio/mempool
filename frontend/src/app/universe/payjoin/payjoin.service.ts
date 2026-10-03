import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

/**
 * IMPLEMENTATION-HANDOFF [WP-FE-012] | DEF-BI-006 / D-FE-012B | C-FE-PAYJOIN-DIRECTORY.
 * Backend WP-BI-006 establishes that HTTP200 alone is currently labeled BIP77
 * and BIP78 support. This DTO also permits a null key hash while the directory
 * template calls .slice on it, which throws on a valid unavailable observation.
 * 1. Coordinate a versioned probe DTO with WP-BI-006: separate HTTP reachability,
 *    validated RFC9458 OHTTP key discovery (RFC9540 media type), BIP77 support
 *    and independently evidenced BIP78 support. Unknown differs from false.
 * 2. Decode key/configuration identity, protocol evidence, timestamps and network
 *    in getDirectories$; update PayjoinOverview counts to include only validated
 *    capability observations. Never count a generic HTML200 as protocol support.
 * 3. Render null key hashes safely and expose the probe's actual unavailable/
 *    unsupported reason. Preserve proposal analysis and playground state.
 * 4. Add proposed payjoin-directory.component.spec.ts rendered tests for null
 *    key, HTML200, malformed key configuration, valid OHTTP and independent v1
 *    states; extend service/overview tests. npm test -- --maxWorkers=2
 *    src/app/universe/payjoin. Require clean render and verified owned Signet
 *    directory readback; HTTP200 by itself is not functional acceptance.
 * Sources: BIP77 0.2.0, RFC9458, RFC9540, and WP-BI-006 pinned research/evidence.
 * Rollback keeps compatible DTO versions and preserves honest unknown states;
 *    the null-safe template correction can remain independent of probe rollout.
 */
export interface PayjoinDirectory {
  directory_id: string;
  url: string;
  ohttp_key_hash: string | null;
  bip77_supported: boolean;
  bip78_supported: boolean;
  latency_ms: number | null;
  last_tested_at: string;
  error: string | null;
}

export interface PayjoinProposalAnalysisResult {
  analysis_id: string;
  protocol_version: 'BIP78' | 'BIP77';
  inputs_added_by_receiver: number;
  receiver_contributed_sats: number | null;
  original_fee_sats: number | null;
  proposal_fee_sats: number | null;
  fee_delta_sats: number | null;
  effective_feerate_sats_vb: number | null;
  heuristics_broken: string[];
  privacy_score_gain: number;
  is_valid: boolean | null;
  structural_checks_passed: boolean;
  psbt_envelope_checks_passed: boolean;
  signatures_verified: boolean | null;
  chain_verified: boolean | null;
  final_signatures_verified?: boolean | null;
  node_policy_accepted?: boolean | null;
  final_vsize?: number;
  final_feerate_sats_vb?: number;
  verification_scope: string;
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
  total_payjoins_detected_24h: number | null;
  common_input_heuristic_breaks_24h: number | null;
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
    const origin = this.apiBaseUrl;
    const update = (network: string) => {
      this.apiBaseUrl =
        origin +
        (network &&
        network !== 'mainnet' &&
        network !== this.stateService.env.ROOT_NETWORK
          ? '/' + network
          : '');
    };
    update(this.stateService.network);
    this.stateService.networkChanged$.subscribe(update);
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

  analyzeProposal$(
    originalPsbt: string,
    proposalPsbt: string,
    policy: {
      payment_output_index?: number;
      disable_output_substitution?: boolean;
      additional_fee_output_index?: number;
      max_additional_fee_contribution?: number;
      final_signed_psbt?: string;
      min_feerate?: number;
    } = {}
  ): Observable<PayjoinProposalAnalysisResult> {
    return this.httpClient.post<PayjoinProposalAnalysisResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/analyze`,
      { original_psbt: originalPsbt, proposal_psbt: proposalPsbt, ...policy }
    );
  }

  createPlaygroundSession$(
    amountSats: number
  ): Observable<PayjoinPlaygroundSession> {
    return this.httpClient.post<PayjoinPlaygroundSession>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/playground/sessions`,
      { amount_sats: amountSats }
    );
  }

  advancePlaygroundSession$(
    sessionId: string
  ): Observable<PayjoinPlaygroundSession> {
    return this.httpClient.post<PayjoinPlaygroundSession>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/payjoin/playground/sessions/${sessionId}/advance`,
      {}
    );
  }
}
