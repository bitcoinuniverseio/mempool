import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import logger from '../../../logger';

/**
 * One place where the main loop hands every processed block, with its full
 * transactions, to the intelligence consumers: protocol activity, blockspace
 * composition, time machine checkpoints, the watchlist matcher. The loop
 * fetches each block once; the consumers read the same copy. A failing
 * consumer is logged and never stops the others or the loop.
 */
export type BlockObserver = (block: BlockExtended, transactions: TransactionExtended[]) => void | Promise<void>;

export class BlockObservationHub {
  private observers: { name: string; observe: BlockObserver }[] = [];

  public subscribe(name: string, observe: BlockObserver): void {
    this.observers.push({ name, observe });
  }

  public names(): string[] {
    return this.observers.map(observer => observer.name);
  }

  /** Runs every observer in order; each failure is contained and reported. */
  public async dispatch(block: BlockExtended, transactions: TransactionExtended[]): Promise<{ name: string; error: string }[]> {
    const failures: { name: string; error: string }[] = [];
    for (const observer of this.observers) {
      try {
        await observer.observe(block, transactions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ name: observer.name, error: message });
        logger.warn(`block observer ${observer.name} failed at ${block.height}: ${message}`);
      }
    }
    return failures;
  }
}

export const blockObservationHub = new BlockObservationHub();
