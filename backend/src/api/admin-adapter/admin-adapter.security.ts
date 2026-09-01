import { NextFunction, Request, Response } from 'express';
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

/**
 * Remembers nonces for exactly as long as a timestamp can stay fresh, so a
 * replay inside the window is refused and memory stays bounded.
 */
export class AdminAdapterNonceStore {
  private seen = new Map<string, number>();

  constructor(private maxEntries = 20_000) {}

  accept(nonce: string, nowMs: number): boolean {
    this.evict(nowMs);
    if (this.seen.has(nonce)) {
      return false;
    }
    this.seen.set(nonce, nowMs);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) {
        this.seen.delete(oldest.value);
      }
    }
    return true;
  }

  private evict(nowMs: number): void {
    const horizon = nowMs - ADMIN_SERVICE_NONCE_TTL_SECONDS * 1000;
    for (const [nonce, at] of this.seen) {
      if (at >= horizon) {
        break;
      }
      this.seen.delete(nonce);
    }
  }
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
  | { ok: true }
  | { ok: false; status: number; code: string; message: string; reason: string };

const nonces = new AdminAdapterNonceStore();

/**
 * The whole verification, expressed as a pure-ish function so it can be tested
 * without an HTTP server. `rawBody` is the exact bytes received, because
 * re-serialising a parsed object would change whitespace and key order and
 * break every signature.
 */
export function verifyAdminAdapterRequest(input: {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  remoteAddress: string;
  keys?: AdminAdapterKey[];
  nowMs?: number;
  nonceStore?: AdminAdapterNonceStore;
}): AdminAdapterVerdict {
  const rejected = (reason: string): AdminAdapterVerdict => ({
    ok: false,
    status: 401,
    code: 'UNAUTHORIZED',
    // One message for every rejection so a caller cannot tell which check
    // failed. The operator still gets the reason in the log.
    message: 'Admin adapter request verification failed.',
    reason,
  });

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

  const store = input.nonceStore ?? nonces;
  if (!store.accept(nonce, input.nowMs ?? Date.now())) {
    return rejected('A signed service request replayed a nonce.');
  }

  return { ok: true };
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

export function adminAdapterGuard() {
  return (request: Request, response: Response, next: NextFunction): void => {
    adminAdapterResponseHeaders(response);
    const verdict = verifyAdminAdapterRequest({
      method: request.method,
      originalUrl: request.originalUrl,
      headers: request.headers as Record<string, string | string[] | undefined>,
      rawBody: (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      remoteAddress: request.socket.remoteAddress ?? '',
    });
    if (verdict.ok) {
      next();
      return;
    }
    logger.warn(`[admin-adapter] ${verdict.reason}`);
    response.status(verdict.status).json({ code: verdict.code, message: verdict.message });
  };
}
