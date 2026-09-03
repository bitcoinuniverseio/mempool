/** @asyncUnsafe The caller owns request-level error handling. */
export async function fetchElectrumTransactionPage<T>(
  history: readonly Readonly<{ tx_hash: string }>[],
  startingIndex: number,
  endIndex: number,
  fetchTransaction: (txid: string) => Promise<T>,
  setProgress: (progress: number) => void,
): Promise<T[]> {
  const page = history.slice(startingIndex, endIndex);
  if (page.length === 0) {
    setProgress(100);
    return [];
  }

  let completed = 0;
  return Promise.all(page.map(
    /** @asyncUnsafe The request-level caller handles transaction failures. */
    async ({ tx_hash }) => {
    const transaction = await fetchTransaction(tx_hash);
    completed += 1;
    setProgress(completed / page.length * 100);
    return transaction;
    },
  ));
}
