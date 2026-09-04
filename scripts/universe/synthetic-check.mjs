#!/usr/bin/env node
/**
 * Synthetic production check for the three routes that shipped broken.
 *
 * The visual QA suite answers from fixtures, so it proves how a page renders
 * given data and nothing about whether the deployment can produce any. This
 * runs against a real origin with no interception: it asks the endpoints those
 * pages depend on and fails on the states that reached production unnoticed,
 * which all answered HTTP 200 or rendered a page that never finished loading.
 *
 * Usage:
 *   node scripts/universe/synthetic-check.mjs [origin]
 *   node scripts/universe/synthetic-check.mjs --base=<origin>
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

/**
 * Both spellings are accepted because the rest of this directory takes
 * --base and this one took a positional, and the mismatch is only ever
 * discovered while running it. Passing --base used to be read as the origin
 * itself, which failed several requests later with a URL parse error naming a
 * string nobody typed. Anything else is rejected now rather than quietly
 * treated as a hostname.
 */
function originFromArguments(argv) {
  const args = argv.slice(2);
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--base=')) {
      positional.push(arg.slice('--base='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option ${arg}; usage: synthetic-check.mjs [origin] or --base=<origin>`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    throw new Error(`expected one origin, got ${positional.length}`);
  }
  return positional[0];
}

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let requestedOrigin;
const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    requestedOrigin = originFromArguments(process.argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

export const ORIGIN = (requestedOrigin || process.env.UNIVERSE_ORIGIN || 'https://explorer.bitcoinuniverse.io').replace(/\/+$/, '');
export const REQUEST_TIMEOUT_MS = 10_000;

export const failures = [];
export const notes = [];
export const operationLog = [];

let currentPhase = 'initialization';
let lastSuccessfulPhase = 'none';
let releaseIdentitySeen = null;

export function setPhase(phase) {
  currentPhase = phase;
}

export function markPhaseSuccessful(phase) {
  lastSuccessfulPhase = phase;
}

export function getLastSuccessfulPhase() {
  return lastSuccessfulPhase;
}

export function getReleaseIdentitySeen() {
  return releaseIdentitySeen;
}

export function setReleaseIdentitySeen(id) {
  releaseIdentitySeen = id;
}

export function fail(check, detail) {
  failures.push(`${check}: ${detail}`);
}

export function pass(check, detail) {
  notes.push(`${check}: ${detail}`);
}

export async function executeSyntheticRequest({
  origin = ORIGIN,
  path: reqPath,
  method = 'GET',
  checkName = currentPhase,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxRetries = 1,
  headers = { accept: 'application/json' },
  fetchFn = globalThis.fetch,
} = {}) {
  const url = `${origin}${reqPath}`;
  const safeUrl = url.replace(/([?&]token=)[^&]+/g, '$1[REDACTED]');
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    const startTime = new Date().toISOString();
    const t0 = performance.now();
    let responseStatus = null;
    let safeExcerpt = '';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new Error(`Timeout of ${timeoutMs}ms exceeded`));
      }, timeoutMs);

      const response = await fetchFn(url, {
        method,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const totalMs = Math.round(performance.now() - t0);
      responseStatus = response.status;
      const text = await response.text();
      safeExcerpt = text.slice(0, 150).replace(/[\r\n\t]+/g, ' ');

      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      operationLog.push({
        checkName,
        method,
        url: safeUrl,
        startTime,
        durationMs: totalMs,
        deadlineMs: timeoutMs,
        attempt,
        status: responseStatus,
        safeExcerpt,
        releaseIdentitySeen,
        lastSuccessfulPhase,
        error: null,
      });

      // Deterministic 4xx or 2xx responses are NEVER retried
      if (responseStatus < 500 || method !== 'GET' || attempt > maxRetries) {
        return { status: responseStatus, body, text };
      }

      // Retry transient 5xx on GET if attempts remain
      await new Promise((r) => setTimeout(r, 100 * attempt));
    } catch (err) {
      const totalMs = Math.round(performance.now() - t0);
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || (err.message && err.message.includes('Timeout'));
      lastError = err;

      operationLog.push({
        checkName,
        method,
        url: safeUrl,
        startTime,
        durationMs: totalMs,
        deadlineMs: timeoutMs,
        attempt,
        status: null,
        safeExcerpt: null,
        releaseIdentitySeen,
        lastSuccessfulPhase,
        error: {
          name: err.name,
          message: err.message,
          isTimeout,
        },
      });

      // Deterministic failure or non-timeout network errors without retries
      if (!isTimeout || attempt > maxRetries) {
        const failureReason = isTimeout
          ? `TIMEOUT on ${method} ${safeUrl} after ${totalMs}ms (deadline: ${timeoutMs}ms, attempt ${attempt}/${maxRetries + 1}). Phase: "${checkName}". Last successful phase: "${lastSuccessfulPhase}". Reason: ${err.message}`
          : `NETWORK FAILURE on ${method} ${safeUrl} after ${totalMs}ms (attempt ${attempt}/${maxRetries + 1}). Phase: "${checkName}". Reason: ${err.message}`;

        fail(checkName, failureReason);
        return { status: isTimeout ? 504 : 502, body: null, text: '', error: err };
      }

      // Transient timeout retry backoff
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }

  return { status: 504, body: null, text: '', error: lastError };
}

export async function get(path, customTimeoutMs) {
  return executeSyntheticRequest({
    path,
    timeoutMs: customTimeoutMs || REQUEST_TIMEOUT_MS,
  });
}

/**
 * A feature the deployment advertises must have its routes mounted. This is
 * the exact contradiction that put a Charts page in front of routes that
 * answered 404.
 */
async function checkCapabilities() {
  const { status, body } = await get('/api/v1/capabilities');
  if (status !== 200 || !body?.features) {
    fail('capabilities', `expected a report, got HTTP ${status}`);
    return null;
  }
  for (const [name, feature] of Object.entries(body.features)) {
    if (feature.enabled && !feature.routesRegistered) {
      fail('capabilities', `${name} is enabled but its routes were never registered`);
    } else {
      pass('capabilities', `${name} enabled=${feature.enabled} state=${feature.state}`);
    }
  }
  return body;
}

/**
 * The addresses this check asks about, and why each one is here.
 *
 * Every assertion below is about shape and identity, never about a balance.
 * Anyone may pay any of these addresses at any time, so a check that pinned a
 * number would start failing on somebody else's transaction and teach whoever
 * reads the alerts to ignore them.
 */
const ADDRESS_SMOKE = [
  {
    address: '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3',
    label: 'p2pkh-historic',
    // The receiving output of the first Bitcoin transaction ever sent between
    // two people, block 170. Its history cannot be undone, so this is one of
    // the few addresses here that is required to have any.
    hasHistory: true,
  },
  {
    address: '1PuJjnF476W3zXfVYmJfGnouzFDAXakkL4',
    label: 'p2pkh',
    hasHistory: true,
  },
  {
    address: '33mapDgyY1XMs6wEts36p1ucR5e6irwRLv',
    label: 'p2sh',
    hasHistory: true,
  },
  {
    address: 'bc1qntndgqfx46wks63jep34cjk3pw63es86kp45c6',
    label: 'p2wpkh',
    hasHistory: true,
  },
  {
    address: 'bc1q5ejhdljezu47220c3rqs27aq5l0sfawcvyhqaadau7gfpeu8yassntm3wt',
    label: 'p2wsh',
    hasHistory: true,
  },
  {
    address: 'bc1pgtdpjs0l3l54l6072f9mh962g4nu5r500rfzsv39twxlalejjrjsq6u69p',
    label: 'taproot',
    hasHistory: true,
  },
  {
    // Four addresses above are outputs of block 900,000, one of each script
    // type. They are here rather than hand-picked favourites because a block
    // that is 900,000 deep is never coming back, so each of them permanently
    // has exactly the confirmed history this check needs and no maintenance.
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    label: 'genesis-coinbase',
    // The most-paid address on the chain. It is here because an address with
    // an enormous history is the case that used to be indistinguishable from
    // a broken backend, and it must now answer like any other.
    hasHistory: true,
    skipUtxo: true,
  },
  {
    address: 'bc1qq6hag67dl53wl99vzg42z8eyzfz2xlkvxechjp',
    label: 'unused',
    // An address nobody has any reason to have paid. A backend that answers
    // "unknown" as "zero" and one that has genuinely never seen this address
    // produce the same document, so what is checked is that the document is
    // well formed rather than what the numbers in it are.
    hasHistory: false,
  },
];

/**
 * The exact string from the production screenshot.
 *
 * It is not a valid address: the bech32 checksum does not verify, and Bitcoin
 * Core rejects it. That is the whole point of keeping it. This string is what
 * a reader gets when an address is mistyped or copied badly, and what the
 * public site did with it was answer "405 OK: Address lookups cannot be used
 * with bitcoind as backend" and then explain, underneath, that the address had
 * too many transactions for the backend to handle.
 *
 * Three claims, none of them true. The correct answer is that the string is
 * not an address, and that is what this holds the origin to.
 */
const MALFORMED_ADDRESS = 'bc1qcx70rmarfudyct7lx0ptrat2c5kgstghx2j69';

/** A whole number of satoshis, and never a string that merely looks like one. */
function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * The address family, asked for the way a reader's browser asks for it.
 *
 * This is the blind spot that let the defect ship. Every check in this file
 * covered charts, mining, protocols, chains and the live socket, and not one
 * of them ever asked this origin for an address. So the deployment served a
 * header inviting a reader to search an address, a search box that recognised
 * one, and an address page that answered 405 under a sentence blaming the
 * reader's own address, and every gate stayed green through all of it.
 */
async function checkAddressLookup(capabilities) {
  const feature = capabilities?.features?.addressLookup;
  if (!feature) {
    fail('address', 'this deployment publishes no address capability at all, so nothing states whether it can serve one');
    return;
  }
  if (feature.state !== 'ready') {
    fail('address', `address lookup is ${feature.state}: ${feature.degradedReason ?? 'no reason given'}`);
    return;
  }
  if (!feature.enabled || !feature.routesRegistered) {
    fail('address', 'address lookup reports ready while saying it is not enabled or has no routes');
    return;
  }
  // Ready means current, and the document has to be able to show its work.
  if (!isCount(feature.indexedTip) || !isCount(feature.bitcoinCoreTip)) {
    fail('address', 'address lookup reports ready without naming an indexed height and a chain height');
    return;
  }
  if (isCount(feature.maxLagBlocks) && feature.lagBlocks > feature.maxLagBlocks) {
    fail('address', `address lookup reports ready while ${feature.lagBlocks} blocks behind, past its limit of ${feature.maxLagBlocks}`);
    return;
  }
  pass('address', `index at block ${feature.indexedTip} of ${feature.bitcoinCoreTip} on ${feature.backendKind}`);

  for (const subject of ADDRESS_SMOKE) {
    await checkOneAddress(subject);
  }
  await checkAddressPagination();
  await checkMalformedAddressIsCalledMalformed();
}

/**
 * A string that is not an address has to be described as a string that is not
 * an address.
 *
 * This is the one from the screenshot. What must never happen again is the
 * origin answering it with a status that the page reads as a fact about the
 * amount of history it has, so the check is as much about what the answer is
 * not as about what it is.
 */
async function checkMalformedAddressIsCalledMalformed() {
  const { status, body, text } = await get(`/api/address/${MALFORMED_ADDRESS}`);
  if (status === 200) {
    fail('address', 'a string that is not an address was answered as though it were one');
    return;
  }
  if (status === 413) {
    fail('address', 'a malformed address was reported as having too much history, which is the defect this replaces');
    return;
  }
  if (status === 405) {
    fail('address', 'a malformed address answered 405, which means an address backend is still missing behind this origin');
    return;
  }
  if (status < 400 || status >= 500) {
    fail('address', `a malformed address answered HTTP ${status}, which says nothing a reader can act on`);
    return;
  }
  const said = (body?.error ?? text ?? '').toLowerCase();
  if (said.includes('too many transactions')) {
    fail('address', 'a malformed address was explained to the reader as having too many transactions');
    return;
  }
  pass('address', `a malformed address is refused with HTTP ${status} rather than blamed on its history`);
}

async function checkOneAddress({ address, label, hasHistory, skipUtxo }) {
  const summary = await get(`/api/address/${address}`);
  if (summary.status !== 200) {
    fail('address', `${label}: the summary answered HTTP ${summary.status}`);
    return;
  }
  if (summary.body?.address !== address) {
    fail('address', `${label}: the summary is about ${summary.body?.address ?? 'nothing'} rather than the address asked for`);
    return;
  }
  for (const section of ['chain_stats', 'mempool_stats']) {
    const stats = summary.body?.[section];
    if (!stats) {
      fail('address', `${label}: the summary has no ${section}`);
      return;
    }
    for (const field of ['funded_txo_count', 'funded_txo_sum', 'spent_txo_count', 'spent_txo_sum', 'tx_count']) {
      if (!isCount(stats[field])) {
        // An amount that arrives as a string, a float, or a missing value is
        // an amount this page would render wrong, and money rendered wrong is
        // worse than money not rendered.
        fail('address', `${label}: ${section}.${field} is ${JSON.stringify(stats[field])} rather than a whole number`);
        return;
      }
    }
  }
  pass('address', `${label}: summary answers with whole-number amounts`);

  const history = await get(`/api/address/${address}/txs`);
  if (history.status !== 200 || !Array.isArray(history.body)) {
    fail('address', `${label}: the first history page answered HTTP ${history.status}`);
    return;
  }
  if (hasHistory && history.body.length === 0) {
    fail('address', `${label}: the history came back empty for an address whose history cannot be undone`);
    return;
  }
  for (const transaction of history.body) {
    if (!/^[0-9a-f]{64}$/.test(transaction?.txid ?? '')) {
      fail('address', `${label}: a history entry does not name a transaction`);
      return;
    }
  }
  pass('address', `${label}: first history page carries ${history.body.length} transactions`);

  if (!skipUtxo) {
    const utxos = await get(`/api/address/${address}/utxo`);
    if (utxos.status !== 200 || !Array.isArray(utxos.body)) {
      fail('address', `${label}: the UTXO query answered HTTP ${utxos.status}`);
      return;
    }
    for (const utxo of utxos.body) {
      if (!/^[0-9a-f]{64}$/.test(utxo?.txid ?? '') || !isCount(utxo?.value)) {
        fail('address', `${label}: a UTXO does not name a transaction and a whole-number value`);
        return;
      }
    }
    pass('address', `${label}: UTXO query answers with ${utxos.body.length} outputs`);
  } else {
    pass('address', `${label}: UTXO query skipped for heavy genesis output set`);
  }
}

/**
 * The page after the first, on an address with enough history to have one.
 *
 * The browser must never be handed an address's whole confirmed history in a
 * single response, so the contract that matters is the cursor: page two has to
 * start after page one ended, and must not repeat what page one already
 * showed. A cursor that is silently ignored looks like a working page and
 * quietly serves the same transactions forever.
 */
async function checkAddressPagination() {
  // A burn address with far more history than one page can hold. Nobody
  // controls it, so its history only ever grows and never reorganises out
  // from under this check.
  const address = '1BitcoinEaterAddressDontSendf59kuE';
  const first = await get(`/api/address/${address}/txs`);
  if (first.status !== 200 || !Array.isArray(first.body)) {
    fail('address', `pagination: the first page answered HTTP ${first.status}`);
    return;
  }
  if (first.body.length === 0) {
    notes.push('address: pagination: the sample address has no history yet, skipping the cursor check');
    return;
  }
  if (first.body.length > 100) {
    fail('address', `pagination: the first page returned ${first.body.length} transactions, which is not a bounded page`);
    return;
  }
  const last = first.body[first.body.length - 1].txid;
  const second = await get(`/api/address/${address}/txs?after_txid=${last}`);
  if (second.status !== 200 || !Array.isArray(second.body)) {
    fail('address', `pagination: the second page answered HTTP ${second.status}`);
    return;
  }
  const firstPage = new Set(first.body.map((transaction) => transaction.txid));
  const repeated = second.body.filter((transaction) => firstPage.has(transaction.txid));
  if (repeated.length > 0) {
    fail('address', `pagination: the cursor was ignored and ${repeated.length} transactions came back twice`);
    return;
  }
  pass('address', `pagination: page one holds ${first.body.length} and page two starts after it`);
}

/**
 * Every route a page depends on must exist. A 404 here is a deployment
 * failure, never an empty state.
 */
async function checkRoutesExist(label, paths) {
  for (const path of paths) {
    const { status } = await get(path);
    if (status === 404) {
      fail(label, `${path} is not served by this deployment`);
    } else if (status >= 500) {
      fail(label, `${path} answered HTTP ${status}`);
    } else if (status !== 200) {
      fail(label, `${path} answered HTTP ${status}`);
    } else {
      pass(label, `${path} answers 200`);
    }
  }
}

/** The live chart must have real samples, not merely a route that answers. */
async function checkStatisticsHaveContent() {
  const { status, body } = await get('/api/v1/statistics/2h');
  if (status !== 200 || !Array.isArray(body)) {
    fail('charts', `the live range did not answer with a series (HTTP ${status})`);
    return;
  }
  if (body.length === 0) {
    fail('charts', 'the live range is empty, so the chart has nothing to draw');
    return;
  }
  const sample = body[0];
  if (typeof sample.added !== 'number' || !Array.isArray(sample.vsizes)) {
    fail('charts', 'a sample did not have the shape the chart renders');
    return;
  }
  pass('charts', `the live range has ${body.length} samples`);
}

/** Reward stats must be real numbers, not zeroes standing in for a failure. */
async function checkMiningHasContent() {
  const { status, body } = await get('/api/v1/mining/reward-stats/144');
  if (status !== 200 || !body) {
    fail('mining', `reward stats did not answer (HTTP ${status})`);
    return;
  }
  const reward = Number(body.totalReward);
  if (!Number.isFinite(reward) || reward <= 0) {
    fail('mining', `reward stats reported a total of ${body.totalReward}`);
  } else {
    pass('mining', `reward stats total ${body.totalReward} over blocks ${body.startBlock} to ${body.endBlock}`);
  }

  const pools = await get('/api/v1/mining/pools/1w');
  if (pools.status !== 200 || !Array.isArray(pools.body?.pools)) {
    fail('mining', `pool ranking did not answer with pools (HTTP ${pools.status})`);
  } else if (pools.body.pools.length === 0) {
    fail('mining', 'pool ranking is empty, so the page has no pools to rank');
  } else {
    pass('mining', `pool ranking lists ${pools.body.pools.length} pools`);
  }
}

/**
 * No protocol may be presented as readable while its authority cannot answer.
 * This is the Protocols page failure, checked at its source.
 */
async function checkProtocolsAreTruthful() {
  const protocols = await get('/api/v1/universe/protocols');
  const sources = await get('/api/v1/universe/sources');
  if (protocols.status !== 200 || !Array.isArray(protocols.body?.protocols)) {
    fail('protocols', `the registry did not answer (HTTP ${protocols.status})`);
    return;
  }
  if (sources.status !== 200 || !Array.isArray(sources.body?.sources)) {
    fail('protocols', `the source snapshot did not answer (HTTP ${sources.status})`);
    return;
  }

  const byAuthority = new Map(sources.body.sources.map((row) => [row.authorityId, row]));
  for (const protocol of protocols.body.protocols) {
    if (!String(protocol.releaseStatus || '').toUpperCase().startsWith('VERIFIED')) continue;
    const source = protocol.indexerAuthority ? byAuthority.get(protocol.indexerAuthority) : null;
    if (!source) {
      fail('protocols', `${protocol.id} is marked readable but its authority is not configured`);
      continue;
    }
    if (source.status === 'unreachable') {
      fail('protocols', `${protocol.id} is marked readable but its authority is ${source.status}`);
      continue;
    }
    if (source.status === 'degraded') {
      pass('protocols', `${protocol.id} authority ${source.authorityId} is currently degraded, ${source.lagBlocks ?? 'unknown'} blocks behind`);
      continue;
    }
    pass('protocols', `${protocol.id} authority ${source.authorityId} is ${source.status}, ${source.lagBlocks ?? 'unknown'} blocks behind`);
  }

  const readableAuthorities = new Set(
    protocols.body.protocols
      .filter((p) => String(p.releaseStatus || '').toUpperCase().startsWith('VERIFIED'))
      .map((p) => p.indexerAuthority)
      .filter(Boolean),
  );

  for (const source of sources.body.sources) {
    if (source.status === 'unconfigured' || source.status === 'unreachable') continue;
    if (!readableAuthorities.has(source.authorityId) && source.status !== 'ready') continue;
    if (!source.checkpoint && source.status === 'ready') {
      fail('protocols', `${source.authorityId} is ready but published no checkpoint`);
    }
  }
}

/** Frontend, backend and the published release must be the same build. */
async function checkReleaseAgreement() {
  const info = await get('/api/v1/backend-info');
  if (info.status !== 200 || !info.body?.gitCommit) {
    fail('release', `the backend did not report its commit (HTTP ${info.status})`);
    return;
  }
  setReleaseIdentitySeen(info.body.gitCommit);
  const configRes = await get('/resources/config.js');
  const config = configRes.text;
  const match = config ? config.match(/GIT_COMMIT_HASH\s*=\s*'([^']+)'/) : null;
  if (!match) {
    fail('release', 'the frontend did not publish a commit');
    return;
  }
  if (match[1] !== info.body.gitCommit) {
    fail('release', `the frontend serves ${match[1]} while the backend runs ${info.body.gitCommit}`);
  } else {
    pass('release', `frontend and backend both report ${match[1]}`);
  }
}


/**
 * The chain domain: three chains, their capability documents, and the routes
 * those documents claim.
 *
 * This is the check that was missing when it was most needed. Every chain
 * route answered 404 in production while the site itself loaded, because the
 * gateway sent everything outside /api/v1/universe to the Bitcoin backend, and
 * nothing here looked. It was found by hand.
 *
 * The distinction this has to keep is between a chain that cannot answer and a
 * chain that will not. A Dogecoin authority in an index recovery is a chain
 * truthfully reporting unavailable, and it must pass. A chain whose document
 * says it can answer while the route does not is a deployment fault, and it
 * must fail. Those two look identical if you only count HTTP statuses, which
 * is why the document is read first and the routes are checked against what it
 * claimed.
 */
const EXPLORER_CHAINS = ['bitcoin', 'dogecoin', 'zcash'];

/**
 * Reads the capability document declares, and the route each one implies.
 *
 * Only for the chains whose object reads the chain domain actually serves.
 * Bitcoin is not one of them: it declares the same reads and they are served
 * by the explorer backend at /api/tx and /api/block, which the rest of this
 * suite already exercises. Its chain-domain surface is status and mempool, and
 * those are checked directly.
 *
 * Address is absent because every chain has its own address alphabet and a
 * wrong one is rejected before the route is reached, which would prove
 * nothing. Fee estimates and projected blocks are not routes of their own.
 */
const CHAIN_OBJECT_READ_CHAINS = ['dogecoin', 'zcash'];
const CHAIN_READ_ROUTES = {
  transaction: (chain) => `/api/v1/${chain}/tx/${'0'.repeat(64)}`,
  block: (chain) => `/api/v1/${chain}/block/1`,
  outpoint: (chain) => `/api/v1/${chain}/outpoint/${'0'.repeat(64)}/0`,
};

/**
 * Telling a missing route from an absent object, both of which answer 404.
 *
 * This is the same distinction the whole product turns on, applied to the
 * check itself: "there is no such route" and "there is no such object" are
 * different answers, and collapsing them makes this either blind to a
 * misrouted family or noisy about every identifier that does not exist.
 *
 * The framework answers an unmounted path with "Cannot GET /some/path". A
 * service answering about an object names its own reason instead, such as
 * zcash-transaction-not-found. So the body decides, not the status.
 */
function isRouteMissing(body) {
  return typeof body?.message === 'string' && body.message.startsWith('Cannot GET');
}

function namedReason(body) {
  if (typeof body?.error === 'string' && body.error.includes('-')) {
    return body.error;
  }
  if (typeof body?.message === 'string') {
    return body.message;
  }
  return 'no reason given';
}

function chainEnvelopeProblems(chain, envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return ['no envelope'];
  }
  const problems = [];
  if (envelope.schemaVersion !== 'universe-chain-capability-v1') {
    problems.push(`schemaVersion is ${JSON.stringify(envelope.schemaVersion)}`);
  }
  if (envelope.chain !== chain) {
    problems.push(`chain is ${JSON.stringify(envelope.chain)}`);
  }
  if (envelope.network !== 'mainnet') {
    problems.push(`network is ${JSON.stringify(envelope.network)}`);
  }
  if (!envelope.reads || typeof envelope.reads !== 'object') {
    problems.push('no reads block');
  }
  if (!envelope.mempool || typeof envelope.mempool.state !== 'string') {
    problems.push('no mempool state');
  }
  // A tip may legitimately be null on a chain that cannot reach its node. What
  // it may not be is a shape nobody can read.
  if (envelope.tip !== null && typeof envelope.tip?.heightAtomic !== 'string') {
    problems.push('tip is neither null nor a checkpoint');
  }
  return problems;
}

/**
 * Every chain the product serves must be present by name. Three envelopes of
 * which one is a chain we do not serve passes a length check and is wrong.
 */
async function checkChainDirectory() {
  const { status, body } = await get('/api/v1/chains');
  if (status !== 200 || !Array.isArray(body)) {
    fail('chains', `/api/v1/chains answered HTTP ${status}`);
    return null;
  }
  const served = new Set(
    body.filter((entry) => entry && typeof entry.chain === 'string').map((entry) => entry.chain),
  );
  const missing = EXPLORER_CHAINS.filter((chain) => !served.has(chain));
  const unexpected = [...served].filter((chain) => !EXPLORER_CHAINS.includes(chain));
  for (const chain of missing) {
    fail('chains', `/api/v1/chains does not include ${chain}`);
  }
  if (unexpected.length) {
    fail('chains', `/api/v1/chains includes ${unexpected.join(', ')}, which this product does not serve`);
  }
  if (!missing.length && !unexpected.length) {
    pass('chains', `/api/v1/chains serves ${EXPLORER_CHAINS.join(', ')}`);
  }
  return served;
}

/**
 * A chain's own status route must answer, and its document must be readable
 * against the contract. A 200 carrying the wrong body is what a misrouted
 * route family looks like when something else happens to answer.
 */
async function checkChainStatus(chain) {
  const { status, body } = await get(`/api/v1/${chain}/status`);
  if (status !== 200) {
    fail(`chain:${chain}`, `/api/v1/${chain}/status answered HTTP ${status}`);
    return null;
  }
  const problems = chainEnvelopeProblems(chain, body);
  if (problems.length) {
    fail(`chain:${chain}`, `capability document is not readable: ${problems.join('; ')}`);
    return null;
  }
  const offered = Object.entries(body.reads || {})
    .filter(([, available]) => available === true)
    .map(([name]) => name);
  pass(
    `chain:${chain}`,
    `declares ${offered.length ? offered.join(', ') : 'no reads'}, confirmed history ${body.coverage?.confirmedHistory}`,
  );
  return body;
}

/**
 * Proof that a chain route family reaches the service that owns it.
 *
 * An invalid network query must be rejected by the chain API with a 400. The
 * Bitcoin backend, which is where these requests went when the gateway was
 * wrong, has no such route and answers 404. So a 400 proves the overlay saw
 * the request and a 404 proves it did not, which is exactly the failure that
 * shipped and that nothing here could see.
 *
 * The status route is used because it is the one route every chain has. An
 * earlier version sent a malformed txid, which works for Dogecoin and Zcash
 * and is wrong for Bitcoin: the chain domain gives Bitcoin only status and
 * mempool, and its transactions are served by the explorer backend at
 * /api/tx/:txid, so a 404 there was a correct answer being read as a fault.
 *
 * This runs whatever the chain's own health is: a chain in an index recovery
 * still has its routes mounted, and the point of this check is the wiring
 * rather than the data behind it.
 */
async function checkChainRoutingReachesTheOverlay(chain) {
  const path = `/api/v1/${chain}/status?network=not-a-network`;
  const { status } = await get(path);
  if (status === 400) {
    pass(`chain:${chain}`, 'chain routes reach the service that owns them');
  } else if (status === 404) {
    fail(`chain:${chain}`, `${path} answered 404, so this route family is not reaching the overlay`);
  } else {
    fail(`chain:${chain}`, `${path} answered HTTP ${status}, expected 400 for an invalid network`);
  }
}

/**
 * The reads a chain claims must actually be served.
 *
 * `reads` is a static statement of what kind of lookup this explorer offers
 * for a chain. It is not a promise that the lookup will succeed right now:
 * that lives in `coverage` and `degradedReasons`. Conflating the two is the
 * first mistake this check made, and it failed Dogecoin for telling the truth.
 *
 * So a 503 passes and is recorded. It is the authority saying it cannot answer,
 * with a named reason, which is exactly what the pages render. A 404 is the
 * route family missing, and a 500 or 502 is a fault; both fail.
 *
 * The identifiers are deliberately ones no chain has, an all-zero txid and
 * block one, so a 404 is expected. Whether that 404 means the route is missing
 * or the object is is read from the body rather than guessed from the status,
 * which is what isRouteMissing is for. The route family is also proved
 * independently by the invalid-network request above.
 */
async function checkChainReadsAreServed(chain, envelope) {
  if (!CHAIN_OBJECT_READ_CHAINS.includes(chain)) {
    return;
  }
  for (const [read, route] of Object.entries(CHAIN_READ_ROUTES)) {
    if (envelope.reads?.[read] !== true) {
      continue;
    }
    const path = route(chain);
    const { status, body } = await get(path);
    if (status === 503) {
      pass(`chain:${chain}`, `${read} is offered and currently unavailable: ${namedReason(body)}`);
    } else if (status === 404 && isRouteMissing(body)) {
      fail(`chain:${chain}`, `declares ${read} but ${path} is not served by this deployment`);
    } else if (status === 404) {
      pass(`chain:${chain}`, `${read} route answers, and has no such object: ${namedReason(body)}`);
    } else if (status >= 500) {
      fail(`chain:${chain}`, `declares ${read} but ${path} answered HTTP ${status}`);
    } else {
      pass(`chain:${chain}`, `${read} route answers HTTP ${status}`);
    }
  }
}

/**
 * Every chain document must name the build that produced it.
 *
 * The overlay resolves its release identifier and, when nothing supplied one,
 * used to fall back to the literal string `development`. Nothing set it: the
 * unit reads an environment file that never mentioned the variable, and no
 * example documented it. So production published `Release development` to the
 * public for as long as the field existed, and every check here passed while
 * it did, because none of them read the field.
 *
 * A placeholder is a legitimate answer from a workstation and never from the
 * public origin, which is the distinction this makes. The three chains are
 * served by one overlay process, so they must also agree: two different
 * release identifiers on one origin means two processes are answering, which
 * is a deployment fault of its own.
 */
const COMMIT_SHA = /^[0-9a-f]{7,64}$/;

/**
 * The dashboard data families behind the chain dashboard, mining, and
 * charts pages. Every route must be mounted and answer its own schema; a
 * missing route here is what a stale overlay looks like when the frontend
 * already advertises the page.
 *
 * Empty history is judged against the deployment's own claim: while the
 * dashboard reports historical statistics as backfilling, an empty block
 * list is honest and noted; once it reports ready, empty becomes a failure,
 * because a chart route answering 200 with nothing to draw is the exact
 * state this suite exists to catch.
 */
async function checkChainDashboardFamilies(chain) {
  const label = `chain:${chain}:dashboard`;
  const dashboard = await get(`/api/v1/${chain}/dashboard`);
  if (dashboard.status !== 200 || dashboard.body?.schemaVersion !== 'universe-chain-dashboard-v1') {
    fail(label, `/api/v1/${chain}/dashboard answered HTTP ${dashboard.status} (${namedReason(dashboard.body)})`);
    return;
  }
  const subsystems = Array.isArray(dashboard.body.subsystems) ? dashboard.body.subsystems : [];
  if (!subsystems.length) {
    fail(label, 'the dashboard names no subsystems, so nothing scopes a failure');
  } else {
    pass(label, `dashboard answers with ${subsystems.length} subsystem readings`);
  }
  const history = subsystems.find((entry) => entry?.id === 'historical-statistics');
  const historyReady = history?.state === 'ready';

  const blocks = await get(`/api/v1/${chain}/blocks/recent?limit=12`);
  if (blocks.status !== 200 || blocks.body?.schemaVersion !== 'universe-recent-blocks-v1') {
    fail(label, `/blocks/recent answered HTTP ${blocks.status} (${namedReason(blocks.body)})`);
  } else if (!Array.isArray(blocks.body.blocks) || blocks.body.blocks.length === 0) {
    if (historyReady) {
      fail(label, 'historical statistics claim ready while the block list is empty');
    } else {
      notes.push(`${label}: block history is still backfilling, list empty and said so`);
    }
  } else {
    const newest = blocks.body.blocks[0];
    if (typeof newest.heightAtomic !== 'string' || typeof newest.hash !== 'string') {
      fail(label, 'a recent block is missing its height or hash');
    } else {
      pass(label, `recent blocks answer, newest at height ${newest.heightAtomic}`);
    }
  }

  const fees = await get(`/api/v1/${chain}/fees`);
  if (fees.status !== 200 || fees.body?.schemaVersion !== 'universe-fee-recommendations-v1') {
    fail(label, `/fees answered HTTP ${fees.status} (${namedReason(fees.body)})`);
  } else if (fees.body.kind !== 'fee-per-kilobyte' && fees.body.kind !== 'zip-317') {
    fail(label, `fee guidance kind is ${JSON.stringify(fees.body.kind)}`);
  } else {
    pass(label, `fee guidance answers as ${fees.body.kind}`);
  }

  const mining = await get(`/api/v1/${chain}/mining`);
  if (mining.status !== 200 || mining.body?.schemaVersion !== 'universe-mining-summary-v1') {
    fail(label, `/mining answered HTTP ${mining.status} (${namedReason(mining.body)})`);
  } else {
    pass(label, `mining summary answers (difficulty ${mining.body.difficultyDecimal ?? 'not reported'})`);
  }

  const pools = await get(`/api/v1/${chain}/mining/pools?window=1w`);
  if (pools.status !== 200 || pools.body?.schemaVersion !== 'universe-mining-pools-v1') {
    fail(label, `/mining/pools answered HTTP ${pools.status} (${namedReason(pools.body)})`);
  } else if (!Array.isArray(pools.body.pools)) {
    fail(label, 'pool shares answered without a pools array');
  } else {
    pass(label, `pool shares answer with ${pools.body.pools.length} rows over ${pools.body.windowBlocksAtomic} blocks`);
  }

  for (const seriesId of ['block-fees', 'mempool-count']) {
    const series = await get(`/api/v1/${chain}/charts/${seriesId}?range=24h`);
    if (series.status !== 200 || series.body?.schemaVersion !== 'universe-chart-series-v1') {
      fail(label, `/charts/${seriesId} answered HTTP ${series.status} (${namedReason(series.body)})`);
      continue;
    }
    const points = (series.body.lines ?? []).reduce(
      (sum, line) => sum + (Array.isArray(line?.points) ? line.points.length : 0),
      0,
    );
    if (points === 0 && historyReady) {
      fail(label, `/charts/${seriesId} answered 200 with nothing to draw while history claims ready`);
    } else if (points === 0) {
      notes.push(`${label}: ${seriesId} has no samples yet, and history says it is backfilling`);
    } else {
      pass(label, `${seriesId} has ${points} drawable points over 24h`);
    }
  }
}

function checkChainReleaseIdentity(envelopes) {
  const named = new Map();
  for (const [chain, envelope] of envelopes) {
    const sha = envelope?.release?.sha;
    if (typeof sha !== 'string' || sha === '') {
      fail(`chain:${chain}`, 'the capability document names no release');
      continue;
    }
    if (sha === 'development') {
      fail(
        `chain:${chain}`,
        'the capability document reports its release as "development", which is the placeholder for a build that could not name itself. Set UNIVERSE_EXPLORER_RELEASE_SHA, or install a RELEASE-SHA file in the overlay release directory',
      );
      continue;
    }
    if (!COMMIT_SHA.test(sha)) {
      fail(`chain:${chain}`, `the release identifier ${JSON.stringify(sha)} is not a commit`);
      continue;
    }
    named.set(chain, sha);
  }
  if (named.size === 0) {
    return;
  }
  const distinct = new Set(named.values());
  if (distinct.size > 1) {
    const listed = [...named].map(([chain, sha]) => `${chain} ${sha}`).join(', ');
    fail('release', `the chain documents name different overlay releases: ${listed}`);
    return;
  }
  pass('release', `every chain document names overlay release ${[...distinct][0]}`);
}

/**
 * The live socket must accept the handshake a browser sends.
 *
 * The overlay refuses an upgrade whose Origin is not allowlisted, and allows
 * one sent with no Origin at all, which is exactly what curl sends. So every
 * probe reported the socket healthy while every real browser was refused and
 * the frontend fell back to its fifteen second poll. A handshake without an
 * Origin header proves nothing; this sends one.
 *
 * The cutover gate runs the same assertion against the loopback gateway. This
 * one runs against the public origin, which is the hop that gate cannot see,
 * and which is where the defect actually lived.
 *
 * Written against node:http rather than fetch, because fetch will not perform
 * an upgrade: it rejects the request outright, which reads as an unreachable
 * server rather than a refused handshake.
 */
async function checkLiveSocketAcceptsABrowser() {
  const url = new URL(`${ORIGIN}/api/v1/universe/ws`);
  const secure = url.protocol === 'https:';
  const transport = secure ? await import('node:https') : await import('node:http');
  const target = `${secure ? 'wss:' : 'ws:'}//${url.host}${url.pathname}`;

  const status = await new Promise((resolve) => {
    const request = transport.request(
      {
        host: url.hostname,
        port: url.port || (secure ? 443 : 80),
        path: url.pathname,
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          origin: ORIGIN,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        response.destroy();
        resolve(response.statusCode);
      },
    );
    // A successful upgrade never emits 'response'; it emits 'upgrade'.
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve('timeout');
    });
    request.on('error', (error) => resolve(`error ${error.message}`));
    request.end();
  });

  if (status === 101) {
    pass('live-socket', 'accepts a handshake carrying a browser Origin');
  } else if (status === 403) {
    fail('live-socket', `${target} refused a browser Origin with 403; every real browser falls back to polling`);
  } else {
    fail('live-socket', `${target} answered ${status}, expected 101`);
  }
}

