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

async function main() {
  console.log(`Synthetic check against ${ORIGIN}`);

  const capabilities = await checkCapabilities();
  await checkReleaseAgreement();
  await checkProtocolsAreTruthful();

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
