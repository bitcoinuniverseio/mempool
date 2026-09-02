import { fetchElectrumTransactionPage } from './electrum-transaction-page';

describe('Electrum address transaction pages', () => {
  it(
    'loads a bounded page concurrently and preserves history order',
    /** @asyncUnsafe Test assertions handle rejection explicitly. */
    async () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      height: 100 - index,
      tx_hash: `tx-${index}`,
    }));
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];

    const fetchTransaction = jest.fn(
      /** @asyncUnsafe The outer test releases and observes every call. */
      async (txid: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return { txid };
      },
    );

    const pending = fetchElectrumTransactionPage(
      history,
      0,
      10,
      fetchTransaction,
      jest.fn(),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchTransaction).toHaveBeenCalledTimes(10);
    expect(maximumActive).toBe(10);
    releases.forEach((release) => release());

    await expect(pending).resolves.toEqual(
      history.slice(0, 10).map(({ tx_hash }) => ({ txid: tx_hash })),
    );
    },
  );
});
