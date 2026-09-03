/**
 * The route half of the node console.
 *
 * The allowlist has its own tests. These check the thing the allowlist
 * cannot: that the route actually goes through it, that a refused method
 * never reaches the client, and that a trimmed answer is trimmed before it
 * is serialized.
 */

const calls: { method: string; args: unknown[] }[] = [];
let nextAnswer: unknown = {};
let nextError: Error | null = null;

/**
 * A client that records what was called on it. Every allowlisted client
 * method is present, so a call reaching the client is a call that would have
 * reached the node.
 */
jest.mock('../api/bitcoin/bitcoin-client', () => {
  const record = (method: string) => (...args: unknown[]): Promise<unknown> => {
    calls.push({ method, args });
    if (nextError) { return Promise.reject(nextError); }
    return Promise.resolve(nextAnswer);
  };
  return {
    __esModule: true,
    default: {
      getBlockchainInfo: record('getBlockchainInfo'),
      getBestBlockHash: record('getBestBlockHash'),
      getBlockCount: record('getBlockCount'),
      getBlockHash: record('getBlockHash'),
      getBlockHeader: record('getBlockHeader'),
      getBlockStats: record('getBlockStats'),
      getChainTips: record('getChainTips'),
      getChainTxStats: record('getChainTxStats'),
      getDifficulty: record('getDifficulty'),
      getTxOut: record('getTxOut'),
      getIndexInfo: record('getIndexInfo'),
      getMempoolInfo: record('getMempoolInfo'),
      getMempoolEntry: record('getMempoolEntry'),
      estimateSmartFee: record('estimateSmartFee'),
      getNetworkInfo: record('getNetworkInfo'),
      getPeerInfo: record('getPeerInfo'),
      getConnectionCount: record('getConnectionCount'),
      getNetTotals: record('getNetTotals'),
      getMiningInfo: record('getMiningInfo'),
      decodeRawTransaction: record('decodeRawTransaction'),
      decodeScript: record('decodeScript'),
      validateAddress: record('validateAddress'),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const routes = require('../api/node-console/node-console.routes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  catalogOf,
  RATE_LIMIT_PER_MINUTE,
  resetRateLimits,
  takeToken,
} = require('../api/node-console/node-console.routes');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FORBIDDEN_METHODS } = require('../api/node-console/rpc-allowlist');

interface Captured {
  status: number;
  body: any;
  headers: Record<string, string>;
}

function handlers(): Map<string, (req: any, res: any) => unknown> {
  const found = new Map<string, (req: any, res: any) => unknown>();
  const app: any = {
    get(path: string, handler: (req: any, res: any) => unknown) {
      found.set(path, handler);
      return app;
    },
    post(path: string, handler: (req: any, res: any) => unknown) {
      found.set('POST ' + path, handler);
      return app;
    },
  };
  routes.initRoutes(app);
  return found;
}

async function call(path: string, req: Record<string, unknown> = {}): Promise<Captured> {
  const handler = handlers().get(path);
  if (!handler) { throw new Error('no handler for ' + path); }
  const captured: Captured = { status: 200, body: undefined, headers: {} };
  const res: any = {
    json(body: unknown) { captured.body = body; return res; },
    send(body: unknown) { captured.body = body; return res; },
    status(code: number) { captured.status = code; return res; },
    header(name: string, value: string) { captured.headers[name] = value; return res; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return res; },
  };
  await handler({ params: {}, query: {}, body: {}, accepts: () => 'json', ...req }, res);
  return captured;
}

const PREFIX = '/api/v1/';
const RPC = `POST ${PREFIX}node/rpc`;

beforeEach(() => {
  calls.length = 0;
  nextAnswer = {};
  nextError = null;
  resetRateLimits();
});

describe('the catalog', () => {
  it('lists the allowlist without the functions on it', () => {
    const entries = catalogOf() as any[];
    expect(entries.length).toBeGreaterThan(15);
    for (const entry of entries) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.summary).toBe('string');
      expect(entry).not.toHaveProperty('redact');
      expect(entry).not.toHaveProperty('clientMethod');
    }
  });

  it('says which entries are trimmed and why', () => {
    const peers = (catalogOf() as any[]).find((entry) => entry.name === 'getpeerinfo');
    expect(peers.redacted).toBe(true);
    expect(peers.redactionNote).toContain('topology');
  });

  it('is served and cached', async () => {
    const answer = await call(`${PREFIX}node/rpc/catalog`);
    expect(answer.status).toBe(200);
    expect(answer.body.methods.length).toBeGreaterThan(15);
    expect(answer.headers['Cache-control']).toContain('max-age');
  });
});

describe('the rpc route refuses what it must', () => {
  it('never calls the client for a forbidden method', async () => {
    for (const method of FORBIDDEN_METHODS) {
      const answer = await call(RPC, { body: { method, args: [] } });
      expect(answer.status).toBe(400);
    }
    // The assertion that matters: not one of them reached the node.
    expect(calls).toEqual([]);
  });

  it('gives the same answer for a forbidden method and an invented one', async () => {
    // Telling them apart would turn this route into a way to enumerate the
    // node's build.
    const forbidden = await call(RPC, { body: { method: 'stop' } });
    const invented = await call(RPC, { body: { method: 'getthething' } });
    expect(forbidden.status).toBe(invented.status);
    expect(forbidden.body).toEqual(invented.body);
  });

  it('refuses a method name that is not a string', async () => {
    for (const method of [undefined, null, 42, ['getblockcount'], { name: 'getblockcount' }]) {
      const answer = await call(RPC, { body: { method } });
      expect(answer.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('refuses a bad argument before calling the client', async () => {
    const answer = await call(RPC, { body: { method: 'getblockhash', args: ['soon'] } });
    expect(answer.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses an argument past the last declared parameter', async () => {
    const answer = await call(RPC, { body: { method: 'getblockcount', args: ['extra'] } });
    expect(answer.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('the rpc route calls what it should', () => {
  it('calls the client method the allowlist recorded, with checked arguments', async () => {
    nextAnswer = '0000000000000000000123';
    const answer = await call(RPC, { body: { method: 'getblockhash', args: ['800000'] } });
    expect(answer.status).toBe(200);
    expect(calls).toEqual([{ method: 'getBlockHash', args: [800000] }]);
    expect(answer.body.result).toBe('0000000000000000000123');
    expect(answer.body.method).toBe('getblockhash');
  });

  it('reports the arguments it actually used, not the ones sent', async () => {
    // A caller who sent a string and sees a number back can tell what the
    // node was really asked.
    const answer = await call(RPC, { body: { method: 'getblockhash', args: [' 800000 '] } });
    expect(answer.body.args).toEqual([800000]);
  });

  it('trims a peer answer before it is serialized', async () => {
    nextAnswer = [{
      addr: '198.51.100.7:8333',
      addrlocal: '203.0.113.4:8333',
      network: 'ipv4',
      inbound: true,
      subver: '/Satoshi:28.0.0/',
    }];
    const answer = await call(RPC, { body: { method: 'getpeerinfo' } });
    const serialized = JSON.stringify(answer.body);
    expect(serialized).not.toContain('198.51.100.7');
    expect(serialized).not.toContain('203.0.113.4');
    expect(answer.body.result[0].network).toBe('ipv4');
    expect(answer.body.redacted).toBe(true);
    expect(answer.body.redactionNote).toContain('topology');
  });

  it('trims the node own addresses out of the network answer', async () => {
    nextAnswer = { version: 280000, localaddresses: [{ address: '203.0.113.4' }] };
    const answer = await call(RPC, { body: { method: 'getnetworkinfo' } });
    expect(JSON.stringify(answer.body)).not.toContain('203.0.113.4');
    expect(answer.body.result.version).toBe(280000);
  });

  it('marks an untrimmed answer as untrimmed rather than leaving it unsaid', async () => {
    nextAnswer = 800_000;
    const answer = await call(RPC, { body: { method: 'getblockcount' } });
    expect(answer.body.redacted).toBe(false);
    expect(answer.body.redactionNote).toBeNull();
  });

  it('caches an answer that cannot change and refuses to cache one that can', async () => {
    const immutable = await call(RPC, { body: { method: 'getblockhash', args: ['800000'] } });
    expect(immutable.headers['Cache-control']).toContain('max-age');
    const live = await call(RPC, { body: { method: 'getblockcount' } });
    expect(live.headers['Cache-control']).toBe('no-store');
  });

  it('passes the node own words back when it refuses', async () => {
    nextError = new Error('Block height out of range');
    const answer = await call(RPC, { body: { method: 'getblockhash', args: ['800000'] } });
    expect(answer.status).toBe(400);
    // handleError answers JSON, so the node words live on the error field.
    expect(answer.body.error).toContain('Block height out of range');
  });

  it('bounds a long rejection so it cannot become the payload', async () => {
    nextError = new Error('x'.repeat(5000));
    const answer = await call(RPC, { body: { method: 'getblockcount' } });
    expect(answer.body.error.length).toBeLessThan(700);
    expect(answer.body.error).toContain('xxx');
  });
});

describe('the rate limit', () => {
  it('allows the budget and then refuses', () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect(takeToken('getblockcount')).toBe(true);
    }
    expect(takeToken('getblockcount')).toBe(false);
  });

  it('is per method, so one busy method does not close another', () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) { takeToken('getblockcount'); }
    expect(takeToken('getblockcount')).toBe(false);
    expect(takeToken('getdifficulty')).toBe(true);
  });

  it('refills after the window passes', () => {
    const start = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) { takeToken('getblockcount', start); }
    expect(takeToken('getblockcount', start + 59_000)).toBe(false);
    expect(takeToken('getblockcount', start + 60_001)).toBe(true);
  });

  it('answers 429 rather than calling the node once the budget is gone', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) { takeToken('getblockcount'); }
    const answer = await call(RPC, { body: { method: 'getblockcount' } });
    expect(answer.status).toBe(429);
    expect(calls).toEqual([]);
  });
});

describe('the overview', () => {
  it('is served with every section present', async () => {
    nextAnswer = {};
    const answer = await call(`${PREFIX}node/overview`);
    expect(answer.status).toBe(200);
    for (const key of ['chain', 'indexes', 'mempool', 'network', 'peers']) {
      expect(answer.body[key]).toHaveProperty('state');
    }
    expect(typeof answer.body.observedAt).toBe('string');
  });

  it('reports a quiet node as unavailable rather than failing the page', async () => {
    nextError = new Error('Could not connect to the server');
    const answer = await call(`${PREFIX}node/overview`);
    expect(answer.status).toBe(200);
    expect(answer.body.chain.state).toBe('unavailable');
    expect(answer.body.chain.reason).toContain('Could not connect');
    expect(answer.body.chain.data).toBeNull();
  });
});

describe('route registration', () => {
  it('puts the calling route behind POST only', () => {
    const found = handlers();
    expect(found.has(`${PREFIX}node/rpc`)).toBe(false);
    expect(found.has(RPC)).toBe(true);
  });

  it('serves the overview and the catalog on GET', () => {
    const found = handlers();
    expect(found.has(`${PREFIX}node/overview`)).toBe(true);
    expect(found.has(`${PREFIX}node/rpc/catalog`)).toBe(true);
  });
});
