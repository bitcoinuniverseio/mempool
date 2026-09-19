import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, shareReplay, throwError, defer, distinctUntilChanged, startWith, switchMap, take } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ProtocolPageKind, readProtocolFailure, readProtocolPage } from './universe-protocol-contract';
import { chainNetwork } from './chain-network';
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
  ExplorerNetwork,
  FeeRecommendationsView,
  MiningPoolsView,
  MiningSummaryView,
  RecentBlocksView,
  UniverseSearchResponse,
  ExplorerProtocolActivityPage,
  ExplorerProtocolObjectsPage,
  AnimaStatusDocument,
  AnimaEventsDocument,
  AnimaEventDocument,
  AnimaOrganismsDocument,
  AnimaOrganismDocument,
  AnimaOrganismHistoryDocument,
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
  BlockTemplateComparison,
  Bolt12Offer,
  Cat20Holder,
  Cat20Token,
  DatasetManifest,
  FractalBlockSummary,
  FractalMempoolOverview,
  FractalTransactionView,
  L2BridgeSystem,
  L2Challenge,
  L2ReserveAudit,
  LightningRfqQuote,
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
  McpToolDeclaration,
  ObserverNode,
  PropagationObservation,
  ProtocolBearingUtxos,
  QueryResult,
  ScriptTypeDistribution,
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
  StreamManifest,
  SupplyCohort,
  TaprootAssetGroup,
  TaprootAssetItem,
  UtreexoRootsView,
  UtxoCheckpoint,
  WildkinBraidCeremony,
  WildkinCreature,
  WildkinStatusSummary,
  ZcashNetworkUpgrade,
  ZcashPoolFlow,
  ZcashPrivacySummary,
  ZcashValuePool,
} from '@app/universe/universe.types';
import {
  BumpPlan,
  ClusterListResponse,
  ClusterResponse,
  DiagramResponse,
  PackageSimulation,
} from '@app/universe/mempool-intelligence/mempool-intelligence.types';
import {
  NodeOverview,
  RpcCatalog,
  RpcResult,
} from '@app/universe/node-console/node-console.types';
import { OwnerKeyService } from '@app/universe/intelligence-platform/owner-key.service';

/** Server-side batch ceilings. Callers must not exceed them. */
export const UNIVERSE_OUTPOINT_BATCH_LIMIT = 50;
export const UNIVERSE_TRANSACTION_BATCH_LIMIT = 25;

