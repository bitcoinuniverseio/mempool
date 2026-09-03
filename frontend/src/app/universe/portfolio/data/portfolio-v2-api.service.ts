import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';
import type {
  PortfolioCounterpartyPage,
  PortfolioDelta,
  PortfolioHistoricalSnapshot,
  PortfolioPerformanceReport,
  PortfolioSemanticActivityPage,
  PortfolioUtxoPage,
  PortfolioV2CoverageResponse,
  PortfolioV2HoldingsPage,
  PortfolioV2NetworksResponse,
  PortfolioV2SummaryResponse,
} from '@app/shared/universe-portfolio-v2.types';

/**
 * Client for Portfolio API v2 under /api/v2/universe/portfolio.
 *
 * Every request names its chain and network explicitly - the route is the
 * claim, never an address-shape guess. Pagination is cursor-based and a
 * typed unsupported statement is a normal 200 answer, so the caller can
 * show exactly what a chain's sources cannot prove.
 */
@Injectable({ providedIn: 'root' })
export class PortfolioV2ApiService {
  private readonly apiBaseUrl: string;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = '';
    if (!stateService.isBrowser) {
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }

  private base(chain?: string, network?: string, address?: string): string {
    let url = this.apiBaseUrl + '/api/v2/universe/portfolio';
    if (chain !== undefined && network !== undefined && address !== undefined) {
      url +=
        '/' + encodeURIComponent(chain)
        + '/' + encodeURIComponent(network)
        + '/' + encodeURIComponent(address);
    }
    return url;
  }

  getNetworks$(): Observable<PortfolioV2NetworksResponse> {
    return this.httpClient.get<PortfolioV2NetworksResponse>(this.base() + '/networks');
  }

  getSummary$(
    chain: string,
    network: string,
    address: string,
  ): Observable<PortfolioV2SummaryResponse> {
    return this.httpClient.get<PortfolioV2SummaryResponse>(
      this.base(chain, network, address) + '/summary',
    );
  }

  getHoldings$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
    limit?: number,
  ): Observable<PortfolioV2HoldingsPage> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit !== undefined) params = params.set('limit', String(limit));
    return this.httpClient.get<PortfolioV2HoldingsPage>(
      this.base(chain, network, address) + '/holdings',
      { params },
    );
  }

  getActivity$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
  ): Observable<PortfolioSemanticActivityPage> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    return this.httpClient.get<PortfolioSemanticActivityPage>(
      this.base(chain, network, address) + '/activity',
      { params },
    );
  }

  getUtxos$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
    limit?: number,
  ): Observable<PortfolioUtxoPage> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit !== undefined) params = params.set('limit', String(limit));
    return this.httpClient.get<PortfolioUtxoPage>(
      this.base(chain, network, address) + '/utxos',
      { params },
    );
  }

  getSnapshot$(
    chain: string,
    network: string,
    address: string,
    point: { timestamp?: string; blockHeightAtomic?: string },
  ): Observable<PortfolioHistoricalSnapshot> {
    let params = new HttpParams();
    if (point.timestamp !== undefined) params = params.set('timestamp', point.timestamp);
    if (point.blockHeightAtomic !== undefined) params = params.set('height', point.blockHeightAtomic);
    return this.httpClient.get<PortfolioHistoricalSnapshot>(
      this.base(chain, network, address) + '/snapshot',
      { params },
    );
  }

  getDelta$(
    chain: string,
    network: string,
    address: string,
    from: { timestamp?: string; blockHeightAtomic?: string },
    to: { timestamp?: string; blockHeightAtomic?: string },
  ): Observable<PortfolioDelta> {
    let params = new HttpParams();
    if (from.timestamp !== undefined) params = params.set('fromTimestamp', from.timestamp);
    if (from.blockHeightAtomic !== undefined) params = params.set('fromHeight', from.blockHeightAtomic);
    if (to.timestamp !== undefined) params = params.set('toTimestamp', to.timestamp);
    if (to.blockHeightAtomic !== undefined) params = params.set('toHeight', to.blockHeightAtomic);
    return this.httpClient.get<PortfolioDelta>(
      this.base(chain, network, address) + '/delta',
      { params },
    );
  }

  getPerformance$(
    chain: string,
    network: string,
    address: string,
  ): Observable<PortfolioPerformanceReport> {
    return this.httpClient.get<PortfolioPerformanceReport>(
      this.base(chain, network, address) + '/performance',
    );
  }

  getCounterparties$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
    limit?: number,
  ): Observable<PortfolioCounterpartyPage> {
    let params = new HttpParams();
    if (cursor) params = params.set('cursor', cursor);
    if (limit !== undefined) params = params.set('limit', String(limit));
    return this.httpClient.get<PortfolioCounterpartyPage>(
      this.base(chain, network, address) + '/counterparties',
      { params },
    );
  }

  getCoverage$(
    chain: string,
    network: string,
    address: string,
  ): Observable<PortfolioV2CoverageResponse> {
    return this.httpClient.get<PortfolioV2CoverageResponse>(
      this.base(chain, network, address) + '/coverage',
    );
  }

  exportUrl(
    chain: string,
    network: string,
    address: string,
    format: 'assets-csv' | 'activity-csv' | 'utxos-csv' | 'evidence-json',
  ): string {
    return this.base(chain, network, address) + '/export?format=' + format;
  }
}
