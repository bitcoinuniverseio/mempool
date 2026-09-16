import * as crypto from 'crypto';
import * as dns from 'dns';
import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import config from '../../../config';
import logger from '../../../logger';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { ApiKeyRow, OutboxRow, OwnerStore, ownerStore, WebhookAttemptRow, WebhookRow } from './owner-store';

/**
 * Developer identity: API keys are the product's owner identity, and webhooks
 * are the owner's delivery targets.
 *
 * The revision this replaces kept everything in process memory, seeded a
 * wildcard master key whose secret was a source constant, hashed with a
 * hard-coded pepper, returned webhook signing secrets on every list, and
 * reported every webhook delivery as a 200 without opening a socket.
 *
 * Now: keys are stored as a peppered hash with the pepper held outside the
 * source; the owner of every resource is the owner of the authenticated key;
 * a wildcard scope cannot be minted through the API; webhook secrets are
 * encrypted at rest and shown once; a delivery is a real HTTPS request whose
 * outcome is recorded, retried from a leased outbox, and never invented.
 */

export const KEY_PREFIX = 'uip_live_';
export const HASH_VERSION = 1;

/** Scopes an API key can hold. '*' exists only for the legacy operator key. */
export const API_SCOPES = ['read', 'watchlists', 'webhooks', 'queries', 'cases', 'knowledge', 'keys:manage', 'node:rpc'] as const;
export type ApiScope = typeof API_SCOPES[number];

/**
 * Scopes a first (bootstrap) key receives; keys:manage lets it mint narrower
 * keys later. node:rpc is included because the RPC route is bounded by its
 * own read-only allowlist and per-method budget; the key adds accountability.
 */
export const BOOTSTRAP_SCOPES: ApiScope[] = ['read', 'watchlists', 'webhooks', 'queries', 'cases', 'knowledge', 'node:rpc', 'keys:manage'];

export const LIMITS = {
  keysPerOwner: 20,
  webhooksPerOwner: 20,
  nameLength: 128,
  urlLength: 2048,
  eventFilters: 32,
  deliveryTimeoutMs: 10_000,
  responseBytes: 64 * 1024,
  maxAttempts: 8,
  payloadBytes: 256 * 1024,
} as const;

export class IdentityError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export interface DeveloperApiKey {
  key_id: string;
  key_prefix: string;
  owner_id: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export interface GeneratedKeyResult extends DeveloperApiKey {
  /** Shown exactly once, at creation. */
  secret_key: string;
}

export interface WebhookView {
  webhook_id: string;
  owner_id: string;
  url: string;
  event_filters: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegisteredWebhook extends WebhookView {
  /** Shown exactly once, at creation, for signature verification on the receiver. */
  signing_secret: string;
}

export interface AuthenticatedOwner {
  owner_id: string;
  key_id: string;
  scopes: string[];
}

/** One HTTP request to a validated public address, with the real outcome. */
export interface DeliveryOutcome {
  status_code: number | null;
  success: boolean;
  response_digest: string | null;
  error_code: string | null;
}

export type DeliveryTransport = (input: {
  url: URL;
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<DeliveryOutcome>;

/** True for loopback, private, link-local, CGNAT, multicast, reserved and IPv4-mapped equivalents. */
const blockedDestinations = new net.BlockList();
// Nonpublic and special-purpose destinations are not webhook/probe targets.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blockedDestinations.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['100:0:0:1::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blockedDestinations.addSubnet(address, prefix, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (!kind || address.includes('%')) return true;
  // Node's binary subnet matcher also handles expanded IPv6, the whole
  // link-local /10 and IPv4-mapped IPv6 (including hexadecimal notation).
  return blockedDestinations.check(address, kind === 4 ? 'ipv4' : 'ipv6');
}

export function validateWebhookUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.urlLength) {
    throw new IdentityError('invalid_url', 'target_url must be a string of at most 2048 characters', 400);
  }
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new IdentityError('invalid_url', 'target_url is not a valid URL', 400); }
  if (parsed.protocol !== 'https:') {
    throw new IdentityError('invalid_url', 'target_url must use https', 400);
  }
  if (parsed.username || parsed.password) {
    throw new IdentityError('invalid_url', 'target_url must not carry credentials', 400);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host) !== 0 && isPrivateAddress(host)) {
    throw new IdentityError('invalid_url', 'target_url resolves to a private, loopback or link-local destination', 400);
  }
  return parsed;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]>;

