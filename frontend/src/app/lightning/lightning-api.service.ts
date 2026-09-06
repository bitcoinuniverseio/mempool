import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, filter, of, shareReplay, take, tap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IChannel, INodesRanking, IOldestNodes, ITopNodesPerCapacity, ITopNodesPerChannels } from '@interfaces/node-api.interface';
import { RequestCache } from '@app/services/request-cache';

@Injectable({
  providedIn: 'root'
})
export class LightningApiService {
  private apiBaseUrl: string; // base URL is protocol, hostname, and port
  private apiBasePath = ''; // network path is /testnet, etc. or '' for mainnet

  // One shared cache. The three services carried identical copies of this,
  // and identical copies of its two faults: a key with no network in it, and
  // an errored entry that suppressed the retry it was asked for.
  private requestCache = new RequestCache();

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = ''; // use relative URL by default
    if (!stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network && network !== this.stateService.env.ROOT_NETWORK ? '/' + network : '';
    });
  }

  cachedRequest<T, F extends (...args: any[]) => Observable<T>>(
    apiFunction: F,
    expireAfter: number, // in ms
    ...params: Parameters<F>
  ): Observable<T> {
    // Captured now, not read back in the response handler. The base path
    // changes the moment the reader switches network, and a response labelled
    // with whatever it had become would be labelled with the wrong network.
    const namespace = this.apiBaseUrl + this.apiBasePath;
    return this.requestCache.request<T>(
      namespace,
      apiFunction as never,
      expireAfter,
      params,
      () => apiFunction.bind(this)(...params),
    );
  }

  getNode$(publicKey: string): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/' + publicKey);
  }

  getNodeGroup$(name: string): Observable<any[]> {
    return this.httpClient.get<any[]>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/group/' + name);
  }

  getChannel$(shortId: string): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/channels/' + shortId);
  }

  getChannelsByNodeId$(publicKey: string, index: number = 0, status = 'open'): Observable<any> {
    const params = new HttpParams()
      .set('public_key', publicKey)
      .set('index', index)
      .set('status', status)
    ;

    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/channels', { params, observe: 'response' });
  }

  getLatestStatistics$(): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/statistics/latest');
  }

  listNodeStats$(publicKey: string): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/' + publicKey + '/statistics');
  }

  getNodeFeeHistogram$(publicKey: string): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/' + publicKey + '/fees/histogram');
  }

  getNodesRanking$(): Observable<INodesRanking> {
    return this.httpClient.get<INodesRanking>(this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/rankings');
  }

  listChannelStats$(publicKey: string): Observable<any> {
    return this.httpClient.get<any>(this.apiBaseUrl + this.apiBasePath + '/channels/' + publicKey + '/statistics');
  }

  listStatistics$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/statistics' +
      (interval !== undefined ? `/${interval}` : ''), { observe: 'response' }
    );
  }

  getTopNodesByCapacity$(): Observable<ITopNodesPerCapacity[]> {
    return this.httpClient.get<ITopNodesPerCapacity[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/rankings/liquidity'
    );
  }

  getTopNodesByChannels$(): Observable<ITopNodesPerChannels[]> {
    return this.httpClient.get<ITopNodesPerChannels[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/rankings/connectivity'
    );
  }

  getPenaltyClosedChannels$(): Observable<IChannel[]> {
    return this.httpClient.get<IChannel[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/penalties'
    );
  }

  getOldestNodes$(): Observable<IOldestNodes[]> {
    return this.httpClient.get<IOldestNodes[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/lightning/nodes/rankings/age'
    );
  }
}
