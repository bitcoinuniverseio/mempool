/**
 * Regression gate for the multichain parity release.
 *
 * Every case here pins a structural fact that once failed in production or
 * that a cleanup could plausibly reintroduce: a navigation item gated back
 * to Bitcoin, a section dropped from the route registry, a dashboard whose
 * data request went back to answering nothing, cubes losing their heights,
 * or Bitcoin units wearing another chain's name. These read the source
 * rather than a build, so they run in seconds and fail with the file named.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('Mining and Charts navigation are not gated to Bitcoin', () => {
  const nav = read('frontend/src/app/components/master-page/master-page.component.html');
  const miningItem = nav.match(/<li class="nav-item mining"[\s\S]*?<\/li>/)?.[0] ?? '';
  assert.ok(miningItem.length, 'the mining navigation item exists');
  assert.ok(
    !/\*ngIf="activeChain === 'bitcoin'/.test(miningItem),
    'the mining item must not require activeChain to be bitcoin',
  );
  assert.match(miningItem, /chainRoute\('mining'\)/,
    'the mining item routes through the chain-aware registry');
  const graphsItem = nav.match(/id="btn-graphs"[\s\S]*?<\/li>/)?.[0] ?? '';
  assert.ok(
    !/activeChain === 'bitcoin'"/.test(graphsItem.split('>')[0]),
    'the charts item must not be hidden on other chains',
  );
  assert.match(graphsItem, /chainRoute\('graphs'\)/);
});

test('Docs navigation stays inside the selected chain', () => {
  const nav = read('frontend/src/app/components/master-page/master-page.component.html');
  const docsItem = nav.match(/id="btn-docs"[\s\S]*?<\/li>/)?.[0] ?? '';
  assert.match(docsItem, /chainRoute\('docs'\)/,
    'a Dogecoin or Zcash reader who opens Docs must get chain docs');
});

test('the route category registry keeps every product section', () => {
  const routing = read('frontend/src/app/universe/universe-chain-routing.ts');
  for (const section of ['dashboard', 'mining', 'mempool', 'protocols', 'graphs', 'docs']) {
    assert.ok(
      routing.includes(`'${section}'`),
      `route category registry names ${section}`,
    );
  }
});

test('the multichain route table mounts mining, graphs, and docs', () => {
  const module_ = read('frontend/src/app/universe/multichain-explorer/multichain-explorer.module.ts');
  assert.match(module_, /path: 'mining'/);
  assert.match(module_, /path: 'graphs'/);
  assert.match(module_, /path: 'docs'/);
  assert.match(module_, /chain-graphs\.module/);
  assert.match(module_, /chain-docs\.module/);
});

test('the dashboard requests real data, not of(null)', () => {
  const multichain = read('frontend/src/app/universe/multichain-explorer/multichain-explorer.component.ts');
  assert.ok(
    !multichain.includes("case 'dashboard':"),
    'the status-report component no longer owns the dashboard',
  );
  const dashboard = read('frontend/src/app/universe/chain-dashboard/chain-dashboard.component.ts');
  assert.match(dashboard, /dashboard\$\(/, 'the dashboard subscribes to the data service');
  const service = read('frontend/src/app/universe/chain-dashboard/chain-dashboard.service.ts');
  assert.match(service, /getChainDashboard\$/, 'the service calls the dashboard aggregate');
});

test('the dashboard composes the block timeline, and cubes carry heights', () => {
  const dashboard = read('frontend/src/app/universe/chain-dashboard/chain-dashboard.component.html');
  assert.match(dashboard, /<app-chain-timeline/);
  const timeline = read('frontend/src/app/universe/chain-dashboard/chain-timeline.component.html');
  assert.match(timeline, /class="cube-height"/, 'heights render above cubes');
  assert.match(timeline, /timeline-side future/, 'the future side exists');
  assert.match(timeline, /timeline-side confirmed/, 'the confirmed side exists');
  const reader = read('frontend/src/app/universe/chain-dashboard/chain-timeline.ts');
  assert.match(reader, /MAXIMUM_FUTURE_SLOTS/,
    'the future side stays one cube per slot, never one giant cube');
});

test('Bitcoin units never appear in the chain page templates', () => {
  for (const path of [
    'frontend/src/app/universe/chain-dashboard/chain-dashboard.component.html',
    'frontend/src/app/universe/chain-dashboard/chain-mining.component.html',
    'frontend/src/app/universe/chain-dashboard/chain-timeline.component.html',
    'frontend/src/app/universe/multichain-explorer/multichain-explorer.component.html',
  ]) {
    const template = read(path);
    assert.ok(!template.includes('sat/vB'), `${path} must not print sat/vB`);
    assert.ok(!/\bBTC\b/.test(template), `${path} must not print BTC`);
  }
});

test('Zcash ordering is never presented as deterministic', () => {
  const reader = read('frontend/src/app/universe/chain-dashboard/chain-timeline.ts');
  assert.match(reader, /zip317-eligibility-tiers/,
    'the tier semantics drive a disclosure');
  assert.match(reader, /randomized/i,
    'the disclosure names the randomized selection');
});

test('the visual gate covers the parity routes', () => {
  const capture = read('scripts/universe/visual-qa/capture.mjs');
  for (const id of [
    'dogecoin-mining', 'dogecoin-graphs', 'dogecoin-docs',
    'zcash-mining', 'zcash-graphs', 'zcash-docs',
  ]) {
    assert.ok(capture.includes(`'${id}'`), `capture gate covers ${id}`);
  }
});

test('the production smoke checks the dashboard families for both chains', () => {
  const smoke = read('scripts/universe/synthetic-check.mjs');
  assert.match(smoke, /checkChainDashboardFamilies/);
  assert.match(smoke, /universe-chain-dashboard-v1/);
  assert.match(smoke, /universe-recent-blocks-v1/);
  assert.match(smoke, /universe-chart-series-v1/);
});
