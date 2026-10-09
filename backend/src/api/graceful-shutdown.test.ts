import { gracefulShutdown } from './graceful-shutdown';

describe('native graceful shutdown phase ordering', () => {
  it('retains late mining and database work past the former five-second exit window', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    const events: string[] = [];
    let finishMining!: () => void;
    let finishDriver!: () => void;
    const mining = new Promise<void>(resolve => { finishMining = resolve; });
    const driver = new Promise<void>(resolve => { finishDriver = resolve; });
    const shutdown = gracefulShutdown({
      stopAdmission: () => { events.push('admission-closed'); },
      drainProducers: async () => { await mining; events.push('mining-complete'); },
      drainDatabase: async () => { await driver; events.push('driver-complete'); },
      flushHistory: async () => { events.push('history-flushed'); },
      releaseResources: async () => { events.push('resources-released'); },
    });
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    expect(events).toEqual(['admission-closed']);
    finishMining();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(events).toEqual(['admission-closed', 'mining-complete']);
    finishDriver();
    await shutdown;
    expect(events).toEqual(['admission-closed', 'mining-complete', 'driver-complete', 'history-flushed', 'resources-released']);
    jest.useRealTimers();
  });

  it('never releases resources after an incomplete writer phase', /** @asyncUnsafe Jest owns the test. */ async () => {
    const releaseResources = jest.fn(async () => undefined);
    const flushHistory = jest.fn(async () => undefined);
    const error = new Error('writer completion refused');
    await expect(gracefulShutdown({
      stopAdmission: () => undefined,
      drainProducers: async () => { throw error; },
      drainDatabase: async () => undefined,
      flushHistory,
      releaseResources,
    })).rejects.toBe(error);
    expect(flushHistory).not.toHaveBeenCalled();
    expect(releaseResources).not.toHaveBeenCalled();
  });
});
