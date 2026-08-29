import test from 'node:test';
import assert from 'node:assert/strict';

// Importing the gateway must not open a socket.
process.env.UNIVERSE_GATEWAY_NO_LISTEN = '1';
const { routeFor, websocketUpstreamFor, inheritedListenerFd } = await import('./gateway.mjs');

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
