import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import logger from '../../logger';

const {
  ADMIN_SERVICE_HEADERS,
  ADMIN_SERVICE_NONCE_TTL_SECONDS,
  ADMIN_CONTROL_SUPPORTED_VERSIONS,
  adminServiceSigningString,
  isAdminServiceTimestampFresh,
  isAdminContractVersionSupported,
} = adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

/**
 * The Explorer adapter is protected the same way Core's is, using the same
 * signing string from the shared contract, so the two cannot drift into
 * different opinions about what a valid request looks like.
 *
 * Two independent things must hold: the connection arrives over a private
 * path, and the request carries a valid signature. A listening port proves
 * nothing on its own.
 */

const KEY_ENVIRONMENT_VARIABLE = 'EXPLORER_ADMIN_ADAPTER_KEYS';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface AdminAdapterKey {
  keyId: string;
  secret: Buffer;
}

export function parseAdminAdapterKeys(raw: string | undefined): AdminAdapterKey[] {
  const keys: AdminAdapterKey[] = [];
  for (const entry of String(raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const keyId = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
      continue;
    }
    const secret = Buffer.from(trimmed.slice(separator + 1).trim(), 'base64');
    // Anything shorter than 32 bytes is not a key, it is a typo.
    if (secret.length < 32) {
      continue;
    }
    keys.push({ keyId, secret });
  }
  return keys;
}

/** RFC 1918, RFC 4193 and link-local ranges, plus loopback. */
export function isPrivateRemoteAddress(address: string): boolean {
  const value = String(address || '').trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (LOOPBACK.has(value)) {
    return true;
  }
  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value;
  const parts = ipv4.split('.');
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map((part) => Number(part));
    if (a === 10) { return true; }
    if (a === 172 && b >= 16 && b <= 31) { return true; }
    if (a === 192 && b === 168) { return true; }
    if (a === 169 && b === 254) { return true; }
    return false;
  }
  return /^f[cd][0-9a-f]{2}:/.test(value) || value.startsWith('fe80:');
}

/** How long a claimed nonce has to stay claimed: the whole freshness window. */
export const ADMIN_NONCE_RETENTION_MS = ADMIN_SERVICE_NONCE_TTL_SECONDS * 1000;

/**
 * The answer of a replay store. `unavailable` is the fail-closed answer: the
 * request is refused because nobody can say whether the nonce was seen.
 */
export type AdminReplayClaim = 'claimed' | 'replayed' | 'unavailable';

/**
 * A shared, atomic claim on a nonce. Every worker that verifies admin requests
 * must consult the same store, otherwise a signed request replays cleanly
 * against the next process.
 */
export interface AdminReplayStore {
  readonly kind: string;
  claim(scope: string, nonce: string, nowMs: number): Promise<AdminReplayClaim>;
}

/**
 * Remembers nonces in this process for exactly as long as a timestamp can
 * stay fresh. Unexpired nonces are never evicted: a store that forgot a live
 * nonce to make room would reopen the replay it exists to close, so when the
 * bound is reached new nonces are refused instead.
 *
 * Single-process only. Production selects a shared store; this one is for
 * unit tests and for an explicit single-process opt-in.
 */
export class AdminAdapterNonceStore implements AdminReplayStore {
  readonly kind = 'memory';
  private seen = new Map<string, number>();

  constructor(private maxEntries = 20_000) {}

  /** Synchronous acceptance for the pure verifier. Nonces are keyed by scope. */
  accept(nonce: string, nowMs: number, scope = ''): boolean {
    this.evict(nowMs);
    const key = `${scope}\n${nonce}`;
    if (this.seen.has(key)) {
      return false;
    }
    if (this.seen.size >= this.maxEntries) {
      return false;
    }
    this.seen.set(key, nowMs);
    return true;
  }

  claim(scope: string, nonce: string, nowMs: number): Promise<AdminReplayClaim> {
    return Promise.resolve(this.accept(nonce, nowMs, scope) ? 'claimed' : 'replayed');
  }

  /** Only expired entries are removed, never a live one. */
  private evict(nowMs: number): void {
    const horizon = nowMs - ADMIN_NONCE_RETENTION_MS;
    for (const [key, at] of this.seen) {
      if (at >= horizon) {
        break;
      }
      this.seen.delete(key);
    }
  }
}

/** The fail-closed store: every claim is unavailable, with the reason logged once. */
export class UnavailableAdminReplayStore implements AdminReplayStore {
  readonly kind = 'unavailable';
  private logged = false;

  constructor(private reason: string) {}

