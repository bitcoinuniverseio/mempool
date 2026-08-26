import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import {
  BackendInfo,
  ExplorerTransactionAssetFlow,
  OutpointBatchResponse,
  OutpointEnrichment,
  ProtocolsResponse,
  SourcesResponse,
  StatusResponse,
  TransactionBatchResponse,
  AssetLookupResult,
  OrdBlockInscriptionsView,
  OrdInscriptionView,
  OrdRuneView,
  OrdSatView,
} from '@app/universe/universe.types';

/** Server-side batch ceilings. Callers must not exceed them. */
export const UNIVERSE_OUTPOINT_BATCH_LIMIT = 50;
export const UNIVERSE_TRANSACTION_BATCH_LIMIT = 25;

@Injectable({
  providedIn: 'root'
})
export class UniverseApiService {
  private apiBaseUrl: string; // base URL is protocol, hostname, and port

  private protocolsCache$: Observable<ProtocolsResponse> | null = null;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = ''; // use relative (same-origin) URL by default
    if (!stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }

  getProtocols$(): Observable<ProtocolsResponse> {
    if (!this.protocolsCache$) {
      this.protocolsCache$ = this.httpClient.get<ProtocolsResponse>(
        this.apiBaseUrl + '/api/v1/universe/protocols'
      ).pipe(
        catchError((error) => {
          // don't cache failures: allow the next subscriber to retry
          this.protocolsCache$ = null;
          return throwError(() => error);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.protocolsCache$;
  }

  getStatus$(): Observable<StatusResponse> {
    return this.httpClient.get<StatusResponse>(this.apiBaseUrl + '/api/v1/universe/status');
  }

  getSources$(): Observable<SourcesResponse> {
    return this.httpClient.get<SourcesResponse>(this.apiBaseUrl + '/api/v1/universe/sources');
  }

  /**
   * Release identity of the running explorer backend. The AGPL source page
   * needs it, so it goes through the same SSR-safe base URL as the rest of
   * the overlay calls rather than a bare relative path.
   */
  getBackendInfo$(): Observable<BackendInfo> {
    return this.httpClient.get<BackendInfo>(this.apiBaseUrl + '/api/v1/backend-info');
  }

  /** Protocol asset flow for one transaction. Never cached: state changes as the transaction confirms. */
  getTransactionFlow$(txid: string): Observable<ExplorerTransactionAssetFlow> {
    return this.httpClient.get<ExplorerTransactionAssetFlow>(
      this.apiBaseUrl + '/api/v1/universe/transactions/' + txid
    );
  }

  /**
   * Asset flows for up to {@link UNIVERSE_TRANSACTION_BATCH_LIMIT} transactions
   * in one request. Batching is what keeps a block or a mempool page from
   * issuing one request per transaction.
   */
  getTransactionFlows$(txids: string[]): Observable<TransactionBatchResponse> {
    return this.httpClient.post<TransactionBatchResponse>(
      this.apiBaseUrl + '/api/v1/universe/transactions/batch',
      { txids: txids.slice(0, UNIVERSE_TRANSACTION_BATCH_LIMIT) }
    );
  }

  /** Assets attached to one outpoint, with the evidence behind the answer. */
  getOutpoint$(txid: string, vout: number | string): Observable<OutpointEnrichment> {
    return this.httpClient.get<OutpointEnrichment>(
      this.apiBaseUrl + '/api/v1/universe/outpoints/' + txid + '/' + vout
    );
  }

  /** Assets attached to up to {@link UNIVERSE_OUTPOINT_BATCH_LIMIT} outpoints. */
  getOutpoints$(outpoints: string[]): Observable<OutpointBatchResponse> {
    return this.httpClient.post<OutpointBatchResponse>(
      this.apiBaseUrl + '/api/v1/universe/outpoints/batch',
      { outpoints: outpoints.slice(0, UNIVERSE_OUTPOINT_BATCH_LIMIT) }
    );
  }

  /** One inscription, addressed by id or by inscription number. */
  getInscription$(reference: string): Observable<AssetLookupResult<OrdInscriptionView>> {
    return this.httpClient.get<AssetLookupResult<OrdInscriptionView>>(
      this.apiBaseUrl + '/api/v1/universe/inscriptions/' + encodeURIComponent(reference)
    );
  }

  /** One rune, addressed by name or by rune id. */
  getRune$(reference: string): Observable<AssetLookupResult<OrdRuneView>> {
    return this.httpClient.get<AssetLookupResult<OrdRuneView>>(
      this.apiBaseUrl + '/api/v1/universe/runes/' + encodeURIComponent(reference)
    );
  }

  /** One satoshi, addressed by its ordinal number. */
  getSat$(reference: string): Observable<AssetLookupResult<OrdSatView>> {
    return this.httpClient.get<AssetLookupResult<OrdSatView>>(
      this.apiBaseUrl + '/api/v1/universe/sats/' + encodeURIComponent(reference)
    );
  }

  /** Inscriptions revealed in one block. Paginated by the authority. */
  getBlockInscriptions$(height: number | string, page = 0): Observable<AssetLookupResult<OrdBlockInscriptionsView>> {
    return this.httpClient.get<AssetLookupResult<OrdBlockInscriptionsView>>(
      this.apiBaseUrl + '/api/v1/universe/blocks/' + height + '/inscriptions?page=' + page
    );
  }
}
