import { TimeMachineService } from './time-machine.service';

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };

describe('time machine history persistence cadence', () => {
  afterEach(() => { jest.useRealTimers(); });

  function service(): { history: any; write: jest.Mock; finish: Array<() => void> } {
    const finish: Array<() => void> = [];
    const write = jest.fn(() => new Promise<void>(resolve => finish.push(resolve)));
    const history = new TimeMachineService({ store: { read: () => null, write, close: jest.fn() } as any, network: 'signet', now: 1000, feed: () => ({}) });
    return { history, write, finish };
  }

  it('writes once per interval and re-arms when observations arrive during the write', async () => {
    jest.useFakeTimers();
    const { history, write, finish } = service();
    history.schedulePersistence();
    jest.advanceTimersByTime(5 * 60_000 - 1);
    expect(write).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    history.schedulePersistence(); // an observation lands while the encode is running
    finish[0]();
    await settle();
    expect(write).toHaveBeenCalledTimes(1); // not repeated back to back
    jest.advanceTimersByTime(5 * 60_000);
    expect(write).toHaveBeenCalledTimes(2);
    finish[1]();
    await settle();
  });

  it('still drains everything for a caller that awaits durability', async () => {
    jest.useFakeTimers();
    const { history, write, finish } = service();
    history.schedulePersistence();
    jest.advanceTimersByTime(5 * 60_000);
    history.schedulePersistence();
    const durable = history.flushHistory();
    let done = false;
    durable.then(() => { done = true; });
    finish[0]();
    await settle();
    expect(write).toHaveBeenCalledTimes(2); // the awaited flush writes what arrived meanwhile
    expect(done).toBe(false);
    finish[1]();
    await settle();
    expect(done).toBe(true);
  });
});
