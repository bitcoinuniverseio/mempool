import type { LocalPortfolio } from '../stores/portfolio-model';

/** Public/watch-only accounts remain source-backed even before discovery completes. */
export function isLocalOnlyPortfolio(portfolio: LocalPortfolio | null): boolean {
  return portfolio !== null && portfolio.accounts.every(account => account.kind === 'manual');
}
