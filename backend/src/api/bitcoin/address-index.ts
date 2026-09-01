import axios from 'axios';
import http from 'http';
import config from '../../config';
import logger from '../../logger';
import { addressSummaryProblems, utxoListProblems } from './esplora-contract';

/**
 * What kind of address index this deployment reads, and whether it can answer.
 *
 * The address page is the one public surface whose backend is a separate piece
 * of infrastructure rather than a switch in this process. It can be absent,
 * present but still building, present and behind, or present and current, and
 * those are four different sentences to show a reader. Until this existed the
 * deployment could only say "enabled" and the page could only guess, which is
 * how an origin advertised address search while every address answered 405.
 *
 * The rule that decides between those states lives in `addressIndexState` and
 * nowhere else. The capability document, the release preflight, the cutover
 * verification and the production synthetic check all read the verdict rather
 * than each forming their own, because four interpretations of "ready" drift
 * and the drift is invisible until it is public.
 */

export type AddressBackendKind = 'none' | 'electrum' | 'esplora';

export type AddressIndexState = 'ready' | 'syncing' | 'degraded' | 'unavailable' | 'disabled';

/** Everything the state rule judges. Nothing here is a secret. */
export interface AddressIndexFacts {
  readonly backendKind: AddressBackendKind;
  /** An endpoint is named in configuration. */
  readonly configured: boolean;
  /** The endpoint answered at all. */
  readonly reachable: boolean;
  /** Height the index says it has indexed, or null when it did not say. */
  readonly indexedTip: number | null;
  /** Height Bitcoin Core reports, or null when Core did not answer. */
  readonly chainTip: number | null;
  /** A real address summary query returned a usable document. */
  readonly summaryAnswered: boolean;
  /** A real UTXO query returned a usable list. */
  readonly utxoAnswered: boolean;
  /** How far behind Core the index may be and still be called current. */
  readonly maxBehindTip: number;
}

export interface AddressIndexVerdict {
  readonly state: AddressIndexState;
  readonly lagBlocks: number | null;
  readonly degradedReason: string | null;
}

/**
 * The one definition of whether this deployment can serve address lookups.
 *
 * A listening port is not readiness. Neither is a process that started. The
 * index has to have answered a real address query, a real UTXO query, and be
 * within the accepted distance of the chain, or the page it backs is going to
 * tell somebody a wrong thing about their money.
 */
export function addressIndexState(facts: AddressIndexFacts): AddressIndexVerdict {
  const lagBlocks =
    facts.indexedTip !== null && facts.chainTip !== null
      ? Math.max(0, facts.chainTip - facts.indexedTip)
      : null;

  if (facts.backendKind === 'none') {
    return {
      state: 'disabled',
      lagBlocks,
      degradedReason: 'This deployment reads Bitcoin Core alone, which cannot answer address lookups.',
    };
  }
  if (!facts.configured) {
    return {
      state: 'unavailable',
      lagBlocks,
      degradedReason: 'An address backend is selected but no endpoint is configured for it.',
    };
  }
  if (!facts.reachable) {
    return {
      state: 'unavailable',
      lagBlocks,
      degradedReason: 'The address index did not answer.',
    };
  }
  if (facts.indexedTip === null) {
    return {
      state: 'degraded',
      lagBlocks,
      degradedReason: 'The address index answered but did not report an indexed height.',
    };
  }
  if (facts.chainTip === null) {
    return {
      state: 'degraded',
      lagBlocks,
      degradedReason: 'Bitcoin Core did not report a height, so the index cannot be held to it.',
    };
  }
  // Still building, or fallen behind far enough that its answers would be
  // wrong. Both are the same thing to a reader: the numbers on this page are
  // not the numbers on the chain, so do not show them.
  if (lagBlocks !== null && lagBlocks > facts.maxBehindTip) {
    return {
      state: 'syncing',
      lagBlocks,
      degradedReason: `The address index has reached block ${facts.indexedTip} of ${facts.chainTip}.`,
    };
  }
  if (!facts.summaryAnswered) {
    return {
      state: 'degraded',
      lagBlocks,
      degradedReason: 'The address index is current but an address summary query did not return a usable answer.',
    };
  }
  if (!facts.utxoAnswered) {
    return {
      state: 'degraded',
      lagBlocks,
      degradedReason: 'The address index is current but a UTXO query did not return a usable answer.',
    };
  }
  return { state: 'ready', lagBlocks, degradedReason: null };
}

