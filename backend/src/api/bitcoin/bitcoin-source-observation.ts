import { IChainSyncState } from '../../mempool.interfaces';

/** Fee/live evidence must agree with the existing owned-node observation. */
export function bitcoinObservationMatches(
  observation: IChainSyncState | null | undefined,
  network: string,
  tip: { height: number; hash: string } | null | undefined,
  maxAgeMs: number,
  now = Date.now(),
  signetChallenge = process.env.UNIVERSE_SIGNET_CHALLENGE,
): boolean {
  const chains: Record<string, string> = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };
  if (!observation || !tip || !chains[network] || observation.chain !== chains[network]
    || observation.initialBlockDownload !== false || !Number.isSafeInteger(observation.blocks)
    || observation.blocks < 0 || observation.headers !== observation.blocks
    || tip.height !== observation.blocks || !/^[a-f0-9]{64}$/i.test(tip.hash)
    || tip.hash !== observation.blockHash) return false;
  const at = Date.parse(observation.checkedAt);
  return Number.isFinite(at) && at <= now && now - at < maxAgeMs
    && (network !== 'signet' || (typeof signetChallenge === 'string' && signetChallenge.length > 0
      && observation.signetChallenge === signetChallenge));
}
