import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { BackendInfo, ExplorerTransactionAssetFlow, ProtocolsResponse, SourcesResponse, StatusResponse } from '@app/universe/universe.types';

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
}
