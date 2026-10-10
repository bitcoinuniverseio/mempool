import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { WebsocketResponse } from '@interfaces/websocket.interface';
import { StateService } from '@app/services/state.service';
import { RbfTree } from '@interfaces/node-api.interface';
import { Transaction } from '@interfaces/electrs.interface';
import { firstValueFrom, Subscription } from 'rxjs';
import { ApiService } from '@app/services/api.service';
import { take, timeout } from 'rxjs/operators';
import { TransferState, makeStateKey } from '@angular/core';
import { CacheService } from '@app/services/cache.service';
import { uncompressDeltaChange, uncompressTx } from '@app/shared/common.utils';
import { RBF_READ_TIMEOUT_MS, validRbfList, validRbfSummary } from './rbf-history-state';
import { decodeFeeEstimate } from './fee-estimate';
import { websocketResponseMatchesScope } from './websocket-response-scope';

const OFFLINE_RETRY_AFTER_MS = 2000;
const OFFLINE_PING_CHECK_AFTER_MS = 30000;
const EXPECT_PING_RESPONSE_AFTER_MS = 5000;

const initData = makeStateKey('/api/v1/init-data');

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private webSocketProtocol = (document.location.protocol === 'https:') ? 'wss:' : 'ws:';
  private webSocketUrl = this.webSocketProtocol + '//' + document.location.hostname + ':' + document.location.port + '{network}/api/v1/ws';

  private websocketSubject: WebSocketSubject<WebsocketResponse>;
  private goneOffline = false;
  private lastWant: string | null = null;
  private isTrackingTx = false;
  private trackingTxId: string;
  private isTrackingMempoolBlock = false;
  private isTrackingRbf: 'all' | 'fullRbf' | false = false;
  private isTrackingRbfSummary = false;
  private rbfTrackedGeneration = -1;
  private rbfSummaryTrackedGeneration = -1;
  private isTrackingAddress: string | false = false;
  private isTrackingAddresses: string[] | false = false;
  private isTrackingAccelerations: boolean = false;
  private isTrackingWallet: boolean = false;
  private trackingWalletName: string;
  private isTrackingStratum: string | number | false = false;
  private trackingMempoolBlock: number;
  private trackingMempoolBlockNetwork: string;
  private stoppingTrackMempoolBlock: any | null = null;
  private latestGitCommit = '';
  private onlineCheckTimeout: number;
  private onlineCheckTimeoutTwo: number;
  private retryTimeout: number;
  private subscription: Subscription;
  private network = '';
  private contextGeneration = 0;
  private rbfSummaryRequest: { generation: number; network: string; promise: Promise<void> } | null = null;

  constructor(
    private stateService: StateService,
    private apiService: ApiService,
    private transferState: TransferState,
    private cacheService: CacheService,
  ) {
    if (!this.stateService.isBrowser) {
      let selected = this.stateService.network;
      this.stateService.networkChanged$.subscribe(network => {
        if (selected !== network) { selected = network; this.contextGeneration += 1; }
      });
      const generation = this.contextGeneration;
      const network = this.stateService.network;
      // @ts-ignore
      this.websocketSubject = { next: () => {}};
      this.stateService.isLoadingWebSocket$.next(false);
      this.apiService.getInitData$()
        .pipe(take(1))
        .subscribe((response) => {
          if (generation === this.contextGeneration && network === this.stateService.network) this.handleResponse(response);
        });
    } else {
      this.network = this.stateService.network === this.stateService.env.ROOT_NETWORK ? '' : this.stateService.network;
      this.websocketSubject = webSocket<WebsocketResponse>(this.webSocketUrl.replace('{network}', this.network ? '/' + this.network : ''));

      const { response: theInitData } = this.transferState.get<any>(initData, null) || {};
      if (theInitData) {
        if (websocketResponseMatchesScope(theInitData.body, this.stateService.network) && theInitData.body.blocks) {
          theInitData.body.blocks = theInitData.body.blocks.reverse();
        }
        const accepted = this.handleResponse(theInitData.body);
        if (accepted) {
          this.stateService.backend$.next(theInitData.backend);
          this.stateService.isLoadingWebSocket$.next(false);
        }
        this.startSubscription(false, accepted);
      } else {
        this.startSubscription();
      }

      this.stateService.networkChanged$.subscribe((network) => {
        if (network === this.network || (this.network === '' && network === this.stateService.env.ROOT_NETWORK)) {
          return;
        }
        this.network = network === this.stateService.env.ROOT_NETWORK ? '' : network;
        clearTimeout(this.onlineCheckTimeout);
        clearTimeout(this.onlineCheckTimeoutTwo);
        clearTimeout(this.retryTimeout);

        this.stateService.resetChainTip();

        this.reconnectWebsocket();
      });
    }
  }

  reconnectWebsocket(retrying = false, hasInitData = false) {
    this.contextGeneration += 1;
    clearTimeout(this.onlineCheckTimeout);
    clearTimeout(this.onlineCheckTimeoutTwo);
    console.log('reconnecting websocket');
    clearTimeout(this.retryTimeout);
    this.stateService.retryLiveFeed();
    if (this.isTrackingRbfSummary) { this.stateService.rbfHistoryState?.beginSummary(); }
    this.subscription.unsubscribe();
    this.websocketSubject.complete();
    this.websocketSubject = webSocket<WebsocketResponse>(
      this.webSocketUrl.replace('{network}', this.network ? '/' + this.network : '')
    );

    this.startSubscription(retrying, hasInitData);
  }

  startSubscription(retrying = false, hasInitData = false) {
    if (!hasInitData) {
      this.stateService.isLoadingWebSocket$.next(true);
      this.websocketSubject.next({'action': 'init'});
    }
    if (retrying) {
      this.stateService.connectionState$.next(1);
    }
    const subscriptionNetwork = this.network;
    const generation = this.contextGeneration;
    const subject = this.websocketSubject;
    this.subscription = this.websocketSubject
      .subscribe((response: WebsocketResponse) => {
        if (subscriptionNetwork !== this.network || generation !== this.contextGeneration) return;
        if (!this.handleResponse(response)) return;
        this.stateService.isLoadingWebSocket$.next(false);

        if (this.goneOffline === true) {
          this.goneOffline = false;
          if (this.lastWant) {
            this.want(JSON.parse(this.lastWant), true);
          }
          if (this.isTrackingTx) {
            this.startMultiTrackTransaction(this.trackingTxId);
          }
          if (this.isTrackingMempoolBlock) {
            this.startTrackMempoolBlock(this.trackingMempoolBlock, true);
          }
          if (this.isTrackingRbf) {
            this.startTrackRbf(this.isTrackingRbf);
          }
          if (this.isTrackingRbfSummary) {
            this.startTrackRbfSummary();
          }
          if (this.isTrackingAddress) {
            this.startTrackAddress(this.isTrackingAddress);
          }
          if (this.isTrackingAddresses) {
            this.startTrackAddresses(this.isTrackingAddresses);
          }
          if (this.isTrackingAccelerations) {
            this.startTrackAccelerations();
          }
          if (this.isTrackingWallet) {
            this.startTrackingWallet(this.trackingWalletName);
          }
          if (this.isTrackingStratum !== false) {
            this.startTrackStratum(this.isTrackingStratum);
          }
          this.stateService.connectionState$.next(2);
        }

        if (this.stateService.connectionState$.value !== 2) {
          this.stateService.connectionState$.next(2);
        }

        if (this.isTrackingRbf && this.rbfTrackedGeneration !== generation) { this.startTrackRbf(this.isTrackingRbf); }
        if (this.isTrackingRbfSummary && this.rbfSummaryTrackedGeneration !== generation) { this.startTrackRbfSummary(); }
        this.startOnlineCheck(generation, subject);
      },
      (err: Error) => {
        console.log(err);
        console.log(`WebSocket error`);
        this.goOffline(generation, subject);
      }, () => this.goOffline(generation, subject));
  }

  startTrackTransaction(txId: string) {
    if (this.isTrackingTx) {
      return;
    }
    this.websocketSubject.next({ 'track-tx': txId });
    this.isTrackingTx = true;
    this.trackingTxId = txId;
  }

  startMultiTrackTransaction(txId: string) {
    this.websocketSubject.next({ 'track-tx': txId, 'watch-mempool': true });
    this.isTrackingTx = true;
    this.trackingTxId = txId;
  }

  stopTrackingTransaction() {
    if (!this.isTrackingTx) {
      return;
    }
    this.websocketSubject.next({ 'track-tx': 'stop' });
    this.isTrackingTx = false;
  }

  startTrackAddress(address: string) {
    this.websocketSubject.next({ 'track-address': address });
    this.isTrackingAddress = address;
  }

  stopTrackingAddress() {
    this.websocketSubject.next({ 'track-address': 'stop' });
    this.isTrackingAddress = false;
  }

  startTrackAddresses(addresses: string[]) {
    this.websocketSubject.next({ 'track-addresses': addresses });
    this.isTrackingAddresses = addresses;
  }

  stopTrackingAddresses() {
    this.websocketSubject.next({ 'track-addresses': [] });
    this.isTrackingAddresses = false;
  }

  startTrackingWallet(walletName: string) {
    this.websocketSubject.next({ 'track-wallet': walletName });
    this.isTrackingWallet = true;
    this.trackingWalletName = walletName;
  }

  stopTrackingWallet() {
    this.websocketSubject.next({ 'track-wallet': 'stop' });
    this.isTrackingWallet = false;
    this.trackingWalletName = '';
  }

  startTrackAsset(asset: string) {
    this.websocketSubject.next({ 'track-asset': asset });
  }

  stopTrackingAsset() {
    this.websocketSubject.next({ 'track-asset': 'stop' });
  }

  startTrackMempoolBlock(block: number, force: boolean = false): boolean {
    if (this.stoppingTrackMempoolBlock) {
      clearTimeout(this.stoppingTrackMempoolBlock);
    }
    // skip duplicate tracking requests
    if (force || this.trackingMempoolBlock !== block || this.network !== this.trackingMempoolBlockNetwork) {
      this.websocketSubject.next({ 'track-mempool-block': block });
      this.isTrackingMempoolBlock = true;
      this.trackingMempoolBlock = block;
      this.trackingMempoolBlockNetwork = this.network;
      return true;
    }
    return false;
  }

  stopTrackMempoolBlock(): void {
    if (this.stoppingTrackMempoolBlock) {
      clearTimeout(this.stoppingTrackMempoolBlock);
    }
    this.isTrackingMempoolBlock = false;
    const generation = this.contextGeneration;
    const subject = this.websocketSubject;
    this.stoppingTrackMempoolBlock = setTimeout(() => {
      if (generation !== this.contextGeneration || subject !== this.websocketSubject) return;
      this.stoppingTrackMempoolBlock = null;
      this.websocketSubject.next({ 'track-mempool-block': -1 });
      this.trackingMempoolBlock = null;
      this.stateService.mempoolBlockState = null;
    }, 2000);
  }

  startTrackRbf(mode: 'all' | 'fullRbf') {
    this.websocketSubject.next({ 'track-rbf': mode });
    this.isTrackingRbf = mode;
    this.rbfTrackedGeneration = this.contextGeneration;
  }

  stopTrackRbf() {
    this.websocketSubject.next({ 'track-rbf': 'stop' });
    this.isTrackingRbf = false;
  }

  startTrackRbfSummary() {
    if (this.isTrackingRbfSummary && this.rbfSummaryTrackedGeneration === this.contextGeneration && this.stateService.rbfHistoryState?.summary$.value.status === 'loading') { return; }
    this.stateService.rbfHistoryState?.beginSummary();
    this.initRbfSummary();
    this.websocketSubject.next({ 'track-rbf-summary': true });
    this.isTrackingRbfSummary = true;
    this.rbfSummaryTrackedGeneration = this.contextGeneration;
  }

  stopTrackRbfSummary() {
    this.websocketSubject.next({ 'track-rbf-summary': false });
    this.isTrackingRbfSummary = false;
  }

  startTrackAccelerations() {
    this.websocketSubject.next({ 'track-accelerations': true });
    this.isTrackingAccelerations = true;
  }

  stopTrackAccelerations() {
    if (this.isTrackingAccelerations) {
      this.websocketSubject.next({ 'track-accelerations': false });
      this.isTrackingAccelerations = false;
    }
  }

  ensureTrackAccelerations() {
    if (!this.isTrackingAccelerations) {
      this.startTrackAccelerations();
    }
  }

  startTrackStratum(pool: number | string) {
    this.websocketSubject.next({ 'track-stratum': pool });
    this.isTrackingStratum = pool;
  }

  stopTrackStratum() {
    if (this.isTrackingStratum) {
      this.websocketSubject.next({ 'track-stratum': null });
      this.isTrackingStratum = false;
    }
  }

  fetchStatistics(historicalDate: string) {
    this.websocketSubject.next({ historicalDate });
  }

  want(data: string[], force = false) {
    if (!this.stateService.isBrowser) {
      return;
    }
    if (JSON.stringify(data) === this.lastWant && !force) {
      return;
    }
    this.websocketSubject.next({action: 'want', data: data});
    this.lastWant = JSON.stringify(data);
  }

  goOffline(generation = this.contextGeneration, subject = this.websocketSubject) {
    if (generation !== this.contextGeneration || subject !== this.websocketSubject) return;
    clearTimeout(this.onlineCheckTimeout);
    clearTimeout(this.onlineCheckTimeoutTwo);
    clearTimeout(this.retryTimeout);
    const retryDelay = OFFLINE_RETRY_AFTER_MS + (Math.random() * OFFLINE_RETRY_AFTER_MS);
    console.log(`trying to reconnect websocket in ${retryDelay} seconds`);
    this.goneOffline = true;
    this.stateService.connectionState$.next(0);
    this.retryTimeout = window.setTimeout(() => {
      if (generation === this.contextGeneration && subject === this.websocketSubject) this.reconnectWebsocket(true);
    }, retryDelay);
  }

  startOnlineCheck(generation = this.contextGeneration, subject = this.websocketSubject) {
    clearTimeout(this.onlineCheckTimeout);
    clearTimeout(this.onlineCheckTimeoutTwo);

    this.onlineCheckTimeout = window.setTimeout(() => {
      if (generation !== this.contextGeneration || subject !== this.websocketSubject) return;
      subject.next({action: 'ping'});
      this.onlineCheckTimeoutTwo = window.setTimeout(() => {
        if (generation !== this.contextGeneration || subject !== this.websocketSubject) return;
        if (!this.goneOffline) {
          console.log('WebSocket response timeout, force closing');
          this.subscription.unsubscribe();
          this.websocketSubject.complete();
          this.goOffline(generation, subject);
        }
      }, EXPECT_PING_RESPONSE_AFTER_MS);
    }, OFFLINE_PING_CHECK_AFTER_MS);
  }

  handleResponse(response: WebsocketResponse) {
    if (!websocketResponseMatchesScope(response, this.stateService.network)) return false;
    const live = response.liveObservation;
    const proof = live?.schemaVersion === 'universe-live-observation-v1' ? decodeFeeEstimate({ ...live,
      schemaVersion: 'universe-fee-estimate-v1', values: live.status === 'ready'
        ? { fastestFee: 0, halfHourFee: 0, hourFee: 0, economyFee: 0, minimumFee: 0 } : null }, this.stateService.network) : null;
    // Legacy scoped data remains usable, but a chain payload without a valid
    // ready observation cannot inherit currentness from a prior snapshot.
    if ((live || response.blocks?.length || response.block || response.mempoolInfo) && proof?.status !== 'ready') {
      this.stateService.invalidateLiveObservation();
    }
    let reinitBlocks = false;

    if (response.backend) {
      this.stateService.backend$.next(response.backend);
    }

    if (response.blocks && response.blocks.length) {
      const blocks = response.blocks;
      this.stateService.resetBlocks(blocks);
      const maxHeight = blocks.reduce((max, block) => Math.max(max, block.height), this.stateService.latestBlockHeight);
      this.stateService.updateChainTip(maxHeight);
    }

    if (response.tx) {
      this.stateService.mempoolTransactions$.next(response.tx);
    }

    if (response['txPosition']) {
      this.stateService.mempoolTxPosition$.next(response['txPosition']);
    }

    if (response.block) {
      if (response.block.height === this.stateService.latestBlockHeight + 1) {
        this.stateService.updateChainTip(response.block.height);
        this.stateService.addBlock(response.block);
        this.stateService.txConfirmed$.next([response.txConfirmed, response.block]);
      } else if (response.block.height > this.stateService.latestBlockHeight + 1) {
        reinitBlocks = true;
      }

      if (response.txConfirmed) {
        this.isTrackingTx = false;
      }
    }

    if (response.conversions) {
      this.stateService.conversions$.next(response.conversions);
    }

    const rbfAllowed = this.stateService.rbfHistoryState?.acceptMarker(response.rbfHistoryAvailability) ?? true;
    // A live, scope-validated producer replacement fact is independent of restored history.
    // Bootstrap/track-tx txReplaced and all history-derived panels remain quarantined.
    if (response.rbfTransaction && (rbfAllowed || proof?.status === 'ready')) {
      this.stateService.txReplaced$.next(response.rbfTransaction);
    }

    if (rbfAllowed && response.rbfInfo) {
      this.stateService.txRbfInfo$.next(response.rbfInfo);
    }

    if (rbfAllowed && Array.isArray(response.rbfLatest)) {
      this.stateService.rbfLatest$.next(response.rbfLatest);
    }

    if (rbfAllowed && validRbfSummary(response.rbfLatestSummary)) {
      this.stateService.rbfHistoryState?.acceptSummary(response.rbfLatestSummary);
      this.stateService.rbfLatestSummary$.next(response.rbfLatestSummary);
    } else if (rbfAllowed && response.rbfLatestSummary !== undefined) { this.stateService.rbfHistoryState?.failSummary(); }

    if (rbfAllowed && response.txReplaced) {
      this.stateService.txReplaced$.next(response.txReplaced);
    }

    if (response['mempool-blocks']) {
      this.stateService.mempoolBlocks$.next(response['mempool-blocks']);
    }

    if (response.transactions) {
      this.stateService.transactions$.next(response.transactions.slice(0, 6));
    }

    if (response['bsq-price']) {
      this.stateService.bsqPrice$.next(response['bsq-price']);
    }

    if (response.utxoSpent) {
      this.stateService.utxoSpent$.next(response.utxoSpent);
    }

    if (response.da) {
      this.stateService.difficultyAdjustment$.next(response.da);
    }

    /**
     * IMPLEMENTATION-HANDOFF [API-05] API-05-FEES-INGRESS | F-FE-001 | FAIL.
     * handleResponse trusts every response.fees, including init-data snapshots;
     * the REST reader refuses these same estimates when mempool.isInSync=false.
     * 1. Decode response.feeEstimate using the additive contract beside
     *    WebsocketResponse.fees. Reject explicit wrong chain/network, invalid
     *    observedAt/tip, nonfinite/negative rates and inconsistent status/values.
     * 2. Emit validated status into StateService.feeEstimate$ (PROPOSED NEW).
     *    Emit legacy recommendedFees$ only for ready snapshots; absence of proof
     *    is unavailable, and receipt time or a socket ping is not observation.
     * 3. Wire startSubscription, goOffline and networkChanged through the same
     *    freshness lifecycle. Clear cross-network state before a replacement
     *    connection can deliver; bound recovery and reject late old frames.
     * 4. Add PROPOSED NEW services/websocket-fee-readiness.spec.ts and shared
     *    fee-estimate tests. Cover cached init vs REST 503, stale after ready,
     *    wrong-network frames, no data after reconnect and fresh recovery.
     *    Run npm test -- <new paths>, npm run lint, npm run build:universe.
     *    Proposed test commands need execution after implementation.
     * Dependencies API-01..API-04 and coordinated backend websocket-handler.ts.
     * Evidence: public-http.json; frontend-source-reproductions.json F-FE-001.
     * Acceptance: dashboard and clock report the same actual Signet snapshot
     *    readiness and original observation; controlled outage is not current.
     * Rollback both contract ends together; no fallback to raw stale fees.
     */
    if ('feeEstimate' in response || response.fees || response.loadingIndicators) {
      this.stateService.acceptFeeEstimate(response.feeEstimate);
    }
    if (proof?.status === 'ready' && (response.blocks?.length || response.block || response.mempoolInfo?.loaded)) {
      this.stateService.acceptLiveObservation(proof.observedAt);
    }

    if (response.backendInfo) {
      this.stateService.backendInfo$.next(response.backendInfo);

      if (!this.latestGitCommit) {
        this.latestGitCommit = response.backendInfo.gitCommit;
      } else {
        if (this.latestGitCommit !== response.backendInfo.gitCommit) {
          const generation = this.contextGeneration;
          setTimeout(() => {
            if (generation === this.contextGeneration) window.location.reload();
          }, Math.floor(Math.random() * 60000) + 60000);
        }
      }
    }

    if (response['address-transactions']) {
      response['address-transactions'].forEach((addressTransaction: Transaction) => {
        this.stateService.mempoolTransactions$.next(addressTransaction);
      });
    }

    if (response['address-removed-transactions']) {
      response['address-removed-transactions'].forEach((addressTransaction: Transaction) => {
        this.stateService.mempoolRemovedTransactions$.next(addressTransaction);
      });
    }

    if (response['multi-address-transactions']) {
      this.stateService.multiAddressTransactions$.next(response['multi-address-transactions']);
    }

    if (response['block-transactions']) {
      response['block-transactions'].forEach((addressTransaction: Transaction) => {
        this.stateService.blockTransactions$.next(addressTransaction);
      });
    }

    if (response['projected-block-transactions']) {
      if (response['projected-block-transactions'].index == this.trackingMempoolBlock) {
        if (response['projected-block-transactions'].blockTransactions) {
          this.stateService.mempoolSequence = response['projected-block-transactions'].sequence;
          this.stateService.mempoolBlockUpdate$.next({
            block: this.trackingMempoolBlock,
            transactions: response['projected-block-transactions'].blockTransactions.map(uncompressTx),
          });
        } else if (response['projected-block-transactions'].delta) {
          if (this.stateService.mempoolSequence && response['projected-block-transactions'].sequence !== this.stateService.mempoolSequence + 1) {
            this.stateService.mempoolSequence = 0;
            this.startTrackMempoolBlock(this.trackingMempoolBlock, true);
          } else {
            this.stateService.mempoolSequence = response['projected-block-transactions'].sequence;
            this.stateService.mempoolBlockUpdate$.next(uncompressDeltaChange(this.trackingMempoolBlock, response['projected-block-transactions'].delta));
          }
        }
      }
    }

    if (response['wallet-transactions']) {
      this.stateService.walletTransactions$.next(response['wallet-transactions']);
    }

    if (response['accelerations']) {
      if (response['accelerations'].accelerations) {
        this.stateService.accelerations$.next({
          added: response['accelerations'].accelerations,
          removed: [],
          reset: true,
        });
      } else {
        this.stateService.accelerations$.next(response['accelerations']);
      }
    }

    if (response['live-2h-chart']) {
      this.stateService.live2Chart$.next(response['live-2h-chart']);
    }

    if (response.loadingIndicators) {
      this.stateService.loadingIndicators$.next(response.loadingIndicators);
      if (response.loadingIndicators.mempool != null && response.loadingIndicators.mempool < 100) {
        this.stateService.isLoadingMempool$.next(true);
      } else {
        this.stateService.isLoadingMempool$.next(false);
      }
    }

    if (response.mempoolInfo) {
      this.stateService.mempoolInfo$.next(response.mempoolInfo);
    }

    if (response.vBytesPerSecond !== undefined) {
      this.stateService.vbytesPerSecond$.next(response.vBytesPerSecond);
    }

    if (response.previousRetarget !== undefined) {
      this.stateService.previousRetarget$.next(response.previousRetarget);
    }

    if (response.stratumJobs) {
      this.stateService.stratumJobUpdate$.next({ state: response.stratumJobs });
    }

    if (response.stratumJob) {
      this.stateService.stratumJobUpdate$.next({ job: response.stratumJob });
    }

    if (response['tomahawk']) {
      this.stateService.serverHealth$.next(response['tomahawk']);
    }

    if (response['git-commit']) {
      this.stateService.backendInfo$.next(response['git-commit']);
    }

    if (reinitBlocks) {
      this.websocketSubject.next({'refresh-blocks': true});
    }
    return true;
  }

  async initRbfSummary(): Promise<void> {
    if (this.stateService.isBrowser) { return; }
    const generation = this.contextGeneration, network = this.stateService.network;
    if (this.rbfSummaryRequest?.generation === generation && this.rbfSummaryRequest.network === network) { return this.rbfSummaryRequest.promise; }
    const request = { generation, network, promise: this.loadRbfSummary() };
    this.rbfSummaryRequest = request;
    try { await request.promise; } finally { if (this.rbfSummaryRequest === request) { this.rbfSummaryRequest = null; } }
  }

  private async loadRbfSummary(): Promise<void> {
    if (!this.stateService.isBrowser) {
      const generation = this.contextGeneration;
      const network = this.stateService.network;
      this.stateService.rbfHistoryState?.beginSummary();
      let rbfList: RbfTree[];
      try { rbfList = await firstValueFrom(this.apiService.getRbfList$(false).pipe(timeout({ first: RBF_READ_TIMEOUT_MS }))); }
      catch { if (generation === this.contextGeneration && network === this.stateService.network) { this.stateService.rbfHistoryState?.failSummary(); } return; }
      if (generation !== this.contextGeneration || network !== this.stateService.network) return;
      if (validRbfList(rbfList) && (this.stateService.rbfHistoryState?.canUseHistory() ?? true)) {
        const rbfSummary = rbfList.slice(0, 6).map(rbfTree => {
          let oldFee = 0;
          let oldVsize = 0;
          for (const replaced of rbfTree.replaces) {
            oldFee += replaced.tx.fee;
            oldVsize += replaced.tx.vsize;
          }
          return {
            txid: rbfTree.tx.txid,
            mined: !!rbfTree.tx.mined,
            fullRbf: !!rbfTree.tx.fullRbf,
            oldFee,
            oldVsize,
            newFee: rbfTree.tx.fee,
            newVsize: rbfTree.tx.vsize,
          };
        });
        this.stateService.rbfHistoryState?.acceptSummary(rbfSummary);
        this.stateService.rbfLatestSummary$.next(rbfSummary);
      } else { this.stateService.rbfHistoryState?.failSummary(); }
    }
  }
}
