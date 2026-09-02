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
  ChainCapabilityEnvelope,
  ChainDashboardView,
  ChainExplorerPayload,
  ChartSeriesView,
  ExplorerChain,
  FeeRecommendationsView,
  MiningPoolsView,
  MiningSummaryView,
  RecentBlocksView,
  UniverseSearchResponse,
  ExplorerProtocolActivityPage,
  AnimaStatusDocument,
  AnimaEventsDocument,
  AnimaEventDocument,
  AnimaOrganismsDocument,
  AnimaOrganismDocument,
  AnimaOrganismHistoryDocument,
} from '@app/universe/universe.types';

/** Server-side batch ceilings. Callers must not exceed them. */
export const UNIVERSE_OUTPOINT_BATCH_LIMIT = 50;
export const UNIVERSE_TRANSACTION_BATCH_LIMIT = 25;

/**
 * How many pending transactions each chain will return in one request.
 *
 * The two chains do not share a ceiling, and asking for more than a chain
 * allows is refused as a bad request rather than trimmed. Asking Zcash for
 * four hundred emptied its lens and its arrivals list in production while
 * every fixture answered whatever it was asked, so the bound is enforced
 * here, once, where the request is built.
 */
export const CHAIN_MEMPOOL_LIMIT: Record<Exclude<ExplorerChain, 'bitcoin'>, number> = {
  dogecoin: 1000,
  zcash: 200,
};

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

  /**
   * One protocol's recent activity from its own authority. A 404 means the
   * authority publishes no feed this explorer reads, which is a state to
   * render, not an error, so it resolves to an explicit unsupported page.
   */
  getProtocolActivity$(protocolId: string, cursor?: string, limit = 25): Observable<ExplorerProtocolActivityPage> {
    let query = '?limit=' + Math.min(Math.max(1, Math.floor(limit)), 200);
    if (cursor) {query += '&cursor=' + encodeURIComponent(cursor);}
    return this.httpClient.get<ExplorerProtocolActivityPage>(
      this.apiBaseUrl + '/api/v1/universe/protocols/' + encodeURIComponent(protocolId) + '/activity' + query
    ).pipe(
      catchError((error) => {
        if (error?.status === 404) {
          return of({
            schemaVersion: 'universe-protocol-activity-v1',
            protocolId,
            state: 'unsupported',
            authorityId: null,
            feedPath: null,
            source: null,
            assets: [],
            events: [],
            invalidations: [],
            holderSnapshots: [],
            nextCursor: null,
            hasMore: false,
            checkpoint: null,
            degradedReason: null,
            observedAt: new Date().toISOString(),
          } as ExplorerProtocolActivityPage);
        }
        return throwError(() => error);
      }),
    );
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

  getChains$(): Observable<ChainCapabilityEnvelope[]> {
    return this.httpClient.get<ChainCapabilityEnvelope[]>(
      this.apiBaseUrl + '/api/v1/chains?network=mainnet'
    );
  }

  getChainStatus$(chain: ExplorerChain): Observable<ChainCapabilityEnvelope> {
    return this.httpClient.get<ChainCapabilityEnvelope>(
      this.apiBaseUrl + '/api/v1/' + chain + '/status?network=mainnet'
    );
  }

  search$(query: string, activeChain: ExplorerChain, allChains = false): Observable<UniverseSearchResponse> {
    return this.httpClient.get<UniverseSearchResponse>(
      this.apiBaseUrl + '/api/v1/universe/search?q=' + encodeURIComponent(query)
        + '&chain=' + activeChain + '&all=' + allChains
    );
  }

  getChainMempool$(chain: Exclude<ExplorerChain, 'bitcoin'>, limit = 100): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mempool?network=mainnet&limit='
        + Math.min(Math.max(1, Math.floor(limit)), CHAIN_MEMPOOL_LIMIT[chain])
    );
  }

  getChainCandidateBuckets$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/candidate-buckets?network=mainnet'
    );
  }

  /** The one-call dashboard aggregate: blocks, buckets, fees, mempool, mining. */
  getChainDashboard$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainDashboardView> {
    return this.httpClient.get<ChainDashboardView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/dashboard?network=mainnet'
    );
  }

  getChainRecentBlocks$(chain: Exclude<ExplorerChain, 'bitcoin'>, limit = 15): Observable<RecentBlocksView> {
    return this.httpClient.get<RecentBlocksView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/blocks/recent?network=mainnet&limit=' + limit
    );
  }

  getChainFees$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<FeeRecommendationsView> {
    return this.httpClient.get<FeeRecommendationsView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/fees?network=mainnet'
    );
  }

  getChainMining$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<MiningSummaryView> {
    return this.httpClient.get<MiningSummaryView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mining?network=mainnet'
    );
  }

  getChainMiningPools$(chain: Exclude<ExplorerChain, 'bitcoin'>, window = '1w'): Observable<MiningPoolsView> {
    return this.httpClient.get<MiningPoolsView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mining/pools?network=mainnet&window=' + encodeURIComponent(window)
    );
  }

  getChainChartSeries$(chain: Exclude<ExplorerChain, 'bitcoin'>, seriesId: string, range = '1w'): Observable<ChartSeriesView> {
    return this.httpClient.get<ChartSeriesView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/charts/' + encodeURIComponent(seriesId)
        + '?network=mainnet&range=' + encodeURIComponent(range)
    );
  }

  getChainTransaction$(chain: Exclude<ExplorerChain, 'bitcoin'>, txid: string): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/tx/' + encodeURIComponent(txid) + '?network=mainnet'
    );
  }

  getChainBlock$(chain: Exclude<ExplorerChain, 'bitcoin'>, reference: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    const paging = chain === 'dogecoin'
      ? '&page=' + (Math.floor(offset / limit) + 1) + '&limit=' + limit
      : '&limit=' + limit + '&offset=' + offset;
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/block/' + encodeURIComponent(reference) + '?network=mainnet' + paging
    );
  }

  getChainAddress$(chain: Exclude<ExplorerChain, 'bitcoin'>, address: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    const paging = chain === 'dogecoin'
      ? '&page=' + (Math.floor(offset / limit) + 1) + '&limit=' + limit
      : '&limit=' + limit + '&offset=' + offset;
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/address/' + encodeURIComponent(address) + '?network=mainnet' + paging
    );
  }

  /**
   * The address asset-holdings view for a chain: every paginated unspent
   * output with its attached protocol assets, address-level balances, and
   * exact aggregates. Served beside the base address view so a failure here
   * degrades the asset sections without taking the address page down.
   */
  getChainAddressHoldings$(chain: Exclude<ExplorerChain, 'bitcoin'>, address: string, limit = 50, offset = 0): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/address/' + encodeURIComponent(address) + '/holdings?network=mainnet&limit=' + limit + '&offset=' + offset
    );
  }

  /** The Bitcoin address asset-holdings view from the universe overlay. */
  getAddressHoldings$(address: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/universe/addresses/' + encodeURIComponent(address) + '/holdings?limit=' + limit + '&offset=' + offset
    );
  }

  getChainOutpoint$(chain: Exclude<ExplorerChain, 'bitcoin'>, txid: string, vout: string): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/outpoint/' + encodeURIComponent(txid) + '/' + encodeURIComponent(vout) + '?network=mainnet'
    );
  }

  getChainProtocols$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols?network=mainnet'
    );
  }

  getChainProtocolList$(chain: Exclude<ExplorerChain, 'bitcoin'>, protocol: string, limit = 100, offset = 0, ruleset?: string): Observable<ChainExplorerPayload> {
    const path = this.protocolPath(chain, protocol);
    let query = '?network=mainnet&limit=' + limit;
    if (chain === 'dogecoin' && protocol !== 'doge-tap') {
      query += '&cursor=' + offset;
    } else if (chain === 'dogecoin') {
      query += '&offset=' + offset;
    }
    if (ruleset) {query += '&ruleset=' + encodeURIComponent(ruleset);}
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols/' + path + query
    );
  }

  getChainProtocolDetail$(chain: Exclude<ExplorerChain, 'bitcoin'>, protocol: string, reference: string, ruleset?: string): Observable<ChainExplorerPayload> {
    const path = this.protocolPath(chain, protocol);
    let query = '?network=mainnet';
    if (ruleset) {query += '&ruleset=' + encodeURIComponent(ruleset);}
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols/' + path + '/' + encodeURIComponent(reference) + query
    );
  }

  getChainProtocolSection$(chain: 'dogecoin', protocol: string, reference: string, section: 'holders' | 'events', limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    const path = this.protocolPath(chain, protocol);
    const paging = protocol === 'drc20'
      ? '&cursor=' + offset
      : '&offset=' + offset;
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols/' + path + '/' + encodeURIComponent(reference) + '/' + section + '?network=mainnet&limit=' + limit + paging
    );
  }

  private protocolPath(chain: Exclude<ExplorerChain, 'bitcoin'>, protocol: string): string {
    const allowed = chain === 'dogecoin'
      ? ['doginals', 'drc20', 'doge-tap', 'dunes']
      : ['zerdinals', 'zrunes', 'zrc20'];
    if (!allowed.includes(protocol)) {throw new Error('unsupported-chain-protocol');}
    return protocol;
  }

  /** ANIMA protocol status, scanner readiness, and exact supply. */
  getAnimaStatus$(): Observable<AnimaStatusDocument> {
    return this.httpClient.get<AnimaStatusDocument>(
      this.apiBaseUrl + '/api/v1/anima/status'
    );
  }

  /** One page of the ANIMA logged transition list. */
  getAnimaEvents$(from = 0, limit = 50): Observable<AnimaEventsDocument> {
    return this.httpClient.get<AnimaEventsDocument>(
      this.apiBaseUrl + '/api/v1/anima/events?from=' + Math.max(0, Math.floor(from))
        + '&limit=' + Math.min(Math.max(1, Math.floor(limit)), 200)
    );
  }

  /** One ANIMA logged transition by the composite id this explorer issues. */
  getAnimaEvent$(eventId: string): Observable<AnimaEventDocument> {
    return this.httpClient.get<AnimaEventDocument>(
      this.apiBaseUrl + '/api/v1/anima/events/' + encodeURIComponent(eventId)
    );
  }

  /** One page of the ANIMA organism list. */
  getAnimaOrganisms$(offset = 0, limit = 50, status?: string): Observable<AnimaOrganismsDocument> {
    let query = '?offset=' + Math.max(0, Math.floor(offset))
      + '&limit=' + Math.min(Math.max(1, Math.floor(limit)), 200);
    if (status) {query += '&status=' + encodeURIComponent(status);}
    return this.httpClient.get<AnimaOrganismsDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms' + query
    );
  }

  /** One ANIMA organism with its waymarks and achievements. */
  getAnimaOrganism$(organismId: string): Observable<AnimaOrganismDocument> {
    return this.httpClient.get<AnimaOrganismDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms/' + encodeURIComponent(organismId)
    );
  }

  /** The transition history and lineage around one ANIMA organism. */
  getAnimaOrganismHistory$(organismId: string): Observable<AnimaOrganismHistoryDocument> {
    return this.httpClient.get<AnimaOrganismHistoryDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms/' + encodeURIComponent(organismId) + '/history'
    );
  }
}
