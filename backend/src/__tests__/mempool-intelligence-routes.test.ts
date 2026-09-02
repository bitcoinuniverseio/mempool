import { MempoolTransactionExtended } from '../mempool.interfaces';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  readBound,
} from '../api/mempool-intelligence/mempool-intelligence.routes';

/**
 * The mempool singleton normally pulls in most of the backend. Replacing it
 * with a value the test controls keeps these route tests about request
 * handling, which is what they are for.
 */
let fakeMempool: { [txid: string]: MempoolTransactionExtended } = {};
jest.mock('../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => fakeMempool, getSpendMap: () => new Map() },
}));

/**
 * The simulate route reaches a Bitcoin Core client, and importing the real one
 * opens a connection that keeps the test runner alive after the assertions
 * finish. These tests are about request handling and never reach it.
 */
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {} }));

// Imported after the mock so the routes module picks the stub up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const routes = require('../api/mempool-intelligence/mempool-intelligence.routes').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const intelligence = require('../api/mempool-intelligence/mempool-intelligence').default;

function id(label: string): string {
  return label.padEnd(64, '0');
}

function entry(
  label: string,
  fee: number,
  vsize: number,
  parents: string[] = [],
): MempoolTransactionExtended {
  return {
    txid: id(label),
    fee,
    vsize,
    weight: vsize * 4,
    vin: parents.map((parent) => ({ txid: id(parent), vout: 0 })),
  } as unknown as MempoolTransactionExtended;
}

