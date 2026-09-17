import DB from '../../../database';
import config from '../../../config';
import { MysqlPrivateRelayStore, PRIVATE_RELAY_TABLE } from './private-relay.store';
import { PrivateRelaySubmissionRow } from './private-relay.types';

jest.mock('../../../database', () => ({ __esModule: true, default: { query: jest.fn() } }));

/**
 * The MySQL store against a mocked driver: what matters is that every
 * competing transition is one UPDATE whose WHERE names the state (and holder),
 * and that the store believes affectedRows rather than its own intent.
 */
const query = DB.query as jest.Mock;
const NOW = '2026-09-17T12:00:00.000Z';

const row: PrivateRelaySubmissionRow = {
  submission_id: '11111111-1111-4111-8111-111111111111', network: 'signet', txid: 'ab'.repeat(32), raw_tx: '02'.repeat(80),
  method: 'privatebroadcast_tor', state: 'queued', relay_endpoint_id: null, attempts: 0, lease_until: null, lease_owner: null,
  owner_token_hash: 'cd'.repeat(32), created_at: NOW, updated_at: NOW, relayed_at: null, confirmed_block_height: null, last_error: null,
};

describe('MysqlPrivateRelayStore', () => {
  const enabled = config.DATABASE.ENABLED;
  const store = new MysqlPrivateRelayStore();
  beforeEach(() => { config.DATABASE.ENABLED = true; query.mockReset(); });
  afterAll(() => { config.DATABASE.ENABLED = enabled; });

  it('inserts a new row and returns the existing one on the (network, txid) unique key', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await store.insertOrExisting(row)).toEqual({ row, created: true });
    expect(query.mock.calls[0][0]).toContain(`INSERT INTO ${PRIVATE_RELAY_TABLE}`);

    query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
    query.mockResolvedValueOnce([[{ ...row, submission_id: '22222222-2222-4222-8222-222222222222', state: 'submitted', created_at: new Date(NOW), updated_at: new Date(NOW), lease_until: null, relayed_at: new Date(NOW) }]]);
    const existing = await store.insertOrExisting(row);
    expect(existing.created).toBe(false);
    expect(existing.row).toMatchObject({ submission_id: '22222222-2222-4222-8222-222222222222', state: 'submitted', relayed_at: NOW, created_at: NOW });
    expect(query.mock.calls[2][0]).toContain('WHERE network = ? AND txid = ?');

    query.mockRejectedValueOnce(new Error('connection lost'));
    await expect(store.insertOrExisting(row)).rejects.toThrow('connection lost');
  });

  it('cancels only a queued row and reports the loss when the worker already claimed it', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await store.cancelIfQueued(row.submission_id, NOW)).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET state = 'cancelled'/);
    expect(sql).toMatch(/WHERE submission_id = \? AND state = 'queued'/);
    expect(params[1]).toBe(row.submission_id);

    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await store.cancelIfQueued(row.submission_id, NOW)).toBe(false);
  });

  it('claims with a compare-and-set on state, updated_at and lease, and yields to a competing claim', async () => {
    const candidate = { ...row, created_at: new Date(NOW), updated_at: new Date(NOW) };
    query.mockResolvedValueOnce([[candidate]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const claimed = await store.claimNext({ network: 'signet', states: ['queued', 'relaying'], workerId: 'w1', nowIso: NOW, leaseUntilIso: '2026-09-17T12:02:00.000Z', maxAttempts: 5 });
    expect(claimed).toMatchObject({ submission_id: row.submission_id, state: 'relaying', lease_owner: 'w1', attempts: 1 });
    const [selectSql] = query.mock.calls[0];
    expect(selectSql).toMatch(/state IN \(\?, \?\) AND attempts <= \?/);
    expect(selectSql).toMatch(/lease_until IS NULL OR lease_until <= \?/);
    const [updateSql, updateParams] = query.mock.calls[1];
    expect(updateSql).toMatch(/SET state = 'relaying', lease_owner = \?, lease_until = \?, attempts = attempts \+ 1/);
    expect(updateSql).toMatch(/WHERE submission_id = \? AND state = \? AND updated_at = \? AND \(lease_until IS NULL OR lease_until <= \?\)/);
    expect(updateParams[4]).toBe('queued');

    query.mockResolvedValueOnce([[candidate]]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await store.claimNext({ network: 'signet', states: ['queued'], workerId: 'w2', nowIso: NOW, leaseUntilIso: NOW, maxAttempts: 5 })).toBeNull();
  });

  it('settles only for the holder in the expected state', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await store.settle({ submissionId: row.submission_id, workerId: 'w1', fromState: 'relaying', toState: 'submitted', nowIso: NOW, leaseUntilIso: null, relayEndpointId: 'tor-a', relayedAtIso: NOW, lastError: null })).toBe(false);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE submission_id = \? AND state = \? AND lease_owner = \?$/);
    expect(params.slice(-3)).toEqual([row.submission_id, 'relaying', 'w1']);
    expect(sql).toMatch(/lease_owner = NULL/);
  });

  it('counts the queue by state for the backend network only', async () => {
    query.mockResolvedValueOnce([[{ state: 'queued', n: '2' }, { state: 'confirmed', n: 3 }, { state: 'bogus', n: 9 }]]);
    expect(await store.queueDepth('signet')).toEqual({ queued: 2, relaying: 0, submitted: 0, confirmed: 3, rejected: 0, cancelled: 0 });
    expect(query.mock.calls[0][1]).toEqual(['signet']);
  });
});
