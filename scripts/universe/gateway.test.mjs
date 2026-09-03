import test from 'node:test';
import assert from 'node:assert/strict';

// Importing the gateway must not open a socket.
process.env.UNIVERSE_GATEWAY_NO_LISTEN = '1';
const { routeFor, websocketUpstreamFor, inheritedListenerFd, contentSecurityPolicy } =
  await import('./gateway.mjs');

/**
 * The path rewrite is load bearing. The explorer backend registers every route
 * under its own `/api/v1/` prefix while clients address them as `/api/`, so a
 * mistake here 404s the whole chain API while the site still loads, which is
 * exactly the kind of failure that reaches production unnoticed.
 */

const OVERLAY_PORT = '3400';
const BACKEND_PORT = '8996';

function port(route) {
  return route === null ? null : route.upstream.port;
}

test('protocol overlay routes reach the overlay unchanged', () => {
  for (const url of [
    '/api/v1/universe',
    '/api/v1/universe/status',
    '/api/v1/universe/transactions/' + 'a'.repeat(64),
    '/api/v1/universe/protocols?chain=bitcoin',
  ]) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    const route = routeFor(pathname, url);
    assert.equal(port(route), OVERLAY_PORT, url);
    assert.equal(route.path, url, url);
  }
});

test('portfolio v2 routes reach the overlay unchanged', () => {
  for (const url of [
    '/api/v2/universe/portfolio/networks',
    '/api/v2/universe/portfolio/bitcoin/mainnet/bc1qexample/summary',
    '/api/v2/universe/portfolio/bitcoin/mainnet/bc1qexample/utxos?limit=25',
    '/api/v2/universe/portfolio/share/some-share-id',
  ]) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    const route = routeFor(pathname, url);
    assert.equal(port(route), OVERLAY_PORT, url);
    assert.equal(route.path, url, url);
  }
  // Other v2 families do not exist yet: anything else under /api/v2
  // belongs to nobody, and must not silently fall through to /api/v1.
  const pathname = new URL('/api/v2/other', 'http://x.invalid').pathname;
  assert.notEqual(port(routeFor(pathname, '/api/v2/other')), OVERLAY_PORT);
});

test('chain-domain routes reach the overlay unchanged', () => {
  for (const url of [
    '/api/v1/chains',
    '/api/v1/chains?network=mainnet',
    '/api/v1/bitcoin/status?network=mainnet',
    '/api/v1/bitcoin/mempool',
    '/api/v1/dogecoin/status?network=mainnet',
    '/api/v1/dogecoin/tx/' + 'c'.repeat(64),
    '/api/v1/dogecoin/protocols/drc20',
    '/api/v1/zcash/mempool?network=mainnet&limit=100',
    '/api/v1/zcash/protocols/zrc20/UNIV?ruleset=zrc20-strict',
  ]) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    const route = routeFor(pathname, url);
    assert.equal(port(route), OVERLAY_PORT, url);
    assert.equal(route.path, url, url);
  }
});

test('a path that merely begins with a chain name stays on the backend', () => {
  for (const url of ['/api/v1/chainstats', '/api/v1/bitcoind', '/api/v1/zcashier']) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    assert.equal(port(routeFor(pathname, url)), BACKEND_PORT, url);
  }
});

test('explicit v1 routes reach the backend unchanged', () => {
  for (const url of ['/api/v1', '/api/v1/fees/recommended', '/api/v1/backend-info']) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    const route = routeFor(pathname, url);
    assert.equal(port(route), BACKEND_PORT, url);
    assert.equal(route.path, url, url);
  }
});

test('unprefixed api routes are rewritten onto the backend prefix', () => {
  const cases = [
    ['/api/blocks/tip/height', '/api/v1/blocks/tip/height'],
    ['/api/block-height/800000', '/api/v1/block-height/800000'],
    ['/api/address/bc1qexample/utxo', '/api/v1/address/bc1qexample/utxo'],
    ['/api/tx/' + 'b'.repeat(64), '/api/v1/tx/' + 'b'.repeat(64)],
  ];
  for (const [url, expected] of cases) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    const route = routeFor(pathname, url);
    assert.equal(port(route), BACKEND_PORT, url);
    assert.equal(route.path, expected, url);
  }
});

