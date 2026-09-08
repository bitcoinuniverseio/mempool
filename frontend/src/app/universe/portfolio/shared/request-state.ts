/** A truthful terminal state for a surface composed from account requests. */
export type PortfolioRequestState = 'loading' | 'ready' | 'partial' | 'error';

export function completedRequestState(
  successfulCount: number,
  failedCount: number
): Exclude<PortfolioRequestState, 'loading'> {
  if (failedCount === 0) {
    return 'ready';
  }
  return successfulCount === 0 ? 'error' : 'partial';
}
