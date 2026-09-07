import { ElectrumDeadlineError, withElectrumDeadline } from '../api/bitcoin/electrum-deadline';

describe('electrum request deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes a timely answer through unchanged', async () => {
    const answer = withElectrumDeadline(Promise.resolve({ height: 965905 }), 'blockchain.headers.subscribe', 1000);
    await expect(answer).resolves.toEqual({ height: 965905 });
  });

  it('passes a timely failure through unchanged', async () => {
    const answer = withElectrumDeadline(Promise.reject(new Error('close connect')), 'blockchain.scripthash.get_history', 1000);
    await expect(answer).rejects.toThrow('close connect');
  });

  it('rejects a request the server never answers', async () => {
    const answer = withElectrumDeadline(new Promise<never>(() => undefined), 'blockchain.scripthash.get_balance', 1000);
    const settled = expect(answer).rejects.toBeInstanceOf(ElectrumDeadlineError);
    jest.advanceTimersByTime(1000);
    await settled;
    await expect(answer).rejects.toThrow('blockchain.scripthash.get_balance did not answer within 1000 ms');
  });

  it('does not keep a timer alive after the answer arrives', async () => {
    await withElectrumDeadline(Promise.resolve(1), 'blockchain.transaction.get_merkle', 1000);
    expect(jest.getTimerCount()).toBe(0);
  });
});