test('a query string survives the rewrite', () => {
  const url = '/api/address/bc1qexample/txs?after_txid=abc';
  const route = routeFor('/api/address/bc1qexample/txs', url);
  assert.equal(route.path, '/api/v1/address/bc1qexample/txs?after_txid=abc');
});

test('the bare api path reaches the backend index', () => {
  const route = routeFor('/api', '/api');
  assert.equal(port(route), BACKEND_PORT);
  assert.equal(route.path, '/api/v1/');
});

test('a universe path that is not under the v1 prefix is not sent to the overlay', () => {
  // `/api/universe/...` is rewritten like any other unprefixed API path, which
  // lands it on the overlay's own prefix and keeps one meaning per path.
  const route = routeFor('/api/universe/status', '/api/universe/status');
  assert.equal(route.path, '/api/v1/universe/status');
});

test('everything outside the api tree is left for the static handler', () => {
  for (const url of ['/', '/protocols', '/tx/abc', '/resources/config.js', '/apixyz']) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    assert.equal(routeFor(pathname, url), null, url);
  }
});

test('the Universe live socket reaches the overlay while the Bitcoin socket stays on the backend', () => {
  assert.equal(websocketUpstreamFor('/api/v1/universe/ws').port, OVERLAY_PORT);
  assert.equal(websocketUpstreamFor('/api/v1/ws').port, BACKEND_PORT);
});

/**
 * A gateway restart used to be the one part of a deploy nothing could bridge.
 * Reading the handover wrong does not fail loudly: the process either binds its
 * own port and quietly reintroduces the gap, or listens on a descriptor it does
 * not own.
 */

test('the socket systemd passes is used when it is addressed to this process', () => {
  assert.equal(inheritedListenerFd({ LISTEN_PID: '42', LISTEN_FDS: '1' }, 42), 3);
});

test('a plain start opens its own port', () => {
  assert.equal(inheritedListenerFd({}, 42), null);
});

test('a descriptor addressed to another process is ignored', () => {
  // LISTEN_PID and LISTEN_FDS are inherited by children. A child that trusted
  // them would listen on its parent's socket.
  assert.equal(inheritedListenerFd({ LISTEN_PID: '41', LISTEN_FDS: '1' }, 42), null);
});

test('a handover of no sockets is not a handover', () => {
  assert.equal(inheritedListenerFd({ LISTEN_PID: '42', LISTEN_FDS: '0' }, 42), null);
  assert.equal(inheritedListenerFd({ LISTEN_PID: '42' }, 42), null);
  assert.equal(inheritedListenerFd({ LISTEN_PID: '42', LISTEN_FDS: 'two' }, 42), null);
});

/**
 * The document policy has to describe the document being served.
 *
 * `UNIVERSE_GATEWAY_ROOT` is a fixed path whose contents a release swaps
 * underneath it, which is why a frontend change needs no gateway restart. The
 * policy was computed once at start-up and did not follow that swap, so a
 * release that changed the document's inline script and left `gateway.mjs`
 * byte identical produced a running gateway allowing the previous build's hash
 * and refusing the script it was itself serving. It reached production, and
 * the only sign was a console error on every page.
 */
