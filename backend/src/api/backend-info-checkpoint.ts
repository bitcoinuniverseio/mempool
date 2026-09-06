import { BlockExtended, IIndexedCheckpoint } from '../mempool.interfaces';

/** Reads the completed cache tip as one block; Core's tip may be newer. */
export function indexedCheckpoint(
  cachedBlocks: readonly Pick<BlockExtended, 'id' | 'height'>[],
  network: IIndexedCheckpoint['network'] | 'liquid' | 'liquidtestnet',
): IIndexedCheckpoint | null {
  const tip = cachedBlocks[cachedBlocks.length - 1];
  if (!tip || !Number.isSafeInteger(tip.height) || tip.height < 0 ||
      typeof tip.id !== 'string' || !/^[a-f0-9]{64}$/i.test(tip.id)) {
    return null;
  }
  if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'liquid', 'liquidtestnet'].includes(network)) {
    return null;
  }
  return {
    chain: network === 'liquid' || network === 'liquidtestnet' ? 'liquid' : 'bitcoin',
    network: network === 'liquid' ? 'mainnet' : network === 'liquidtestnet' ? 'testnet' : network,
    heightAtomic: String(tip.height),
    blockHash: tip.id,
    // Observation of this cached block, not its mining time or Core's sample.
    observedAt: new Date().toISOString(),
  };
}
