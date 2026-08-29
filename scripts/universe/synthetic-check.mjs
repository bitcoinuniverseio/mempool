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

let requestedOrigin;
try {
  requestedOrigin = originFromArguments(process.argv);
} catch (error) {
  process.stderr.write(`${error.message}
`);
  process.exit(2);
}

const ORIGIN = (requestedOrigin || process.env.UNIVERSE_ORIGIN || 'https://explorer.bitcoinuniverse.io').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 20_000;

const failures = [];
const notes = [];

function fail(check, detail) {
  failures.push(`${check}: ${detail}`);
}

function pass(check, detail) {
  notes.push(`${check}: ${detail}`);
}

async function get(path) {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
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
    if (source.status === 'unreachable' || source.status === 'degraded') {
      fail('protocols', `${protocol.id} is marked readable but its authority is ${source.status}`);
      continue;
    }
    pass('protocols', `${protocol.id} authority ${source.authorityId} is ${source.status}, ${source.lagBlocks ?? 'unknown'} blocks behind`);
  }

  for (const source of sources.body.sources) {
    if (source.status === 'unconfigured') continue;
    if (!source.checkpoint) {
      fail('protocols', `${source.authorityId} is configured but published no checkpoint`);
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
  const config = await fetch(`${ORIGIN}/resources/config.js`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then((response) => response.text());
  const match = config.match(/GIT_COMMIT_HASH\s*=\s*'([^']+)'/);
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

async function main() {
  console.log(`Synthetic check against ${ORIGIN}`);

  const capabilities = await checkCapabilities();
  await checkReleaseAgreement();
  await checkProtocolsAreTruthful();

  const chains = await checkChainDirectory();
  if (chains) {
    for (const chain of EXPLORER_CHAINS) {
      await checkChainRoutingReachesTheOverlay(chain);
      const envelope = await checkChainStatus(chain);
      if (envelope) {
        await checkChainReadsAreServed(chain, envelope);
      }
    }
  }
  await checkLiveSocketAcceptsABrowser();

  if (capabilities?.features?.statistics?.enabled) {
    await checkRoutesExist('charts', [
      '/api/v1/statistics/2h',
      '/api/v1/statistics/24h',
      '/api/v1/statistics/1w',
    ]);
    await checkStatisticsHaveContent();
  } else {
    notes.push('charts: statistics are switched off in this deployment, skipping');
  }

  if (capabilities?.features?.mining?.enabled) {
    await checkRoutesExist('mining', [
      '/api/v1/mining/reward-stats/144',
      '/api/v1/mining/pools/1w',
      '/api/v1/mining/hashrate/3d',
      '/api/v1/mining/difficulty-adjustments',
    ]);
    await checkMiningHasContent();
  } else {
    notes.push('mining: block indexing is switched off in this deployment, skipping');
  }

  for (const note of notes) console.log(`  ok    ${note}`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} synthetic check(s) failed against ${ORIGIN}`);
    process.exit(1);
  }
  console.log(`\nAll synthetic checks passed against ${ORIGIN}`);
}

main().catch((error) => {
  console.error(`Synthetic check could not run: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
