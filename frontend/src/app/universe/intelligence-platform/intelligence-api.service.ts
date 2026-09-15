import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { OwnerKeyService } from './owner-key.service';

@Injectable({
  providedIn: 'root',
})
export class IntelligenceApiService {
  private apiBaseUrl = '';

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
    private ownerKey: OwnerKeyService,
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

  // Product 1: Policy Lab
  evaluatePackage$(rawTxs: string[]): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/policy/evaluations`, {
      transactions: rawTxs,
    });
  }

  getNodeProfiles$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/policy/profiles`);
  }

  getTxForecast$(txid: string): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/forecasts/${encodeURIComponent(txid)}`);
  }

  // Product 2: Relay Observatory
  getRelayOverview$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/relay/overview`);
  }

  getRelayTransaction$(txid: string): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/relay/transactions/${encodeURIComponent(txid)}`);
  }

  getRelayPolicyDifferences$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/relay/policy-differences`);
  }

  // Product 3: Time Machine
  getTimeMachineCoverage$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/history/coverage`);
  }

  replayHistory$(timestampUtc?: string, blockHeight?: number): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/history/replays`, {
      timestamp_utc: timestampUtc,
      block_height: blockHeight,
    });
  }

  compareStates$(stateHashA: string, stateHashB: string): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/history/compare?state_a=${encodeURIComponent(stateHashA)}&state_b=${encodeURIComponent(stateHashB)}`
    );
  }

  // Product 4: Mining Templates
  getTemplateOverview$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/templates/overview`);
  }

  diffTemplates$(templateA: string, templateB: string): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/templates/${encodeURIComponent(templateA)}/diff/${encodeURIComponent(templateB)}`
    );
  }

  // Product 5: UTXO Set
  getUtxoOverview$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/utxo/overview`);
  }

  getUtxoCohorts$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/utxo/cohorts`);
  }

  getUtxoThresholds$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/utxo/economic-thresholds`);
  }

  // Product 6: Transaction Graph
  queryGraph$(rootEntity: string, hops = 2, direction = 'both', minValueSats = 0): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/graph/queries`, {
      root_entity: rootEntity,
      hops,
      direction,
      min_value_sats: minValueSats,
    });
  }

  findShortestPath$(fromEntity: string, toEntity: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/graph/paths`, {
      from_entity: fromEntity,
      to_entity: toEntity,
    });
  }

  getGraphCases$(userId = 'user-default'): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/graph/cases?user_id=${encodeURIComponent(userId)}`);
  }

  // Product 7: Workbench
  analyzeScript$(scriptHex: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/workbench/script/analyze`, {
      script_hex: scriptHex,
    });
  }

  parseDescriptor$(descriptor: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/workbench/descriptors/parse`, {
      descriptor,
    });
  }

  analyzePsbt$(psbt: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/workbench/psbt/analyze`, {
      psbt,
    });
  }

  // Product 8: Verification & Incident Center
  generateSpvProof$(txid: string, blockHash: string, blockHeight?: number): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/verification/spv-proof`, {
      txid,
      block_hash: blockHash,
      block_height: blockHeight,
    });
  }

  getIncidents$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/incidents`);
  }

  // Product 9: Developer Platform & Query Studio
  //
  // Owner-scoped calls carry the owner key as a bearer token. There is no
  // user_id: the backend derives the owner from the key.
  private get ownerHeaders() {
    return { headers: this.ownerKey.headers() };
  }

  /** Creates a new owner and returns its first key, shown once. */
  createOwner$(name: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/owners`, { name });
  }

  getDeveloperKeys$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/keys`, this.ownerHeaders);
  }

  generateDeveloperKey$(name: string, scopes: string[]): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/keys`, { name, scopes }, this.ownerHeaders);
  }

  revokeDeveloperKey$(keyId: string): Observable<any> {
    return this.httpClient.delete<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/keys/${encodeURIComponent(keyId)}`, this.ownerHeaders);
  }

  getDeveloperUsage$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/usage`, this.ownerHeaders);
  }

  getWebhooks$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/webhooks`, this.ownerHeaders);
  }

  registerWebhook$(targetUrl: string, events: string[]): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/webhooks`, { target_url: targetUrl, events }, this.ownerHeaders);
  }

  getWebhookAttempts$(webhookId: string): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/developer/webhooks/${encodeURIComponent(webhookId)}/attempts`, this.ownerHeaders);
  }

  executeDevQuery$(sql: string, maxRows = 100): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/query/execute`, {
      sql,
      max_rows: maxRows,
    });
  }

  getQuerySchema$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/query/schema`);
  }

  // Product 10: Watchlists (owner-scoped)
  getWatchlists$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists`, this.ownerHeaders);
  }

  createWatchlist$(name: string, privacyMode = 'blinded'): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists`, { name, privacy_mode: privacyMode }, this.ownerHeaders);
  }

  deleteWatchlist$(watchlistId: string): Observable<any> {
    return this.httpClient.delete<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists/${encodeURIComponent(watchlistId)}`, this.ownerHeaders);
  }

  addWatchlistEntity$(watchlistId: string, entityType: string, raw: string, label: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists/${encodeURIComponent(watchlistId)}/entities`, { entity_type: entityType, entity_raw_or_blinded: raw, label }, this.ownerHeaders);
  }

  addWatchlistRule$(watchlistId: string, conditionType: string, deliveryChannel: string, thresholdValue?: number, webhookId?: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists/${encodeURIComponent(watchlistId)}/rules`, { condition_type: conditionType, delivery_channel: deliveryChannel, threshold_value: thresholdValue, webhook_id: webhookId }, this.ownerHeaders);
  }

  getWatchlistNotifications$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists/notifications`, this.ownerHeaders);
  }

  acknowledgeNotification$(notificationId: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/watchlists/notifications/${encodeURIComponent(notificationId)}/ack`, {}, this.ownerHeaders);
  }

  // Product 11: Knowledge Registry
  getKnowledgeLabels$(category?: string): Observable<any> {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/knowledge/labels${query}`);
  }

  getKnowledgeAuditLog$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/knowledge/audit-log`);
  }

  // Product 12: Protocol Registry
  getProtocolAdapters$(): Observable<any> {
    return this.httpClient.get<any>(`${this.apiBaseUrl}/api/v1/intelligence/protocols`);
  }

  decodeProtocolPayload$(rawHex: string): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/protocols/decode`, {
      script_hex: rawHex,
    });
  }
}
