import { preflightFailures, type PreflightInput } from '../api/capabilities.preflight';

/**
 * The production incident these rules exist to prevent: the frontend shipped a
 * Charts page and a Mining dashboard while the backend had the database off, so
 * every request behind those pages answered 404 and the pages loaded forever.
 */

/**
 * Address lookup is a required capability on this product, so every coherent
 * fixture below carries a working address index. Removing it is what the
 * address tests do deliberately, and what production did by accident.
 */
const withAddressIndex = {
  addressBackend: 'esplora',
  esploraEndpointConfigured: true,
  esploraFallbacks: [],
} satisfies Pick<PreflightInput, 'addressBackend' | 'esploraEndpointConfigured' | 'esploraFallbacks'>;

const coherentWithData: PreflightInput = {
  statisticsEnabled: true,
  databaseEnabled: true,
  mempoolEnabled: true,
  indexingBlocksAmount: -1,
  ...withAddressIndex,
};

const coherentWithoutData: PreflightInput = {
  statisticsEnabled: false,
  databaseEnabled: false,
  mempoolEnabled: true,
  indexingBlocksAmount: 0,
  ...withAddressIndex,
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
      ...withAddressIndex,
    });
    expect(failures.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The failure in the screenshot that started this: an origin publicly offering
 * address search, running with `MEMPOOL.BACKEND` set to `none`, answering every
 * address with a 405 that the page then explained as the address having too
 * many transactions.
 *
 * Every gate the release ran was green. None of them had an opinion about
 * address lookup, so the state was not a bug that slipped through, it was a
 * state nothing was looking at. These are the tests that look.
 */
describe('address lookup preflight', () => {
  it('refuses a release with no address backend at all', () => {
    const failures = preflightFailures({ ...coherentWithData, addressBackend: 'none' });
    expect(failures.map((failure) => failure.feature)).toContain('addressLookup');
    expect(failures.some((failure) => failure.reason.includes('MEMPOOL.BACKEND is none'))).toBe(true);
  });

  it('refuses an Esplora backend with no endpoint configured', () => {
    const failures = preflightFailures({ ...coherentWithData, esploraEndpointConfigured: false });
    expect(failures.map((failure) => failure.feature)).toContain('addressLookup');
  });

  it('accepts an Electrum backend, which needs no Esplora endpoint', () => {
    const failures = preflightFailures({
      ...coherentWithData,
      addressBackend: 'electrum',
      esploraEndpointConfigured: false,
    });
    expect(failures.map((failure) => failure.feature)).not.toContain('addressLookup');
  });

  it('refuses a fallback that is not infrastructure this deployment runs', () => {
    // The names are deliberately neutral. The rule is an allowlist of loopback
    // and Unix sockets, so what it refuses is every host that is not this
    // machine, and spelling out a public explorer here would put a forbidden
    // origin in the tree to make a point the rule already makes. A private
    // address is in the list because "internal" is not the same as "ours": the
    // gate can prove a loopback endpoint is this host and can prove nothing
    // about anything else.
    for (const fallback of [
      'https://public-explorer.example.com/api',
      'hosted-esplora.example.net',
      'https://esplora.example.org',
      'http://10.0.0.5:3000',
    ]) {
      const failures = preflightFailures({ ...coherentWithData, esploraFallbacks: [fallback] });
      expect(
        failures.some((failure) => failure.feature === 'addressLookup' && failure.reason.includes(fallback)),
      ).toBe(true);
    }
  });

  it('accepts fallbacks that stay on this host', () => {
    const failures = preflightFailures({
      ...coherentWithData,
      esploraFallbacks: ['http://127.0.0.1:3002', '/var/run/universe-explorer/electrs.sock', 'http://localhost:3003'],
    });
    expect(failures.map((failure) => failure.feature)).not.toContain('addressLookup');
  });
});