  claim(): Promise<AdminReplayClaim> {
    if (!this.logged) {
      this.logged = true;
      logger.err(`[admin-adapter] Admin requests are refused: ${this.reason}`);
    }
    return Promise.resolve('unavailable');
  }
}

/** The key/version pair a nonce is claimed under, so keys cannot collide. */
export function adminNonceScope(keyId: string, contractVersion: string): string {
  return `${keyId}@${contractVersion}`;
}

function header(request: Request, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return typeof value === 'string' ? value : '';
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export type AdminAdapterVerdict =
  | { ok: true; authorization: { keyId: string; elevated: boolean } }
  | { ok: false; status: number; code: string; message: string; reason: string };

/** A verified signature whose nonce has not been claimed yet. */
export type AdminAdapterSignatureVerdict =
  | { ok: true; authorization: { keyId: string; elevated: boolean }; nonce: string; scope: string }
  | { ok: false; status: number; code: string; message: string; reason: string };

export interface AdminAdapterRequestInput {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  remoteAddress: string;
  keys?: AdminAdapterKey[];
  nowMs?: number;
}

/**
 * The whole verification, expressed as a pure-ish function so it can be tested
 * without an HTTP server. `rawBody` is the exact bytes received, because
 * re-serialising a parsed object would change whitespace and key order and
 * break every signature.
 *
 * This variant claims the nonce in the given single-process store and exists
 * for unit tests and the isolated harness. The guard uses
 * `verifyAdminAdapterRequestWithStore` against the shared store.
 */
export function verifyAdminAdapterRequest(input: AdminAdapterRequestInput & {
  nonceStore: AdminAdapterNonceStore;
}): AdminAdapterVerdict {
  const verdict = checkAdminAdapterSignature(input);
  if (!verdict.ok) {
    return verdict;
  }
  if (!input.nonceStore.accept(verdict.nonce, input.nowMs ?? Date.now(), verdict.scope)) {
    return unauthorized('A signed service request replayed a nonce.');
  }
  return { ok: true, authorization: verdict.authorization };
}

/**
 * The verification the guard runs: every signature check, then one atomic
 * claim in the shared replay store. An unavailable store refuses the request
 * with its own code so the operator can tell it apart from a bad signature.
 *
 * @asyncUnsafe The guard catches a rejection and refuses the request.
 */
export async function verifyAdminAdapterRequestWithStore(
  input: AdminAdapterRequestInput,
  store: AdminReplayStore,
): Promise<AdminAdapterVerdict> {
  const verdict = checkAdminAdapterSignature(input);
  if (!verdict.ok) {
    return verdict;
  }
  const claim = await store.claim(verdict.scope, verdict.nonce, input.nowMs ?? Date.now());
  if (claim === 'replayed') {
    return unauthorized('A signed service request replayed a nonce.');
  }
  if (claim !== 'claimed') {
    return {
      ok: false,
      status: 503,
      code: 'REPLAY_STORE_UNAVAILABLE',
      message: 'The Explorer admin adapter cannot verify request freshness right now.',
      reason: `A signed service request was refused because the ${store.kind} replay store is unavailable.`,
    };
  }
  return { ok: true, authorization: verdict.authorization };
}

function unauthorized(reason: string): { ok: false; status: number; code: string; message: string; reason: string } {
  return {
    ok: false,
    status: 401,
    code: 'UNAUTHORIZED',
    // One message for every rejection so a caller cannot tell which check
    // failed. The operator still gets the reason in the log.
    message: 'Admin adapter request verification failed.',
    reason,
  };
}

/** Every check except the nonce claim. */
export function checkAdminAdapterSignature(input: AdminAdapterRequestInput): AdminAdapterSignatureVerdict {
  const rejected = unauthorized;

  if (!isPrivateRemoteAddress(input.remoteAddress)) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'Not found.',
      reason: `An admin adapter request arrived from a public address (${input.remoteAddress}).`,
    };
  }

  const keys = input.keys ?? parseAdminAdapterKeys(process.env[KEY_ENVIRONMENT_VARIABLE]);
  if (keys.length === 0) {
    return {
      ok: false,
      status: 503,
      code: 'ADAPTER_NOT_CONFIGURED',
      message: 'The Explorer admin adapter has no service keys configured.',
      reason: 'An admin adapter request arrived while no service key was configured.',
    };
  }

  const read = (name: string): string => {
    const value = input.headers[name];
    if (Array.isArray(value)) {
      return value[0] ?? '';
    }
    return typeof value === 'string' ? value : '';
  };

  const contractVersion = read(ADMIN_SERVICE_HEADERS.contractVersion);
  if (!isAdminContractVersionSupported(contractVersion)) {
    return {
      ok: false,
      status: 403,
      code: 'UNSUPPORTED_CONTRACT_VERSION',
      message: `Contract version ${contractVersion || 'missing'} is not supported. This adapter speaks ${ADMIN_CONTROL_SUPPORTED_VERSIONS.join(', ')}.`,
      reason: `An admin adapter request declared contract version ${contractVersion || 'nothing'}.`,
    };
  }

  const keyId = read(ADMIN_SERVICE_HEADERS.keyId);
  const timestamp = read(ADMIN_SERVICE_HEADERS.timestamp);
  const nonce = read(ADMIN_SERVICE_HEADERS.nonce);
  const bodyDigest = read(ADMIN_SERVICE_HEADERS.bodyDigest);
  const signature = read(ADMIN_SERVICE_HEADERS.signature);

  if (!keyId || !timestamp || !nonce || !bodyDigest || !signature) {
    return rejected('A signed service request was missing a required header.');
  }
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(nonce)) {
    return rejected('A signed service request carried a malformed nonce.');
  }
  if (!isAdminServiceTimestampFresh(timestamp, input.nowMs ?? Date.now())) {
    return rejected('A signed service request carried a stale or future timestamp.');
  }

  const key = keys.find((candidate) => candidate.keyId === keyId);
  if (!key) {
    return rejected('A signed service request named an unknown key.');
  }

  const expectedDigest = createHash('sha256').update(input.rawBody).digest('hex');
  if (!equal(expectedDigest, bodyDigest)) {
    return rejected('A signed service request body did not match its digest.');
  }

  const [path, query = ''] = input.originalUrl.split('?');
  const expected = createHmac('sha256', key.secret)
    .update(
      adminServiceSigningString({
        method: input.method,
        path,
        query,
        keyId,
        timestamp,
        nonce,
        bodyDigest,
      }),
    )
    .digest('hex');
  if (!equal(expected, signature)) {
    return rejected('A signed service request signature did not verify.');
  }

  // This declaration is covered by the existing signed body digest. An
  // unsigned forwarding header cannot upgrade a request's authority.
  let elevated = false;
  if (input.rawBody.length > 0) {
    try {
      const body = JSON.parse(input.rawBody.toString('utf8'));
      elevated = body?.adminAuthorization?.elevated === true;
    } catch {
      return rejected('A signed admin request did not contain valid JSON.');
    }
  }
  return { ok: true, authorization: { keyId, elevated }, nonce, scope: adminNonceScope(keyId, contractVersion) };
}