/**
 * The address the readiness probe asks about.
 *
 * It is the receiving output of the first Bitcoin transaction ever sent
 * between two people, in block 170, January 2009. Nothing about that can be
 * undone, so the probe cannot start failing because somebody moved coins, and
 * its history is a handful of entries rather than a hundred thousand, so
 * asking about it costs the index almost nothing.
 *
 * The probe asserts shape and never a balance. Anyone may pay this address, so
 * its numbers are free to change and none of them means the index is broken.
 */
export const ADDRESS_PROBE = '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';

export interface AddressIndexProbe extends AddressIndexVerdict {
  readonly backendKind: AddressBackendKind;
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly indexedTip: number | null;
  readonly chainTip: number | null;
  readonly maxBehindTip: number;
  readonly summaryAnswered: boolean;
  readonly utxoAnswered: boolean;
  /** What the index says it was built from, when it says. Never an origin. */
  readonly sourceRelease: string | null;
}

/**
 * A dedicated client, deliberately not the one the rest of the backend uses.
 *
 * The shared Esplora client fails over between hosts and counts failures
 * towards its own health. A probe that borrowed it would both distort those
 * counts and be told what the router already believed rather than what the
 * index answers now.
 */
const probeConnection = axios.create({
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 2 }),
});

function esploraRequest(path: string, timeout: number): Promise<{ data: unknown; headers: Record<string, unknown> }> {
  return config.ESPLORA.UNIX_SOCKET_PATH
    ? probeConnection.get(`http://api${path}`, { socketPath: config.ESPLORA.UNIX_SOCKET_PATH as string, timeout })
    : probeConnection.get(`${config.ESPLORA.REST_API_URL}${path}`, { timeout });
}

export function addressBackendKind(): AddressBackendKind {
  const backend = config.MEMPOOL.BACKEND;
  return backend === 'esplora' || backend === 'electrum' ? backend : 'none';
}

function factsFor(
  backendKind: AddressBackendKind,
  maxBehindTip: number,
  chainTip: number | null,
  overrides: Partial<AddressIndexFacts> = {},
): AddressIndexFacts {
  return {
    backendKind,
    configured: false,
    reachable: false,
    indexedTip: null,
    chainTip,
    summaryAnswered: false,
    utxoAnswered: false,
    maxBehindTip,
    ...overrides,
  };
}

/**
 * Asks the configured address index what it can actually do right now.
 *
 * @asyncSafe
 */
