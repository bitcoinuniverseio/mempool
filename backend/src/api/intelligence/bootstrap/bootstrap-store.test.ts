jest.mock('../../../database', () => ({ __esModule: true, default: { query: jest.fn() } }));

import DB from '../../../database';
import { JOBS_TABLE, MysqlBootstrapStore, VERIFICATIONS_TABLE } from './bootstrap-store';
import { NodeBootstrapJob } from './bootstrap.models';

const query = DB.query as jest.Mock;

function job(overrides: Partial<NodeBootstrapJob> = {}): NodeBootstrapJob {
  const now = '2026-09-17T00:00:00.000Z';
  return {
    job_id: 'job-1', job_type: 'generate_snapshot', network: 'signet', node_id: 'owned-core-signet', idempotency_key: 'idem-1', state: 'queued', status: 'queued',
    progress_pct: 0, message: '', requested_by: 'ops', created_at: now, updated_at: now, attempts: 0, lease: null, rpc: null, preconditions: {}, evidence: {}, checkpoints: [], ...overrides,
  };
}

describe('MysqlBootstrapStore', () => {
  const store = new MysqlBootstrapStore();
  beforeEach(() => query.mockReset());

  it('scopes verification reads by network and tells a missing row apart from a row', async () => {
    query.mockResolvedValueOnce([[]]);
    expect(await store.getVerification('v1', 'signet')).toBeNull();
    expect(query.mock.calls[0][0]).toContain(`FROM ${VERIFICATIONS_TABLE} WHERE verification_id = ? AND network = ?`);
    expect(query.mock.calls[0][1]).toEqual(['v1', 'signet']);
    query.mockResolvedValueOnce([[{ document: JSON.stringify({ verification_id: 'v1', state: 'valid' }) }]]);
    expect(await store.getVerification('v1', 'signet')).toEqual({ verification_id: 'v1', state: 'valid' });
    query.mockRejectedValueOnce(new Error('gone'));
    await expect(store.getVerification('v1', 'signet')).rejects.toThrow('gone');
  });

  it('returns the stored job when the idempotency key is already taken', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await store.insertJob(job())).toEqual({ job: job(), created: true });
    expect(query.mock.calls[0][0]).toContain(`INSERT IGNORE INTO ${JOBS_TABLE}`);
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    query.mockResolvedValueOnce([[{ document: JSON.stringify(job({ job_id: 'job-0', state: 'completed' })) }]]);
    const duplicate = await store.insertJob(job({ job_id: 'job-9' }));
    expect(duplicate).toEqual({ job: job({ job_id: 'job-0', state: 'completed' }), created: false });
    expect(query.mock.calls[2][0]).toContain('WHERE network = ? AND idempotency_key = ?');
    expect(query.mock.calls[2][1]).toEqual(['signet', 'idem-1']);
  });

  it('claims a queued or lapsed job only through a conditional lease update', async () => {
    query.mockResolvedValueOnce([[{ job_id: 'job-1' }]]);
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await store.claimJob('signet', 'worker-a', '2026-09-17T00:00:00.000Z', 60000)).toBeNull();
    expect(query.mock.calls[0][0]).toContain(`state = 'queued' OR (state = 'running' AND lease_expires_at < ?)`);
    expect(query.mock.calls[1][0]).toContain(`SET state = 'running', lease_owner = ?, lease_expires_at = ?`);
    expect(query.mock.calls[1][0]).toContain(`WHERE job_id = ? AND network = ? AND (state = 'queued' OR (state = 'running' AND lease_expires_at < ?))`);
    query.mockReset();
    query.mockResolvedValueOnce([[{ job_id: 'job-1' }]]);
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    query.mockResolvedValueOnce([[{ document: JSON.stringify(job()) }]]);
    const claimed = await store.claimJob('signet', 'worker-a', '2026-09-17T00:00:00.000Z', 60000);
    expect(claimed).toMatchObject({ job_id: 'job-1', state: 'running', lease: { owner: 'worker-a', expires_at: '2026-09-17T00:01:00.000Z' } });
    query.mockResolvedValueOnce([[]]);
    expect(await store.claimJob('signet', 'worker-a', '2026-09-17T00:00:00.000Z', 60000)).toBeNull();
  });

  it('writes a job only while the same owner still holds the lease', async () => {
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await store.updateJob(job({ state: 'running', lease: { owner: 'worker-a', expires_at: '2026-09-17T00:01:00.000Z' } }), 'worker-a')).toBe(false);
    expect(query.mock.calls[0][0]).toContain('WHERE job_id = ? AND network = ? AND lease_owner = ?');
    expect(query.mock.calls[0][1].slice(-3)).toEqual(['job-1', 'signet', 'worker-a']);
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await store.updateJob(job({ state: 'completed', lease: null }), 'worker-a')).toBe(true);
    expect(query.mock.calls[1][1][1]).toBeNull();
  });
});