interface Captured {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Collects the handlers `initRoutes` registers, so each one can be called
 * directly with a request the test built.
 */
function registeredHandlers(): Map<string, (req: any, res: any) => void> {
  const handlers = new Map<string, (req: any, res: any) => void>();
  // Keyed by method and path, so a route registered under one verb cannot be
  // reached by a test that meant the other.
  const app: any = {
    get(path: string, handler: (req: any, res: any) => void) {
      handlers.set(path, handler);
      return app;
    },
    post(path: string, handler: (req: any, res: any) => void) {
      handlers.set('POST ' + path, handler);
      return app;
    },
  };
  routes.initRoutes(app);
  return handlers;
}

function call(
  path: string,
  req: { params?: Record<string, string>; query?: Record<string, unknown> },
): Captured {
  const handlers = registeredHandlers();
  const handler = handlers.get(path);
  if (!handler) {
    throw new Error('no handler registered for ' + path + '; have ' + [...handlers.keys()]);
  }
  const captured: Captured = { status: 200, body: undefined, headers: {} };
  const res: any = {
    json(body: unknown) { captured.body = body; return res; },
    send(body: unknown) { captured.body = body; return res; },
    status(code: number) { captured.status = code; return res; },
    header(name: string, value: string) { captured.headers[name] = value; return res; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return res; },
  };
  // `handleError` asks the request what it accepts before choosing between a
  // JSON body and plain text, so the stub has to answer that too.
  handler({ params: {}, query: {}, accepts: () => 'json', ...req }, res);
  return captured;
}

/** The same, for a route whose handler returns a promise. */
async function callAsync(
  path: string,
  req: { body?: unknown },
): Promise<Captured> {
  const handler = registeredHandlers().get(path);
  if (!handler) { throw new Error('no handler registered for ' + path); }
  const captured: Captured = { status: 200, body: undefined, headers: {} };
  const res: any = {
    json(body: unknown) { captured.body = body; return res; },
    send(body: unknown) { captured.body = body; return res; },
    status(code: number) { captured.status = code; return res; },
    header(name: string, value: string) { captured.headers[name] = value; return res; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return res; },
  };
  await handler({ params: {}, query: {}, accepts: () => 'json', ...req } as any, res);
  return captured;
}

const PREFIX = '/api/v1/';

beforeEach(() => {
  intelligence.invalidate();
  fakeMempool = {};
});

describe('readBound', () => {
  it('takes the default when nothing was supplied', () => {
    expect(readBound(undefined, 7, 100)).toBe(7);
    expect(readBound('', 7, 100)).toBe(7);
  });

  it('accepts a whole number inside the bound', () => {
    expect(readBound('0', 7, 100)).toBe(0);
    expect(readBound('100', 7, 100)).toBe(100);
  });

  it('refuses text rather than quietly using the default', () => {
    // A caller who sent limit=abc and got the default back would believe
    // their request was understood.
    expect(readBound('abc', 7, 100)).toBeNull();
    expect(readBound('12abc', 7, 100)).toBeNull();
  });

  it('refuses a negative, a fraction, and a value past the bound', () => {
    expect(readBound('-1', 7, 100)).toBeNull();
    expect(readBound('1.5', 7, 100)).toBeNull();
    expect(readBound('101', 7, 100)).toBeNull();
  });

  it('refuses a repeated query parameter, which arrives as an array', () => {
    expect(readBound(['1', '2'], 7, 100)).toBeNull();
  });

  it('refuses a number too long to be a real bound', () => {
    expect(readBound('1234567890', 7, 2_000_000_000)).toBeNull();
  });
});

describe('GET mempool/clusters', () => {
  it('answers the clusters in the mempool with their freshness', () => {
    fakeMempool = {
      [id('a')]: entry('a', 100, 100),
      [id('b')]: entry('b', 900, 100),
    };
    const result = call(PREFIX + 'mempool/clusters', {});
    expect(result.status).toBe(200);
    const body = result.body as any;
    expect(body.total).toBe(2);
    expect(body.clusters[0].id).toBe(id('b'));
    expect(body.freshness.budgetMs).toBeGreaterThan(0);
    expect(body.limit).toBe(DEFAULT_LIMIT);
  });

  it('refuses a limit past the maximum instead of clamping it', () => {
    const result = call(PREFIX + 'mempool/clusters', {
      query: { limit: String(MAX_LIMIT + 1) },
    });
    expect(result.status).toBe(400);
  });

  it('refuses a zero limit, which would answer nothing and look empty', () => {
    expect(call(PREFIX + 'mempool/clusters', { query: { limit: '0' } }).status).toBe(400);
  });

  it('refuses a malformed offset', () => {
    expect(call(PREFIX + 'mempool/clusters', { query: { offset: 'x' } }).status).toBe(400);
  });

  it('answers an empty list for an empty mempool without failing', () => {
    const body = call(PREFIX + 'mempool/clusters', {}).body as any;
    expect(body.clusters).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('answers only clusters with a dependency when asked for packages', () => {
    fakeMempool = {
      [id('a')]: entry('a', 100, 100),
      [id('b')]: entry('b', 1000, 100, ['a']),
      [id('c')]: entry('c', 900, 100),
    };
    const body = call(PREFIX + 'mempool/clusters', { query: { minTxCount: '2' } }).body as any;
    expect(body.total).toBe(1);
    expect(body.clusters[0].id).toBe(id('a'));
  });

  it('refuses a minTxCount of zero', () => {
    expect(call(PREFIX + 'mempool/clusters', { query: { minTxCount: '0' } }).status)
      .toBe(400);
  });
  it('caches only as long as the freshness budget', () => {
    const result = call(PREFIX + 'mempool/clusters', {});
    expect(result.headers['Cache-control']).toBe('public, max-age=5');
  });
});

describe('GET mempool/clusters/:reference', () => {
  beforeEach(() => {
    fakeMempool = {
      [id('a')]: entry('a', 100, 100),
      [id('b')]: entry('b', 1000, 100, ['a']),
    };
  });

  it('answers the cluster for a member txid', () => {
    const result = call(PREFIX + 'mempool/clusters/:reference', {
      params: { reference: id('b') },
    });
    expect(result.status).toBe(200);
    expect((result.body as any).cluster.id).toBe(id('a'));
  });

  it('accepts an uppercase txid', () => {
    const result = call(PREFIX + 'mempool/clusters/:reference', {
      params: { reference: id('a').toUpperCase() },
    });
    expect(result.status).toBe(200);
  });

  it('refuses something that is not a transaction id', () => {
    expect(call(PREFIX + 'mempool/clusters/:reference', {
      params: { reference: 'not-a-txid' },
    }).status).toBe(400);
  });

  it('answers 404 for a transaction that is not unconfirmed here', () => {
    // Different from a malformed id, and the message says which.
    const result = call(PREFIX + 'mempool/clusters/:reference', {
      params: { reference: id('ee') },
    });
    expect(result.status).toBe(404);
  });
});

describe('GET mempool/feerate-diagram', () => {
  it('answers both curves for the same mempool', () => {
    fakeMempool = {
      [id('a')]: entry('a', 10, 100),
      [id('b')]: entry('b', 1000, 100, ['a']),
    };
    const body = call(PREFIX + 'mempool/feerate-diagram', {}).body as any;
    expect(body.points.length).toBeGreaterThan(1);
    expect(body.naivePoints.length).toBeGreaterThan(1);
    expect(body.totalFeeSats).toBe(1010);
  });
});

describe('GET mempool/packages/:txid', () => {
  it('answers the package around a transaction', () => {
    fakeMempool = {
      [id('a')]: entry('a', 100, 100),
      [id('b')]: entry('b', 1000, 100, ['a']),
    };
    const result = call(PREFIX + 'mempool/packages/:txid', { params: { txid: id('b') } });
    expect(result.status).toBe(200);
    expect((result.body as any).cluster.txids).toEqual([id('a'), id('b')]);
  });

  it('refuses a malformed transaction id', () => {
    expect(call(PREFIX + 'mempool/packages/:txid', { params: { txid: 'zz' } }).status)
      .toBe(400);
  });

  it('answers 404 when the transaction is not in the mempool', () => {
    expect(call(PREFIX + 'mempool/packages/:txid', { params: { txid: id('ee') } }).status)
      .toBe(404);
  });
});

describe('POST mempool/simulate', () => {
  const RAW = 'ab'.repeat(80);

  it('refuses a body that is not a list of raw transactions', async () => {
    const answer = await callAsync(`POST ${PREFIX}mempool/simulate`, { body: {} });
    expect(answer.status).toBe(400);
  });

  it('refuses an empty package rather than asking the node about nothing', async () => {
    const answer = await callAsync(`POST ${PREFIX}mempool/simulate`, { body: { rawTxs: [] } });
    expect(answer.status).toBe(400);
  });

  it('refuses anything that is not hexadecimal, before the node sees it', async () => {
    const answer = await callAsync(`POST ${PREFIX}mempool/simulate`, { body: { rawTxs: ['zz'] } });
    expect(answer.status).toBe(400);
  });

  it('refuses more transactions than a node relays as one package', async () => {
    const many = Array.from({ length: 26 }, (_, i) => RAW + i.toString(16).padStart(2, '0'));
    const answer = await callAsync(`POST ${PREFIX}mempool/simulate`, { body: { rawTxs: many } });
    expect(answer.status).toBe(400);
  });

  it('is registered under POST only, so a GET cannot reach it', () => {
    const handlers = registeredHandlers();
    expect(handlers.has(`${PREFIX}mempool/simulate`)).toBe(false);
    expect(handlers.has(`POST ${PREFIX}mempool/simulate`)).toBe(true);
  });
});