/** @asyncUnsafe resolvePublicAddress turns a rejection into an IdentityError. */
const defaultResolver: Resolver = async hostname => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map(result => ({ address: result.address, family: result.family as 4 | 6 }));
};
let activeDestinationResolutions = 0;

/** Resolves the host and refuses if any answer is private; returns the pinned public address. */
export async function resolvePublicAddress(url: URL, resolver: Resolver = defaultResolver): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) !== 0) {
    if (isPrivateAddress(host)) { throw new IdentityError('blocked_destination', 'destination address is not public', 400); }
    return { address: host, family: net.isIP(host) as 4 | 6 };
  }
  let answers: { address: string; family: 4 | 6 }[];
  if (activeDestinationResolutions >= 32) throw new IdentityError('resolution_busy', 'Destination resolution capacity is exhausted', 503);
  activeDestinationResolutions++;
  let timer: NodeJS.Timeout | undefined;
  // Keep the capacity occupied until the underlying resolver settles, even if
  // the caller times out. Otherwise slow DNS can accumulate unbounded jobs.
  const lookup = Promise.resolve().then(() => resolver(host)).finally(() => { activeDestinationResolutions--; });
  try {
    answers = await Promise.race([lookup, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 4000);
      timer.unref();
    })]);
  } catch { throw new IdentityError('unresolvable', 'Destination did not resolve within the time limit', 400); }
  finally { if (timer) clearTimeout(timer); }
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 512) { throw new IdentityError('unresolvable', 'Destination returned no usable address set', 400); }
  for (const answer of answers) {
    if (isPrivateAddress(answer.address) || net.isIP(answer.address) !== answer.family) {
      throw new IdentityError('blocked_destination', `${host} resolves to a private address`, 400);
    }
  }
  return answers[0];
}

/**
 * The real transport: one HTTPS POST to the pinned address, presenting the
 * hostname for TLS and verifying the certificate against it. An extra CA
 * can be supplied through UNIVERSE_INTELLIGENCE_WEBHOOK_CA (PEM file) for
 * receivers behind a private authority; the default is the system store.
 */
export function extraCertificateAuthority(): Buffer | undefined {
  const file = process.env.UNIVERSE_INTELLIGENCE_WEBHOOK_CA;
  if (!file) { return undefined; }
  try { return fs.readFileSync(file); } catch { return undefined; }
}

export const httpsTransport: DeliveryTransport = ({ url, address, family, headers, body, timeoutMs, maxResponseBytes }) => new Promise(resolve => {
  let settled = false;
  const finish = (outcome: DeliveryOutcome): void => { if (!settled) { settled = true; resolve(outcome); } };
  const ca = extraCertificateAuthority();
  const request = https.request({
    host: address,
    family,
    port: url.port ? Number(url.port) : 443,
    servername: url.hostname,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: { ...headers, host: url.host },
    timeout: timeoutMs,
    ca: ca ? [...tls.rootCertificates, ca.toString()] : undefined,
    // Connecting to the pinned address while verifying the certificate for the hostname.
    checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity(url.hostname, cert),
  }, response => {
    const hash = crypto.createHash('sha256');
    let received = 0;
    response.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxResponseBytes) { response.destroy(); finish({ status_code: response.statusCode ?? null, success: false, response_digest: null, error_code: 'response_too_large' }); return; }
      hash.update(chunk);
    });
    response.on('end', () => {
      const status = response.statusCode ?? null;
      // A redirect is not a delivery: the target must accept the request itself.
      finish({ status_code: status, success: status !== null && status >= 200 && status < 300, response_digest: hash.digest('hex'), error_code: status !== null && status >= 200 && status < 300 ? null : (status !== null && status >= 300 && status < 400 ? 'redirect' : 'http_error') });
    });
    response.on('error', () => finish({ status_code: response.statusCode ?? null, success: false, response_digest: null, error_code: 'response_error' }));
  });
  request.on('timeout', () => { request.destroy(new Error('timeout')); });
  request.on('error', error => finish({ status_code: null, success: false, response_digest: null, error_code: (error as NodeJS.ErrnoException).code === undefined ? (error.message === 'timeout' ? 'timeout' : 'connection_error') : String((error as NodeJS.ErrnoException).code).toLowerCase() }));
  request.end(body);
});

