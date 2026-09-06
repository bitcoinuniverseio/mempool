export interface SwapSimulationInput {
  currentHeight: number; lockupHeight: number; timeoutHeight: number; depth: number;
  feeRate: number; feeThreshold: number;
}

/** Hypothetical rollback to a common ancestor, with no replacement blocks yet. */
export function simulateSwapRollback(input: SwapSimulationInput) {
  for (const value of [input.currentHeight, input.lockupHeight, input.timeoutHeight, input.depth]) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 500000000) throw new Error('Heights and rollback depth must be integer block counts below 500000000.');
  }
  if (input.lockupHeight < 1 || input.timeoutHeight < 1 || input.lockupHeight > input.currentHeight || input.depth > input.currentHeight) {
    throw new Error('The lockup must be mined at or below the current height, with a positive timeout and a rollback no deeper than the chain.');
  }
  if (![input.feeRate, input.feeThreshold].every(value => Number.isFinite(value) && value > 0 && value <= 1000000)) {
    throw new Error('Fee rates must be positive values up to 1000000 sat/vB.');
  }
  const ancestorHeight = input.currentHeight - input.depth;
  return {
    status: 'simulation-only' as const,
    ancestorHeight,
    confirmations: Math.max(0, ancestorHeight - input.lockupHeight + 1),
    lockupDisplaced: input.lockupHeight > ancestorHeight,
    refundHeightSatisfied: ancestorHeight >= input.timeoutHeight,
    blocksUntilRefund: Math.max(0, input.timeoutHeight - ancestorHeight),
    belowHypotheticalFeeThreshold: input.feeRate < input.feeThreshold,
  };
}