test('the content policy follows the build behind the static root', async () => {
  const { mkdtempSync, writeFileSync, utimesSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');

  const root = mkdtempSync(join(tmpdir(), 'gateway-csp-'));
  process.env.UNIVERSE_GATEWAY_ROOT = root;
  process.env.UNIVERSE_GATEWAY_NO_LISTEN = '1';
  // A second copy of the module, bound to a root this test controls. The one
  // imported at the top of this file is bound to the default root.
  const gateway = await import(`./gateway.mjs?csp=${Date.now()}`);

  const hashOf = (body) =>
    `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

  const first = 'window.__a=1;';
  writeFileSync(join(root, 'index.html'), `<html><script>${first}</script></html>`);
  const before = gateway.contentSecurityPolicy();
  assert.ok(before.includes(hashOf(first)), 'the first build is allowed by name');

  // A longer script: the file changes size as well as time.
  const second = 'window.__b=2;window.__c=3;';
  writeFileSync(join(root, 'index.html'), `<html><script>${second}</script></html>`);
  const after = gateway.contentSecurityPolicy();
  assert.ok(after.includes(hashOf(second)), 'the build now behind the path is allowed');
  assert.ok(!after.includes(hashOf(first)), 'the build that is gone is no longer allowed');

  // And a script of exactly the same length, with the modification time forced
  // back to what it was. Neither dimension of the cache key may be load
  // bearing on its own: a build that changes the file without changing its
  // size has to be noticed, and so has one that lands at the same instant.
  const stamped = statSync(join(root, 'index.html'));
  const third = 'window.__b=9;window.__c=8;';
  assert.equal(third.length, second.length, 'the two scripts are the same length');
  writeFileSync(join(root, 'index.html'), `<html><script>${third}</script></html>`);
  utimesSync(join(root, 'index.html'), stamped.atime, stamped.mtime);

  const sameSizeSameTime = gateway.contentSecurityPolicy();
  assert.ok(
    sameSizeSameTime.includes(hashOf(third)),
    'a build of the same size at the same instant is still the build being served',
  );
});

/**
 * The split between the explorer backend and the first-party Esplora index.
 *
 * With `MEMPOOL.BACKEND` set to `esplora` the backend deliberately does not
 * mount the address, transaction, block or mempool routes: it expects the edge
 * to send that whole family to the index instead. If this table is wrong the
 * failure is not subtle in effect and is entirely silent in cause, because the
 * site still loads and every one of those paths answers 404 or, worse, is
 * answered by the wrong process.
 */

const ESPLORA_PORT = '3001';

const withEsplora = await (async () => {
  process.env.UNIVERSE_GATEWAY_ESPLORA = `http://127.0.0.1:${ESPLORA_PORT}`;
  process.env.UNIVERSE_GATEWAY_NO_LISTEN = '1';
  const module = await import('./gateway.mjs?esplora=1');
  delete process.env.UNIVERSE_GATEWAY_ESPLORA;
  return module;
})();

function esploraRoute(url) {
  const pathname = new URL(url, 'http://x.invalid').pathname;
  return withEsplora.routeFor(pathname, url);
}

test('the whole Esplora address family reaches the index with the api prefix stripped', () => {
  const address = 'bc1qcx70rmarfudyct7lx0ptrat2c5kgstghx2j69';
  const scripthash = 'd'.repeat(64);
  const cases = [
    [`/api/address/${address}`, `/address/${address}`],
    [`/api/address/${address}/txs`, `/address/${address}/txs`],
    [`/api/address/${address}/txs/chain`, `/address/${address}/txs/chain`],
    [`/api/address/${address}/txs/chain/${'e'.repeat(64)}`, `/address/${address}/txs/chain/${'e'.repeat(64)}`],
    [`/api/address/${address}/txs/mempool`, `/address/${address}/txs/mempool`],
    [`/api/address/${address}/utxo`, `/address/${address}/utxo`],
    [`/api/scripthash/${scripthash}`, `/scripthash/${scripthash}`],
    [`/api/scripthash/${scripthash}/txs`, `/scripthash/${scripthash}/txs`],
    [`/api/scripthash/${scripthash}/utxo`, `/scripthash/${scripthash}/utxo`],
    ['/api/address-prefix/bc1qcx', '/address-prefix/bc1qcx'],
  ];
  for (const [url, expected] of cases) {
    const route = esploraRoute(url);
    assert.equal(port(route), ESPLORA_PORT, url);
    assert.equal(route.path, expected, url);
  }
});

test('the rest of the Esplora surface reaches the index too', () => {
  const cases = [
    [`/api/tx/${'b'.repeat(64)}`, `/tx/${'b'.repeat(64)}`],
    [`/api/block/${'0'.repeat(64)}`, `/block/${'0'.repeat(64)}`],
    [`/api/block/${'0'.repeat(64)}/txs/25`, `/block/${'0'.repeat(64)}/txs/25`],
    ['/api/blocks/tip/height', '/blocks/tip/height'],
    ['/api/mempool', '/mempool'],
    ['/api/mempool/recent', '/mempool/recent'],
    ['/api/fee-estimates', '/fee-estimates'],
  ];
  for (const [url, expected] of cases) {
    const route = esploraRoute(url);
    assert.equal(port(route), ESPLORA_PORT, url);
    assert.equal(route.path, expected, url);
  }
});

test('a query string survives the rewrite onto the index', () => {
  const route = esploraRoute('/api/address/bc1qexample/txs?after_txid=abc');
  assert.equal(port(route), ESPLORA_PORT);
  assert.equal(route.path, '/address/bc1qexample/txs?after_txid=abc');
});

test('the index never receives a v1 path', () => {
  for (const url of [
    '/api/v1',
    '/api/v1/backend-info',
    '/api/v1/capabilities',
    '/api/v1/fees/recommended',
    '/api/v1/mining/pools/1w',
    '/api/v1/statistics/2h',
    '/api/v1/transaction-times?txId=' + 'a'.repeat(64),
    '/api/v1/validate-address/bc1qexample',
    '/api/v1/cpfp',
    '/api/v1/blocks/0',
  ]) {
    const route = esploraRoute(url);
    assert.equal(port(route), BACKEND_PORT, url);
    assert.equal(route.path, url, url);
  }
});

test('the overlay keeps its routes when an index is configured', () => {
  for (const url of [
    '/api/v1/universe/protocols',
    '/api/v1/chains',
    '/api/v1/bitcoin/status',
    '/api/v1/dogecoin/mempool',
    '/api/v1/zcash/status',
  ]) {
    const route = esploraRoute(url);
    assert.equal(port(route), OVERLAY_PORT, url);
    assert.equal(route.path, url, url);
  }
});

test('the index administrative surface is refused rather than proxied', () => {
  for (const url of ['/api/internal', '/api/internal/', '/api/internal/precache-scripts']) {
    const route = esploraRoute(url);
    assert.equal(route.upstream, null, url);
    assert.equal(route.status, 404, url);
  }
  // The v1 internal routes belong to the explorer backend and are unchanged.
  assert.equal(port(esploraRoute('/api/v1/internal/blocks/definition/list')), BACKEND_PORT);
});

test('WebSocket ownership is unchanged by the index', () => {
  assert.equal(withEsplora.websocketUpstreamFor('/api/v1/universe/ws').port, OVERLAY_PORT);
  assert.equal(withEsplora.websocketUpstreamFor('/api/v1/ws').port, BACKEND_PORT);
});

test('nothing outside the api tree is sent to the index', () => {
  for (const url of ['/', '/address/bc1qexample', '/resources/config.js', '/apixyz']) {
    const pathname = new URL(url, 'http://x.invalid').pathname;
    assert.equal(withEsplora.routeFor(pathname, url), null, url);
  }
});

test('with no index configured the backend still owns the whole api surface', () => {
  // This is the deployment that reads Bitcoin Core alone. The address family
  // has to keep reaching the backend, which answers that it cannot serve it,
  // rather than reaching an index that is not there.
  const route = routeFor('/api/address/bc1qexample', '/api/address/bc1qexample');
  assert.equal(port(route), BACKEND_PORT);
  assert.equal(route.path, '/api/v1/address/bc1qexample');
  // And with nothing to refuse on its behalf, the internal path is rewritten
  // like any other rather than being answered here.
  assert.equal(port(routeFor('/api/internal/x', '/api/internal/x')), BACKEND_PORT);
});
