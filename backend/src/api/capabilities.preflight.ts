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
  return failures;
}
