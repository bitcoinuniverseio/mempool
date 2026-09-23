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

/**
 * The chains this map may name and the networks each one serves.
 *
 * Pinned to the overlay's request contract, backend-apis
 * `src/universe-explorer/contracts/explorer-context.ts` (NETWORKS), limited to
 * the chains this explorer reads: the two chain pages and Fractal, whose
 * CAT20 protocol page reads its sources and activity under chain=fractal. A
 * network the overlay would refuse is refused here too, before any request
 * is built. Bitcoin is absent on purpose: it follows the selector.
 */
export const CONFIGURABLE_CHAIN_NETWORKS: Readonly<Record<'dogecoin' | 'zcash' | 'fractal', readonly ExplorerNetwork[]>> = {
  dogecoin: ['mainnet', 'testnet', 'regtest'],
  zcash: ['mainnet', 'testnet', 'regtest'],
  fractal: ['mainnet', 'testnet'],
};

/** Every network any configurable chain accepts. */
export const CHAIN_NETWORK_VALUES: readonly ExplorerNetwork[] = ['mainnet', 'testnet', 'regtest'];

/**
 * The parsed map. `networks` holds the explicit valid entries; `invalid`
 * names each chain whose explicit entry was refused, with the reason; and
 * `mapError` is set when the value as a whole could not be read, which makes
 * every configurable chain unavailable rather than silently mainnet.
 */
export interface ChainNetworkConfig {
  readonly networks: Readonly<Record<string, ExplorerNetwork>>;
  readonly invalid: Readonly<Record<string, string>>;
  readonly mapError: string | null;
}

/**
 * The network a chain is read from, or why it has none: exactly one of
 * `network` and `reason` is set, as `available` says.
 */
export interface ChainNetworkResolution {
  readonly available: boolean;
  readonly network: ExplorerNetwork | null;
  readonly reason: string | null;
}

/**
 * Raised instead of a request when a chain's configured network is invalid.
 * Carries the chain and a readable reason so a page can say what is wrong
 * and that nothing was read, never a silent mainnet answer.
 */
export class ChainNetworkUnavailableError extends Error {
  constructor(readonly chain: string, readonly reason: string) {
    super('chain-network-unavailable');
    this.name = 'ChainNetworkUnavailableError';
  }
}

export function isChainNetworkUnavailable(error: unknown): error is ChainNetworkUnavailableError {
  return error instanceof ChainNetworkUnavailableError;
}

type Env = { [UNIVERSE_CHAIN_NETWORKS_KEY]?: unknown } | undefined | null;

const EMPTY: ChainNetworkConfig = Object.freeze({ networks: {}, invalid: {}, mapError: null });

let lastRaw: unknown = undefined;
let lastParsed: ChainNetworkConfig = EMPTY;

/**
 * The validated chain network map from `env.UNIVERSE_CHAIN_NETWORKS`.
 *
 * An absent or empty value is the production default: nothing configured,
 * every chain reads mainnet. A value that is present but wrong is kept as an
 * error, never dropped: unreadable JSON, a non-object, or a key naming a chain
 * this explorer does not configure (a typo for `dogecoin` must not leave
 * Dogecoin on mainnet) fails the whole map; an unsupported network fails that
 * one chain. The result is memoized on the raw value so a page does not
 * re-warn on every request.
 */
export function configuredChainNetworks(env: Env): ChainNetworkConfig {
  const raw = env?.[UNIVERSE_CHAIN_NETWORKS_KEY];
  if (raw === lastRaw) {return lastParsed;}
  lastRaw = raw;
  lastParsed = parse(raw);
  return lastParsed;
}

function parse(raw: unknown): ChainNetworkConfig {
  if (raw === undefined || raw === null || raw === '') {return EMPTY;}
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return mapFailure('is not valid JSON.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return mapFailure('must be a JSON object such as {"dogecoin":"testnet"}.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [chain] of entries) {
    if (chain === 'bitcoin') {
      return mapFailure('cannot name a Bitcoin network; Bitcoin follows the network selector.');
    }
    if (!hasOwn(CONFIGURABLE_CHAIN_NETWORKS, chain)) {
      return mapFailure('names ' + JSON.stringify(chain) + ', which is not a chain this explorer reads.');
    }
  }
  const networks: Record<string, ExplorerNetwork> = {};
  const invalid: Record<string, string> = {};
  for (const [chain, network] of entries) {
    const supported = CONFIGURABLE_CHAIN_NETWORKS[chain as keyof typeof CONFIGURABLE_CHAIN_NETWORKS];
    if (typeof network === 'string' && supported.includes(network as ExplorerNetwork)) {
      networks[chain] = network as ExplorerNetwork;
    } else {
      invalid[chain] = UNIVERSE_CHAIN_NETWORKS_KEY + ' names ' + JSON.stringify(network) + ' for ' + chain
        + ', which is not one of its networks (' + supported.join(', ') + ').';
      warn(invalid[chain]);
    }
  }
  return { networks, invalid, mapError: null };
}

function mapFailure(detail: string): ChainNetworkConfig {
  const reason = UNIVERSE_CHAIN_NETWORKS_KEY + ' ' + detail;
  warn(reason);
  return { networks: {}, invalid: {}, mapError: reason };
}

function warn(detail: string): void {
  // eslint-disable-next-line no-console
  console.warn(detail + ' Reads of the affected chain are stopped until the setting is corrected.');
}

/**
 * The network a chain is read from, or why it cannot be read: the selected
 * Bitcoin network for Bitcoin, the configured network for every other chain,
 * mainnet for a chain the map does not name. An explicit entry that is wrong
 * never becomes mainnet. The Bitcoin selector never implies another chain's
 * network.
 */
export function resolveChainNetwork(chain: ExplorerChain | string, bitcoinNetwork: ExplorerNetwork, env: Env): ChainNetworkResolution {
  if (chain === 'bitcoin') {return available(bitcoinNetwork);}
  const config = configuredChainNetworks(env);
  if (!hasOwn(CONFIGURABLE_CHAIN_NETWORKS, chain)) {
    return unavailable(JSON.stringify(chain) + ' is not a chain this explorer reads.');
  }
  if (config.mapError) {return unavailable(config.mapError);}
  if (hasOwn(config.invalid, chain)) {return unavailable(config.invalid[chain]);}
  return available(config.networks[chain] ?? 'mainnet');
}

function available(network: ExplorerNetwork): ChainNetworkResolution {
  return { available: true, network, reason: null };
}

function unavailable(reason: string): ChainNetworkResolution {
  return { available: false, network: null, reason };
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * {@link resolveChainNetwork} for a caller about to build a request: the
 * network, or a {@link ChainNetworkUnavailableError} so no request is sent.
 */
export function chainNetwork(chain: ExplorerChain | string, bitcoinNetwork: ExplorerNetwork, env: Env): ExplorerNetwork {
  const resolved = resolveChainNetwork(chain, bitcoinNetwork, env);
  if (!resolved.available || !resolved.network) {throw new ChainNetworkUnavailableError(chain, resolved.reason ?? 'unavailable');}
  return resolved.network;
}
