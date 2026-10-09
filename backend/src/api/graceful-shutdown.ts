export interface GracefulShutdownSteps {
  stopAdmission: () => void;
  drainProducers: () => Promise<void>;
  drainDatabase: () => Promise<void>;
  flushHistory: () => Promise<void>;
  releaseResources: () => Promise<void>;
}

/**
 * Shutdown has no deadline that turns unfinished writes into permission to exit.
 * Each owner must stop future admission before supplying its completion promise.
 * A failed phase rejects and never invokes the later resource release phase.
 * @asyncUnsafe The signal owner logs failure and holds the process for diagnosis.
 */
export async function gracefulShutdown(steps: GracefulShutdownSteps): Promise<void> {
  steps.stopAdmission();
  await steps.drainProducers();
  await steps.drainDatabase();
  await steps.flushHistory();
  await steps.releaseResources();
}
