import * as crypto from 'crypto';
import * as https from 'https';
import * as secp256k1 from 'tiny-secp256k1';
import { IdentityError, resolvePublicAddress, validateWebhookUrl } from '../identity/developer-identity';
import { CashuMint, FedimintFederation, EcashProviderClaim, EcashOverview } from './ecash.models';

/**
 * Ecash providers: Cashu mints this deployment is configured to observe,
 * and operator claims checked against their signatures.
 *
 * The revision this replaces listed two third-party mints with invented
 * keysets and heartbeats, two federations with invented epochs, and a
 * "verified" claim whose attestation was random bytes. Mints now come from
 * UNIVERSE_ECASH_MINTS (comma separated https URLs) and are read through
 * their own NUT-06 and NUT-02 endpoints; federations need a Fedimint client
 * this deployment does not run; a claim is verified only when its Schnorr
 * or ECDSA signature over the claim body checks out against the operator key.
 */

export const MINTS_ENV = 'UNIVERSE_ECASH_MINTS';

export class EcashUnavailableError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

export type MintFetcher = (url: URL, address: string, path: string) => Promise<{ status: number | null; json: unknown; error: string | null }>;

const defaultFetcher: MintFetcher = (url, address, path) => new Promise(resolve => {
  const request = https.request({ host: address, servername: url.hostname, port: url.port ? Number(url.port) : 443, path: `${url.pathname.replace(/\/$/, '')}${path}`, method: 'GET', headers: { host: url.host, accept: 'application/json' }, timeout: 5000 }, response => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 256 * 1024) { chunks.push(chunk); } });
    response.on('end', () => {
      try { resolve({ status: response.statusCode ?? null, json: JSON.parse(Buffer.concat(chunks).toString('utf8')), error: null }); }
      catch { resolve({ status: response.statusCode ?? null, json: null, error: 'invalid json' }); }
    });
  });
  request.on('timeout', () => { request.destroy(new Error('timeout')); });
  request.on('error', error => resolve({ status: null, json: null, error: (error as NodeJS.ErrnoException).code ?? error.message }));
  request.end();
});

/** The bytes an operator signs for a claim: type, identifier and domain, joined and hashed. */
export function claimDigest(claim: { provider_type: string; identifier: string; domain: string }): Buffer {
  return crypto.createHash('sha256').update(`ecash-provider-claim|${claim.provider_type}|${claim.identifier}|${claim.domain}`).digest();
}

export function verifyClaimSignature(claim: { provider_type: string; identifier: string; domain: string; operator_pubkey: string; attestation_signature: string }): { valid: boolean; scheme: 'schnorr' | 'ecdsa' | null; reason: string | null } {
  if (!/^(02|03)[0-9a-fA-F]{64}$/.test(claim.operator_pubkey)) { return { valid: false, scheme: null, reason: 'operator_pubkey must be a 33-byte compressed key in hex' }; }
  if (!/^[0-9a-fA-F]{128}$/.test(claim.attestation_signature)) { return { valid: false, scheme: null, reason: 'attestation_signature must be 64 bytes in hex' }; }
  const digest = claimDigest(claim);
  const key = Buffer.from(claim.operator_pubkey, 'hex');
  const sig = Buffer.from(claim.attestation_signature, 'hex');
  try { if (secp256k1.verifySchnorr(digest, key.subarray(1), sig)) { return { valid: true, scheme: 'schnorr', reason: null }; } } catch { /* try ecdsa */ }
  try { if (secp256k1.verify(digest, key, sig)) { return { valid: true, scheme: 'ecdsa', reason: null }; } } catch { /* invalid */ }
  return { valid: false, scheme: null, reason: 'attestation_signature does not verify against operator_pubkey over the claim body' };
}

export class EcashService {
  private static instance: EcashService;
  private mintCache: { at: number; mints: CashuMint[] } | null = null;
  public fetcher: MintFetcher = defaultFetcher;
  public configuredMints: () => string[] = () => (process.env[MINTS_ENV] ?? '').split(',').map(value => value.trim()).filter(Boolean);

  private constructor() {}

  public static getInstance(): EcashService {
    if (!EcashService.instance) {
      EcashService.instance = new EcashService();
    }
    return EcashService.instance;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.mintCache = null;
  }

  private static mintId(url: URL): string {
    return `mint-${crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 12)}`;
  }

