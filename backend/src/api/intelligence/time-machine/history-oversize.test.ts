import { TimeMachineService } from './time-machine.service';
import { HistoryStore } from './history-store';
import { BlockExtended } from '../../../mempool.interfaces';

const block = (height: number): BlockExtended => ({ height, id: height.toString(16).padStart(64, '0'), timestamp: height, weight: 4000, extras: { totalFees: 500 } } as unknown as BlockExtended);

function service(write: (value: { checkpoints: unknown[] }) => Promise<void>) {
  const store = { read: () => null, write: jest.fn(write), close: () => undefined } as unknown as HistoryStore;
  const history = new TimeMachineService({ store, network: 'signet', now: 1000, feed: () => ({}) });
  for (let height = 1; height <= 8; height++) history.observeBlock(block(height), [], 1000 + height * 1000);
  return { history, store: store as unknown as { write: jest.Mock } };
}

describe('history larger than the store', () => {
  it('persists the newest checkpoints that fit', async () => {
    const { history, store } = service(async value => {
      if (value.checkpoints.length > 3) throw new Error('History snapshot exceeds the storage limit.');
    });
    await expect(history.flushHistory()).resolves.toBeUndefined();
    const written = store.write.mock.calls.at(-1)[0].checkpoints.map((entry: { checkpoint: { block_height: number } }) => entry.checkpoint.block_height);
    expect(written).toEqual([6, 7, 8]);
    expect(history.getCoverage().total_checkpoints).toBe(8);
    const attempts = store.write.mock.calls.length;
    history.observeBlock(block(9), [], 10_000);
    await history.flushHistory();
    expect(store.write).toHaveBeenCalledTimes(attempts + 1);
  });

  it('writes once per timer and leaves later observations for the next one', async () => {
    let release!: () => void;
    const { history, store } = service(() => new Promise<void>(resolve => { release = resolve; }));
    const timed = history.flushHistory(false);
    history.observeBlock(block(9), [], 10_000);
    release();
    await timed;
    expect(store.write).toHaveBeenCalledTimes(1);
    const drained = history.flushHistory();
    release();
    await drained;
    expect(store.write).toHaveBeenCalledTimes(2);
  });
});
