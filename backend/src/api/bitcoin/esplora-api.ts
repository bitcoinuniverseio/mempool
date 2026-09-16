import config from '../../config';
import axios, { isAxiosError } from 'axios';
import http from 'http';
import { AbstractBitcoinApi, HealthCheckHost } from './bitcoin-api-abstract-factory';
import { IEsploraApi } from './esplora-api.interface';
import logger from '../../logger';
import { Common } from '../common';
import { SubmitPackageResult, TestMempoolAcceptResult } from './bitcoin-api.interface';
import { isFirstPartyEndpoint } from '../capabilities.preflight';
import { bitcoinCoreApi } from './bitcoin-api-factory';
interface FailoverHost {
  host: string,
  rtts: number[],
  rtt: number,
  timedOut?: boolean,
  failures: number,
  latestHeight?: number,
  socket?: boolean,
  outOfSync?: boolean,
  unreachable?: boolean,
  preferred?: boolean,
  checked: boolean,
  lastChecked?: number,
  publicDomain: string,
  hashes: {
    frontend?: string,
    hybrid?: string,
    backend?: string,
    electrs?: string,
    ssr?: string,
    core?: string,
    os?: string,
    lastUpdated: number,
  }
}

export class FailoverRouter {
  activeHost: FailoverHost;
  fallbackHost: FailoverHost;
  maxSlippage: number = config.ESPLORA.MAX_BEHIND_TIP ?? (Common.isLiquid() ? 8 : 2);
  maxHeight: number = 0;
  hosts: FailoverHost[];
  multihost: boolean;
  gitHashInterval: number = 60000; // 1 minute
  pollInterval: number = 60000; // 1 minute
  pollTimer: NodeJS.Timeout | null = null;
  pollConnection = axios.create({ maxRedirects: 0, proxy: false, maxContentLength: 2 * 1024 * 1024 });
  requestConnection = axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    maxRedirects: 0,
    proxy: false,
  });

  constructor() {
    for (const endpoint of [config.ESPLORA.UNIX_SOCKET_PATH || config.ESPLORA.REST_API_URL, ...(config.ESPLORA.FALLBACK || [])]) {
      if (typeof endpoint !== 'string' || !isFirstPartyEndpoint(endpoint)) throw new Error('ESPLORA requires operated loopback endpoints or absolute Unix socket paths.');
    }
    // setup list of hosts
    this.hosts = (config.ESPLORA.FALLBACK || []).map(domain => {
      return {
        host: domain,
        socket: domain.startsWith('/'),
        checked: false,
        rtts: [],
        rtt: Infinity,
        failures: 0,
        publicDomain: this.metadataOrigin(domain),
        hashes: {
          lastUpdated: 0,
        },
      };
    });
    this.activeHost = {
      host: config.ESPLORA.UNIX_SOCKET_PATH || config.ESPLORA.REST_API_URL,
      rtts: [],
      rtt: 0,
      failures: 0,
      socket: !!config.ESPLORA.UNIX_SOCKET_PATH,
      preferred: true,
      checked: false,
      publicDomain: this.metadataOrigin(config.ESPLORA.UNIX_SOCKET_PATH || config.ESPLORA.REST_API_URL),
      hashes: {
        lastUpdated: 0,
      },
    };
    this.fallbackHost = this.activeHost;
    this.hosts.unshift(this.activeHost);
    this.multihost = this.hosts.length > 1;
  }

  public startHealthChecks(): void {
    // use axios interceptors to measure request rtt
    this.pollConnection.interceptors.request.use((config) => {
      config['meta'] = { startTime: Date.now() };
      return config;
    });
    this.pollConnection.interceptors.response.use((response) => {
      response.config['meta'].rtt = Date.now() - response.config['meta'].startTime;
      return response;
    });

    if (this.multihost) {
      void this.pollHosts();
    }
  }

  // start polling hosts to measure availability & rtt
  /** @asyncSafe */
  private async pollHosts(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    const start = Date.now();

    // update rtts & sync status
    for (const host of this.hosts) {
      try {
        const result = await (host.socket
          ? this.pollConnection.get<number>('http://api/blocks/tip/height', { socketPath: host.host, timeout: config.ESPLORA.FALLBACK_TIMEOUT })
          : this.pollConnection.get<number>(host.host + '/blocks/tip/height', { timeout: config.ESPLORA.FALLBACK_TIMEOUT })
        );
        if (result) {
          const height = result.data;
          host.latestHeight = height;
          this.maxHeight = Math.max(height || 0, ...this.hosts.map(h => (!(h.unreachable || h.timedOut || h.outOfSync) ? h.latestHeight || 0 : 0)));
          const rtt = result.config['meta'].rtt;
          host.rtts.unshift(rtt);
          host.rtts.slice(0, 5);
          host.rtt = host.rtts.reduce((acc, l) => acc + l, 0) / host.rtts.length;
          if (height == null || isNaN(height) || (this.maxHeight - height > this.maxSlippage)) {
            host.outOfSync = true;
          } else {
            host.outOfSync = false;
          }
          host.unreachable = false;

          // update esplora git hash using the x-powered-by header from the height check
          const poweredBy = result.headers['x-powered-by'];
          if (poweredBy) {
            const match = poweredBy.match(/([a-fA-F0-9]{5,40})/);
            if (match && match[1]?.length) {
              host.hashes.electrs = match[1];
            }
          }

          // Check front and backend git hashes less often
          if (Date.now() - host.hashes.lastUpdated > this.gitHashInterval) {
            await Promise.all([
              this.$updateFrontendGitHash(host),
              this.$updateBackendVersions(host),
              this.$updateSSRGitHash(host),
              config.MEMPOOL.OFFICIAL ? this.$updateHybridGitHash(host) : Promise.resolve(),
            ]);
            host.hashes.lastUpdated = Date.now();
          }
        } else {
          host.outOfSync = true;
          host.unreachable = true;
          host.rtts = [];
          host.rtt = Infinity;
        }
        host.timedOut = false;
      } catch (e) {
        host.outOfSync = true;
        host.unreachable = true;
        host.rtts = [];
        host.rtt = Infinity;
        if (isAxiosError(e) && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) {
          host.timedOut = true;
        } else {
          host.timedOut = false;
        }
      }
      host.checked = true;
      host.lastChecked = Date.now();

      const rankOrder = this.sortHosts();
      // switch if the current host is out of sync or significantly slower than the next best alternative
      if (this.activeHost.outOfSync || this.activeHost.unreachable || (this.activeHost !== rankOrder[0] && rankOrder[0].preferred) || (!this.activeHost.preferred && this.activeHost.rtt > (rankOrder[0].rtt * 2) + 50)) {
        if (this.activeHost.unreachable) {
          logger.warn(`🚨🚨🚨 Unable to reach ${this.activeHost.host}, failing over to next best alternative 🚨🚨🚨`);
        } else if (this.activeHost.outOfSync) {
          logger.warn(`🚨🚨🚨 ${this.activeHost.host} has fallen behind, failing over to next best alternative 🚨🚨🚨`);
        } else {
          logger.debug(`🛠️ ${this.activeHost.host} is no longer the best esplora host 🛠️`);
        }
        this.electHost();
      }
      await Common.sleep$(50);
    }

    const rankOrder = this.updateFallback();
    logger.debug(`Tomahawk ranking:\n${rankOrder.map((host, index) => this.formatRanking(index, host, this.activeHost, this.maxHeight)).join('\n')}`);

    const elapsed = Date.now() - start;

    this.pollTimer = setTimeout(() => { void this.pollHosts(); }, Math.max(1, this.pollInterval - elapsed));
  }

  private formatRanking(index: number, host: FailoverHost, active: FailoverHost, maxHeight: number): string {
    const heightStatus = !host.checked ? '⏳' : (host.outOfSync ? '🚫' : (host.latestHeight && host.latestHeight < maxHeight ? '🟧' : '✅'));
    return `${host === active ? '⭐️' : '  '} ${host.rtt < Infinity ? Math.round(host.rtt).toString().padStart(5, ' ') + 'ms' : (host.timedOut ? '  ⌛️💥 ' : '    -  ')} ${!host.checked ? '⏳' : (host.unreachable ? '🔥' : '✅')} | block: ${host.latestHeight || '??????'} ${heightStatus} | ${host.host} ${host === active ? '⭐️' : '  '}`;
  }

  private updateFallback(): FailoverHost[] {
    const rankOrder = this.sortHosts();
    if (rankOrder.length > 1 && rankOrder[0] === this.activeHost) {
      this.fallbackHost = rankOrder[1];
    } else {
      this.fallbackHost = rankOrder[0];
    }
    return rankOrder;
  }

  // sort hosts by connection quality, and update default fallback
  public sortHosts(): FailoverHost[] {
    // sort by connection quality
    return this.hosts.slice().sort((a, b) => {
      if ((a.unreachable || a.outOfSync) === (b.unreachable || b.outOfSync)) {
        if  (a.preferred === b.preferred) {
          // lower rtt is best
          return a.rtt - b.rtt;
        } else { // unless we have a preferred host
          return a.preferred ? -1 : 1;
        }
      } else { // or the host is out of sync
        return (a.unreachable || a.outOfSync) ? 1 : -1;
      }
    });
  }

  // depose the active host and choose the next best replacement
  private electHost(): void {
    this.activeHost.failures = 0;
    const rankOrder = this.sortHosts();
    this.activeHost = rankOrder[0];
    logger.warn(`Switching esplora host to ${this.activeHost.host}`);
  }

  private addFailure(host: FailoverHost): FailoverHost {
    host.failures++;
    if (host.failures > 5 && this.multihost) {
      logger.warn(`🚨🚨🚨 Too many esplora failures on ${this.activeHost.host}, falling back to next best alternative 🚨🚨🚨`);
      this.activeHost.unreachable = true;
      this.electHost();
      return this.activeHost;
    } else {
      return this.fallbackHost;
    }
  }

  // methods for retrieving git hashes by host
  private async $updateFrontendGitHash(host: FailoverHost): Promise<void> {
    try {
      const url = `${host.publicDomain}/resources/config.js`;
      const response = await this.pollConnection.get<string>(
        url, {
          timeout: config.ESPLORA.FALLBACK_TIMEOUT,
          socketPath: host.socket ? host.host : undefined
        }
      );
      const match = response.data.match(/GIT_COMMIT_HASH\s*=\s*['"](.*?)['"]/);
      if (match && match[1]?.length) {
        host.hashes.frontend = match[1];
      }
      const hybridMatch = response.data.match(/GIT_COMMIT_HASH_MEMPOOL_SPACE\s*=\s*['"](.*?)['"]/);
      if (hybridMatch && hybridMatch[1]?.length) {
        host.hashes.hybrid = hybridMatch[1];
      }
    } catch (e) {
      // failed to get frontend build hash - do nothing
    }
  }

  private async $updateHybridGitHash(host: FailoverHost): Promise<void> {
    try {
      const { data: response } = await this.pollConnection.get<string>(host.publicDomain + '/en-US/resources/config.js', {
        timeout: config.ESPLORA.FALLBACK_TIMEOUT, socketPath: host.socket ? host.host : undefined,
      });
      const match = response.match(/GIT_COMMIT_HASH_MEMPOOL_SPACE\s*=\s*['"](.*?)['"]/);
      if (match && match[1]?.length) {
        host.hashes.hybrid = match[1];
      }
    } catch (e) {
      // failed to get frontend build hash - do nothing
    }
  }

  private async $updateBackendVersions(host: FailoverHost): Promise<void> {
    try {
      const url = `${host.publicDomain}/api/v1/backend-info`;
      const response = await this.pollConnection.get<any>(
        url, {
          timeout: config.ESPLORA.FALLBACK_TIMEOUT,
          socketPath: host.socket ? host.host : undefined
        }
      );
      if (response.data?.gitCommit) {
        host.hashes.backend = response.data.gitCommit;
      }
      if (response.data?.coreVersion) {
        host.hashes.core = response.data.coreVersion;
      }
      if (response.data?.osVersion) {
        host.hashes.os = response.data.osVersion;
      }
    } catch (e) {
      // failed to get backend build hash - do nothing
    }
  }

  private async $updateSSRGitHash(host: FailoverHost): Promise<void> {
    try {
      const url = `${host.publicDomain}/ssr/api/status`;
      const response = await this.pollConnection.get<any>(
        url, {
          timeout: config.ESPLORA.FALLBACK_TIMEOUT,
          socketPath: host.socket ? host.host : undefined
        }
      );
      if (response.data?.gitHash) {
        host.hashes.ssr = response.data.gitHash;
      }
    } catch (e) {
      // failed to get ssr build hash - do nothing
    }
  }

  // Build metadata must come from the configured host too. Never derive a
  // public domain or discard a tunnel's scheme/port to guess another service.
  private metadataOrigin(endpoint: string): string {
    return endpoint.startsWith('/') ? 'http://api' : new URL(endpoint).origin;
  }

  private async $query<T>(method: 'get'| 'post', path, data: any, responseType = 'json', host = this.activeHost, retry: boolean = true): Promise<T> {
    let axiosConfig;
    let url;
    if (host.socket) {
      axiosConfig = { socketPath: host.host, timeout: config.ESPLORA.REQUEST_TIMEOUT, responseType };
      url = 'http://api' + path;
    } else {
      axiosConfig = { timeout: config.ESPLORA.REQUEST_TIMEOUT, responseType };
      url = host.host + path;
    }
    if (data?.params) {
      axiosConfig.params = data.params;
    }
    return (method === 'post'
        ? this.requestConnection.post<T>(url, data, axiosConfig)
        : this.requestConnection.get<T>(url, axiosConfig)
    ).then((response) => { host.failures = Math.max(0, host.failures - 1); return response.data; })
      .catch((e) => {
        let fallbackHost = this.fallbackHost;
        if (e?.response?.status !== 404) {
          logger.warn(`esplora request failed ${e?.response?.status} ${host.host}${path}`);
          logger.warn(e instanceof Error ? e.message : e);
          fallbackHost = this.addFailure(host);
        }
        if (retry && e?.code === 'ECONNREFUSED' && this.multihost) {
          // Retry immediately
          return this.$query(method, path, data, responseType, fallbackHost, false);
        } else {
          throw e;
        }
      });
  }

  public async $get<T>(path, responseType = 'json', params: any = null): Promise<T> {
    return this.$query<T>('get', path, params ? { params } : null, responseType);
  }

  public async $post<T>(path, data: any, responseType = 'json'): Promise<T> {
    return this.$query<T>('post', path, data, responseType);
  }
}

class ElectrsApi implements AbstractBitcoinApi {
  private failoverRouter = new FailoverRouter();

  $getRawMempool(): Promise<IEsploraApi.Transaction['txid'][]> {
    return this.failoverRouter.$get<IEsploraApi.Transaction['txid'][]>('/mempool/txids');
  }

  $getRawTransaction(txId: string): Promise<IEsploraApi.Transaction> {
    return this.failoverRouter.$get<IEsploraApi.Transaction>('/tx/' + txId);
  }

  async $getRawTransactions(txids: string[]): Promise<IEsploraApi.Transaction[]> {
    return this.failoverRouter.$post<IEsploraApi.Transaction[]>('/internal/txs', txids, 'json');
  }

  async $getMempoolTransactions(txids: string[]): Promise<IEsploraApi.Transaction[]> {
    return this.failoverRouter.$post<IEsploraApi.Transaction[]>('/internal/mempool/txs', txids, 'json');
  }

  async $getAllMempoolTransactions(lastSeenTxid?: string, max_txs?: number): Promise<IEsploraApi.Transaction[]> {
    return this.failoverRouter.$get<IEsploraApi.Transaction[]>('/internal/mempool/txs' + (lastSeenTxid ? '/' + lastSeenTxid : ''), 'json', max_txs ? { max_txs } : null);
  }

  $getTransactionHex(txId: string): Promise<string> {
    return this.failoverRouter.$get<string>('/tx/' + txId + '/hex');
  }

  $getTransactionMerkleProof(txId: string): Promise<IEsploraApi.MerkleProof> {
    return this.failoverRouter.$get<IEsploraApi.MerkleProof>('/tx/' + txId + '/merkle-proof');
  }

  $getBlockHeightTip(): Promise<number> {
    return this.failoverRouter.$get<number>('/blocks/tip/height');
  }

  $getBlockHashTip(): Promise<string> {
    return this.failoverRouter.$get<string>('/blocks/tip/hash');
  }

  /** @asyncUnsafe */
  async $getTxIdsForBlock(hash: string, fallbackToCore = false): Promise<string[]> {
    try {
      const txids = await this.failoverRouter.$get<string[]>('/block/' + hash + '/txids');
      return txids;
    } catch (e) {
      if (fallbackToCore && isAxiosError(e) && e.response?.status === 404) {
        // might be a stale block, see if Core has it?
        const coreBlock = await bitcoinCoreApi.$getBlock(hash);
        if (coreBlock?.stale) {
          return bitcoinCoreApi.$getTxIdsForBlock(hash);
        }
      }
      throw e;
    }
  }

  /** @asyncUnsafe */
  async $getTxsForBlock(hash: string, fallbackToCore = false): Promise<IEsploraApi.Transaction[]> {
    try {
      const txs = await this.failoverRouter.$get<IEsploraApi.Transaction[]>('/internal/block/' + hash + '/txs');
      return txs;
    } catch (e) {
      if (fallbackToCore && isAxiosError(e) && e.response?.status === 404) {
        // might be a stale block, see if Core has it?
        const coreBlock = await bitcoinCoreApi.$getBlock(hash);
        if (coreBlock?.stale) {
          return bitcoinCoreApi.$getTxsForBlock(hash);
        }
      }
      throw e;
    }
  }

  $getBlockHash(height: number): Promise<string> {
    return this.failoverRouter.$get<string>('/block-height/' + height);
  }

  $getBlockHeader(hash: string): Promise<string> {
    return this.failoverRouter.$get<string>('/block/' + hash + '/header');
  }

  $getBlock(hash: string): Promise<IEsploraApi.Block> {
    return this.failoverRouter.$get<IEsploraApi.Block>('/block/' + hash);
  }

  $getRawBlock(hash: string): Promise<Buffer> {
    return this.failoverRouter.$get<any>('/block/' + hash + '/raw', 'arraybuffer')
      .then((response) => { return Buffer.from(response.data); });
  }

  $getAddress(address: string): Promise<IEsploraApi.Address> {
    return this.failoverRouter.$get<IEsploraApi.Address>('/address/' + address);
  }

  $getAddressTransactions(address: string, txId?: string): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getAddressTransactions not implemented.');
  }

  $getAddressUtxos(address: string): Promise<IEsploraApi.UTXO[]> {
    return this.failoverRouter.$get<IEsploraApi.UTXO[]>('/address/' + address + '/utxo');
  }

  $getScriptHash(scripthash: string): Promise<IEsploraApi.ScriptHash> {
    throw new Error('Method getScriptHash not implemented.');
  }

  $getScriptHashTransactions(scripthash: string, txId?: string): Promise<IEsploraApi.Transaction[]> {
    throw new Error('Method getScriptHashTransactions not implemented.');
  }

  $getScriptHashUtxos(scripthash: string): Promise<IEsploraApi.UTXO[]> {
    throw new Error('Method getScriptHashUtxos not implemented.');
  }

  $getAddressPrefix(prefix: string): string[] {
    throw new Error('Method not implemented.');
  }

  $sendRawTransaction(rawTransaction: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  $testMempoolAccept(rawTransactions: string[], maxfeerate?: number): Promise<TestMempoolAcceptResult[]> {
    throw new Error('Method not implemented.');
  }

  $submitPackage(rawTransactions: string[]): Promise<SubmitPackageResult> {
    throw new Error('Method not implemented.');
  }

  $getOutspend(txId: string, vout: number): Promise<IEsploraApi.Outspend> {
    return this.failoverRouter.$get<IEsploraApi.Outspend>('/tx/' + txId + '/outspend/' + vout);
  }

  $getOutspends(txId: string): Promise<IEsploraApi.Outspend[]> {
    return this.failoverRouter.$get<IEsploraApi.Outspend[]>('/tx/' + txId + '/outspends');
  }

  async $getBatchedOutspends(txids: string[]): Promise<IEsploraApi.Outspend[][]> {
    throw new Error('Method not implemented.');
  }

  async $getBatchedOutspendsInternal(txids: string[]): Promise<IEsploraApi.Outspend[][]> {
    return this.failoverRouter.$post<IEsploraApi.Outspend[][]>('/internal/txs/outspends/by-txid', txids, 'json');
  }

  async $getOutSpendsByOutpoint(outpoints: { txid: string, vout: number }[]): Promise<IEsploraApi.Outspend[]> {
    return this.failoverRouter.$post<IEsploraApi.Outspend[]>('/internal/txs/outspends/by-outpoint', outpoints.map(out => `${out.txid}:${out.vout}`), 'json');
  }

  /** @asyncUnsafe */
  async $getCoinbaseTx(blockhash: string): Promise<IEsploraApi.Transaction> {
    const txid = await this.failoverRouter.$get<string>(`/block/${blockhash}/txid/0`);
    return this.failoverRouter.$get<IEsploraApi.Transaction>('/tx/' + txid);
  }

  async $getAddressTransactionSummary(address: string): Promise<IEsploraApi.AddressTxSummary[]> {
    return this.failoverRouter.$get<IEsploraApi.AddressTxSummary[]>('/address/' + address + '/txs/summary');
  }

  public startHealthChecks(): void {
    this.failoverRouter.startHealthChecks();
  }

  public getHealthStatus(): HealthCheckHost[] {
    if (config.MEMPOOL.OFFICIAL) {
      return this.failoverRouter.sortHosts().map(host => ({
        host: host.host,
        active: host === this.failoverRouter.activeHost,
        rtt: host.rtt,
        latestHeight: host.latestHeight || 0,
        socket: !!host.socket,
        outOfSync: !!host.outOfSync,
        unreachable: !!host.unreachable,
        checked: !!host.checked,
        lastChecked: host.lastChecked || 0,
        hashes: host.hashes,
      }));
    } else {
      return [];
    }
  }
}

export default ElectrsApi;