  /** @asyncUnsafe Reads each configured mint's info (NUT-06) and keysets (NUT-02) with a short cache. */
  public async getMints(now = Date.now()): Promise<CashuMint[]> {
    if (this.mintCache && now - this.mintCache.at < 5 * 60_000) { return this.mintCache.mints; }
    const configured = this.configuredMints();
    if (configured.length === 0) {
      throw new EcashUnavailableError('unavailable-ecash-registry', `No Cashu mint is configured on this deployment (${MINTS_ENV}); mint identities, keysets and reachability cannot be reported.`);
    }
    const mints: CashuMint[] = [];
    for (const raw of configured) {
      let url: URL;
      try { url = validateWebhookUrl(raw); } catch (error) {
        mints.push({ mint_id: `mint-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)}`, mint_url: raw, name: null, nuts_supported: [], active_keysets_count: 0, keysets: [], last_heartbeat: null, reachable: false, error: error instanceof IdentityError ? error.message : 'invalid url' });
        continue;
      }
      let info: Awaited<ReturnType<MintFetcher>>;
      let keysets: Awaited<ReturnType<MintFetcher>>;
      try {
        const pinned = await resolvePublicAddress(url);
        [info, keysets] = await Promise.all([this.fetcher(url, pinned.address, '/v1/info'), this.fetcher(url, pinned.address, '/v1/keysets')]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        info = { status: null, json: null, error: message };
        keysets = { status: null, json: null, error: message };
      }
      const infoBody = (info.json ?? {}) as { name?: unknown; nuts?: Record<string, unknown> };
      const keysetBody = (keysets.json ?? {}) as { keysets?: { id?: unknown; unit?: unknown; active?: unknown }[] };
      const list = Array.isArray(keysetBody.keysets) ? keysetBody.keysets.filter(entry => typeof entry?.id === 'string').map(entry => ({ id: String(entry.id), unit: String(entry.unit ?? ''), active: entry.active === true })) : [];
      const reachable = info.status === 200 && info.error === null;
      mints.push({
        mint_id: EcashService.mintId(url), mint_url: url.toString(), name: reachable && typeof infoBody.name === 'string' ? infoBody.name : null,
        nuts_supported: reachable && infoBody.nuts && typeof infoBody.nuts === 'object' ? Object.keys(infoBody.nuts).map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [],
        active_keysets_count: list.filter(entry => entry.active).length, keysets: list, last_heartbeat: reachable ? new Date(now).toISOString() : null,
        reachable, error: info.error ?? (reachable ? null : `http ${info.status}`),
      });
    }
    this.mintCache = { at: now, mints };
    return mints;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getMintById(mintId: string): Promise<CashuMint | null> {
    return (await this.getMints()).find(mint => mint.mint_id === mintId) ?? null;
  }

  public getFederations(): FedimintFederation[] {
    throw new EcashUnavailableError('unavailable-fedimint-client', 'Fedimint federations require the owned Fedimint client (fedimint-cli) with an invite code per federation, which is not connected on this deployment.');
  }

  public getFederationById(_federationId: string): FedimintFederation | null {
    return this.getFederations().find(() => false) ?? null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getOverview(): Promise<EcashOverview> {
    const mints = await this.getMints();
    return {
      total_cashu_mints: mints.length, reachable_cashu_mints: mints.filter(mint => mint.reachable).length,
      total_fedimint_federations: null, total_verified_guardians: null, active_claims_count: null,
      mints, federations: [], federations_note: 'Fedimint federations need the owned Fedimint client; none is connected.', last_updated: new Date().toISOString(),
    };
  }

  /**
   * Checks a provider claim. Nothing is registered: this deployment keeps no
   * claim registry, so the answer is the verification and its reason.
   */
  public verifyClaim(claim: Partial<Omit<EcashProviderClaim, 'claim_id' | 'verified_at'>>): EcashProviderClaim & { verified: boolean; scheme: 'schnorr' | 'ecdsa' | null; reason: string | null; registered: false } {
    if (!claim.domain || !claim.operator_pubkey || !claim.identifier || !claim.provider_type || !claim.attestation_signature) {
      throw new Error('provider_type, identifier, domain, operator_pubkey and attestation_signature are required.');
    }
    if (!['cashu_mint', 'fedimint_federation'].includes(claim.provider_type)) {
      throw new Error('provider_type must be cashu_mint or fedimint_federation.');
    }
    const body = { provider_type: claim.provider_type, identifier: String(claim.identifier).slice(0, 256), domain: String(claim.domain).slice(0, 253).toLowerCase(), operator_pubkey: String(claim.operator_pubkey), attestation_signature: String(claim.attestation_signature) };
    const signature = verifyClaimSignature(body);
    return {
      claim_id: `clm-${crypto.createHash('sha256').update(`${body.provider_type}|${body.identifier}|${body.domain}|${body.operator_pubkey}`).digest('hex').slice(0, 16)}`,
      ...body, verified: signature.valid, scheme: signature.scheme, reason: signature.reason,
      verified_at: signature.valid ? new Date().toISOString() : null, registered: false,
    };
  }
}

export const ecashService = EcashService.getInstance();
