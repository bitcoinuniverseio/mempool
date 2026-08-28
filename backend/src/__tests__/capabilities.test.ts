import { preflightFailures, type PreflightInput } from '../api/capabilities.preflight';

/**
 * The production incident these rules exist to prevent: the frontend shipped a
 * Charts page and a Mining dashboard while the backend had the database off, so
 * every request behind those pages answered 404 and the pages loaded forever.
 */

const coherentWithData: PreflightInput = {
  statisticsEnabled: true,
  databaseEnabled: true,
  mempoolEnabled: true,
  indexingBlocksAmount: -1,
};

const coherentWithoutData: PreflightInput = {
  statisticsEnabled: false,
  databaseEnabled: false,
  mempoolEnabled: true,
  indexingBlocksAmount: 0,
};

describe('deployment configuration preflight', () => {
  it('accepts a deployment that serves statistics and mining from a database', () => {
    expect(preflightFailures(coherentWithData)).toEqual([]);
  });

  it('accepts a deployment that serves neither, with the database off', () => {
    expect(preflightFailures(coherentWithoutData)).toEqual([]);
  });

  it('rejects statistics without a database, because the routes would never mount', () => {
    const failures = preflightFailures({ ...coherentWithData, databaseEnabled: false, indexingBlocksAmount: 0 });
    expect(failures.map((failure) => failure.feature)).toContain('statistics');
  });

  it('rejects statistics without the mempool backend collecting them', () => {
    const failures = preflightFailures({ ...coherentWithData, mempoolEnabled: false });
    expect(failures.map((failure) => failure.reason.includes('MEMPOOL.ENABLED'))).toContain(true);
  });

  it('rejects block indexing without a database, because mining routes would never mount', () => {
    const failures = preflightFailures({ ...coherentWithoutData, indexingBlocksAmount: 52560 });
    expect(failures.map((failure) => failure.feature)).toContain('mining');
  });

  it('rejects a database that nothing uses', () => {
    const failures = preflightFailures({ ...coherentWithoutData, databaseEnabled: true });
    expect(failures.map((failure) => failure.feature)).toContain('database');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const failures = preflightFailures({
      statisticsEnabled: true,
      databaseEnabled: false,
      mempoolEnabled: false,
      indexingBlocksAmount: 144,
    });
    expect(failures.length).toBeGreaterThanOrEqual(3);
  });
});
