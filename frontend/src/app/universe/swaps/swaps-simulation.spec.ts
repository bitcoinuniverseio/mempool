import { describe, expect, it, vi } from 'vitest';
import { simulateSwapRollback } from './swaps-simulation';
import { SwapsSimulateComponent } from './swaps-simulate.component';

vi.mock('@app/shared/shared.module', () => ({ SharedModule: class {} }));

describe('Explicitly local swap rollback simulation', () => {
  const input = { currentHeight: 200, lockupHeight: 198, timeoutHeight: 200, depth: 3, feeRate: 10, feeThreshold: 45 };
  it('displaces a lockup above the common ancestor and restores the refund wait', () => {
    expect(simulateSwapRollback(input)).toEqual({ status: 'simulation-only', ancestorHeight: 197, confirmations: 0,
      lockupDisplaced: true, refundHeightSatisfied: false, blocksUntilRefund: 3, belowHypotheticalFeeThreshold: true });
  });
  it('preserves unaffected confirmations and the BIP65 next-block height boundary', () => {
    expect(simulateSwapRollback({ ...input, depth: 0 })).toMatchObject({ confirmations: 3, refundHeightSatisfied: true, blocksUntilRefund: 0 });
  });
  it.each([{ depth: 201 }, { depth: 1.5 }, { feeRate: 0 }, { lockupHeight: 201 }, { timeoutHeight: 500000000 }])('rejects invalid input %j', changed => {
    expect(() => simulateSwapRollback({ ...input, ...changed })).toThrow();
  });
  it('connects the real form handler to the local simulation and clears stale results', () => {
    const component = new SwapsSimulateComponent(); component.run(); expect(component.result?.status).toBe('simulation-only');
    component.input.depth = 1000; component.run(); expect(component.result).toBeNull(); expect(component.error).not.toBe('');
  });
});
