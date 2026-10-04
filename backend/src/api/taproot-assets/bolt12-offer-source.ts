import { promises as fs } from 'fs';
import { isAbsolute } from 'path';
import { createConnection } from 'net';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Bolt12DecodedOffer, decodeBolt12Offer } from './bolt12-decoder';
import { GENESIS } from '../intelligence/utxo/utxo-evidence';
import { Bolt12Offer, Bolt12OfferPage } from './taproot-assets.types';

export class Bolt12SourceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}
type Rpc = (method: string, params: any, signal: AbortSignal) => Promise<any>;
export interface OfferPublication {
  schema: 'universe-bolt12-publication-v1'; revision: string; network: string;
  genesisHash: string; signetChallenge?: string; nodeId: string; implementationVersion: string;
  updatedAt: string; publishedOfferIds: string[];
}
export interface OfferSourceDependencies {
  publication: (signal: AbortSignal) => Promise<Buffer>;
  lightning: Rpc; core: Rpc;
  decode?: (offer: string, network: string) => Promise<Bolt12DecodedOffer>;
  now?: () => number;
}
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const hex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const height = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const unavailable = () => new Bolt12SourceError('unavailable-offer-source', 'The intentionally public owned Lightning offer source could not be verified.');
const restart = () => new Bolt12SourceError('offer-source-changed', 'The public offer catalog changed. Restart pagination.', 409);
interface Anchor { height: number; hash: string; }
interface Cursor { version: 1; network: string; publication: string; snapshot: string; after: string; limit: number; expires: number; anchor: Anchor; }

/** Fixed read methods over an operator-selected, OS-authenticated local socket. */
export function unixOfferRpc(socketPath: string): Rpc {
  /** @asyncUnsafe Socket errors propagate to the bounded page operation. */
  return async (method, params, signal) => {
    if (!['getinfo', 'getchaininfo', 'getrawblockbyheight', 'listoffers'].includes(method) || signal.aborted) throw unavailable();
    let stat;
    try { stat = await fs.lstat(socketPath); } catch { throw unavailable(); }
    if (!stat.isSocket() || (stat.mode & 0o007) !== 0 || (stat.mode & 0o111) !== 0 ||
        typeof process.getuid !== 'function' || stat.uid !== process.getuid()) throw unavailable();
    return new Promise((accept, reject) => {
      const id = randomBytes(16).toString('hex');
      const socket = createConnection(socketPath);
      let bytes = Buffer.alloc(0), done = false;
      const finish = (error?: Error, result?: any) => {
        if (done) return;
        done = true; signal.removeEventListener('abort', abort); socket.destroy();
        if (error) reject(error); else accept(result);
      };
      const abort = () => finish(unavailable());
      signal.addEventListener('abort', abort, { once: true });
      socket.setTimeout(5000, abort);
      socket.on('error', abort); socket.on('end', abort);
      socket.on('connect', () => {
        if (signal.aborted) return abort();
        socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n\n');
      });
      socket.on('data', chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 8 * 1024 * 1024) return abort();
        if (!bytes.includes('\n\n')) return;
        try {
          const response = JSON.parse(bytes.toString('utf8'));
          if (response.id !== id || response.error || !Object.prototype.hasOwnProperty.call(response, 'result')) return abort();
          finish(undefined, response.result);
        } catch { abort(); }
      });
      if (signal.aborted) abort();
    });
  };
}

export function offerSourceFromEnvironment(network: string, core: Rpc): Bolt12OfferSource | null {
  const socketPath = process.env.UNIVERSE_BOLT12_RPC_SOCKET;
  const publicationPath = process.env.UNIVERSE_BOLT12_PUBLICATION_FILE;
  if (!socketPath && !publicationPath) return null;
  if (!socketPath || !publicationPath || !isAbsolute(socketPath) || !isAbsolute(publicationPath)) throw unavailable();
  return new Bolt12OfferSource(network, {
    core, lightning: unixOfferRpc(socketPath),
    /** @asyncUnsafe File errors propagate to the bounded page operation. */
    publication: async signal => {
      try {
      if (signal.aborted) throw unavailable();
      const before = await fs.lstat(publicationPath);
      if (!before.isFile() || before.isSymbolicLink() || before.size > 65536) throw unavailable();
      // O_NOFOLLOW prevents a symlink swap between lstat and open on the Linux socket deployment.
      const handle = await fs.open(publicationPath, require('fs').constants.O_RDONLY | require('fs').constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 65536 || stat.dev !== before.dev || stat.ino !== before.ino) throw unavailable();
        const buffer = Buffer.alloc(65537);
        const read = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, read.bytesRead);
        if (bytes.length > 65536 || signal.aborted) throw unavailable();
        return bytes;
      } finally { await handle.close(); }
      } catch { throw unavailable(); }
    },
  });
}

