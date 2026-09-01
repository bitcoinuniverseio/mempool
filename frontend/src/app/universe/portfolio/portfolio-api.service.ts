import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';
import {
  PortfolioActivityPage,
  PortfolioHistoryPage,
  PortfolioNetworksResponse,
  PortfolioPnlReport,
  PortfolioSummaryResponse,
} from '@app/universe/portfolio/portfolio.types';

/**
 * Client for the versioned portfolio API under /api/v1/universe/portfolio.
 *
 * Every request names its chain and network explicitly. Nothing here ever
 * guesses a chain from the shape of an address; the route is the claim.
 */
@Injectable({ providedIn: 'root' })
export class PortfolioApiService {
  private apiBaseUrl: string;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = '';
    if (!stateService.isBrowser) {
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }

  getNetworks$(): Observable<PortfolioNetworksResponse> {
    return this.httpClient.get<PortfolioNetworksResponse>(
      this.apiBaseUrl + '/api/v1/universe/portfolio/networks'
    );
  }

  /**
   * The full portfolio summary for one address on one explicit chain and
   * network. `cursor` continues a prior read; the answer's `nextCursor`
   * says whether more pages exist. Never cached: holdings change as
   * transactions confirm.
   */
  getSummary$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
  ): Observable<PortfolioSummaryResponse> {
    let params = new HttpParams();
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<PortfolioSummaryResponse>(
      this.apiBaseUrl
        + '/api/v1/universe/portfolio/'
        + encodeURIComponent(chain)
        + '/' + encodeURIComponent(network)
        + '/' + encodeURIComponent(address)
        + '/summary',
      { params },
    );
  }

  /**
   * One page of the normalized activity ledger. The answer is either a page
   * of classified events or a typed unsupported statement for chains whose
   * history authority is not wired yet.
   */
  getActivity$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
  ): Observable<PortfolioActivityPage> {
    let params = new HttpParams();
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<PortfolioActivityPage>(
      this.apiBaseUrl
        + '/api/v1/universe/portfolio/'
        + encodeURIComponent(chain)
        + '/' + encodeURIComponent(network)
        + '/' + encodeURIComponent(address)
        + '/activity',
      { params },
    );
  }

  /**
   * The native balance history, valued where the historical feed holds
   * that day. An incomplete window carries its own boundary and cursor.
   */
  getHistory$(
    chain: string,
    network: string,
    address: string,
    cursor?: string,
  ): Observable<PortfolioHistoryPage> {
    let params = new HttpParams();
    if (cursor) {
      params = params.set('cursor', cursor);
    }
    return this.httpClient.get<PortfolioHistoryPage>(
      this.apiBaseUrl
        + '/api/v1/universe/portfolio/'
        + encodeURIComponent(chain)
        + '/' + encodeURIComponent(network)
        + '/' + encodeURIComponent(address)
        + '/history',
      { params },
    );
  }

  /** FIFO profit and loss, or a typed statement about why there is none. */
  getPnl$(
    chain: string,
    network: string,
    address: string,
  ): Observable<PortfolioPnlReport> {
    return this.httpClient.get<PortfolioPnlReport>(
      this.apiBaseUrl
        + '/api/v1/universe/portfolio/'
        + encodeURIComponent(chain)
        + '/' + encodeURIComponent(network)
        + '/' + encodeURIComponent(address)
        + '/pnl',
    );
  }

  /** The export URL for a format; the browser downloads it directly. */
  exportUrl(
    chain: string,
    network: string,
    address: string,
    format: 'assets-csv' | 'activity-csv' | 'evidence-json',
  ): string {
    return this.apiBaseUrl
      + '/api/v1/universe/portfolio/'
      + encodeURIComponent(chain)
      + '/' + encodeURIComponent(network)
      + '/' + encodeURIComponent(address)
      + '/export?format=' + format;
  }
}
