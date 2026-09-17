import { ExplorerChain, ExplorerNetwork } from './universe.types';

/**
 * The frontend env key that names which network each non-Bitcoin chain is
 * read from: a JSON object such as `{"dogecoin":"testnet"}`, either as an
 * object (mempool-frontend-config.json) or as a JSON string (a Docker
 * environment value). Bitcoin is never listed here: it follows the network
 * selector. A chain not listed reads mainnet, so the default `{}` leaves
 * production unchanged.
 */
export const UNIVERSE_CHAIN_NETWORKS_KEY = 'UNIVERSE_CHAIN_NETWORKS';

/** The networks a non-Bitcoin chain may be configured to. */
export const CHAIN_NETWORK_VALUES: readonly ExplorerNetwork[] = ['mainnet', 'testnet', 'regtest'];

export type ChainNetworkConfig = Readonly<Record<string, ExplorerNetwork>>;

type Env = { [UNIVERSE_CHAIN_NETWORKS_KEY]?: unknown } | undefined | null;

let lastRaw: unknown = undefined;
let lastParsed: ChainNetworkConfig = {};

/**
 * The validated chain network map from `env.UNIVERSE_CHAIN_NETWORKS`.
 *
 * Every entry is checked at read time: a chain other than dogecoin/zcash, a
 * network outside {@link CHAIN_NETWORK_VALUES}, or an unparseable value is
 * dropped with one console warning and that chain reads mainnet. The result
 * is memoized on the raw value so a page does not re-warn on every request.
 */
export function configuredChainNetworks(env: Env): ChainNetworkConfig {
  const raw = env?.[UNIVERSE_CHAIN_NETWORKS_KEY];
  if (raw === lastRaw) {return lastParsed;}
  lastRaw = raw;
  lastParsed = parse(raw);
  return lastParsed;
}

function parse(raw: unknown): ChainNetworkConfig {
  if (raw === undefined || raw === null || raw === '') {return {};}
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      warn('is not valid JSON; every chain reads mainnet.');
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warn('must be a JSON object such as {"dogecoin":"testnet"}; every chain reads mainnet.');
    return {};
  }
  const parsed: Record<string, ExplorerNetwork> = {};
  for (const [chain, network] of Object.entries(value as Record<string, unknown>)) {
    if (chain === 'bitcoin') {
      warn('cannot name a Bitcoin network; Bitcoin follows the network selector.');
    } else if (typeof network !== 'string' || !CHAIN_NETWORK_VALUES.includes(network as ExplorerNetwork)) {
      warn('names an unsupported network for ' + chain + ' (' + String(network) + '); ' + chain + ' reads mainnet.');
    } else {
      parsed[chain] = network as ExplorerNetwork;
    }
  }
  return parsed;
}

function warn(detail: string): void {
  // eslint-disable-next-line no-console
  console.warn(UNIVERSE_CHAIN_NETWORKS_KEY + ' ' + detail);
}

/**
 * The network a chain is read from: the selected Bitcoin network for Bitcoin,
 * the configured network for every other chain. The Bitcoin selector never
 * implies another chain's network.
 */
export function chainNetwork(chain: ExplorerChain | string, bitcoinNetwork: ExplorerNetwork, env: Env): ExplorerNetwork {
  if (chain === 'bitcoin') {return bitcoinNetwork;}
  return configuredChainNetworks(env)[chain] ?? 'mainnet';
}
