import { promises as fs, constants } from 'fs';
import { isAbsolute } from 'path';
import { request } from 'http';
import { createHash } from 'crypto';

export class ArkNativeSourceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

export interface ArkNativeProfile {
  schema: 'universe-ark-native-profile-v1';
  dialect: 'arkade'; version: 'v0.9.16'; sourceRevision: string;
  providerId: string; providerName: string; signerPubkey: string; forfeitPubkey: string;
  network: 'signet'; genesisHash: string; signetChallenge: string; blockOneHash: string;
  publicationIntent: 'owned-public-indexer';
}
export interface ArkNativeAnchor { height: number; hash: string; }
export interface ArkNativeObservation {
  schema: 'universe-ark-native-observation-v1'; profile: ArkNativeProfile; profileSha256: string;
  anchor: ArkNativeAnchor; observedAt: string; info: ArkNativeInfo;
}
export interface ArkNativeInfo {
  version: 'v0.9.16'; network: 'signet'; signerPubkey: string; forfeitPubkey: string;
  sessionDurationSeconds: string;
  scheduledSession: unknown | null;
  unilateralExitDelay: { unit: 'seconds' | 'blocks'; value: string };
  boardingExitDelay: { unit: 'seconds' | 'blocks'; value: string };
  providerDigest: string;
}
type CoreRead = (method: string, params: unknown[], signal: AbortSignal) => Promise<any>;
export type ArkNativeRead = (path: string, admin: boolean, signal: AbortSignal) => Promise<any>;
const HASH = /^[0-9a-f]{64}$/;
const PUBKEY = /^(?:02|03)[0-9a-f]{64}$/;
const DIGITS = /^(?:0|[1-9][0-9]{0,19})$/;
const failure = () => new ArkNativeSourceError('unavailable-ark-native-source', 'The selected native Ark provider and Bitcoin checkpoint could not be verified.');
const changed = () => new ArkNativeSourceError('ark-native-source-changed', 'The native Ark provider or Bitcoin checkpoint changed.', 409);
const active = (signal: AbortSignal) => { if (signal.aborted) throw failure(); };

export function validateArkNativeProfile(raw: any): ArkNativeProfile {
  if (!raw || raw.schema !== 'universe-ark-native-profile-v1' || raw.dialect !== 'arkade' || raw.version !== 'v0.9.16'
    || raw.sourceRevision !== 'e2d9ed443df7a0dfb3aa1e5c824de9541ff71047' || raw.network !== 'signet'
    || raw.publicationIntent !== 'owned-public-indexer' || !PUBKEY.test(raw.signerPubkey) || !PUBKEY.test(raw.forfeitPubkey)
    || !HASH.test(raw.genesisHash) || !HASH.test(raw.blockOneHash) || !/^(?:[0-9a-f]{2}){1,10000}$/.test(raw.signetChallenge)
    || typeof raw.providerId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.providerId)
    || typeof raw.providerName !== 'string' || raw.providerName.length < 1 || raw.providerName.length > 128) throw failure();
  return { schema: raw.schema, dialect: raw.dialect, version: raw.version, sourceRevision: raw.sourceRevision,
    providerId: raw.providerId, providerName: raw.providerName, signerPubkey: raw.signerPubkey, forfeitPubkey: raw.forfeitPubkey,
    network: raw.network, genesisHash: raw.genesisHash, signetChallenge: raw.signetChallenge,
    blockOneHash: raw.blockOneHash, publicationIntent: raw.publicationIntent };
}

