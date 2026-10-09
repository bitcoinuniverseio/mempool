const databaseConfig = { DATABASE: { ENABLED: true, SOCKET: '', TIMEOUT: 100 } };
const queryState = { query: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
const connection = {
  query: (...args: unknown[]) => queryState.query(...args),
  beginTransaction: async () => undefined,
  commit: () => queryState.commit(),
  rollback: () => queryState.rollback(),
  release: () => queryState.release(),
};
jest.mock('../config', () => ({ __esModule: true, default: databaseConfig }));
jest.mock('mysql2/promise', () => ({ createPool: () => ({
  on: () => undefined,
  query: (...args: unknown[]) => queryState.query(...args),
  getConnection: async () => connection,
}) }));
import db from '../database';

describe('native database completion drain', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('waits for driver completion after the query caller times out', /** @asyncUnsafe Jest owns the test. */ async () => {
    let complete!: () => void;
    let drained = false;
    queryState.query.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve([[], []]); }));
    const caller = db.query('INSERT INTO fixture VALUES (1)');
    const rejected = expect(caller).rejects.toThrow('failed to return');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    await rejected;
    const drain = db.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    complete();
    await drain;
    expect(drained).toBe(true);
  });

  it('waits for the transaction commit rather than its last query', /** @asyncUnsafe Jest owns the test. */ async () => {
    let commit!: () => void;
    let drained = false;
    queryState.commit.mockImplementationOnce(() => new Promise<void>(resolve => { commit = resolve; }));
    const transaction = db.$transaction(async () => 'written');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const drain = db.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    commit();
    expect(await transaction).toBe('written');
    await drain;
    expect(drained).toBe(true);
    expect(queryState.release).toHaveBeenCalled();
  });

  it('observes pending connection acquisition before the non-timeout driver call exists', /** @asyncUnsafe Jest owns the test. */ async () => {
    databaseConfig.DATABASE.TIMEOUT = 0;
    let acquire!: (value: unknown) => void;
    const acquisition = new Promise(resolve => { acquire = resolve; });
    const getPool = jest.spyOn(db as any, 'getPool').mockReturnValueOnce(acquisition);
    queryState.query.mockResolvedValueOnce([[], []]);
    let drained = false;
    try {
      const caller = db.query('INSERT INTO fixture VALUES (2)');
      const drain = db.drain().then(() => { drained = true; });
      await Promise.resolve();
      expect(drained).toBe(false);
      acquire(connection);
      await caller;
      await drain;
      expect(drained).toBe(true);
    } finally {
      getPool.mockRestore();
      databaseConfig.DATABASE.TIMEOUT = 100;
    }
  });

  it('does not treat a driver timeout as proof the server-side write completed', /** @asyncUnsafe Jest owns the test. */ async () => {
    let fresh: typeof db;
    jest.isolateModules(() => { fresh = require('../database').default; });
    const driverError = Object.assign(new Error('driver response timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT', fatal: true });
    queryState.query.mockRejectedValueOnce(driverError);
    await expect(fresh!.query('INSERT INTO fixture VALUES (3)')).rejects.toBe(driverError);
    await expect(fresh!.drain()).rejects.toThrow('driver-completion-lost');
  });

  it('keeps uncertain atomic query completion refused even after rollback reports success', /** @asyncUnsafe Jest owns the test. */ async () => {
    let fresh: typeof db;
    jest.isolateModules(() => { fresh = require('../database').default; });
    const driverError = Object.assign(new Error('response lost'), { code: 'ECONNRESET' });
    queryState.query.mockRejectedValueOnce(driverError);
    queryState.rollback.mockResolvedValueOnce(undefined);
    await expect(fresh!.$atomicQuery([{ query: 'INSERT INTO fixture VALUES (4)', params: [] }])).rejects.toBe(driverError);
    await expect(fresh!.drain()).rejects.toThrow('driver-completion-lost');
    expect(queryState.rollback).toHaveBeenCalled();
  });

  it('keeps a failed commit refused after a successful rollback', /** @asyncUnsafe Jest owns the test. */ async () => {
    let fresh: typeof db;
    jest.isolateModules(() => { fresh = require('../database').default; });
    const commitError = new Error('commit response unknown');
    queryState.commit.mockRejectedValueOnce(commitError);
    queryState.rollback.mockResolvedValueOnce(undefined);
    await expect(fresh!.$transaction(async () => 'written')).rejects.toBe(commitError);
    await expect(fresh!.drain()).rejects.toThrow('commit-failed');
  });
});
