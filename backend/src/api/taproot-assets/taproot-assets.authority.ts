import axios from 'axios';
import { readFileSync } from 'fs';
import https from 'https';
import { WorkbenchCoreReader } from '../intelligence/workbench/workbench-core';
import { TaprootProofVerdict, verifyTaprootProof } from './taproot-proof';
export { TaprootProofVerdict } from './taproot-proof';
import { LightningRfqQuote, TaprootAssetGroup, TaprootAssetItem } from './taproot-assets.types';

/**
 * The owned Taproot Assets daemon (tapd) as this deployment's asset Universe.
 *
 * Everything here is a read of tapd's documented REST surface, authenticated
 * with a macaroon the operator issued, over the daemon's own TLS certificate:
 *   GET  /v1/taproot-assets/getinfo                  daemon version and network
 *   GET  /v1/taproot-assets/assets                   assets the daemon holds proofs for
 *   GET  /v1/taproot-assets/assets/groups            assets grouped by group key
 *   POST /v1/taproot-assets/proofs/decode            read a proof file
 *   POST /v1/taproot-assets/proofs/verify            verify a proof file
 *   GET  /v1/taproot-assets/rfq/quotes/peeraccepted  quotes peers accepted, with expiry
 * Nothing is answered from anywhere else, and a daemon on another network than
 * the backend is refused rather than mixed in.
 */
export interface TapdConfig {
  origin: string;
  macaroonHex: string;
  tlsCertPath?: string;
}