export function arkNativeSourceFromEnvironment(network: string, core: CoreRead): ArkNativeSource | null {
  const profileFile = process.env.UNIVERSE_ARK_NATIVE_PROFILE_FILE;
  const publicSocket = process.env.UNIVERSE_ARK_NATIVE_PUBLIC_SOCKET;
  const adminSocket = process.env.UNIVERSE_ARK_NATIVE_ADMIN_SOCKET;
  const macaroon = process.env.UNIVERSE_ARK_NATIVE_READONLY_MACAROON_FILE;
  if (!profileFile && !publicSocket && !adminSocket && !macaroon) return null;
  if (network !== 'signet' || !profileFile || !publicSocket || Boolean(adminSocket) !== Boolean(macaroon) || !isAbsolute(profileFile)) throw failure();
  try {
    const stat = require('fs').lstatSync(profileFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw failure();
    const profile = validateArkNativeProfile(JSON.parse(require('fs').readFileSync(profileFile, 'utf8')));
    return new ArkNativeSource(profile, core, unixArkNativeRead(publicSocket, adminSocket, macaroon));
  } catch { throw failure(); }
}

/** Bounded local read transport. No wallet, signer, write, subscription or arbitrary URL surface. */
export function unixArkNativeRead(publicSocket: string, adminSocket?: string, readonlyMacaroonFile?: string): ArkNativeRead {
  return async function readNative(path, admin, signal) {
    try {
    active(signal);
    if (!allowedArkReadPath(path, admin)) throw new ArkNativeSourceError('invalid-ark-read', 'Unsupported native Ark read.', 400);
    const socketPath = admin ? adminSocket : publicSocket;
    if (!socketPath || !isAbsolute(socketPath) || typeof process.getuid !== 'function') throw failure();
    const stat = await fs.lstat(socketPath);
    if (!stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) throw failure();
    const headers: Record<string, string> = { Accept: 'application/json', Connection: 'close' };
    if (admin) {
      if (!readonlyMacaroonFile || !isAbsolute(readonlyMacaroonFile)) throw failure();
      const before = await fs.lstat(readonlyMacaroonFile);
      if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || (before.mode & 0o077) !== 0 || before.size > 4096) throw failure();
      const handle = await fs.open(readonlyMacaroonFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > 4096) throw failure();
        const bytes = Buffer.alloc(4097); const read = await handle.read(bytes, 0, bytes.length, 0);
        if (!read.bytesRead || read.bytesRead > 4096) throw failure();
        headers['X-Macaroon'] = bytes.subarray(0, read.bytesRead).toString('hex');
      } finally { await handle.close(); }
    }
    active(signal);
    return new Promise((accept, reject) => {
      let done = false;
      const finish = (error?: Error, value?: unknown) => {
        if (done) return;
        done = true; signal.removeEventListener('abort', abort); req.destroy();
        if (error) reject(error); else accept(value);
      };
      const abort = () => finish(failure());
      const req = request({ socketPath, path, method: 'GET', headers, agent: false }, response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('error', abort); response.on('aborted', abort);
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) return abort();
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (signal.aborted || response.statusCode !== 200 || !response.complete) return abort();
          try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { abort(); }
        });
      });
      req.on('error', abort); req.setTimeout(5000, abort);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else req.end();
    });
    } catch (error) {
      if (error instanceof ArkNativeSourceError) throw error;
      throw failure();
    }
  };
}

export function allowedArkReadPath(path: string, admin: boolean): boolean {
  if (admin) {
    if (/^\/v1\/admin\/round\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path)) return true;
    if (!/^\/v1\/admin\/(?:rounds\?after=(?:0|[1-9][0-9]{0,11})&before=[1-9][0-9]{0,11}&limit=(?:[1-9]|[1-9][0-9]|100)&withCompleted=true|offchainTxs\?after=(?:0|[1-9][0-9]{0,11})&before=[1-9][0-9]{0,11}&limit=(?:[1-9]|[1-9][0-9]|100))$/.test(path)) return false;
    const query = new URLSearchParams(path.split('?')[1]);
    return BigInt(query.get('after')!) < BigInt(query.get('before')!);
  }
  return path === '/v1/info' || /^\/v1\/indexer\/commitmentTx\/[0-9a-f]{64}$/.test(path)
    || /^\/v1\/indexer\/virtualTx\/[0-9a-f]{64}(?:,[0-9a-f]{64}){0,31}$/.test(path)
    || /^\/v1\/indexer\/vtxos\?outpoints=[0-9a-f]{64}:[0-9]{1,10}&page\.size=(?:[1-9]|[1-9][0-9]|100)&page\.index=[0-9]{1,4}$/.test(path)
    || /^\/v1\/indexer\/batch\/[0-9a-f]{64}\/[0-9]{1,10}\/tree(?:\/leaves)?\?page\.size=(?:[1-9]|[1-9][0-9]|100)&page\.index=[0-9]{1,4}$/.test(path);
}