/** Mount before any general body parser so signatures retain the exact bytes. */
export function adminAdapterJsonParser(): RequestHandler {
  return express.json({
    limit: '256kb',
    strict: true,
    verify: (request, _response, buffer) => {
      (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  });
}

/** The control plane owns reauthentication; this gate requires its signed claim. */
export function hasSignedAdminElevation(response: Pick<Response, 'locals'>): boolean {
  return response.locals.adminAdapterAuthorization?.elevated === true;
}

/** Admin responses are never cached, indexed, or framed. */
export function adminAdapterResponseHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  // The public API sets a wildcard CORS origin. These routes must never be
  // reachable from a browser, so the wildcard is removed here.
  response.removeHeader('Access-Control-Allow-Origin');
  response.removeHeader('Access-Control-Allow-Methods');
  response.removeHeader('Access-Control-Allow-Headers');
}

/**
 * The guard. The replay store is injected so the choice of store is made once,
 * at mount time, and logged; without one every request fails closed.
 */
export function adminAdapterGuard(
  store: AdminReplayStore = new UnavailableAdminReplayStore('no replay store was provided to the admin guard'),
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    adminAdapterResponseHeaders(response);
    const refuse = (verdict: { status: number; code: string; message: string; reason: string }): void => {
      logger.warn(`[admin-adapter] ${verdict.reason}`);
      response.status(verdict.status).json({ code: verdict.code, message: verdict.message });
    };
    verifyAdminAdapterRequestWithStore({
      method: request.method,
      originalUrl: request.originalUrl,
      headers: request.headers as Record<string, string | string[] | undefined>,
      rawBody: (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      remoteAddress: request.socket.remoteAddress ?? '',
    }, store)
      .then((verdict) => {
        if (verdict.ok) {
          response.locals.adminAdapterAuthorization = verdict.authorization;
          next();
          return;
        }
        refuse(verdict);
      })
      .catch((e) => {
        refuse({
          status: 503,
          code: 'REPLAY_STORE_UNAVAILABLE',
          message: 'The Explorer admin adapter cannot verify request freshness right now.',
          reason: 'The replay store threw while claiming a nonce: ' + (e instanceof Error ? e.message : String(e)),
        });
      });
  };
}
