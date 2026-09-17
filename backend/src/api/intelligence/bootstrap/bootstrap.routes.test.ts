import { createHash, createHmac } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';

jest.mock('./bootstrap.service', () => {
  class BootstrapEvidenceError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 503) {
      super(message);
    }
  }
  return {
    __esModule: true,
    BootstrapEvidenceError,
    default: {
      startWorker: jest.fn(),
      createOperatorJob: jest.fn(async (params: any, authorization: any) => ({ job_id: 'job-1', state: 'queued', params, authorization })),
      getJob: jest.fn(async () => undefined),
    },
  };
});

import bootstrapRoutes, { OPERATOR_PREFIX } from './bootstrap.routes';
import bootstrapService from './bootstrap.service';

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

/** Captures what the routes mount, so a request can be pushed through the operator prefix chain. */
function mountedApp(): { uses: Array<{ path: string; handlers: Handler[] }>; posts: Record<string, Handler[]> } {
  const uses: Array<{ path: string; handlers: Handler[] }> = [];
  const posts: Record<string, Handler[]> = {};
  const app: any = {
    use: (path: string, ...handlers: Handler[]) => { uses.push({ path, handlers }); return app; },
    get: () => app,
    post: (path: string, ...handlers: Handler[]) => { posts[path] = handlers; return app; },
  };
  // The guard is mounted with the process replay store; this single-process
  // test opts into the in-memory one explicitly, as the production selector
  // never chooses it on its own.
  process.env.EXPLORER_ADMIN_REPLAY_STORE = 'memory';
  bootstrapRoutes.initRoutes(app);
  return { uses, posts };
}

function response(): { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock; removeHeader: jest.Mock; locals: Record<string, unknown>; sent: () => { status: number; body: any } } {
  const res: any = { locals: {}, statusCode: 200 };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((body: unknown) => { res.body = body; return res; });
  res.setHeader = jest.fn();
  res.removeHeader = jest.fn();
  res.sent = () => ({ status: res.statusCode, body: res.body });
  return res;
}

// The guard verifies against the replay store asynchronously and answers or
// calls next() later, so each handler is awaited until it either advanced or
// sent a response.
async function runChain(handlers: Handler[], req: any, res: any): Promise<void> {
  for (const handler of handlers) {
    const outcome = await new Promise<'next' | 'sent'>((resolve) => {
      const originalJson = res.json;
      res.json = jest.fn((body: unknown) => { const r = originalJson(body); resolve('sent'); return r; });
      Promise.resolve(handler(req, res, () => resolve('next'))).catch(() => resolve('sent'));
    });
    if (outcome !== 'next') {
      return;
    }
  }
}

function request(remoteAddress: string, body: Record<string, unknown>, headers: Record<string, string> = {}): any {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  return { method: 'POST', originalUrl: `${OPERATOR_PREFIX}/loads`, headers: { 'content-type': 'application/json', ...headers }, rawBody: raw, body, socket: { remoteAddress } };
}

function signedHeaders(secret: Buffer, keyId: string, rawBody: Buffer, path: string): Record<string, string> {
  const { ADMIN_SERVICE_HEADERS, ADMIN_CONTROL_CONTRACT_VERSION, adminServiceSigningString } = adminControl as any;
  const timestamp = new Date().toISOString();
  const nonce = 'nonce-' + Math.random().toString(16).slice(2, 14);
  const bodyDigest = createHash('sha256').update(rawBody).digest('hex');
  const signature = createHmac('sha256', secret).update(adminServiceSigningString({ method: 'POST', path, query: '', keyId, timestamp, nonce, bodyDigest })).digest('hex');
  return {
    [ADMIN_SERVICE_HEADERS.contractVersion]: ADMIN_CONTROL_CONTRACT_VERSION,
    [ADMIN_SERVICE_HEADERS.keyId]: keyId,
    [ADMIN_SERVICE_HEADERS.timestamp]: timestamp,
    [ADMIN_SERVICE_HEADERS.nonce]: nonce,
    [ADMIN_SERVICE_HEADERS.bodyDigest]: bodyDigest,
    [ADMIN_SERVICE_HEADERS.signature]: signature,
  };
}

