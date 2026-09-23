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

/**
 * IMPLEMENTATION-HANDOFF [M23-NET] | defect F-M23-02 | coverage C-NET-EXPLICIT
 * Preparation only, 2026-09-23. Dependency: M23-BASE; coordinate all callers
 * of configuredChainNetworks and chainNetwork before changing their contract.
 * Verified at 079dc0d79755bc986bfae3288ffe0e479da3e1f6: malformed JSON or an
 * explicit unsupported network is dropped here, then chainNetwork defaults
 * to mainnet. chain-network.spec.ts deliberately asserts this for Dogecoin
 * signet/testnet3. This violates the requested separation of test and mainnet
 * contexts; it is not evidence of a transaction having been sent incorrectly.
 * Governing requirement: user brief network isolation (lines 41-49), with
 * Bitcoin Signet specified by BIP 325; do not infer Signet support for other
 * chains from Bitcoin's selector or from a generic list of network names.
 * 1. Preserve missing configuration and omitted-chain mainnet defaults, but
 * represent an explicitly invalid map/entry as a typed unavailable result
 * with a reason. Do not erase the error into an absent entry or substitute a
 * different network. Preserve valid entries independently where safe.
 * 2. Validate keys against the actual Explorer chain registry and each
 * authority's declared supported networks. Pin that registry contract first;
 * do not derive support from CHAIN_NETWORK_VALUES alone or invent new chains.
 * 3. Update callers to stop affected API requests, clear prior-context data,
 * and render a recoverable configuration error. Keep request/cache/query
 * identities chain-and-network bound; retry only after valid configuration.
 * 4. Extend chain-network.spec.ts with invalid JSON, invalid explicit network,
 * unknown chain, valid object/string, omitted defaults, and configuration
 * correction. Add consumer tests proving zero wrong-network requests and no
 * stale mainnet data after an invalid test-network selection or reconnect.
 * Commands (declared, not executed on SERVER in this preparation):
 * cd frontend; npm run test:ci -- src/app/universe/chain-network.spec.ts
 * npm run lint; npm run build:universe
 * Acceptance: explicit invalid input never becomes a mainnet request; absent
 * defaults stay mainnet; valid chain-specific testnet reads survive Bitcoin
 * selector changes, refresh and reconnect. Record actual supported-network
 * consumer evidence separately from unit tests. No mainnet test transactions.
 * Rollback: revert the coordinated parser/caller change together; preserve
 * production defaults and network-scoped caches. No database migration here.
 */
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
