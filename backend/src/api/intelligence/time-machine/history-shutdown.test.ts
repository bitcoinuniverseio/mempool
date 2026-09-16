import { boundedHistoryFlush } from './history-shutdown';
describe('bounded history shutdown', () => {
  it('awaits the actual durable flush', async () => {
    let resolve!: () => void; let finished=false;
    const pending=boundedHistoryFlush(()=>new Promise<void>(done=>resolve=done)).then(value=>{finished=true;return value;});
    await Promise.resolve(); expect(finished).toBe(false); resolve(); expect(await pending).toBe(true);
  });
  it('reports failure and bounds hung storage', async () => {
    expect(await boundedHistoryFlush(async()=>{throw new Error('disk');})).toBe(false);
    expect(await boundedHistoryFlush(()=>new Promise<void>(()=>undefined),10)).toBe(false);
  });
});