export async function $probeAddressIndex(chainTip: number | null): Promise<AddressIndexProbe> {
  const backendKind = addressBackendKind();
  const maxBehindTip = config.ESPLORA.MAX_BEHIND_TIP ?? 2;
  const base = {
    backendKind,
    configured: false,
    reachable: false,
    indexedTip: null as number | null,
    chainTip,
    maxBehindTip,
    summaryAnswered: false,
    utxoAnswered: false,
    sourceRelease: null as string | null,
  };

  if (backendKind === 'none') {
    return { ...base, ...addressIndexState(factsFor(backendKind, maxBehindTip, chainTip)) };
  }

  // The Electrum path is served through the client this process already holds
  // open, so what there is to probe is that socket.
  //
  // This used to report configured and reachable and never an indexed height,
  // on the stated grounds that the deployment did not run on Electrum. It
  // does. The consequence was that addressLookup could only ever be degraded,
  // and since the cutover gate requires ready, every cutover on this host
  // switched, failed its own verification and rolled itself back. So the same
  // three questions the esplora branch answers are answered here: what height
  // does the index have, does a real address summary come back usable, and
  // does a real UTXO list.
  if (backendKind === 'electrum') {
    const configured = !!config.ELECTRUM.HOST && !!config.ELECTRUM.PORT;
    if (!configured) {
      return { ...base, ...addressIndexState(factsFor(backendKind, maxBehindTip, chainTip)) };
    }

    // Loaded here rather than at the top of the file. The state rule above is
    // pure and is imported by its own test in isolation; a top-level import of
    // the API factory drags the whole backend graph, and the compiled gbt
    // module with it, into anything that merely wants to reason about states.
    let client: {
      $getIndexedTip?: () => Promise<number | null>;
      $getAddress?: (address: string) => Promise<unknown>;
      $getAddressUtxos?: (address: string) => Promise<unknown>;
    };
    try {
      const { default: api } = await import('./bitcoin-api-factory');
      client = api as unknown as typeof client;
    } catch (e) {
      logger.debug('Address index probe could not load the Bitcoin API: ' + (e instanceof Error ? e.message : e));
      const facts = factsFor(backendKind, maxBehindTip, chainTip, { configured: true, reachable: false });
      return { ...base, configured: true, reachable: false, ...addressIndexState(facts) };
    }

    let reachable = false;
    let indexedTip: number | null = null;
    let summaryAnswered = false;
    let utxoAnswered = false;

    try {
      indexedTip = (await client.$getIndexedTip?.()) ?? null;
      reachable = indexedTip !== null;
    } catch (e) {
      logger.debug('Address index probe could not read the indexed height: ' + (e instanceof Error ? e.message : e));
    }

    if (reachable) {
      try {
        const summary = await client.$getAddress?.(ADDRESS_PROBE);
        summaryAnswered = addressSummaryProblems(summary, ADDRESS_PROBE).length === 0;
      } catch (e) {
        logger.debug('Address index probe could not read an address summary: ' + (e instanceof Error ? e.message : e));
      }
      try {
        const utxos = await client.$getAddressUtxos?.(ADDRESS_PROBE);
        utxoAnswered = utxoListProblems(utxos).length === 0;
      } catch (e) {
        logger.debug('Address index probe could not read a UTXO list: ' + (e instanceof Error ? e.message : e));
      }
    }

    const facts = factsFor(backendKind, maxBehindTip, chainTip, {
      configured: true,
      reachable,
      indexedTip,
      summaryAnswered,
      utxoAnswered,
    });
    return {
      ...base,
      configured: true,
      reachable,
      indexedTip,
      summaryAnswered,
      utxoAnswered,
      ...addressIndexState(facts),
    };
  }

  const configured = !!(config.ESPLORA.UNIX_SOCKET_PATH || config.ESPLORA.REST_API_URL);
  if (!configured) {
    return { ...base, ...addressIndexState(factsFor(backendKind, maxBehindTip, chainTip)) };
  }

  const timeout = config.ESPLORA.FALLBACK_TIMEOUT || 5000;
  let reachable = false;
  let indexedTip: number | null = null;
  let sourceRelease: string | null = null;
  let summaryAnswered = false;
  let utxoAnswered = false;

  try {
    const height = await esploraRequest('/blocks/tip/height', timeout);
    reachable = true;
    const parsed = Number(height.data);
    indexedTip = Number.isInteger(parsed) ? parsed : null;
    // electrs names the commit it was built from in this header and nowhere
    // else in its REST surface.
    const poweredBy = height.headers?.['x-powered-by'];
    if (typeof poweredBy === 'string') {
      const match = poweredBy.match(/([a-fA-F0-9]{5,40})/);
      sourceRelease = match ? match[1] : null;
    }
  } catch (e) {
    logger.debug('Address index probe could not read the indexed height: ' + (e instanceof Error ? e.message : e));
  }

  if (reachable) {
    try {
      const summary = await esploraRequest(`/address/${ADDRESS_PROBE}`, timeout);
      summaryAnswered = addressSummaryProblems(summary.data, ADDRESS_PROBE).length === 0;
    } catch (e) {
      logger.debug('Address index probe could not read an address summary: ' + (e instanceof Error ? e.message : e));
    }
    try {
      const utxos = await esploraRequest(`/address/${ADDRESS_PROBE}/utxo`, timeout);
      // 500 is the index's own default for the most unspent outputs it will
      // return for one address, and the same number the address page uses to
      // decide whether to ask at all. They are deliberately the same: a page
      // that asked for more than the index will ever give would show an error
      // for every large address and call it a failure.
      utxoAnswered = utxoListProblems(utxos.data).length === 0;
    } catch (e) {
      logger.debug('Address index probe could not read a UTXO list: ' + (e instanceof Error ? e.message : e));
    }
  }

  const facts = factsFor(backendKind, maxBehindTip, chainTip, {
    configured: true,
    reachable,
    indexedTip,
    summaryAnswered,
    utxoAnswered,
  });
  return {
    backendKind,
    configured: true,
    reachable,
    indexedTip,
    chainTip,
    maxBehindTip,
    summaryAnswered,
    utxoAnswered,
    sourceRelease,
    ...addressIndexState(facts),
  };
}
