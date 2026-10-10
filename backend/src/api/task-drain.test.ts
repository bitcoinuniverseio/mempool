import { TaskDrain } from './task-drain';

describe('task completion drain', () => {
  it('waits for late child work after its parent settles', /** @asyncUnsafe Jest owns the test. */ async () => {
    const work = new TaskDrain();
    let finishParent!: () => void;
    let finishChild!: () => void;
    let drained = false;
    const parent = new Promise<void>(resolve => { finishParent = resolve; }).then(() => {
      work.track(new Promise<void>(resolve => { finishChild = resolve; }));
    });
    work.track(parent);
    const drain = work.drain().then(() => { drained = true; });
    finishParent();
    await parent;
    await Promise.resolve();
    expect(drained).toBe(false);
    finishChild();
    await drain;
    expect(drained).toBe(true);
  });

  it('keeps the caller failure while observing actual completion', /** @asyncUnsafe Jest owns the test. */ async () => {
    const work = new TaskDrain();
    const failure = new Error('transaction failed');
    const operation = work.track(Promise.reject(failure));
    await expect(operation).rejects.toBe(failure);
    await work.drain();
  });
});