/** Native provider identity never substitutes for an independent Bitcoin source identity. */
export class ArkNativeSource {
  readonly profile: ArkNativeProfile;
  private active = 0;
  constructor(profile: ArkNativeProfile, private readonly core: CoreRead, private readonly read: ArkNativeRead) {
    this.profile = Object.freeze(validateArkNativeProfile(profile));
  }
  /** @asyncUnsafe All source errors are surfaced; partial reads never become observations. */
  async observe(path = '/v1/info', admin = false): Promise<{ observation: ArkNativeObservation; payload: any }> {
    if (!allowedArkReadPath(path, admin)) throw new ArkNativeSourceError('invalid-ark-read', 'Unsupported native Ark read.', 400);
    if (this.active >= 2) throw new ArkNativeSourceError('ark-native-source-busy', 'The bounded native Ark reader is busy.');
    this.active++;
    const controller = new AbortController();
    const operation = this.observeBounded(path, admin, controller.signal);
    operation.finally(() => { this.active--; }).catch(() => undefined);
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(failure()); }, 15000);
      })]);
    } finally { clearTimeout(timer!); controller.abort(); }
  }
  /** @asyncUnsafe Independent Bitcoin errors propagate to the observation. */
  private async anchor(signal: AbortSignal): Promise<ArkNativeAnchor> {
    const chain = await this.core('getblockchaininfo', [], signal); active(signal);
    if (chain?.chain !== 'signet' || chain.signet_challenge !== this.profile.signetChallenge || chain.initialblockdownload !== false
      || !Number.isSafeInteger(chain.blocks) || chain.blocks < 1 || !HASH.test(chain.bestblockhash)) throw failure();
    const [genesis, one, current] = await Promise.all([this.core('getblockhash', [0], signal), this.core('getblockhash', [1], signal), this.core('getblockhash', [chain.blocks], signal)]);
    active(signal);
    if (genesis !== this.profile.genesisHash || one !== this.profile.blockOneHash || current !== chain.bestblockhash) throw failure();
    return { height: chain.blocks, hash: current };
  }
  private decodeInfo(raw: any): ArkNativeInfo {
    if (!raw || raw.version !== this.profile.version || raw.network !== this.profile.network || raw.signerPubkey !== this.profile.signerPubkey
      || raw.forfeitPubkey !== this.profile.forfeitPubkey || typeof raw.sessionDuration !== 'string' || !DIGITS.test(raw.sessionDuration)
      || typeof raw.unilateralExitDelay !== 'string' || !DIGITS.test(raw.unilateralExitDelay)
      || typeof raw.boardingExitDelay !== 'string' || !DIGITS.test(raw.boardingExitDelay) || !HASH.test(raw.digest)) throw failure();
    return { version: raw.version, network: raw.network, signerPubkey: raw.signerPubkey, forfeitPubkey: raw.forfeitPubkey,
      sessionDurationSeconds: raw.sessionDuration, scheduledSession: raw.scheduledSession ?? null,
      unilateralExitDelay: this.locktime(raw.unilateralExitDelay),
      boardingExitDelay: this.locktime(raw.boardingExitDelay), providerDigest: raw.digest };
  }
  /** Pinned native ParseRelativeLocktime: below 512 is blocks, otherwise rounded seconds. */
  private locktime(value: string): { unit: 'seconds' | 'blocks'; value: string } {
    const amount = BigInt(value);
    if (amount > 4294967295n || amount >= 512n && amount % 512n !== 0n) throw failure();
    return { unit: amount < 512n ? 'blocks' : 'seconds', value };
  }
  /** @asyncUnsafe A failed native read invalidates the entire observation. */
  private async observeBounded(path: string, admin: boolean, signal: AbortSignal): Promise<{ observation: ArkNativeObservation; payload: any }> {
    const anchor = await this.anchor(signal);
    const before = this.decodeInfo(await this.read('/v1/info', false, signal)); active(signal);
    const payload = path === '/v1/info' ? before : await this.read(path, admin, signal); active(signal);
    const after = this.decodeInfo(await this.read('/v1/info', false, signal));
    const latest = await this.anchor(signal);
    const original = await this.core('getblockhash', [anchor.height], signal); active(signal);
    if (original !== anchor.hash || latest.height < anchor.height || JSON.stringify(before) !== JSON.stringify(after)) throw changed();
    return { observation: { schema: 'universe-ark-native-observation-v1', profile: this.profile,
      profileSha256: createHash('sha256').update(JSON.stringify(this.profile)).digest('hex'), anchor,
      observedAt: new Date().toISOString(), info: before }, payload };
  }
}