export interface TapdHttp {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export class TapdError extends Error {
  constructor(public readonly code: 'unavailable-universe' | 'network-mismatch', message: string) {
    super(message);
  }
}

const TIMEOUT_MS = 10000;

export function tapdConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): TapdConfig | null {
  const origin = env.UNIVERSE_TAPD_ORIGIN?.trim();
  if (!origin) {return null;}
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('UNIVERSE_TAPD_ORIGIN is not a valid URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {throw new Error('UNIVERSE_TAPD_ORIGIN must be http(s).');}
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('UNIVERSE_TAPD_ORIGIN must be an origin without credentials, path, query or fragment.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote tapd connections require HTTPS.');
  const macaroonHex = env.UNIVERSE_TAPD_MACAROON_HEX?.trim()
    || (env.UNIVERSE_TAPD_MACAROON_PATH ? readFileSync(env.UNIVERSE_TAPD_MACAROON_PATH).toString('hex') : '');
  if ((!/^(?:[0-9a-f]{2})+$/i.test(macaroonHex) || macaroonHex.length > 131072)) {throw new Error('UNIVERSE_TAPD_MACAROON_HEX or UNIVERSE_TAPD_MACAROON_PATH must name the tapd macaroon.');}
  return { origin: url.origin, macaroonHex, tlsCertPath: env.UNIVERSE_TAPD_TLS_CERT_PATH?.trim() || undefined };
}

export function axiosTapdHttp(config: TapdConfig): TapdHttp {
  const agent = new https.Agent(config.tlsCertPath ? { ca: readFileSync(config.tlsCertPath) } : {});
  return {
    request(method, path, body) {
      return axios.request({
        method, url: config.origin + path, data: body, timeout: TIMEOUT_MS, httpsAgent: agent, maxRedirects: 0,
        validateStatus: () => true, maxContentLength: 16 * 1024 * 1024, maxBodyLength: 2 * 1024 * 1024, proxy: false,
        headers: { 'Grpc-Metadata-macaroon': config.macaroonHex, Accept: 'application/json', 'Content-Type': 'application/json' },
      }).then(response => ({ status: response.status, body: response.data }));
    },
  };
}

/** tapd's ListAssets item, the fields this reads. */
interface TapdAsset {
  asset_genesis?: { genesis_point?: string; name?: string; asset_id?: string; asset_type?: string; output_index?: number };
  amount?: string;
  script_key?: string;
  asset_group?: { tweaked_group_key?: string } | null;
  chain_anchor?: { anchor_outpoint?: string; anchor_block_hash?: string; block_height?: number; block_timestamp?: string | number };
  prev_witnesses?: unknown[];
}

export class TapdAuthority {


  constructor(
    private readonly expectedNetwork: string,
    private readonly http: TapdHttp,
    private readonly anchors: WorkbenchCoreReader,
  ) {}

  /** @asyncUnsafe The service maps a rejection to an exact HTTP answer. */
  public async listAssets(): Promise<TaprootAssetItem[]> {
    const body = await this.get('/v1/taproot-assets/assets?include_leased=true') as { assets?: TapdAsset[] };
    if (!Array.isArray(body?.assets)) {throw new TapdError('unavailable-universe', 'tapd answered ListAssets without an assets array.');}
    return body.assets.map(toItem);
  }

  /** @asyncUnsafe The service maps a rejection to an exact HTTP answer. */
  public async getAsset(assetId: string): Promise<TaprootAssetItem | null> {
    return (await this.listAssets()).find(asset => asset.assetId === assetId.toLowerCase()) ?? null;
  }

  /** @asyncUnsafe The service maps a rejection to an exact HTTP answer. */
  public async listGroups(): Promise<TaprootAssetGroup[]> {
    const body = await this.get('/v1/taproot-assets/assets/groups') as { groups?: Record<string, { assets?: { id?: string; amount?: string; tag?: string }[] }> };
    if (!body?.groups || typeof body.groups !== 'object' || Array.isArray(body.groups)) {throw new TapdError('unavailable-universe', 'tapd answered ListGroups without a groups map.');}
    return Object.entries(body.groups).map(([groupKey, group]) => {
      if (!/^(02|03)[0-9a-f]{64}$/.test(groupKey) || !Array.isArray(group?.assets)) throw new TapdError('unavailable-universe', 'tapd returned malformed group evidence.');
      const assets = group.assets;
      return {
        groupKey,
        name: assets[0]?.tag ?? '',
        totalAssetsCount: assets.length,
        totalCirculatingSupplyAtomic: assets.reduce((sum, asset) => sum + toBigInt(asset.amount), 0n).toString(),
      };
    });
  }

  /** @asyncUnsafe The service maps a rejection to an exact HTTP answer. */
  public async getRfqQuotes(): Promise<LightningRfqQuote[]> {
    interface Quote { id?: string; expiry?: string | number; asset_spec?: { id?: string; group_pub_key?: string }; ask_asset_rate?: Rate; bid_asset_rate?: Rate }
    interface Rate { coefficient?: string; scale?: number }
    const body = await this.get('/v1/taproot-assets/rfq/quotes/peeraccepted') as { buy_quotes?: Quote[]; sell_quotes?: Quote[] };
    if (!Array.isArray(body?.buy_quotes) || !Array.isArray(body?.sell_quotes)) {throw new TapdError('unavailable-universe', 'tapd answered the RFQ read without quote arrays.');}
    const rate = (value?: Rate): string | null => value?.coefficient === undefined ? null : fixedPoint(value.coefficient, value.scale ?? 0);
    const quote = (entry: Quote, side: 'buy' | 'sell'): LightningRfqQuote => {
      if (!entry || typeof entry.id !== 'string' || !entry.id || !Number.isSafeInteger(Number(entry.expiry)) || Number(entry.expiry) < 0 ||
          !/^[0-9a-f]{64}$/.test(entry.asset_spec?.id ?? '') && !/^(02|03)[0-9a-f]{64}$/.test(entry.asset_spec?.group_pub_key ?? '')) {
        throw new TapdError('unavailable-universe', 'tapd returned incomplete RFQ identity or expiry evidence.');
      }
      return ({
      quoteId: String(entry.id ?? ''),
      baseAsset: entry.asset_spec?.id || entry.asset_spec?.group_pub_key || '',
      quoteAsset: 'BTC',
      askRate: side === 'buy' ? rate(entry.ask_asset_rate) : null,
      bidRate: side === 'sell' ? rate(entry.bid_asset_rate) : null,
      spreadBps: null,
      validUntil: Number(entry.expiry),
      });
    };
    return [...body.buy_quotes.map(entry => quote(entry, 'buy')), ...body.sell_quotes.map(entry => quote(entry, 'sell'))];
  }

  /**
   * Decode the proof to learn what it claims, have tapd verify the file, then
   * confirm the anchor block the proof names is the block the owned reader has
   * at that height. `valid` is true only when all three agree. @asyncUnsafe */
  public async verifyProof(assetId: string, proofBase64: string): Promise<TaprootProofVerdict> {
    return verifyTaprootProof(this.expectedNetwork, this.http, this.anchors, assetId, proofBase64);
  }

  /** Refresh the daemon network for every listing operation. @asyncUnsafe */
  private async requireNetwork(): Promise<void> {
    const body = await this.get('/v1/taproot-assets/getinfo', true) as { network?: string };
    const network = body?.network === 'testnet3' ? 'testnet' : body?.network;
    if (network !== this.expectedNetwork) throw new TapdError('network-mismatch', 'tapd network differs from the configured backend network.');
  }

  /** @asyncUnsafe */
  private async get(path: string, skipNetworkCheck = false): Promise<unknown> {
    if (!skipNetworkCheck) {await this.requireNetwork();}
    let response: { status: number; body: unknown };
    try {
      response = await this.http.request('GET', path);
    } catch (error) {
      throw new TapdError('unavailable-universe', `tapd did not answer ${path}.`);
    }
    if (response.status !== 200) {throw new TapdError('unavailable-universe', `tapd answered HTTP ${response.status} to ${path}.`);}
    return response.body;
  }


}

function toItem(asset: TapdAsset): TaprootAssetItem {
  if (!asset || !/^[0-9a-f]{64}$/.test(asset.asset_genesis?.asset_id ?? '') ||
      !['NORMAL', 'COLLECTIBLE'].includes(asset.asset_genesis?.asset_type ?? '') ||
      !/^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/.test(asset.asset_genesis?.genesis_point ?? '') ||
      !/^(02|03)[0-9a-f]{64}$/.test(asset.script_key ?? '') ||
      typeof asset.asset_genesis?.name !== 'string') throw new TapdError('unavailable-universe', 'tapd returned malformed asset evidence.');
  const genesis = asset.asset_genesis ?? {};
  const anchor = asset.chain_anchor ?? {};
  const outpoint = anchor.anchor_outpoint ?? '';
  const isGenesisOutput = !asset.prev_witnesses?.length;
  return {
    assetId: (genesis.asset_id ?? '').toLowerCase(),
    assetType: genesis.asset_type === 'COLLECTIBLE' ? 'collectible' : 'normal',
    name: genesis.name ?? '',
    groupKey: asset.asset_group?.tweaked_group_key || undefined,
    genesisPoint: genesis.genesis_point ?? '',
    // Only a genesis output's anchor is the genesis block; a transferred asset's anchor is its latest transfer.
    genesisHeight: isGenesisOutput && Number.isInteger(anchor.block_height) ? anchor.block_height as number : null,
    totalAmountAtomic: toBigInt(asset.amount).toString(),
    anchorTxid: outpoint.split(':')[0],
    anchorOutpoint: outpoint,
    scriptKey: asset.script_key ?? '',
    // ListAssets does not prove that this particular proof file is available or valid.
    hasProofFile: null,
    mintTime: Number(anchor.block_timestamp ?? 0),
  };
}

function toBigInt(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw new TapdError('unavailable-universe', 'tapd returned an invalid uint64 asset amount.');
  return BigInt(value);
}

/** A tapd fixed-point rate as a decimal string, exact. */
function fixedPoint(coefficient: string, scale: number): string {
  if (typeof coefficient !== 'string' || coefficient.length > 256 || !Number.isInteger(scale) || scale < 0 || scale > 256) throw new TapdError('unavailable-universe', 'tapd returned an invalid bounded fixed-point rate.');
  const digits = coefficient.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(digits)) throw new TapdError('unavailable-universe', 'tapd returned an invalid rate coefficient.');
  if (scale === 0) {return digits;}
  const padded = digits.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}
