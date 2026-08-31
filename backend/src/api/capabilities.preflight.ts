/**
 * Configuration combinations that must never reach production traffic.
 *
 * This module deliberately imports nothing. The release gate, the unit tests,
 * and the running backend all judge the same rules, and none of them has to
 * open a database or start a timer to do it.
 */

/** A configuration combination that must never reach production traffic. */
export interface PreflightFailure {
  readonly feature: string;
  readonly reason: string;
}

/** The configuration facts the preflight rules judge. */
export interface PreflightInput {
  readonly statisticsEnabled: boolean;
  readonly databaseEnabled: boolean;
  readonly mempoolEnabled: boolean;
  readonly indexingBlocksAmount: number;
  /** Which address index this deployment reads, if any. */
  readonly addressBackend: 'none' | 'electrum' | 'esplora';
  /** An Esplora endpoint is named in configuration. */
  readonly esploraEndpointConfigured: boolean;
  /** Extra Esplora hosts this deployment would fall back to. */
  readonly esploraFallbacks: readonly string[];
}

/**
 * Returns every reason this configuration would put a broken public feature in
 * front of users. An empty list means the deployment is coherent.
 */
export function preflightFailures(input: PreflightInput): PreflightFailure[] {
  const failures: PreflightFailure[] = [];

  if (input.statisticsEnabled && !input.databaseEnabled) {
    failures.push({
      feature: 'statistics',
      reason: 'STATISTICS.ENABLED is true but DATABASE.ENABLED is false, so no statistics route can be served.',
    });
  }
  if (input.statisticsEnabled && !input.mempoolEnabled) {
    failures.push({
      feature: 'statistics',
      reason: 'STATISTICS.ENABLED is true but MEMPOOL.ENABLED is false, so nothing collects statistics.',
    });
  }
  if (input.indexingBlocksAmount !== 0 && !input.databaseEnabled) {
    failures.push({
      feature: 'mining',
      reason: 'INDEXING_BLOCKS_AMOUNT is set but DATABASE.ENABLED is false, so no mining route can be served.',
    });
  }
  if (input.databaseEnabled && input.indexingBlocksAmount === 0 && !input.statisticsEnabled) {
    failures.push({
      feature: 'database',
      reason: 'DATABASE.ENABLED is true but neither block indexing nor statistics uses it.',
    });
  }

  // Address lookup is not optional on this product. The header invites a
  // reader to search an address, the search box recognises one, and every link
  // out of a transaction goes to an address page. A deployment that cannot
  // answer those is not a reduced deployment, it is a broken one, and it
  // shipped once already because nothing here said so.
  if (input.addressBackend === 'none') {
    failures.push({
      feature: 'addressLookup',
      reason: 'MEMPOOL.BACKEND is none, so every address, script hash and UTXO lookup would fail while the site still offers them.',
    });
  }
  if (input.addressBackend === 'esplora' && !input.esploraEndpointConfigured) {
    failures.push({
      feature: 'addressLookup',
      reason: 'MEMPOOL.BACKEND is esplora but no ESPLORA endpoint is configured, so nothing would answer the address family.',
    });
  }
  // Data sovereignty: every address answer has to come from infrastructure we
  // run. A fallback is a source too, and a fallback is exactly where a public
  // API gets in unnoticed, because it only answers when something is already
  // wrong and nobody is reading the logs.
  for (const fallback of input.esploraFallbacks) {
    if (!isFirstPartyEndpoint(fallback)) {
      failures.push({
        feature: 'addressLookup',
        reason: `ESPLORA.FALLBACK names ${fallback}, which is not a loopback or Unix socket endpoint this deployment operates.`,
      });
    }
  }
  return failures;
}

/**
 * Whether an endpoint is one this host serves itself.
 *
 * Loopback and Unix sockets are the only shapes a first-party index takes in
 * this deployment. A name that resolves elsewhere might still be ours, but
 * nothing here can prove that, and a rule that cannot prove its answer is not
 * a rule worth having in a release gate.
 */
function isFirstPartyEndpoint(endpoint: string): boolean {
  if (endpoint.startsWith('/')) {
    return true;
  }
  let host: string;
  try {
    host = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`).hostname;
  } catch {
    return false;
  }
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
