export interface GracefulShutdownSteps {
  stopAdmission: () => void;
  drainProducers: () => Promise<void>;
  drainDatabase: () => Promise<void>;
  flushHistory: () => Promise<void>;
  releaseResources: () => Promise<void>;
}

/** Records the current phase and the owners whose completion is still pending. */
export class ShutdownProgress {
  phase = 'stopAdmission';
  private readonly pending = new Set<string>();

  /** @asyncSafe Returns the same settlement; only bookkeeping is added. */
  track<T>(owner: string, work: Promise<T>): Promise<T> {
    this.pending.add(owner);
    return work.finally(() => { this.pending.delete(owner); });
  }

  describe(): string {
    return this.pending.size ? `${this.phase} (waiting on: ${[...this.pending].join(', ')})` : this.phase;
  }
}

/**
 * Each owner must stop future admission before supplying its completion promise.
 * A failed phase rejects and never invokes the later resource release phase.
 * The signal owner bounds the whole sequence with its own exit deadline; every
 * persisted snapshot is replaced by atomic rename, so an exit at any await
 * leaves the previous complete snapshot in place.
 * @asyncUnsafe The signal owner logs failure and holds the process until its deadline.
 */
export async function gracefulShutdown(steps: GracefulShutdownSteps, progress = new ShutdownProgress()): Promise<void> {
  progress.phase = 'stopAdmission';
  steps.stopAdmission();
  progress.phase = 'drainProducers';
  await steps.drainProducers();
  progress.phase = 'drainDatabase';
  await steps.drainDatabase();
  progress.phase = 'flushHistory';
  await steps.flushHistory();
  progress.phase = 'releaseResources';
  await steps.releaseResources();
  progress.phase = 'complete';
}