export async function main() {
  console.log(`Synthetic check against ${ORIGIN}`);

  setPhase('capabilities');
  const capabilities = await checkCapabilities();
  if (capabilities) markPhaseSuccessful('capabilities');

  setPhase('release');
  await checkReleaseAgreement();
  markPhaseSuccessful('release');

  setPhase('protocols');
  await checkProtocolsAreTruthful();
  markPhaseSuccessful('protocols');

  setPhase('chains');
  const chains = await checkChainDirectory();
  if (chains) {
    const envelopes = [];
    for (const chain of EXPLORER_CHAINS) {
      await checkChainRoutingReachesTheOverlay(chain);
      const envelope = await checkChainStatus(chain);
      if (envelope) {
        envelopes.push([chain, envelope]);
        await checkChainReadsAreServed(chain, envelope);
      }
      if (chain !== 'bitcoin') {
        // The dashboard families run whether or not the status answered:
        // one red authority must not skip the rest of the matrix.
        await checkChainDashboardFamilies(chain);
      }
    }
    checkChainReleaseIdentity(envelopes);
  }
  markPhaseSuccessful('chains');

  setPhase('live-socket');
  await checkLiveSocketAcceptsABrowser();
  markPhaseSuccessful('live-socket');

  setPhase('address');
  await checkAddressLookup(capabilities);
  markPhaseSuccessful('address');

  if (capabilities?.features?.statistics?.enabled) {
    setPhase('charts');
    await checkRoutesExist('charts', [
      '/api/v1/statistics/2h',
      '/api/v1/statistics/24h',
      '/api/v1/statistics/1w',
    ]);
    await checkStatisticsHaveContent();
    markPhaseSuccessful('charts');
  } else {
    notes.push('charts: statistics are switched off in this deployment, skipping');
  }

  if (capabilities?.features?.mining?.enabled) {
    setPhase('mining');
    await checkRoutesExist('mining', [
      '/api/v1/mining/reward-stats/144',
      '/api/v1/mining/pools/1w',
      '/api/v1/mining/hashrate/3d',
      '/api/v1/mining/difficulty-adjustments',
    ]);
    await checkMiningHasContent();
    markPhaseSuccessful('mining');
  } else {
    notes.push('mining: block indexing is switched off in this deployment, skipping');
  }

  for (const note of notes) console.log(`  ok    ${note}`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} synthetic check(s) failed against ${ORIGIN}`);
    if (isDirectExecution) process.exit(1);
    return false;
  }
  console.log(`\nAll synthetic checks passed against ${ORIGIN}`);
  return true;
}

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Synthetic check could not run: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
