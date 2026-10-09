import axios from 'axios';
import { verifyAddressSource, AddressSourceCheckpoint } from './address-source-checkpoint';
import http from 'http';
import { bech32 } from 'bech32';
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
  readonly checkpoint?: AddressSourceCheckpoint | null;
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
/* IMPLEMENTATION-HANDOFF [WP-BE-004]
 * Defect BE-004; coverage COV-BE-004.source-network, readiness, failover.
 * Reproduction: backend-reproduce.cjs obtains ready from only height,
 * address-summary and UTXO reads, with no genesis/shared block hash check.
 * An index at 1000000 versus Core at 100 is also ready because lag clamps
 * to zero. A same-height fork/custom Signet can satisfy the existing facts.
 * 1. Add validated source identity and a shared checkpoint to these facts,
 *    probe results and capabilities. Read expected network/genesis from the
 *    owned node and compare the address index block hash at a shared height.
 *    Recheck the node tip around the reads; bounded retry handles normal tip
 *    movement. Validate safe nonnegative heights before computing lag.
 * 2. For Signet, bind the configured challenge as well as chain and genesis:
 *    BIP325 Signets share genesis, so a matching genesis is insufficient.
 *    If a reader cannot attest the required context, readiness is unavailable.
 * 3. Apply the same identity check separately to each Esplora failover host
 *    and Electrum backend before its data is served. Preserve owned endpoints
 *    and never substitute an unrelated public provider to pass the gate.
 * 4. Extend address-index/network/capabilities tests with equal-height forks,
 *    wrong genesis, custom Signet challenge, huge ahead height, normal one-
 *    block races, missing/malformed checkpoint and stale fallback. Exercise
 *    actual Signet node plus index restart/reorg and frontend source states.
 * Dependencies: AddressIndexFacts/Probe, capabilities.ts, backend-info.ts,
 * esplora-api.ts FailoverRouter, electrum-indexed-tip, gateway health contract.
 * Sources: R-BTC-06 (BIP325), R-BE-CORE (getblockchaininfo), owned index RPC.
 * Acceptance: ready proves the expected chain at an observed shared block;
 * height alone cannot establish identity and negative lag hides no mismatch.
 * Rollback: retain previous validated source and data checkpoint; disable
 * only an unverified source connection while restoring the compatible pair.
 * Preparation only; the existing readiness behavior remains unchanged.
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
  if (!Number.isSafeInteger(facts.indexedTip) || facts.indexedTip < 0 || !Number.isSafeInteger(facts.chainTip) || facts.chainTip < 0 || facts.indexedTip > facts.chainTip + 2) {
    return {state: 'degraded', lagBlocks: null, degradedReason: 'The address index reported an invalid or implausible height.'};
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
  if (!facts.checkpoint || facts.checkpoint.blockHeight !== Math.min(facts.indexedTip, facts.chainTip) || Date.now() - Date.parse(facts.checkpoint.verifiedAt) > 90000 || Date.parse(facts.checkpoint.verifiedAt) > Date.now() + 5000 || !/^[0-9a-f]{64}$/.test(facts.checkpoint.genesisHash) || !/^[0-9a-f]{64}$/.test(facts.checkpoint.blockHash) || !Number.isFinite(Date.parse(facts.checkpoint.verifiedAt))) {
    return {state: 'degraded', lagBlocks, degradedReason: 'The address source has no verified active-chain checkpoint.'};
  }
  return { state: 'ready', lagBlocks, degradedReason: null };
}

/**
 * The address the readiness probe asks about.
 *
 * This fixed P2WPKH hash is the first 20 bytes of SHA256 of
 * "Universe Explorer health probe v1". It has no assigned wallet or signer.
 * A capability check measures responsive canonical reads; the release gate
 * separately checks the populated historical address and must remain intact.
 *
 * The probe asserts shape and never a balance. Anyone may pay this address, so
 * its numbers are free to change and none of them means the index is broken.
 */
export const ADDRESS_PROBE = bech32.encode('bc', [0, ...bech32.toWords(Buffer.from('00f989dec2228b0b15755ab98e6de0adaf978e00', 'hex'))]);

/** A valid read-only probe for the configured chain; no balance is assumed. */
export function addressProbeForNetwork(network: string): string {
  if (network === 'mainnet') return ADDRESS_PROBE;
  const prefixes: Record<string, string> = {
    testnet: 'tb', testnet4: 'tb', signet: 'tb', regtest: 'bcrt',
    liquid: 'ex', liquidtestnet: 'tex',
  };
  const prefix = prefixes[network];
  if (!prefix) throw new Error(`Unsupported address probe network: ${network}`);
  return bech32.encode(prefix, [0, ...bech32.toWords(Buffer.alloc(20))]);
}

export interface AddressIndexProbe extends AddressIndexVerdict {
  readonly backendKind: AddressBackendKind;
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly indexedTip: number | null;
  readonly chainTip: number | null;
  readonly maxBehindTip: number;
  readonly checkpoint?: AddressSourceCheckpoint | null;
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
  maxRedirects: 0,
  proxy: false,
});