export class DeveloperIdentityService {
  private static instance: DeveloperIdentityService;
  private pepper: string | null = null;
  private encryptionKey: Buffer | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;
  private outboxRunning = false;
  private bootstrapWindow = new Map<string, number[]>();

  public transport: DeliveryTransport = httpsTransport;
  public resolver: Resolver = defaultResolver;

  private constructor() {}

  public static getInstance(): DeveloperIdentityService {
    if (!DeveloperIdentityService.instance) {
      DeveloperIdentityService.instance = new DeveloperIdentityService();
    }
    return DeveloperIdentityService.instance;
  }

  private get store(): OwnerStore {
    return ownerStore();
  }

  private get network(): string {
    return config.MEMPOOL.NETWORK;
  }

  /** Test seam: forget cached secrets so a swapped store is used fresh. */
  public resetForTests(): void {
    this.pepper = null;
    this.encryptionKey = null;
    this.bootstrapWindow.clear();
  }

  /**
   * The pepper comes from UNIVERSE_INTELLIGENCE_KEY_PEPPER when set, and is
   * otherwise generated once and kept in the database, so it is never a
   * source constant and keys survive restarts.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  private async getPepper(): Promise<string> {
    if (this.pepper) { return this.pepper; }
    const fromEnv = process.env.UNIVERSE_INTELLIGENCE_KEY_PEPPER;
    if (fromEnv && fromEnv.length >= 32) {
      this.pepper = fromEnv;
      return this.pepper;
    }
    this.pepper = await this.store.setSettingIfAbsent('identity_pepper_v1', crypto.randomBytes(32).toString('hex'));
    return this.pepper;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) { return this.encryptionKey; }
    const fromEnv = process.env.UNIVERSE_INTELLIGENCE_SECRET_KEY;
    if (fromEnv && /^[0-9a-f]{64}$/i.test(fromEnv)) {
      this.encryptionKey = Buffer.from(fromEnv, 'hex');
      return this.encryptionKey;
    }
    // Derived from the stored pepper: distinct from the key hash domain.
    this.encryptionKey = crypto.createHash('sha256').update(`webhook-secret:${await this.getPepper()}`).digest();
    return this.encryptionKey;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async hashSecret(secret: string): Promise<string> {
    return crypto.createHmac('sha256', await this.getPepper()).update(secret).digest('hex');
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async encrypt(plain: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async decrypt(ciphertext: string): Promise<string> {
    const [iv, tag, data] = ciphertext.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', await this.getEncryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
  }

  private view(row: ApiKeyRow): DeveloperApiKey {
    return {
      key_id: row.key_id, key_prefix: row.key_prefix, owner_id: row.owner_id, name: row.name, scopes: row.scopes, rate_limit: row.rate_limit,
      expires_at: row.expires_at, created_at: row.created_at, last_used_at: row.last_used_at, revoked: row.revoked_at !== null,
    };
  }

  public static validateScopes(requested: unknown, allowed: readonly string[]): ApiScope[] {
    if (!Array.isArray(requested) || requested.length === 0 || requested.length > API_SCOPES.length) {
      throw new IdentityError('invalid_scopes', 'scopes must be a non-empty array of known scopes', 400);
    }
    const scopes = new Set<ApiScope>();
    for (const scope of requested) {
      if (typeof scope !== 'string' || !(API_SCOPES as readonly string[]).includes(scope)) {
        throw new IdentityError('invalid_scopes', `unknown scope: ${String(scope).slice(0, 32)}`, 400);
      }
      if (!allowed.includes('*') && !allowed.includes(scope)) {
        throw new IdentityError('scope_escalation', `the caller does not hold scope ${scope}`, 403);
      }
      scopes.add(scope as ApiScope);
    }
    return [...scopes];
  }

  private static validateName(name: unknown): string {
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > LIMITS.nameLength) {
      throw new IdentityError('invalid_name', `name must be 1 to ${LIMITS.nameLength} characters`, 400);
    }
    return name.trim();
  }

  /**
   * A first key for a new owner. The owner ID is generated here, never taken
   * from the caller, and the scopes are the fixed bootstrap set. Bounded per
   * caller address so the route cannot be used to fill the table.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  public async bootstrapOwner(name: unknown, callerAddress: string, now = Date.now()): Promise<GeneratedKeyResult> {
    const recent = (this.bootstrapWindow.get(callerAddress) ?? []).filter(at => now - at < 3_600_000);
    if (recent.length >= 10) {
      throw new IdentityError('rate_limited', 'too many new owners from this address; try again later', 429);
    }
    recent.push(now);
    this.bootstrapWindow.set(callerAddress, recent);
    return this.createKey(crypto.randomUUID(), DeveloperIdentityService.validateName(name), BOOTSTRAP_SCOPES, 1000, undefined, now);
  }

  /** @asyncUnsafe A further key for an authenticated owner, limited to a subset of the caller's scopes. */
  public async generateApiKey(owner: AuthenticatedOwner, name: unknown, scopes: unknown, rateLimit = 1000, expiresInDays?: number, now = Date.now()): Promise<GeneratedKeyResult> {
    if (!owner.scopes.includes('*') && !owner.scopes.includes('keys:manage')) {
      throw new IdentityError('forbidden', 'keys:manage scope is required to create keys', 403);
    }
    const validScopes = DeveloperIdentityService.validateScopes(scopes, owner.scopes);
    if ((await this.store.countApiKeys(owner.owner_id, this.network)) >= LIMITS.keysPerOwner) {
      throw new IdentityError('quota', `an owner may hold at most ${LIMITS.keysPerOwner} active keys`, 409);
    }
    return this.createKey(owner.owner_id, DeveloperIdentityService.validateName(name), validScopes, rateLimit, expiresInDays, now);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async createKey(ownerId: string, name: string, scopes: string[], rateLimit: number, expiresInDays: number | undefined, now: number): Promise<GeneratedKeyResult> {
    const secretKey = `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
    const row: ApiKeyRow = {
      key_id: EventEnvelopeValidator.generateUuidV7(),
      owner_id: ownerId,
      network: this.network,
      key_prefix: KEY_PREFIX,
      key_hash: await this.hashSecret(secretKey),
      hash_version: HASH_VERSION,
      name,
      scopes,
      rate_limit: Math.max(1, Math.min(100_000, Math.floor(rateLimit) || 1000)),
      expires_at: expiresInDays && expiresInDays > 0 ? new Date(now + expiresInDays * 86_400_000).toISOString() : null,
      created_at: new Date(now).toISOString(),
      last_used_at: null,
      revoked_at: null,
    };
    await this.store.insertApiKey(row);
    return { ...this.view(row), secret_key: secretKey };
  }

  /**
   * Resolves a raw secret to its owner, or null. The legacy operator key
   * (UNIVERSE_INTELLIGENCE_LEGACY_MASTER_KEY) is honoured only when an operator
   * sets it explicitly; nothing is seeded from the source.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  public async authenticateKey(rawSecret: unknown, requiredScope?: string, now = Date.now()): Promise<AuthenticatedOwner | null> {
    if (typeof rawSecret !== 'string' || !rawSecret.startsWith(KEY_PREFIX) || rawSecret.length > 128) {
      return null;
    }
    const legacy = process.env.UNIVERSE_INTELLIGENCE_LEGACY_MASTER_KEY;
    if (legacy && legacy.length >= 32 && crypto.timingSafeEqual(Buffer.from(rawSecret.padEnd(legacy.length)), Buffer.from(legacy.padEnd(rawSecret.length)))) {
      return { owner_id: 'owner-operator', key_id: 'key-operator-env', scopes: ['*'] };
    }
    const row = await this.store.findApiKeyByHash(await this.hashSecret(rawSecret));
    if (!row || row.revoked_at !== null) { return null; }
    if (row.expires_at && Date.parse(row.expires_at) < now) { return null; }
    if (requiredScope && !row.scopes.includes('*') && !row.scopes.includes(requiredScope)) { return null; }
    this.store.touchApiKey(row.key_id, new Date(now).toISOString()).catch(() => undefined);
    return { owner_id: row.owner_id, key_id: row.key_id, scopes: row.scopes };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listKeys(owner: AuthenticatedOwner): Promise<DeveloperApiKey[]> {
    return (await this.store.listApiKeys(owner.owner_id, this.network)).map(row => this.view(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async revokeApiKey(owner: AuthenticatedOwner, keyId: string, now = Date.now()): Promise<boolean> {
    if (!owner.scopes.includes('*') && !owner.scopes.includes('keys:manage')) {
      throw new IdentityError('forbidden', 'keys:manage scope is required to revoke keys', 403);
    }
    return this.store.revokeApiKey(owner.owner_id, this.network, keyId, new Date(now).toISOString());
  }

  private webhookView(row: WebhookRow): WebhookView {
    return { webhook_id: row.webhook_id, owner_id: row.owner_id, url: row.url, event_filters: row.event_filters, active: row.active, created_at: row.created_at, updated_at: row.updated_at };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async registerWebhook(owner: AuthenticatedOwner, targetUrl: unknown, eventFilters: unknown, now = Date.now()): Promise<RegisteredWebhook> {
    if (!owner.scopes.includes('*') && !owner.scopes.includes('webhooks')) {
      throw new IdentityError('forbidden', 'webhooks scope is required', 403);
    }
    const url = validateWebhookUrl(String(targetUrl ?? ''));
    await resolvePublicAddress(url, this.resolver);
    if (!Array.isArray(eventFilters) || eventFilters.length === 0 || eventFilters.length > LIMITS.eventFilters || eventFilters.some(f => typeof f !== 'string' || f.length === 0 || f.length > 64)) {
      throw new IdentityError('invalid_filters', 'events must be 1 to 32 short strings', 400);
    }
    if ((await this.store.countWebhooks(owner.owner_id, this.network)) >= LIMITS.webhooksPerOwner) {
      throw new IdentityError('quota', `an owner may register at most ${LIMITS.webhooksPerOwner} webhooks`, 409);
    }
    const secret = crypto.randomBytes(32).toString('hex');
    const at = new Date(now).toISOString();
    const row: WebhookRow = {
      webhook_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: this.network, url: url.toString(),
      secret_ciphertext: await this.encrypt(secret), key_version: 1, event_filters: eventFilters as string[], active: true, created_at: at, updated_at: at,
    };
    await this.store.insertWebhook(row);
    return { ...this.webhookView(row), signing_secret: secret };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listWebhooks(owner: AuthenticatedOwner): Promise<WebhookView[]> {
    return (await this.store.listWebhooks(owner.owner_id, this.network)).map(row => this.webhookView(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWebhook(owner: AuthenticatedOwner, webhookId: string): Promise<WebhookView | null> {
    const row = await this.store.getWebhook(owner.owner_id, this.network, webhookId);
    return row ? this.webhookView(row) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listAttempts(owner: AuthenticatedOwner, webhookId: string, limit = 50): Promise<WebhookAttemptRow[] | null> {
    const row = await this.store.getWebhook(owner.owner_id, this.network, webhookId);
    if (!row) { return null; }
    return this.store.listAttempts(webhookId, Math.max(1, Math.min(200, limit)));
  }

  public signWebhookPayload(payload: string, secret: string, timestamp: number): string {
    return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  }

  /** @asyncUnsafe Queues a notification for a webhook. Delivery happens in processOutbox. */
  public async enqueueDelivery(notificationId: string, webhookId: string, now = Date.now()): Promise<'inserted' | 'duplicate'> {
    const at = new Date(now).toISOString();
    const row: OutboxRow = {
      outbox_id: EventEnvelopeValidator.generateUuidV7(), notification_id: notificationId, webhook_id: webhookId, network: this.network,
      state: 'pending', attempt_count: 0, next_attempt_at: at, lease_until: null, last_error: null, created_at: at, updated_at: at,
    };
    return this.store.insertOutbox(row);
  }

  /**
   * Performs one delivery attempt: re-resolves and pins the destination,
   * signs the exact body, sends it, records the real outcome. Never claims
   * success without a 2xx from the receiver.
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  public async deliver(outbox: OutboxRow, now = Date.now()): Promise<WebhookAttemptRow> {
    const webhook = await this.store.getWebhookById(this.network, outbox.webhook_id);
    const notification = await this.store.getNotificationById(this.network, outbox.notification_id);
    const started = new Date(now).toISOString();
    const attemptNumber = outbox.attempt_count + 1;
    const base = { attempt_id: EventEnvelopeValidator.generateUuidV7(), outbox_id: outbox.outbox_id, webhook_id: outbox.webhook_id, event_id: notification?.event_id ?? 'unknown', attempt_number: attemptNumber, started_at: started };
    let outcome: DeliveryOutcome;
    if (!webhook || !webhook.active || !notification) {
      outcome = { status_code: null, success: false, response_digest: null, error_code: !webhook ? 'webhook_missing' : (!webhook.active ? 'webhook_inactive' : 'notification_missing') };
    } else {
      try {
        const url = validateWebhookUrl(webhook.url);
        const pinned = await resolvePublicAddress(url, this.resolver);
        const body = JSON.stringify({
          event_id: notification.event_id, notification_id: notification.notification_id, watchlist_id: notification.watchlist_id, rule_id: notification.rule_id,
          network: notification.network, title: notification.title, message: notification.message, severity: notification.severity,
          entity_type: notification.entity_type, blinded_hash: notification.blinded_hash, block_height: notification.block_height, block_hash: notification.block_hash,
          created_at: notification.created_at, attempt: attemptNumber,
        });
        if (Buffer.byteLength(body) > LIMITS.payloadBytes) { throw new IdentityError('payload_too_large', 'payload too large', 500); }
        const secret = await this.decrypt(webhook.secret_ciphertext);
        const timestamp = now;
        const headers = {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          'user-agent': 'universe-explorer-webhooks/1',
          'x-universe-event-id': notification.event_id,
          'x-universe-timestamp': String(timestamp),
          'x-universe-signature': `v1=${this.signWebhookPayload(body, secret, timestamp)}`,
        };
        outcome = await this.transport({ url, address: pinned.address, family: pinned.family, headers, body, timeoutMs: LIMITS.deliveryTimeoutMs, maxResponseBytes: LIMITS.responseBytes });
      } catch (error) {
        outcome = { status_code: null, success: false, response_digest: null, error_code: error instanceof IdentityError ? error.code : 'delivery_error' };
      }
    }
    const attempt: WebhookAttemptRow = { ...base, finished_at: new Date().toISOString(), ...outcome };
    await this.store.insertAttempt(attempt);
    const permanent = outcome.error_code === 'webhook_missing' || outcome.error_code === 'webhook_inactive' || outcome.error_code === 'notification_missing' || outcome.error_code === 'blocked_destination' || outcome.error_code === 'invalid_url';
    if (outcome.success) {
      await this.store.completeOutbox(outbox.outbox_id, 'delivered', attemptNumber, new Date(now).toISOString(), null, new Date().toISOString());
    } else if (permanent || attemptNumber >= LIMITS.maxAttempts) {
      await this.store.completeOutbox(outbox.outbox_id, 'failed', attemptNumber, new Date(now).toISOString(), outcome.error_code, new Date().toISOString());
    } else {
      // Capped exponential backoff with jitter: 30 s, 60 s, 120 s ... up to an hour.
      const delay = Math.min(3_600_000, 30_000 * 2 ** (attemptNumber - 1)) * (0.8 + Math.random() * 0.4);
      await this.store.completeOutbox(outbox.outbox_id, 'pending', attemptNumber, new Date(now + delay).toISOString(), outcome.error_code, new Date().toISOString());
    }
    return attempt;
  }

  /** @asyncUnsafe Claims due outbox rows under a lease and delivers them. Returns the attempts made. */
  public async processOutbox(limit = 20, now = Date.now()): Promise<WebhookAttemptRow[]> {
    if (this.outboxRunning) { return []; }
    this.outboxRunning = true;
    try {
      const claimed = await this.store.claimOutbox(this.network, new Date(now).toISOString(), new Date(now + LIMITS.deliveryTimeoutMs * 3).toISOString(), limit);
      const attempts: WebhookAttemptRow[] = [];
      for (const row of claimed) {
        attempts.push(await this.deliver(row, Date.now()));
      }
      return attempts;
    } finally {
      this.outboxRunning = false;
    }
  }

  public startOutboxWorker(intervalMs = 15_000): void {
    if (this.outboxTimer) { return; }
    this.outboxTimer = setInterval(() => {
      this.processOutbox().catch(error => logger.warn(`webhook outbox: ${error instanceof Error ? error.message : error}`));
    }, intervalMs);
    this.outboxTimer.unref?.();
  }

  public stopOutboxWorker(): void {
    if (this.outboxTimer) { clearInterval(this.outboxTimer); this.outboxTimer = null; }
  }
}

export const developerIdentity = DeveloperIdentityService.getInstance();
export const DeveloperIdentityManager = developerIdentity;