/** The chains the picker lists, each read from its own network. */
const EXPLORER_CHAINS: readonly ExplorerChain[] = ['bitcoin', 'dogecoin', 'zcash'];

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
  private protocolsCacheNetwork?: ExplorerNetwork;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
    private ownerKey: OwnerKeyService,
  ) {
    this.apiBaseUrl = ''; // use relative (same-origin) URL by default
    if (!stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }

  get network(): ExplorerNetwork {
    const network = this.stateService.network || 'mainnet';
    if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network)) {
      throw new Error('unsupported-overlay-network');
    }
    return network as ExplorerNetwork;
  }

  /**
   * Backend-owned routes follow the selected network the way the gateway does:
   * /signet/api/v1/... reaches the Signet backend, /api/v1/... the root one. Overlay
   * routes carry chain and network as query fields instead and do not use this.
   */
  private get backendBase(): string {
    const network = this.stateService.network;
    const prefix = network && network !== 'mainnet' && network !== this.stateService.env?.ROOT_NETWORK ? '/' + network : '';
    return this.apiBaseUrl + prefix;
  }
  /**
   * The Bitcoin network every overlay request below is addressed to. Public so
   * a page can label what it shows from the same source its request used.
   */
  selectedNetwork$(): Observable<ExplorerNetwork> {
    return defer(() => (this.stateService.networkChanged$ ?? of(this.stateService.network)).pipe(
      startWith(this.stateService.network),
      map(() => this.network),
      distinctUntilChanged(),
    ));
  }

  /**
   * The network a chain is read from: the selected Bitcoin network for Bitcoin
   * and the configured UNIVERSE_CHAIN_NETWORKS entry (mainnet when unlisted)
   * for every other chain. The Bitcoin selector never implies another chain's
   * network, so a Signet reader still reads Dogecoin from its configured network.
   */
  chainNetwork(chain: ExplorerChain | string): ExplorerNetwork {
    return chainNetwork(chain, this.network, this.stateService.env);
  }

  /** {@link chainNetwork} as a stream: re-emits only when the Bitcoin selection matters. */
  chainNetwork$(chain: ExplorerChain | string): Observable<ExplorerNetwork> {
    return this.selectedNetwork$().pipe(
      map((network) => chainNetwork(chain, network, this.stateService.env)),
      distinctUntilChanged(),
    );
  }

  private requestForNetwork<T>(url: string, network: ExplorerNetwork, body?: unknown, chain = 'bitcoin'): Observable<T> {
    const address = url + (url.includes('?') ? '&' : '?') + 'chain=' + encodeURIComponent(chain) + '&network=' + network;
    const request = body === undefined ? this.httpClient.get<T>(address) : this.httpClient.post<T>(address, body);
    return request.pipe(map((value) => {
      this.assertResponseContext(value, network, chain);
      return value;
    }));
  }

  /** Re-subscribes at a network switch, cancelling the previous HTTP request. */
  private scopedRequest<T>(url: string, body?: unknown, chain = 'bitcoin',
    recover?: (error: unknown, network: ExplorerNetwork) => Observable<T>): Observable<T> {
    return this.chainNetwork$(chain).pipe(
      switchMap((network) => {
        const request = this.requestForNetwork<T>(url, network, body, chain);
        return recover ? request.pipe(catchError((error) => recover(error, network))) : request;
      }),
    );
  }

  private assertResponseContext(value: unknown, network: ExplorerNetwork, chain = 'bitcoin'): void {
    if (!value || typeof value !== 'object') {return;}
    const row = value as Record<string, unknown>;
    // A missing checkpoint remains unknown. Never promote it to block proof.
    if ((row.chain !== undefined && row.chain !== null && row.chain !== chain)
      || (row.network !== undefined && row.network !== null && row.network !== network)) {
      throw new Error('authority-network-mismatch');
    }
    for (const key of ['checkpoint', 'flow', 'evidence', 'source']) {
      if (row[key]) {this.assertResponseContext(row[key], network, chain);}
    }
    for (const key of ['results', 'positions', 'sources', 'inputs', 'outputs', 'actions', 'sourceEvidence', 'utxos',
      'assets', 'events', 'invalidations', 'holderSnapshots', 'items']) {
      if (Array.isArray(row[key])) {
        for (const child of row[key] as unknown[]) {this.assertResponseContext(child, network, chain);}
      }
    }
  }

  getProtocols$(): Observable<ProtocolsResponse> {
    return this.selectedNetwork$().pipe(switchMap((network) => {
      if (!this.protocolsCache$ || this.protocolsCacheNetwork !== network) {
        this.protocolsCacheNetwork = network;
        this.protocolsCache$ = this.requestForNetwork<ProtocolsResponse>(
          this.apiBaseUrl + '/api/v1/universe/protocols', network,
        ).pipe(
          catchError((error) => {
            // Only clear the failed partition; a late failure cannot evict a newer network.
            if (this.protocolsCacheNetwork === network) {this.protocolsCache$ = null;}
            return throwError(() => error);
          }),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
      }
      return this.protocolsCache$;
    }));
  }

  private protocolFailure(error: unknown, kind: ProtocolPageKind, protocolId: string,
    network: ExplorerNetwork, chain: string): Observable<ExplorerProtocolActivityPage | ExplorerProtocolObjectsPage> {
    const page = readProtocolFailure(kind, error, protocolId);
    this.assertResponseContext(page, network, chain);
    return of(page);
  }

  /** Validates the authority document while retaining typed dependency states and transport errors. */
  getProtocolActivity$(protocolId: string, cursor?: string, limit = 25, chain = 'bitcoin'): Observable<ExplorerProtocolActivityPage> {
    let query = '?limit=' + Math.min(Math.max(1, Math.floor(limit)), 200);
    if (cursor) {query += '&cursor=' + encodeURIComponent(cursor);}
    return this.scopedRequest<unknown>(
      this.apiBaseUrl + '/api/v1/universe/protocols/' + encodeURIComponent(protocolId) + '/activity' + query,
      undefined, chain, (error, network) => this.protocolFailure(error, 'activity', protocolId, network, chain),
    ).pipe(map((page) => readProtocolPage('activity', page, protocolId)));
  }

  getStatus$(): Observable<StatusResponse> {
    return this.scopedRequest<StatusResponse>(this.apiBaseUrl + '/api/v1/universe/status');
  }

  getSources$(chain = 'bitcoin'): Observable<SourcesResponse> {
    return this.scopedRequest<SourcesResponse>(this.apiBaseUrl + '/api/v1/universe/sources', undefined, chain);
  }

  /**
   * Release identity of the running explorer backend. The AGPL source page
   * needs it, so it goes through the same SSR-safe base URL as the rest of
   * the overlay calls rather than a bare relative path.
   */
  getBackendInfo$(): Observable<BackendInfo> {
    return this.httpClient.get<BackendInfo>(this.backendBase + '/api/v1/backend-info');
  }

  /** Protocol asset flow for one transaction. Never cached: state changes as the transaction confirms. */
  /**
   * IMPLEMENTATION-HANDOFF [TX-05] TX-05-FE-API
   * Coverage G01/G08-G12/P-*-api; D05. R-ANGULAR-20/R-ARCH.
   * Current flow has no component-owned deadline and the observed public read
   * exceeded 15 seconds. Type parameters do not validate untrusted responses.
   * 1. Add getTransactionAssets$(context,txid,paging?) for the new same-origin
   * transactions/:txid/assets contract. Use explicit validated chain/network;
   * retain requestForNetwork context checks and add the TX-01 summary decoder.
   * 2. Set an eight-second client deadline around the complete summary request
   * (the backend target is five seconds). Convert timeout/unconfigured/partial/
   * not-found to distinct states. Never catch a failure into assets:[] or zero.
   * 3. SwitchMap on txid/context/status-revision and cancel prior HTTP work.
   * Share one request among sibling views for a context/txid/revision; clear it
   * on context changes, confirmation, replacement or reorg. Do not use a global
   * shareReplay that can leak a mainnet payload into Signet or another chain.
   * 4. Retry is user-triggered plus a bounded refresh on actual status/checkpoint
   * changes; honor retryAfter, no infinite retry or per-logo request waterfall.
   * Expose pagination without changing the counts to the number of loaded rows.
   * Depends TX-01/02/04 backend; keep getTransactionFlow$ independent so a slow
   * legacy flow cannot hold the compact summary hostage. Existing browser/SSR
   * origins and self-host-only transport remain unchanged.
   * Tests: universe-api.service.spec.ts and new summary decoder tests: cancellation,
   * deadline, wrong network, invalid txid, partial sources, replay isolation,
   * back/forward, pagination and no duplicate subscriptions.
   */
  getTransactionFlow$(txid: string): Observable<ExplorerTransactionAssetFlow> {
    return this.scopedRequest<ExplorerTransactionAssetFlow>(
      this.apiBaseUrl + '/api/v1/universe/transactions/' + txid
    );
  }

  /**
   * Asset flows for up to {@link UNIVERSE_TRANSACTION_BATCH_LIMIT} transactions
   * in one request. Batching is what keeps a block or a mempool page from
   * issuing one request per transaction.
   */
  getTransactionFlows$(txids: string[]): Observable<TransactionBatchResponse> {
    if (txids.length > UNIVERSE_TRANSACTION_BATCH_LIMIT) {
      return throwError(() => new Error('universe-transactions-batch-limit-exceeded'));
    }
    return this.scopedRequest<TransactionBatchResponse>(
      this.apiBaseUrl + '/api/v1/universe/transactions/batch',
      { txids: txids.slice() }
    ).pipe(take(1));
  }

  /** Assets attached to one outpoint, with the evidence behind the answer. */
  getOutpoint$(txid: string, vout: number | string): Observable<OutpointEnrichment> {
    return this.scopedRequest<OutpointEnrichment>(
      this.apiBaseUrl + '/api/v1/universe/outpoints/' + txid + '/' + vout
    );
  }

  /** Assets attached to up to {@link UNIVERSE_OUTPOINT_BATCH_LIMIT} outpoints. */
  getOutpoints$(outpoints: string[]): Observable<OutpointBatchResponse> {
    if (outpoints.length > UNIVERSE_OUTPOINT_BATCH_LIMIT) {
      return throwError(() => new Error('universe-outpoints-batch-limit-exceeded'));
    }
    return this.scopedRequest<OutpointBatchResponse>(
      this.apiBaseUrl + '/api/v1/universe/outpoints/batch',
      { outpoints: outpoints.slice() }
    ).pipe(take(1));
  }

  /** One inscription, addressed by id or by inscription number. */
  getInscription$(reference: string): Observable<AssetLookupResult<OrdInscriptionView>> {
    return this.scopedRequest<AssetLookupResult<OrdInscriptionView>>(
      this.apiBaseUrl + '/api/v1/universe/inscriptions/' + encodeURIComponent(reference)
    );
  }

  /** One rune, addressed by name or by rune id. */
  getRune$(reference: string): Observable<AssetLookupResult<OrdRuneView>> {
    return this.scopedRequest<AssetLookupResult<OrdRuneView>>(
      this.apiBaseUrl + '/api/v1/universe/runes/' + encodeURIComponent(reference)
    );
  }

  /** One satoshi, addressed by its ordinal number. */
  getSat$(reference: string): Observable<AssetLookupResult<OrdSatView>> {
    return this.scopedRequest<AssetLookupResult<OrdSatView>>(
      this.apiBaseUrl + '/api/v1/universe/sats/' + encodeURIComponent(reference)
    );
  }

  /** Inscriptions revealed in one block. Paginated by the authority. */
  getBlockInscriptions$(height: number | string, page = 0): Observable<AssetLookupResult<OrdBlockInscriptionsView>> {
    return this.scopedRequest<AssetLookupResult<OrdBlockInscriptionsView>>(
      this.apiBaseUrl + '/api/v1/universe/blocks/' + height + '/inscriptions?page=' + page
    );
  }

  /**
   * One capability record per chain, each read from its own network. The
   * overlay lists /api/v1/chains?network=<n> by network, so a Signet reader
   * with Dogecoin on testnet needs three scoped reads, not one list; a chain
   * whose configured network the overlay does not serve answers its typed
   * unavailable record under that network, never a mainnet one.
   */
  getChains$(): Observable<ChainCapabilityEnvelope[]> {
    return this.selectedNetwork$().pipe(switchMap(network => forkJoin(EXPLORER_CHAINS.map(chain => {
      const expected = chainNetwork(chain, network, this.stateService.env);
      return this.httpClient.get<ChainCapabilityEnvelope>(
        this.apiBaseUrl + '/api/v1/chains/' + chain + '?network=' + expected,
      ).pipe(map(row => {
        if (!row || row.chain !== chain) {throw new Error('invalid-chain-capabilities');}
        if (row.network !== expected) {throw new Error('authority-network-mismatch');}
        this.assertResponseContext(row, expected, chain);
        return row;
      }));
    }))));
  }

  getChainStatus$(chain: ExplorerChain): Observable<ChainCapabilityEnvelope> {
    return this.chainNetwork$(chain).pipe(
      switchMap(network => this.httpClient.get<ChainCapabilityEnvelope>(
        this.apiBaseUrl + '/api/v1/' + chain + '/status?network=' + network,
      ).pipe(map(row => {
        this.assertResponseContext(row, network, chain);
        return row;
      }))),
    );
  }

  /**
   * A search carries the selected network, and a network switch cancels the
   * request in flight. Without the network the overlay answered every search
   * from mainnet, so a Signet reader was sent to mainnet pages; without the
   * switch a late mainnet answer could land on a page that had moved on.
   */
  search$(query: string, activeChain: ExplorerChain, allChains = false): Observable<UniverseSearchResponse> {
    return this.chainNetwork$(activeChain).pipe(
      switchMap(network => this.httpClient.get<UniverseSearchResponse>(
        this.apiBaseUrl + '/api/v1/universe/search?q=' + encodeURIComponent(query)
          + '&chain=' + activeChain + '&all=' + allChains + '&network=' + network,
      ).pipe(map(response => {
        const active = (response.groups ?? []).find(group => group.chain === activeChain);
        if ((response.activeChain !== undefined && response.activeChain !== activeChain)
          || (active && active.network !== network)) {
          throw new Error('authority-network-mismatch');
        }
        return response;
      }))),
    );
  }

  getChainMempool$(chain: Exclude<ExplorerChain, 'bitcoin'>, limit = 100): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mempool?network=' + this.chainNetwork(chain) + '&limit='
        + Math.min(Math.max(1, Math.floor(limit)), CHAIN_MEMPOOL_LIMIT[chain])
    );
  }

  getChainCandidateBuckets$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/candidate-buckets?network=' + this.chainNetwork(chain)
    );
  }

  /** The one-call dashboard aggregate: blocks, buckets, fees, mempool, mining. */
  getChainDashboard$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainDashboardView> {
    return this.httpClient.get<ChainDashboardView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/dashboard?network=' + this.chainNetwork(chain)
    );
  }

  getChainRecentBlocks$(chain: Exclude<ExplorerChain, 'bitcoin'>, limit = 15): Observable<RecentBlocksView> {
    return this.httpClient.get<RecentBlocksView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/blocks/recent?network=' + this.chainNetwork(chain) + '&limit=' + limit
    );
  }

  getChainFees$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<FeeRecommendationsView> {
    return this.httpClient.get<FeeRecommendationsView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/fees?network=' + this.chainNetwork(chain)
    );
  }

  getChainMining$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<MiningSummaryView> {
    return this.httpClient.get<MiningSummaryView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mining?network=' + this.chainNetwork(chain)
    );
  }

  getChainMiningPools$(chain: Exclude<ExplorerChain, 'bitcoin'>, window = '1w'): Observable<MiningPoolsView> {
    return this.httpClient.get<MiningPoolsView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/mining/pools?network=' + this.chainNetwork(chain) + '&window=' + encodeURIComponent(window)
    );
  }

  getChainChartSeries$(chain: Exclude<ExplorerChain, 'bitcoin'>, seriesId: string, range = '1w'): Observable<ChartSeriesView> {
    return this.httpClient.get<ChartSeriesView>(
      this.apiBaseUrl + '/api/v1/' + chain + '/charts/' + encodeURIComponent(seriesId)
        + '?network=' + this.chainNetwork(chain) + '&range=' + encodeURIComponent(range)
    );
  }

  getChainTransaction$(chain: Exclude<ExplorerChain, 'bitcoin'>, txid: string): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/tx/' + encodeURIComponent(txid) + '?network=' + this.chainNetwork(chain)
    );
  }

  getChainBlock$(chain: Exclude<ExplorerChain, 'bitcoin'>, reference: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    const paging = chain === 'dogecoin'
      ? '&page=' + (Math.floor(offset / limit) + 1) + '&limit=' + limit
      : '&limit=' + limit + '&offset=' + offset;
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/block/' + encodeURIComponent(reference) + '?network=' + this.chainNetwork(chain) + paging
    );
  }

  getChainAddress$(chain: Exclude<ExplorerChain, 'bitcoin'>, address: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    const paging = chain === 'dogecoin'
      ? '&page=' + (Math.floor(offset / limit) + 1) + '&limit=' + limit
      : '&limit=' + limit + '&offset=' + offset;
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/address/' + encodeURIComponent(address) + '?network=' + this.chainNetwork(chain) + paging
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
      this.apiBaseUrl + '/api/v1/' + chain + '/address/' + encodeURIComponent(address) + '/holdings?network=' + this.chainNetwork(chain) + '&limit=' + limit + '&offset=' + offset
    );
  }

  /** The Bitcoin address asset-holdings view from the universe overlay. */
  getAddressHoldings$(address: string, limit = 100, offset = 0): Observable<ChainExplorerPayload> {
    return this.scopedRequest<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/universe/addresses/' + encodeURIComponent(address) + '/holdings?limit=' + limit + '&offset=' + offset
    );
  }

  getChainOutpoint$(chain: Exclude<ExplorerChain, 'bitcoin'>, txid: string, vout: string): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/outpoint/' + encodeURIComponent(txid) + '/' + encodeURIComponent(vout) + '?network=' + this.chainNetwork(chain)
    );
  }

  getChainProtocols$(chain: Exclude<ExplorerChain, 'bitcoin'>): Observable<ChainExplorerPayload> {
    return this.httpClient.get<ChainExplorerPayload>(
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols?network=' + this.chainNetwork(chain)
    );
  }

  getChainProtocolList$(chain: Exclude<ExplorerChain, 'bitcoin'>, protocol: string, limit = 100, offset = 0, ruleset?: string): Observable<ChainExplorerPayload> {
    const path = this.protocolPath(chain, protocol);
    let query = '?network=' + this.chainNetwork(chain) + '&limit=' + limit;
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
    let query = '?network=' + this.chainNetwork(chain);
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
      this.apiBaseUrl + '/api/v1/' + chain + '/protocols/' + path + '/' + encodeURIComponent(reference) + '/' + section + '?network=' + this.chainNetwork(chain) + '&limit=' + limit + paging
    );
  }


  /**
   * Clusters in this node mempool, highest fee rate first.
   *
   * The response carries the age of the snapshot it was built from, so a
   * caller renders how old the answer is rather than implying it is live.
   */
  getMempoolClusters$(offset = 0, limit = 50, minTxCount = 1): Observable<ClusterListResponse> {
    return this.httpClient.get<ClusterListResponse>(
      this.backendBase + '/api/v1/mempool/clusters?offset=' + offset + '&limit=' + limit
        + '&minTxCount=' + minTxCount
    );
  }

  /** One cluster in full, addressed by its id or by any member txid. */
  getMempoolCluster$(reference: string): Observable<ClusterResponse> {
    return this.httpClient.get<ClusterResponse>(
      this.backendBase + '/api/v1/mempool/clusters/' + encodeURIComponent(reference)
    );
  }

  /** The mempool wide fee rate diagram, with the naive curve beside it. */
  getMempoolFeerateDiagram$(): Observable<DiagramResponse> {
    return this.httpClient.get<DiagramResponse>(
      this.backendBase + '/api/v1/mempool/feerate-diagram'
    );
  }

  /** The package around one unconfirmed transaction. */
  getMempoolPackage$(txid: string): Observable<ClusterResponse> {
    return this.httpClient.get<ClusterResponse>(
      this.backendBase + '/api/v1/mempool/packages/' + encodeURIComponent(txid)
    );
  }

  /**
   * Asks the node what it would do with a package, without sending it.
   *
   * The answer depends on the mempool at this instant, so it is cached on
   * neither side. A cached verdict on a replacement is a verdict about a
   * conflict that may already be gone.
   */
  simulatePackage$(rawTxs: string[]): Observable<PackageSimulation> {
    return this.httpClient.post<PackageSimulation>(
      this.backendBase + '/api/v1/mempool/simulate',
      { rawTxs },
    );
  }

  /**
   * What it would cost to make an unconfirmed transaction confirm sooner.
   *
   * The target rate is required by the server rather than defaulted, so a
   * plan is always a plan for a rate the caller actually asked for.
   */
  getBumpPlan$(txid: string, targetFeerate: number): Observable<BumpPlan> {
    return this.httpClient.get<BumpPlan>(
      this.backendBase + '/api/v1/mempool/bump/' + encodeURIComponent(txid)
        + '?targetFeerate=' + encodeURIComponent(String(targetFeerate)),
    );
  }

  /** What this node is, section by section, each with its own state. */
  getNodeOverview$(): Observable<NodeOverview> {
    return this.httpClient.get<NodeOverview>(this.backendBase + '/api/v1/node/overview');
  }

  /** The only node methods the console will call. */
  getRpcCatalog$(): Observable<RpcCatalog> {
    return this.httpClient.get<RpcCatalog>(this.backendBase + '/api/v1/node/rpc/catalog');
  }

  /**
   * Calls one allowlisted node method.
   *
   * The method name goes in the body rather than the path, so no part of a
   * URL is ever interpolated into a call, and the server matches it against
   * its allowlist before anything else happens.
   */
  callNodeRpc$(method: string, args: unknown[]): Observable<RpcResult> {
    // Executing a method spends the node's RPC budget, so the route needs an
    // owner key with the node:rpc scope; the catalog and overview stay public.
    return this.httpClient.post<RpcResult>(
      this.backendBase + '/api/v1/node/rpc',
      { method, args },
      { headers: this.ownerKey.headers() },
    );
  }

  private protocolPath(chain: Exclude<ExplorerChain, 'bitcoin'>, protocol: string): string {
    const allowed = chain === 'dogecoin'
      ? ['doginals', 'drc20', 'doge-tap', 'dunes']
      : ['zerdinals', 'zrunes', 'zrc20'];
    if (!allowed.includes(protocol)) {throw new Error('unsupported-chain-protocol');}
    return protocol;
  }

  /** One protocol's validated standing objects, with explicit dependency and failure states. */
  getProtocolObjects$(protocolId: string, cursor?: string, limit = 25, chain = 'bitcoin'): Observable<ExplorerProtocolObjectsPage> {
    let query = '?limit=' + Math.min(Math.max(1, Math.floor(limit)), 200);
    if (cursor) {query += '&cursor=' + encodeURIComponent(cursor);}
    return this.scopedRequest<unknown>(
      this.apiBaseUrl + '/api/v1/universe/protocols/' + encodeURIComponent(protocolId) + '/objects' + query,
      undefined, chain, (error, network) => this.protocolFailure(error, 'objects', protocolId, network, chain),
    ).pipe(map((page) => readProtocolPage('objects', page, protocolId)));
  }

  /** ANIMA protocol status, scanner readiness, and exact supply. */
  getAnimaStatus$(): Observable<AnimaStatusDocument> {
    return this.scopedRequest<AnimaStatusDocument>(
      this.apiBaseUrl + '/api/v1/anima/status'
    );
  }

  /** One page of the ANIMA logged transition list. */
  getAnimaEvents$(from = 0, limit = 50): Observable<AnimaEventsDocument> {
    return this.scopedRequest<AnimaEventsDocument>(
      this.apiBaseUrl + '/api/v1/anima/events?from=' + Math.max(0, Math.floor(from))
        + '&limit=' + Math.min(Math.max(1, Math.floor(limit)), 200)
    );
  }

  /** One ANIMA logged transition by the composite id this explorer issues. */
  getAnimaEvent$(eventId: string): Observable<AnimaEventDocument> {
    return this.scopedRequest<AnimaEventDocument>(
      this.apiBaseUrl + '/api/v1/anima/events/' + encodeURIComponent(eventId)
    );
  }

  /** One page of the ANIMA organism list. */
  getAnimaOrganisms$(offset = 0, limit = 50, status?: string): Observable<AnimaOrganismsDocument> {
    let query = '?offset=' + Math.max(0, Math.floor(offset))
      + '&limit=' + Math.min(Math.max(1, Math.floor(limit)), 200);
    if (status) {query += '&status=' + encodeURIComponent(status);}
    return this.scopedRequest<AnimaOrganismsDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms' + query
    );
  }

  /** One ANIMA organism with its waymarks and achievements. */
  getAnimaOrganism$(organismId: string): Observable<AnimaOrganismDocument> {
    return this.scopedRequest<AnimaOrganismDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms/' + encodeURIComponent(organismId)
    );
  }

  /** The transition history and lineage around one ANIMA organism. */
  getAnimaOrganismHistory$(organismId: string): Observable<AnimaOrganismHistoryDocument> {
    return this.scopedRequest<AnimaOrganismHistoryDocument>(
      this.apiBaseUrl + '/api/v1/anima/organisms/' + encodeURIComponent(organismId) + '/history'
    );
  }

  // ---------------------------------------------------------------------------
  // Product Verticals API Methods
  // ---------------------------------------------------------------------------

  getFractalTip$(): Observable<{ height: number; hash: string; time: number; network: string }> {
    return this.httpClient.get<{ height: number; hash: string; time: number; network: string }>(
      this.apiBaseUrl + '/api/v1/fractal/tip'
    );
  }

  getFractalMempool$(): Observable<FractalMempoolOverview> {
    return this.httpClient.get<FractalMempoolOverview>(
      this.apiBaseUrl + '/api/v1/fractal/mempool'
    );
  }

  getFractalBlock$(hash: string): Observable<FractalBlockSummary> {
    return this.httpClient.get<FractalBlockSummary>(
      this.apiBaseUrl + '/api/v1/fractal/block/' + encodeURIComponent(hash)
    );
  }

  getFractalTx$(txid: string): Observable<FractalTransactionView> {
    return this.httpClient.get<FractalTransactionView>(
      this.apiBaseUrl + '/api/v1/fractal/tx/' + encodeURIComponent(txid)
    );
  }

  getCat20Tokens$(): Observable<{ tokens: Cat20Token[]; total: number }> {
    return this.httpClient.get<{ tokens: Cat20Token[]; total: number }>(
      this.apiBaseUrl + '/api/v1/fractal/cat20/tokens'
    );
  }

  getCat20Token$(tokenId: string): Observable<Cat20Token> {
    return this.httpClient.get<Cat20Token>(
      this.apiBaseUrl + '/api/v1/fractal/cat20/tokens/' + encodeURIComponent(tokenId)
    );
  }

  getCat20Holders$(tokenId: string): Observable<{ holders: Cat20Holder[]; total: number }> {
    return this.httpClient.get<{ holders: Cat20Holder[]; total: number }>(
      this.apiBaseUrl + '/api/v1/fractal/cat20/tokens/' + encodeURIComponent(tokenId) + '/holders'
    );
  }

  getZcashPrivacySummary$(): Observable<ZcashPrivacySummary> {
    return this.httpClient.get<ZcashPrivacySummary>(
      this.apiBaseUrl + '/api/v1/zcash/privacy/summary'
    );
  }

  getZcashPools$(): Observable<{ pools: ZcashValuePool[]; total: number }> {
    return this.httpClient.get<{ pools: ZcashValuePool[]; total: number }>(
      this.apiBaseUrl + '/api/v1/zcash/privacy/pools'
    );
  }

  getZcashUpgrades$(): Observable<{ upgrades: ZcashNetworkUpgrade[]; total: number }> {
    return this.httpClient.get<{ upgrades: ZcashNetworkUpgrade[]; total: number }>(
      this.apiBaseUrl + '/api/v1/zcash/privacy/upgrades'
    );
  }

  getLiquidNode$(network: string): Observable<import('./liquid-observatory/liquid-node-view').LiquidNodeView> {
    return this.httpClient.get<import('./liquid-observatory/liquid-node-view').LiquidNodeView>(this.apiBaseUrl + '/api/v1/liquid/observatory/node?network=' + encodeURIComponent(network));
  }

  getLiquidObservatorySummary$(): Observable<LiquidObservatorySummary> {
    return this.httpClient.get<LiquidObservatorySummary>(
      this.apiBaseUrl + '/api/v1/liquid/observatory/summary'
    );
  }

  getLiquidAssets$(): Observable<{ assets: LiquidAssetRecord[]; total: number }> {
    return this.httpClient.get<{ assets: LiquidAssetRecord[]; total: number }>(
      this.apiBaseUrl + '/api/v1/liquid/observatory/assets'
    );
  }

  getLiquidAsset$(assetId: string): Observable<LiquidAssetRecord> {
    return this.httpClient.get<LiquidAssetRecord>(
      this.apiBaseUrl + '/api/v1/liquid/observatory/assets/' + encodeURIComponent(assetId)
    );
  }

  getLiquidPegs$(): Observable<{ pegs: LiquidPegRecord[]; total: number }> {
    return this.httpClient.get<{ pegs: LiquidPegRecord[]; total: number }>(
      this.apiBaseUrl + '/api/v1/liquid/observatory/pegs'
    );
  }

  getLiquidFederation$(): Observable<LiquidFederationEpoch> {
    return this.httpClient.get<LiquidFederationEpoch>(
      this.apiBaseUrl + '/api/v1/liquid/observatory/federation'
    );
  }

  getDataCatalog$(): Observable<{ datasets: DatasetManifest[]; streams: StreamManifest[]; mcpTools: McpToolDeclaration[] }> {
    return this.httpClient.get<{ datasets: DatasetManifest[]; streams: StreamManifest[]; mcpTools: McpToolDeclaration[] }>(
      this.backendBase + '/api/v1/data/catalog'
    );
  }

  executeDataQuery$(query: any): Observable<QueryResult> {
    return this.httpClient.post<QueryResult>(
      this.backendBase + '/api/v1/data/query',
      query
    );
  }

  getObserverNodes$(): Observable<{ nodes: ObserverNode[]; total: number }> {
    return this.httpClient.get<{ nodes: ObserverNode[]; total: number }>(
      this.backendBase + '/api/v1/network/nodes'
    );
  }

  getPropagationObservation$(txid?: string): Observable<PropagationObservation> {
    const path = txid
      ? '/api/v1/network/propagation/' + encodeURIComponent(txid)
      : '/api/v1/network/propagation';
    // Same partition as the nodes and templates reads beside it: a Signet
    // reader was sent to the root backend for propagation alone.
    return this.httpClient.get<PropagationObservation>(this.backendBase + path);
  }

  getBlockTemplateComparison$(): Observable<BlockTemplateComparison> {
    return this.httpClient.get<BlockTemplateComparison>(
      this.backendBase + '/api/v1/network/templates'
    );
  }

  getTaprootAssets$(): Observable<{ assets: TaprootAssetItem[]; total: number }> {
    return this.httpClient.get<{ assets: TaprootAssetItem[]; total: number }>(
      this.backendBase + '/api/v1/taproot-assets/assets'
    );
  }

  verifyTaprootProof$(assetId: string, proofData: string): Observable<any> {
    return this.httpClient.post(this.backendBase + '/api/v1/taproot-assets/proof/verify', { assetId, proofData });
  }

  getTaprootAsset$(assetId: string): Observable<TaprootAssetItem> {
    return this.httpClient.get<TaprootAssetItem>(
      this.backendBase + '/api/v1/taproot-assets/assets/' + encodeURIComponent(assetId)
    );
  }

  getTaprootAssetGroups$(): Observable<{ groups: TaprootAssetGroup[]; total: number }> {
    return this.httpClient.get<{ groups: TaprootAssetGroup[]; total: number }>(
      this.backendBase + '/api/v1/taproot-assets/groups'
    );
  }

  decodeBolt12Offer$(offer: string): Observable<import('./taproot-assets/bolt12-decoded-offer').Bolt12DecodedOffer> {
    return this.httpClient.post<import('./taproot-assets/bolt12-decoded-offer').Bolt12DecodedOffer>(this.backendBase + '/api/v1/lightning/offers/decode', {offer, network:this.network || 'mainnet'});
  }

  getBolt12Offers$(): Observable<{ offers: Bolt12Offer[]; total: number }> {
    return this.httpClient.get<{ offers: Bolt12Offer[]; total: number }>(
      this.backendBase + '/api/v1/lightning/offers'
    );
  }

  getLightningRfq$(): Observable<{ quotes: LightningRfqQuote[]; total: number }> {
    return this.httpClient.get<{ quotes: LightningRfqQuote[]; total: number }>(
      this.backendBase + '/api/v1/lightning/rfq'
    );
  }

  getArkOperators$(): Observable<{ operators: ArkOperator[]; total: number }> {
    return this.httpClient.get<{ operators: ArkOperator[]; total: number }>(
      this.backendBase + '/api/v1/ark/operators'
    );
  }

  getArkBatches$(): Observable<{ batches: ArkBatch[]; total: number }> {
    return this.httpClient.get<{ batches: ArkBatch[]; total: number }>(
      this.backendBase + '/api/v1/ark/batches'
    );
  }

  getArkBatch$(batchId: string): Observable<ArkBatch> {
    return this.httpClient.get<ArkBatch>(
      this.backendBase + '/api/v1/ark/batches/' + encodeURIComponent(batchId)
    );
  }

  getArkVtxo$(vtxoId: string): Observable<ArkVtxo> {
    return this.httpClient.get<ArkVtxo>(
      this.backendBase + '/api/v1/ark/vtxos/' + encodeURIComponent(vtxoId)
    );
  }

  getStratumV2Network$(): Observable<{ roles: StratumV2RoleStatus[]; total: number }> {
    return this.httpClient.get<{ roles: StratumV2RoleStatus[]; total: number }>(
      this.backendBase + '/api/v1/stratum-v2/network'
    );
  }

  getStratumV2Templates$(): Observable<{ templates: StratumV2Template[]; total: number }> {
    return this.httpClient.get<{ templates: StratumV2Template[]; total: number }>(
      this.backendBase + '/api/v1/stratum-v2/templates'
    );
  }

  getStratumV2Declarations$(): Observable<{ declarations: StratumV2JobDeclaration[]; total: number }> {
    return this.httpClient.get<{ declarations: StratumV2JobDeclaration[]; total: number }>(
      this.backendBase + '/api/v1/stratum-v2/declarations'
    );
  }

  getL2Systems$(): Observable<{ systems: L2BridgeSystem[]; total: number }> {
    return this.httpClient.get<{ systems: L2BridgeSystem[]; total: number }>(
      this.backendBase + '/api/v1/l2/systems'
    );
  }

  getL2System$(systemId: string): Observable<L2BridgeSystem> {
    return this.httpClient.get<L2BridgeSystem>(
      this.backendBase + '/api/v1/l2/systems/' + encodeURIComponent(systemId)
    );
  }

  getL2Challenges$(systemId?: string): Observable<{ challenges: L2Challenge[]; total: number }> {
    const query = systemId ? '?systemId=' + encodeURIComponent(systemId) : '';
    return this.httpClient.get<{ challenges: L2Challenge[]; total: number }>(
      this.backendBase + '/api/v1/l2/challenges' + query
    );
  }

  getL2ReserveAudit$(systemId: string): Observable<L2ReserveAudit> {
    return this.httpClient.get<L2ReserveAudit>(
      this.backendBase + '/api/v1/l2/reserves/' + encodeURIComponent(systemId)
    );
  }

  getUtxoCheckpoints$(): Observable<{ checkpoints: UtxoCheckpoint[]; total: number }> {
    return this.httpClient.get<{ checkpoints: UtxoCheckpoint[]; total: number }>(
      this.backendBase + '/api/v1/utxo-set/checkpoints'
    );
  }

  getUtxoDistribution$(): Observable<{ valueCohorts: SupplyCohort[]; scriptTypes: ScriptTypeDistribution[] }> {
    return this.httpClient.get<{ valueCohorts: SupplyCohort[]; scriptTypes: ScriptTypeDistribution[] }>(
      this.backendBase + '/api/v1/utxo-set/distribution'
    );
  }

  getProtocolBearingUtxos$(): Observable<ProtocolBearingUtxos> {
    return this.httpClient.get<ProtocolBearingUtxos>(
      this.backendBase + '/api/v1/utxo-set/protocols'
    );
  }

  getUtreexoRoots$(): Observable<UtreexoRootsView> {
    return this.httpClient.get<UtreexoRootsView>(
      this.backendBase + '/api/v1/utreexo/roots'
    );
  }

  getWildkinStatus$(): Observable<WildkinStatusSummary> {
    return this.httpClient.get<WildkinStatusSummary>(
      this.backendBase + '/api/v1/wildkin/status'
    );
  }

  getWildkinCreatures$(): Observable<{ creatures: WildkinCreature[]; total: number }> {
    return this.httpClient.get<{ creatures: WildkinCreature[]; total: number }>(
      this.backendBase + '/api/v1/wildkin/creatures'
    );
  }

  getWildkinCreature$(id: string): Observable<WildkinCreature> {
    return this.httpClient.get<WildkinCreature>(
      this.backendBase + '/api/v1/wildkin/creatures/' + encodeURIComponent(id)
    );
  }

  getWildkinBraids$(): Observable<{ braids: WildkinBraidCeremony[]; total: number }> {
    return this.httpClient.get<{ braids: WildkinBraidCeremony[]; total: number }>(
      this.backendBase + '/api/v1/wildkin/braids'
    );
  }
}
