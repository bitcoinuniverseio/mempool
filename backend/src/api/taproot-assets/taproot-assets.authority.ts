import axios from 'axios';
import { readFileSync } from 'fs';
import https from 'https';
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
  try { url = new URL(origin); } catch { throw new Error(`UNIVERSE_TAPD_ORIGIN is not a URL: ${origin}`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {throw new Error('UNIVERSE_TAPD_ORIGIN must be http(s).');}
  const macaroonHex = env.UNIVERSE_TAPD_MACAROON_HEX?.trim()
    || (env.UNIVERSE_TAPD_MACAROON_PATH ? readFileSync(env.UNIVERSE_TAPD_MACAROON_PATH).toString('hex') : '');
  if (!/^[0-9a-f]+$/i.test(macaroonHex)) {throw new Error('UNIVERSE_TAPD_MACAROON_HEX or UNIVERSE_TAPD_MACAROON_PATH must name the tapd macaroon.');}
  return { origin: url.origin, macaroonHex, tlsCertPath: env.UNIVERSE_TAPD_TLS_CERT_PATH?.trim() || undefined };
}

export function axiosTapdHttp(config: TapdConfig): TapdHttp {
  const agent = new https.Agent(config.tlsCertPath ? { ca: readFileSync(config.tlsCertPath) } : {});
  return {
    request(method, path, body) {
      return axios.request({
        method, url: config.origin + path, data: body, timeout: TIMEOUT_MS, httpsAgent: agent, maxRedirects: 0,
        validateStatus: () => true, maxContentLength: 16 * 1024 * 1024,
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

interface TapdDecodedProof {
  decoded_proof?: { number_of_proofs?: number; asset?: TapdAsset };
}

export type TaprootProofVerdict =
  | { valid: true; stage: 'verified'; asset_id: string; genesis_point: string; proofs_in_file: number; anchor: { txid: string; outpoint: string; block_height: number; block_hash: string } }
  | { valid: false; stage: 'invalid-input' | 'unavailable-verifier' | 'invalid-proof' | 'asset-mismatch' | 'anchor-mismatch'; error: string };

export interface TaprootAnchorReader {
  $getBlockHash(height: number): Promise<string>;
}

export class TapdAuthority {
  private info: { network: string; version: string } | null = null;

  constructor(
    private readonly expectedNetwork: string,
    private readonly http: TapdHttp,
    private readonly anchors: TaprootAnchorReader,
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
    if (!body?.groups || typeof body.groups !== 'object') {throw new TapdError('unavailable-universe', 'tapd answered ListGroups without a groups map.');}
    return Object.entries(body.groups).map(([groupKey, group]) => {
      const assets = group?.assets ?? [];
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
    const quote = (entry: Quote, side: 'buy' | 'sell'): LightningRfqQuote => ({
      quoteId: String(entry.id ?? ''),
      baseAsset: entry.asset_spec?.id || entry.asset_spec?.group_pub_key || '',
      quoteAsset: 'BTC',
      askRate: side === 'buy' ? rate(entry.ask_asset_rate) : null,
      bidRate: side === 'sell' ? rate(entry.bid_asset_rate) : null,
      spreadBps: null,
      validUntil: Number(entry.expiry),
    });
    return [...body.buy_quotes.map(entry => quote(entry, 'buy')), ...body.sell_quotes.map(entry => quote(entry, 'sell'))];
  }

  /**
   * Decode the proof to learn what it claims, have tapd verify the file, then
   * confirm the anchor block the proof names is the block the owned reader has
   * at that height. `valid` is true only when all three agree. @asyncUnsafe */
  public async verifyProof(assetId: string, proofBase64: string): Promise<TaprootProofVerdict> {
    const decoded = await this.post('/v1/taproot-assets/proofs/decode', { raw_proof: proofBase64, proof_at_depth: 0 }, [400, 500]);
    if (decoded.status !== 200) {return { valid: false, stage: 'invalid-proof', error: `tapd could not decode the proof: ${describeBody(decoded.body)}` };}
    const asset = (decoded.body as TapdDecodedProof)?.decoded_proof?.asset;
    const genesisPoint = asset?.asset_genesis?.genesis_point;
    const claimedId = asset?.asset_genesis?.asset_id?.toLowerCase();
    if (!genesisPoint || !claimedId) {return { valid: false, stage: 'invalid-proof', error: 'The decoded proof names no asset genesis.' };}
    if (claimedId !== assetId.toLowerCase()) {return { valid: false, stage: 'asset-mismatch', error: `The proof is for asset ${claimedId}, not ${assetId.toLowerCase()}.` };}
    const verified = await this.post('/v1/taproot-assets/proofs/verify', { raw_proof_file: proofBase64, genesis_point: genesisPoint }, [400, 500]);
    if (verified.status !== 200) {return { valid: false, stage: 'invalid-proof', error: `tapd rejected the proof file: ${describeBody(verified.body)}` };}
    const verdict = verified.body as { valid?: boolean; decoded_proof?: TapdDecodedProof['decoded_proof'] };
    if (verdict.valid !== true) {return { valid: false, stage: 'invalid-proof', error: 'tapd verified the proof file and found it invalid.' };}
    const anchor = verdict.decoded_proof?.asset?.chain_anchor ?? asset.chain_anchor;
    const height = anchor?.block_height;
    const blockHash = anchor?.anchor_block_hash?.toLowerCase();
    const outpoint = anchor?.anchor_outpoint;
    if (!Number.isInteger(height) || !blockHash || !outpoint) {return { valid: false, stage: 'invalid-proof', error: 'The verified proof names no confirmed chain anchor.' };}
    let ownedHash: string;
    try {
      ownedHash = String(await this.anchors.$getBlockHash(height as number)).toLowerCase();
    } catch (error) {
      return { valid: false, stage: 'unavailable-verifier', error: `The owned Bitcoin reader could not provide block ${height}: ${describe(error)}` };
    }
    if (ownedHash !== blockHash) {return { valid: false, stage: 'anchor-mismatch', error: `The proof anchors in block ${blockHash} at height ${height}; the owned ${this.expectedNetwork} chain has ${ownedHash} there.` };}
    return {
      valid: true, stage: 'verified', asset_id: claimedId, genesis_point: genesisPoint,
      proofs_in_file: verdict.decoded_proof?.number_of_proofs ?? (decoded.body as TapdDecodedProof).decoded_proof?.number_of_proofs ?? 1,
      anchor: { txid: outpoint.split(':')[0], outpoint, block_height: height as number, block_hash: blockHash },
    };
  }

  /** The daemon must be on the backend's network; checked once and remembered. @asyncUnsafe */
  private async requireNetwork(): Promise<void> {
    if (this.info) {return;}
    const body = await this.get('/v1/taproot-assets/getinfo', true) as { network?: string; version?: string };
    const network = typeof body?.network === 'string' ? body.network : '';
    if (network !== this.expectedNetwork) {
      throw new TapdError('network-mismatch', `tapd reports network "${network}" while this backend serves ${this.expectedNetwork}.`);
    }
    this.info = { network, version: String(body.version ?? '') };
  }

  /** @asyncUnsafe */
  private async get(path: string, skipNetworkCheck = false): Promise<unknown> {
    if (!skipNetworkCheck) {await this.requireNetwork();}
    let response: { status: number; body: unknown };
    try {
      response = await this.http.request('GET', path);
    } catch (error) {
      throw new TapdError('unavailable-universe', `tapd did not answer ${path}: ${describe(error)}`);
    }
    if (response.status !== 200) {throw new TapdError('unavailable-universe', `tapd answered HTTP ${response.status} to ${path}: ${describeBody(response.body)}`);}
    return response.body;
  }

  /** @asyncUnsafe */
  private async post(path: string, body: unknown, tolerated: number[]): Promise<{ status: number; body: unknown }> {
    await this.requireNetwork();
    let response: { status: number; body: unknown };
    try {
      response = await this.http.request('POST', path, body);
    } catch (error) {
      throw new TapdError('unavailable-universe', `tapd did not answer ${path}: ${describe(error)}`);
    }
    if (response.status !== 200 && !tolerated.includes(response.status)) {throw new TapdError('unavailable-universe', `tapd answered HTTP ${response.status} to ${path}: ${describeBody(response.body)}`);}
    return response;
  }
}

function toItem(asset: TapdAsset): TaprootAssetItem {
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
    hasProofFile: true,
    mintTime: Number(anchor.block_timestamp ?? 0),
  };
}

function toBigInt(value: unknown): bigint {
  try { return typeof value === 'string' || typeof value === 'number' ? BigInt(value) : 0n; } catch { return 0n; }
}

/** A tapd fixed-point rate as a decimal string, exact. */
function fixedPoint(coefficient: string, scale: number): string {
  const digits = coefficient.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(digits) || !Number.isInteger(scale) || scale < 0) {return coefficient;}
  if (scale === 0) {return digits;}
  const padded = digits.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeBody(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {return (body as { message: string }).message;}
  return typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200) ?? '';
}