describe('bootstrap operator routes', () => {
  const secret = Buffer.alloc(32, 7);
  const previousKeys = process.env.EXPLORER_ADMIN_ADAPTER_KEYS;
  beforeEach(() => {
    (bootstrapService.createOperatorJob as jest.Mock).mockClear();
    process.env.EXPLORER_ADMIN_ADAPTER_KEYS = 'ops:' + secret.toString('base64');
  });
  afterAll(() => {
    if (previousKeys === undefined) {
      delete process.env.EXPLORER_ADMIN_ADAPTER_KEYS;
    } else {
      process.env.EXPLORER_ADMIN_ADAPTER_KEYS = previousKeys;
    }
  });

  it('mounts the admin adapter guard on the operator prefix before any handler', () => {
    const { uses, posts } = mountedApp();
    expect(uses.map((u) => u.path)).toEqual([OPERATOR_PREFIX]);
    expect(uses[0].handlers).toHaveLength(2);
    expect(Object.keys(posts)).toEqual(expect.arrayContaining([`${OPERATOR_PREFIX}/snapshots`, `${OPERATOR_PREFIX}/loads`]));
    expect(bootstrapService.startWorker).toHaveBeenCalled();
  });

  it('answers a public origin with 404 and never reaches the service', async () => {
    const { uses, posts } = mountedApp();
    const res = response();
    const req = request('203.0.113.9', { snapshot_id: 's', idempotency_key: 'idem-12345678', confirm: 'load_snapshot' });
    await runChain([uses[0].handlers[1], ...posts[`${OPERATOR_PREFIX}/loads`]], req, res);
    expect(res.sent()).toEqual({ status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } });
    expect(bootstrapService.createOperatorJob).not.toHaveBeenCalled();
  });

  it('answers an unsigned private request with a rejection and never reaches the service', async () => {
    const { uses, posts } = mountedApp();
    const res = response();
    const req = request('127.0.0.1', { snapshot_id: 's', idempotency_key: 'idem-12345678', confirm: 'load_snapshot' });
    await runChain([uses[0].handlers[1], ...posts[`${OPERATOR_PREFIX}/loads`]], req, res);
    expect([401, 403]).toContain(res.sent().status);
    expect(bootstrapService.createOperatorJob).not.toHaveBeenCalled();
    delete process.env.EXPLORER_ADMIN_ADAPTER_KEYS;
    const unconfigured = response();
    await runChain([uses[0].handlers[1], ...posts[`${OPERATOR_PREFIX}/loads`]], request('127.0.0.1', {}), unconfigured);
    expect(unconfigured.sent().status).toBe(503);
    expect(bootstrapService.createOperatorJob).not.toHaveBeenCalled();
  });

  it('passes a correctly signed private request to the service with its verified authorization', async () => {
    const { uses, posts } = mountedApp();
    const body = { snapshot_id: 'regtest-105', idempotency_key: 'idem-12345678', confirm: 'load_snapshot', adminAuthorization: { elevated: true } };
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const req = request('10.0.0.5', body, signedHeaders(secret, 'ops', raw, `${OPERATOR_PREFIX}/loads`));
    const res = response();
    await runChain([uses[0].handlers[1], ...posts[`${OPERATOR_PREFIX}/loads`]], req, res);
    expect(res.sent().status).toBe(202);
    expect(bootstrapService.createOperatorJob).toHaveBeenCalledWith(
      { job_type: 'load_snapshot', node_id: undefined, snapshot_id: 'regtest-105', idempotency_key: 'idem-12345678', confirm: 'load_snapshot' },
      { keyId: 'ops', elevated: true }
    );
    const tampered = request('10.0.0.5', { ...body, snapshot_id: 'other' }, signedHeaders(secret, 'ops', raw, `${OPERATOR_PREFIX}/loads`));
    const rejected = response();
    await runChain([uses[0].handlers[1], ...posts[`${OPERATOR_PREFIX}/loads`]], tampered, rejected);
    expect(rejected.sent().status).toBe(401);
    expect(bootstrapService.createOperatorJob).toHaveBeenCalledTimes(1);
  });
});
