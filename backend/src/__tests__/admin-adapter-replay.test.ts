/**
 * The shared replay stores behind the admin guard, against a stand-in for the
 * admin_nonces table (a primary key that refuses duplicates, an UPDATE that
 * reports touched rows) and a stand-in for Redis SET NX PX.
 */
const configState = { DATABASE: { ENABLED: true }, REDIS: { ENABLED: false } };

class DuplicateKey extends Error { code = 'ER_DUP_ENTRY'; errno = 1062; }

const table = {
  rows: new Map<string, Date>(),
  failing: null as string | null,
  /** @asyncUnsafe test double */
  async query(sql: string, params: any[] = []): Promise<any> {
    if (table.failing !== null) throw new Error(table.failing);
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('DELETE FROM admin_nonces WHERE expires_at <= ?')) {
      for (const [key, expiresAt] of table.rows) if (expiresAt.getTime() <= params[0].getTime()) table.rows.delete(key);
      return [{ affectedRows: 0 }];
    }
    if (s.startsWith('INSERT INTO admin_nonces')) {
      const key = `${params[0]}\n${params[1]}`;
      if (table.rows.has(key)) throw new DuplicateKey('dup');
      table.rows.set(key, params[2]);
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('UPDATE admin_nonces SET expires_at = ? WHERE scope = ? AND nonce = ? AND expires_at <= ?')) {
      const key = `${params[1]}\n${params[2]}`;
      const current = table.rows.get(key);
      if (!current || current.getTime() > params[3].getTime()) return [{ affectedRows: 0 }];
      table.rows.set(key, params[0]);
      return [{ affectedRows: 1 }];
    }
    throw new Error('fixture does not understand: ' + s);
  },
};

const redis = {
  keys: new Map<string, number>(),
  failing: null as string | null,
  /** @asyncUnsafe test double */
  async $claimOnce(key: string, ttlMs: number): Promise<boolean> {
    if (redis.failing !== null) throw new Error(redis.failing);
    if (redis.keys.has(key)) return false;
    redis.keys.set(key, ttlMs);
    return true;
  },
};

jest.mock('../config', () => ({ __esModule: true, default: configState }));
jest.mock('../database', () => ({ __esModule: true, default: { query: (sql: string, params?: any[]) => table.query(sql, params) } }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: redis }));

import {
  ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE,
  MysqlAdminReplayStore,
  RedisAdminReplayStore,
  createAdminReplayStore,
} from '../api/admin-adapter/admin-adapter.replay';
import { ADMIN_NONCE_RETENTION_MS } from '../api/admin-adapter/admin-adapter.security';

const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);

describe('database replay store', () => {
  beforeEach(() => {
    table.rows.clear();
    table.failing = null;
  });

  it('lets two workers sharing the table accept a nonce exactly once', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const workerA = new MysqlAdminReplayStore();
    const workerB = new MysqlAdminReplayStore();
    expect(await workerA.claim('key@1.0.0', 'isolated-nonce-1234', NOW)).toBe('claimed');
    expect(await workerB.claim('key@1.0.0', 'isolated-nonce-1234', NOW + 1)).toBe('replayed');
    expect(await workerA.claim('key@1.0.0', 'isolated-nonce-1234', NOW + 2)).toBe('replayed');
    // A different key scope is a different claim.
    expect(await workerB.claim('other@1.0.0', 'isolated-nonce-1234', NOW + 3)).toBe('claimed');
  });

  it('never releases a live nonce under pressure and reuses it only after retention', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const store = new MysqlAdminReplayStore();
    expect(await store.claim('key@1.0.0', 'nonce-a', NOW)).toBe('claimed');
    for (let i = 0; i < 25_000; i++) {
      table.rows.set(`key@1.0.0\nfiller-${i}`, new Date(NOW + ADMIN_NONCE_RETENTION_MS));
    }
    expect(await store.claim('key@1.0.0', 'nonce-a', NOW + ADMIN_NONCE_RETENTION_MS - 1)).toBe('replayed');
    expect(await store.claim('key@1.0.0', 'nonce-a', NOW + ADMIN_NONCE_RETENTION_MS)).toBe('claimed');
  });

  it('answers unavailable when the table cannot be reached, never claimed', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const store = new MysqlAdminReplayStore();
    table.failing = 'isolated unavailable database fixture';
    expect(await store.claim('key@1.0.0', 'nonce-a', NOW)).toBe('unavailable');
  });
});

describe('redis replay store', () => {
  beforeEach(() => {
    redis.keys.clear();
    redis.failing = null;
  });

  it('claims with SET NX and refuses the second claim', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const workerA = new RedisAdminReplayStore();
    const workerB = new RedisAdminReplayStore();
    expect(await workerA.claim('key@1.0.0', 'nonce-a', NOW)).toBe('claimed');
    expect(await workerB.claim('key@1.0.0', 'nonce-a', NOW)).toBe('replayed');
    expect(redis.keys.get('admin-nonce:key@1.0.0:nonce-a')).toBe(ADMIN_NONCE_RETENTION_MS);
  });

  it('answers unavailable when Redis is not connected', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    redis.failing = 'Redis is not connected';
    expect(await new RedisAdminReplayStore().claim('key@1.0.0', 'nonce-a', NOW)).toBe('unavailable');
  });
});

describe('replay store selection', () => {
  it('prefers the database, then Redis, and otherwise fails closed', () => {
    expect(createAdminReplayStore({}, { database: true, redis: true }).kind).toBe('database');
    expect(createAdminReplayStore({}, { database: false, redis: true }).kind).toBe('redis');
    expect(createAdminReplayStore({}, { database: false, redis: false }).kind).toBe('unavailable');
  });

  it('honours the explicit override and refuses one that cannot be met', () => {
    expect(createAdminReplayStore({ [ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE]: 'redis' }, { database: true, redis: true }).kind).toBe('redis');
    expect(createAdminReplayStore({ [ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE]: 'redis' }, { database: true, redis: false }).kind).toBe('unavailable');
    expect(createAdminReplayStore({ [ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE]: 'bogus' }, { database: true, redis: true }).kind).toBe('unavailable');
  });

  it('uses memory only on the explicit single-process opt-in', () => {
    expect(createAdminReplayStore({ [ADMIN_REPLAY_STORE_ENVIRONMENT_VARIABLE]: 'memory' }, { database: false, redis: false }).kind).toBe('memory');
    expect(createAdminReplayStore({}, { database: false, redis: false }).kind).not.toBe('memory');
  });
});