function esploraRequest(path: string, timeout: number, signal?: AbortSignal): Promise<{ data: unknown; headers: Record<string, unknown> }> {
  return config.ESPLORA.UNIX_SOCKET_PATH
    ? probeConnection.get(`http://api${path}`, { socketPath: config.ESPLORA.UNIX_SOCKET_PATH as string, timeout, signal })
    : probeConnection.get(`${config.ESPLORA.REST_API_URL}${path}`, { timeout, signal });
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
 * IMPLEMENTATION-HANDOFF [API-01] [API-01-CALLERS]
 * DEF-CANCEL; C-HTTP-ADDRESS. Both Electrum and Esplora verification callers
 * currently drop this function's AbortSignal. Together with a synchronous
 * Electrum read callback this can escape the optional probe and kill the app.
 * 1. Integrate candidate 87859cf9f69e4166bdd783a4472c6674a2ef24c3 with the
 *    paired address-source-checkpoint.ts change, passing signal as argument5
 *    from BOTH verifyAddressSource invocations. Keep failed proof degraded.
 * 2. Preserve address-read isolation/backpressure and existing owned-node
 *    checks; a healthy TCP listener is not summary/UTXO/checkpoint acceptance.
 * 3. Run the candidate's exact address-source checkpoint/capability/RPC tests,
 *    including caller cancellation and fresh retry; verify no fatal rejection
 *    and no cross-network cached result. API-02 routing qualification follows.
 * Evidence/rollback: API-01-CANCEL and VERIFICATION.md in the SERVER handoff.
 */
/**
 * Asks the configured address index what it can actually do right now.
 *
 * @asyncSafe
 */
export async function $probeAddressIndex(chainTip: number | null, signal?: AbortSignal): Promise<AddressIndexProbe> {
  const active = (): void => { if (signal?.aborted) throw new Error('Address index probe cancelled'); };
  active();
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

  const probeAddress = addressProbeForNetwork(config.MEMPOOL.NETWORK);

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
      $getIndexBlockHash?: (height: number) => Promise<string>;
      $getIndexedTip?: () => Promise<number | null>;
      $getAddress?: (address: string, signal?: AbortSignal) => Promise<unknown>;
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
      active();
      indexedTip = (await client.$getIndexedTip?.()) ?? null;
      reachable = indexedTip !== null;
    } catch (e) {
      logger.debug('Address index probe could not read the indexed height: ' + (e instanceof Error ? e.message : e));
    }

    if (reachable) {
      // Independent reads share the capability deadline. Serializing them can
      // exhaust that budget even when both canonical address routes answer.
      try { await Promise.all([
        (async (): Promise<void> => {
          try {
            active();
            const summary = await client.$getAddress?.(probeAddress, signal);
            active();
            summaryAnswered = addressSummaryProblems(summary, probeAddress).length === 0;
          } catch (e) {
            logger.debug('Address index probe could not read an address summary: ' + (e instanceof Error ? e.message : e));
          }
        })(),
        (async (): Promise<void> => {
          try {
            active();
            const utxos = await client.$getAddressUtxos?.(probeAddress);
            active();
            utxoAnswered = utxoListProblems(utxos).length === 0;
          } catch (e) {
            logger.debug('Address index probe could not read a UTXO list: ' + (e instanceof Error ? e.message : e));
          }
        })(),
      ]); } catch (e) {
        summaryAnswered = false;
        utxoAnswered = false;
        logger.debug('Address index probe could not complete both reads: ' + (e instanceof Error ? e.message : e));
      }
    }

    let checkpoint: AddressSourceCheckpoint | null = null;
    try { active(); checkpoint = await verifyAddressSource(indexedTip, height => { active(); return client.$getIndexBlockHash!(height); }, undefined, undefined, signal); } catch { /* Unverified source stays degraded. */ }
    const facts = factsFor(backendKind, maxBehindTip, chainTip, {
      checkpoint,
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
      checkpoint: facts.checkpoint,
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
    active();
    const height = await esploraRequest('/blocks/tip/height', timeout, signal);
    reachable = true;
    const parsed = Number(height.data);
    indexedTip = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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
      active();
      const summary = await esploraRequest(`/address/${probeAddress}`, timeout, signal);
      summaryAnswered = addressSummaryProblems(summary.data, probeAddress).length === 0;
    } catch (e) {
      logger.debug('Address index probe could not read an address summary: ' + (e instanceof Error ? e.message : e));
    }
    try {
      active();
      const utxos = await esploraRequest(`/address/${probeAddress}/utxo`, timeout, signal);
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

  let checkpoint: AddressSourceCheckpoint | null = null;
  try { checkpoint = await verifyAddressSource(indexedTip, async (height, signal) => (await esploraRequest('/block-height/' + height, timeout, signal)).data, undefined, undefined, signal); } catch { /* Unverified source stays degraded. */ }
  const facts = factsFor(backendKind, maxBehindTip, chainTip, {
    checkpoint,
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
    checkpoint,
    ...addressIndexState(facts),
  };
}