/** Public IDs are an explicit operator publication decision, never all node offers. */
export class Bolt12OfferSource {
  private readonly secret = randomBytes(32);
  private active = 0;
  private readonly now: () => number;
  constructor(private readonly network: string, private readonly io: OfferSourceDependencies) { this.now = io.now || Date.now; }

  public async page(query: Record<string, unknown> = {}): Promise<Bolt12OfferPage> {
    if (Object.keys(query).some(key => key !== 'limit' && key !== 'cursor') ||
        query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.limit)) ||
        query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 2048)) {
      throw new Bolt12SourceError('invalid-input', 'Use a limit from 1 to 50 and an opaque offer cursor.', 400);
    }
    const limit = Number(query.limit || 20);
    const cursor = query.cursor !== undefined ? this.parseCursor(query.cursor as string, limit) : null;
    if (this.active >= 2) throw new Bolt12SourceError('offer-source-busy', 'The bounded offer reader is busy.');
    this.active++;
    const controller = new AbortController();
    let timer: NodeJS.Timeout;
    const operation = this.read(limit, cursor, controller.signal);
    // Keep the slot until all injected I/O settles, even if an implementation ignores cancellation.
    operation.finally(() => { this.active--; }).catch(() => undefined);
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, 15000);
      })]);
    } catch (error) {
      if (error instanceof Bolt12SourceError) throw error;
      throw unavailable();
    } finally { clearTimeout(timer!); controller.abort(); }
  }

  private parsePublication(bytes: Buffer): OfferPublication {
    if (bytes.length > 65536) throw unavailable();
    const value = JSON.parse(bytes.toString('utf8'));
    if (value?.schema !== 'universe-bolt12-publication-v1' || value.network !== this.network || value.genesisHash !== GENESIS[this.network] ||
        typeof value.revision !== 'string' || !value.revision.length || value.revision.length > 128 ||
        !/^(02|03)[0-9a-f]{64}$/.test(value.nodeId) || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(value.implementationVersion) ||
        typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > this.now() ||
        this.network === 'signet' && (typeof value.signetChallenge !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value.signetChallenge) || value.signetChallenge.length > 20000) ||
        !Array.isArray(value.publishedOfferIds) || value.publishedOfferIds.length > 128 || !value.publishedOfferIds.every(hex) ||
        new Set(value.publishedOfferIds).size !== value.publishedOfferIds.length) throw unavailable();
    return value;
  }

  /** @asyncUnsafe Source failures propagate to page's sanitized boundary. */
  private async block(heightValue: number, signal: AbortSignal): Promise<string> {
    const [coreHash, block] = await Promise.all([
      this.io.core('getblockhash', [heightValue], signal),
      this.io.lightning('getrawblockbyheight', { height: heightValue }, signal),
    ]);
    if (!hex(coreHash) || !block || block.blockhash !== coreHash || typeof block.block !== 'string' ||
        block.block.length < 160 || block.block.length > 8000000 || !/^(?:[0-9a-f]{2})+$/.test(block.block)) throw unavailable();
    const header = Buffer.from(block.block.slice(0, 160), 'hex');
    const calculated = createHash('sha256').update(createHash('sha256').update(header).digest()).digest().reverse().toString('hex');
    if (calculated !== coreHash) throw unavailable();
    return coreHash;
  }

  /** @asyncUnsafe Source failures propagate to page's sanitized boundary. */
  private async fence(publication: OfferPublication, signal: AbortSignal, catalogAnchor?: Anchor): Promise<Anchor & { catalogAnchorHash?: string }> {
    const [core, info, chain] = await Promise.all([
      this.io.core('getblockchaininfo', [], signal), this.io.lightning('getinfo', {}, signal), this.io.lightning('getchaininfo', {}, signal),
    ]);
    const chainName = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[this.network];
    const lightningNetwork = this.network === 'mainnet' ? 'bitcoin' : this.network;
    if (signal.aborted || core?.chain !== chainName || core.initialblockdownload !== false || !height(core.blocks) || !hex(core.bestblockhash) ||
        info?.network !== lightningNetwork || info.id !== publication.nodeId || info.version !== publication.implementationVersion ||
        !height(info.blockheight) || info.warning_bitcoind_sync || info.warning_lightningd_sync ||
        chain?.chain !== chainName || chain.ibd !== false || !height(chain.blockcount) || !height(chain.headercount) ||
        chain.headercount < chain.blockcount ||
        Math.max(core.blocks, chain.blockcount, info.blockheight) - Math.min(core.blocks, chain.blockcount, info.blockheight) > 2 ||
        this.network === 'signet' && core.signet_challenge !== publication.signetChallenge) throw unavailable();
    // Native getinfo and getchaininfo advance independently. Verify the lowest
    // observed height while retaining the bounded lag and both fresh readers.
    const common = Math.min(core.blocks, chain.blockcount, info.blockheight);
    if (catalogAnchor && common < catalogAnchor.height) throw restart();
    const hashes = await Promise.all([this.block(0, signal), this.block(common, signal),
      this.network === 'signet' ? this.block(1, signal) : Promise.resolve(null),
      catalogAnchor && catalogAnchor.height !== common ? this.block(catalogAnchor.height, signal) : Promise.resolve(null)]);
    if (hashes[0] !== publication.genesisHash || signal.aborted) throw unavailable();
    return { height: common, hash: hashes[1], ...(catalogAnchor ? { catalogAnchorHash: catalogAnchor.height === common ? hashes[1] : hashes[3]! } : {}) };
  }

  /** @asyncUnsafe Source failures propagate to page's sanitized boundary. */
  private async catalog(publication: OfferPublication, signal: AbortSignal): Promise<any[]> {
    const result = await this.io.lightning('listoffers', {}, signal);
    if (!Array.isArray(result?.offers) || result.offers.length > 512) throw unavailable();
    const seen = new Set<string>();
    for (const row of result.offers) {
      if (!hex(row?.offer_id) || seen.has(row.offer_id)) throw unavailable();
      seen.add(row.offer_id);
    }
    return [...publication.publishedOfferIds].sort().map(id => {
      const row = result.offers.find(row => row.offer_id === id);
      if (!row || typeof row.bolt12 !== 'string' || Buffer.byteLength(row.bolt12) > 16384 ||
          ![row.active, row.single_use, row.used].every(value => typeof value === 'boolean')) throw unavailable();
      // Explicit projection excludes private label and all unpublished node records.
      return { offer_id: id, bolt12: row.bolt12, active: row.active, single_use: row.single_use, used: row.used };
    });
  }

  /** @asyncUnsafe Source failures propagate to page's sanitized boundary. */
  private async read(limit: number, cursor: Cursor | null, signal: AbortSignal): Promise<Bolt12OfferPage> {
    const bytes = await this.io.publication(signal);
    const publication = this.parsePublication(bytes), publicationHash = digest(bytes);
    if (cursor && cursor.publication !== publicationHash) throw restart();
    const before = await this.fence(publication, signal, cursor?.anchor);
    const anchor = cursor?.anchor || { height: before.height, hash: before.hash };
    // This fence already independently measured Core and CLN at the anchor.
    // Reuse only this page's observation, never a cached result from a prior page.
    if (cursor && before.catalogAnchorHash !== anchor.hash) throw restart();
    const rows = await this.catalog(publication, signal);
    const offers: Bolt12Offer[] = [];
    for (const row of rows) {
      if (signal.aborted) throw unavailable();
      const decoded = await (this.io.decode || ((offer, network) => decodeBolt12Offer({ offer, network }, network)))(row.bolt12, this.network);
      // CLN v26.06.8 common/bolt12.c calc_offer hashes the offer TLV ranges.
      // The native parser accepts only those ranges; LDK Offer::id uses its own
      // merkle-derived identifier. Preserve both instead of treating them as aliases.
      if (digest(Buffer.from(decoded.tlv_hex, 'hex')) !== row.offer_id || !hex(decoded.offer_id) ||
          decoded.syntax_valid !== true || decoded.network !== this.network) throw unavailable();
      offers.push({
        offerId: row.offer_id, decoderOfferId: decoded.offer_id, offerString: decoded.normalized_offer, description: decoded.description || '',
        ...(decoded.issuer === null ? {} : { issuer: decoded.issuer }),
        ...(decoded.amount?.kind === 'bitcoin' ? { amountMsat: decoded.amount.amount_msat } : {}),
        ...(decoded.amount?.kind === 'currency' ? { currency: decoded.amount.currency, currencyAmountAtomic: decoded.amount.amount_minor_units } : {}),
        blindRoutesCount: decoded.blinded_path_count, syntaxValid: true, sourceActive: row.active, sourceUsed: row.used, singleUse: row.single_use,
        networkCompatible: decoded.network_compatible, unknownRequiredFeatures: decoded.unknown_required_features,
        valid: false, validity: 'usable-unverified', expiryAtomic: decoded.absolute_expiry,
        invoiceAvailability: 'unverified', paymentVerified: false,
      });
    }
    const afterFence = await this.fence(publication, signal, anchor);
    const after = { height: afterFence.height, hash: afterFence.hash };
    if (afterFence.catalogAnchorHash !== anchor.hash ||
        digest(await this.io.publication(signal)) !== publicationHash ||
        digest(JSON.stringify(await this.catalog(publication, signal))) !== digest(JSON.stringify(rows))) throw restart();
    const observed = this.now();
    for (const offer of offers) {
      const expired = offer.expiryAtomic !== null && BigInt(Math.floor(observed / 1000)) > BigInt(offer.expiryAtomic);
      offer.validity = !offer.sourceActive ? 'source-disabled' : offer.singleUse && offer.sourceUsed ? 'already-used' :
        expired ? 'expired' : !offer.networkCompatible ? 'wrong-chain' : offer.unknownRequiredFeatures ? 'unsupported-required-features' : 'usable-unverified';
      offer.valid = offer.validity === 'usable-unverified';
    }
    const snapshot = digest(JSON.stringify(offers));
    if (signal.aborted || cursor && (cursor.snapshot !== snapshot || cursor.expires <= observed)) throw restart();
    const index = cursor ? offers.findIndex(row => row.offerId === cursor.after) : -1;
    if (cursor && index < 0) throw restart();
    const page = offers.slice(index + 1, index + 1 + limit);
    const nextCursor = index + 1 + page.length < offers.length ? this.encode({ version: 1, network: this.network,
      publication: publicationHash, snapshot, after: page[page.length - 1].offerId, limit, expires: cursor?.expires || observed + 300000, anchor }) : null;
    return { offers: page, total: offers.length, nextCursor, source: {
      implementation: 'CoreLightning', version: publication.implementationVersion, nodeId: publication.nodeId,
      network: this.network, genesisHash: publication.genesisHash, ...(this.network === 'signet' ? { signetChallenge: publication.signetChallenge } : {}),
      publicationSha256: publicationHash, observedAt: new Date(observed).toISOString(), checkpoint: after, catalogAnchor: anchor,
      scope: 'Intentionally published offers from the configured owned node; global directory completeness and invoice availability are unverified.',
    } };
  }

  private encode(cursor: Cursor): string {
    const body = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return body + '.' + createHmac('sha256', this.secret).update(body).digest('base64url');
  }
  private parseCursor(encoded: string, limit: number): Cursor {
    try {
      const parts = encoded.split('.');
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw restart();
      const mac = Buffer.from(parts[1], 'base64url'), expected = createHmac('sha256', this.secret).update(parts[0]).digest();
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw restart();
      const cursor = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      if (cursor.version !== 1 || cursor.network !== this.network || cursor.limit !== limit || !hex(cursor.publication) ||
          !hex(cursor.snapshot) || !hex(cursor.after) || !height(cursor.anchor?.height) || !hex(cursor.anchor.hash) ||
          !height(cursor.expires) || cursor.expires <= this.now()) throw restart();
      return cursor;
    } catch { throw restart(); }
  }
}
