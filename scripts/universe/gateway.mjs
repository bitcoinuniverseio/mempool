#!/usr/bin/env node
/**
 * Universe Explorer gateway.
 *
 * One loopback listener that fronts the whole product:
 *
 *   /api/v1/universe/*  ->  the protocol overlay
 *   /api/v1/chains      ->  the protocol overlay, which owns the chain domain
 *   /api/v1/bitcoin/*   ->  the protocol overlay
 *   /api/v1/dogecoin/*  ->  the protocol overlay
 *   /api/v1/zcash/*     ->  the protocol overlay
 *   /api/*              ->  the explorer backend, including WebSocket upgrades
 *   everything else     ->  the built frontend, with SPA fallback
 *
 * It exists so the public origin has a single upstream to point at, and so the
 * indexer host needs no additional system packages. Everything it does is
 * deliberately small: no rewriting of bodies, no caching layer of its own, no
 * configuration language.
 *
 * Configuration, all optional:
 *   UNIVERSE_GATEWAY_HOST     default 127.0.0.1
 *   UNIVERSE_GATEWAY_PORT     default 8099
 *   UNIVERSE_GATEWAY_BACKEND  default http://127.0.0.1:8996
 *   UNIVERSE_GATEWAY_OVERLAY  default http://127.0.0.1:3400
 *   UNIVERSE_GATEWAY_ROOT     default ./frontend/dist/mempool/browser
 */

import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const HOST = process.env.UNIVERSE_GATEWAY_HOST || '127.0.0.1';
const PORT = Number(process.env.UNIVERSE_GATEWAY_PORT || 8099);
const BACKEND = new URL(process.env.UNIVERSE_GATEWAY_BACKEND || 'http://127.0.0.1:8996');
const OVERLAY = new URL(process.env.UNIVERSE_GATEWAY_OVERLAY || 'http://127.0.0.1:3400');
const ROOT = resolve(process.env.UNIVERSE_GATEWAY_ROOT || 'frontend/dist/mempool/browser');

/** Upstream request budget. Long enough for a cold index read, short enough to fail fast. */
const UPSTREAM_TIMEOUT_MS = 30_000;

const CONTENT_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
}));

/**
 * Security headers applied to every response.
 *
 * The referrer policy is the one that matters most here: a page URL on this
 * site contains an address, a transaction, or an output, so leaking it to any
 * site a visitor clicks through to would undo the rest of the privacy work.
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy':
    'accelerometer=(), camera=(), display-capture=(), geolocation=(), ' +
    'gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/**
 * Content policy for the document itself.
 *
 * Everything the page loads is served from this origin. Angular injects
 * component styles at runtime and writes style attributes for bound values, so
 * inline styles are permitted; inline script is not, and nothing is fetched
 * from anywhere else.
 */
const CONTENT_SECURITY_POLICY_PARTS = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
];

/**
 * The build injects one inline script into the document to name the theme
 * files, and its content changes with every build. Rather than weaken the
 * policy with 'unsafe-inline', its hash is computed once at start-up and
 * allowed by name. Anything else inline stays blocked.
 */
function inlineScriptHashes() {
  const index = join(ROOT, 'index.html');
  if (!existsSync(index)) return [];
  let html;
  try {
    html = readFileSync(index, 'utf8');
  } catch {
    return [];
  }
  const hashes = [];
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc\s*=/.test(match[1])) continue;
    const body = match[2];
    if (!body) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

const CONTENT_SECURITY_POLICY = (() => {
  const hashes = inlineScriptHashes();
  return CONTENT_SECURITY_POLICY_PARTS.map((part) =>
    part.startsWith('script-src') && hashes.length
      ? `${part} ${hashes.join(' ')}`
      : part,
  ).join('; ');
})();

function withSecurityHeaders(headers, isDocument) {
  const merged = { ...headers, ...SECURITY_HEADERS };
  if (isDocument) merged['content-security-policy'] = CONTENT_SECURITY_POLICY;
  return merged;
}

/** Requests for a mining pool logo the build does not carry. */
const MINING_POOL_LOGO = /^\/resources\/mining-pools\/[A-Za-z0-9._-]+\.svg$/;

/** Build output is content hashed, so it can be cached hard. Entry points cannot. */
const HASHED_ASSET = /\.[0-9a-f]{16,}\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|avif|wasm)$/i;

/**
 * Chain-domain routes the overlay owns. The overlay registers them under the
 * same `/api/v1/` prefix the backend uses, so the gateway has to name them
 * explicitly: anything not listed here still belongs to the Bitcoin backend.
 */
const OVERLAY_CHAIN_PREFIXES = [
  '/api/v1/chains',
  '/api/v1/bitcoin',
  '/api/v1/dogecoin',
  '/api/v1/zcash',
];

/**
 * Which upstream serves a path, and what path it should see.
 *
 * The explorer backend registers every route under its own `/api/v1/` prefix,
 * while clients and the Esplora-compatible surface address them as `/api/`.
 * Upstream resolves that in nginx; this does the same rewrite, because getting
 * it wrong silently 404s the entire chain API while the site still loads.
 */
export function routeFor(pathname, originalUrl) {
  if (pathname === '/api/v1/universe' || pathname.startsWith('/api/v1/universe/')) {
    return { upstream: OVERLAY, path: originalUrl };
  }
  for (const prefix of OVERLAY_CHAIN_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { upstream: OVERLAY, path: originalUrl };
    }
  }
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
    return { upstream: BACKEND, path: originalUrl };
  }
  if (pathname.startsWith('/api/')) {
    return { upstream: BACKEND, path: `/api/v1/${originalUrl.slice('/api/'.length)}` };
  }
  if (pathname === '/api') {
    return { upstream: BACKEND, path: '/api/v1/' };
  }
  return null;
}

export function websocketUpstreamFor(pathname) {
  return pathname === '/api/v1/universe/ws' ? OVERLAY : BACKEND;
}

/**
 * How long a request waits for an upstream that is refusing connections.
 *
 * A release restarts the backend and the overlay, and they take a few seconds
 * to listen again. Answering 502 the instant the connection is refused turns
 * every request in that window into a visible failure, which is the difference
 * between a deploy nobody notices and one that shows up as an outage. These
 * delays bridge a restart and give up well inside the page's own budget, so a
 * genuinely dead upstream is still reported promptly rather than hidden.
 */
const RESTART_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2000];

/** True for a failure that a moment's wait could plausibly resolve. */
function upstreamIsRestarting(error) {
  return error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET';
}

function proxy(request, response, route) {
  const upstream = route.upstream;
  // Only a request with no body can be replayed. Everything this gateway
  // proxies that changes state carries one, so this never retries a write.
  const replayable = request.method === 'GET' || request.method === 'HEAD';
  let attempt = 0;
  let pendingRetry = null;
  let clientGone = false;

  // A reader who navigates away mid-retry leaves a response nothing can be
  // written to. Writing to it anyway throws from a timer callback, where there
  // is no request to fail: it takes the whole gateway down. Track the client
  // and stop the moment it leaves.
  const abandon = () => {
    clientGone = true;
    if (pendingRetry) {
      clearTimeout(pendingRetry);
      pendingRetry = null;
    }
  };
  response.on('close', abandon);
  request.on('aborted', abandon);

  const failClosed = () => {
    if (clientGone || response.headersSent || response.writableEnded) return;
    try {
      // A dead upstream is reported as a gateway failure, never as an empty
      // success: a caller must be able to tell the two apart.
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'upstream-unavailable' }));
    } catch {
      // The client went away between the check and the write.
      response.destroy();
    }
  };

  const send = () => {
    if (clientGone) return;
    const options = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: route.path,
      headers: { ...request.headers, host: upstream.host },
      timeout: UPSTREAM_TIMEOUT_MS,
    };
    const proxied = http.request(options, (upstreamResponse) => {
      if (clientGone) {
        upstreamResponse.destroy();
        return;
      }
      try {
        // API responses are data, never documents, so they get the headers
        // without a content policy.
        response.writeHead(
          upstreamResponse.statusCode || 502,
          withSecurityHeaders(upstreamResponse.headers, false),
        );
      } catch {
        upstreamResponse.destroy();
        response.destroy();
        return;
      }
      upstreamResponse.pipe(response);
    });
    proxied.on('timeout', () => proxied.destroy(new Error('upstream timeout')));
    proxied.on('error', (error) => {
      if (clientGone) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (replayable && upstreamIsRestarting(error) && attempt < RESTART_RETRY_DELAYS_MS.length) {
        const delay = RESTART_RETRY_DELAYS_MS[attempt];
        attempt += 1;
        pendingRetry = setTimeout(() => {
          pendingRetry = null;
          send();
        }, delay);
        return;
      }
      failClosed();
    });
    if (replayable) {
      proxied.end();
    } else {
      request.pipe(proxied);
      // A request body that stops arriving must not leave the upstream socket
      // open forever.
      request.on('error', () => proxied.destroy());
    }
  };

  send();
}

/** Resolves a request path to a file inside the root, or null. */
function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  if (!existsSync(candidate)) return null;
  const stats = statSync(candidate);
  if (stats.isDirectory()) {
    const index = join(candidate, 'index.html');
    return existsSync(index) ? index : null;
  }
  return candidate;
}

function serveFile(response, file, status = 200) {
  const extension = extname(file).toLowerCase();
  const headers = {
    'content-type': CONTENT_TYPES.get(extension) || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': HASHED_ASSET.test(file)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };
  try {
    headers['content-length'] = String(statSync(file).size);
  } catch {
    // A file that vanished between the check and the read is a 404, not a crash.
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(
    status,
    withSecurityHeaders(headers, headers['content-type'].startsWith('text/html')),
  );
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://gateway.invalid').pathname;
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  if (pathname === '/__gateway/health') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify({ status: 'ok', root: ROOT }));
    return;
  }

  const route = routeFor(pathname, request.url);
  if (route) {
    proxy(request, response, route);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const file = staticFile(pathname);
  if (file) {
    serveFile(response, file);
    return;
  }

  // A mining pool with no bundled logo is expected, not an error. The page
  // already falls back to the default mark, so serving it here keeps a dozen
  // 404s per page load out of the console and off the wire.
  if (MINING_POOL_LOGO.test(pathname)) {
    const fallback = join(ROOT, 'resources', 'mining-pools', 'default.svg');
    if (existsSync(fallback)) {
      serveFile(response, fallback);
      return;
    }
  }

  // Single page application: an unknown path is a client route, not a 404,
  // unless it looks like a missing asset request.
  if (extname(pathname)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const index = join(ROOT, 'index.html');
  if (existsSync(index)) {
    serveFile(response, index);
    return;
  }
  response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Frontend build not present');
});

/**
 * WebSocket upgrades belong to the explorer backend, which attaches its socket
 * server to the whole HTTP server rather than to one path, so the path passes
 * through unchanged.
 */
server.on('upgrade', (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url || '/', 'http://gateway.invalid').pathname;
  } catch {
    socket.destroy();
    return;
  }
  const upstream = websocketUpstreamFor(pathname);
  const proxied = net.connect(Number(upstream.port), upstream.hostname, () => {
    const lines = [`${request.method} ${request.url} HTTP/1.1`];
    for (const [name, value] of Object.entries(request.headers)) {
      if (name.toLowerCase() === 'host') continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        lines.push(`${name}: ${item}`);
      }
    }
    lines.push(`Host: ${upstream.host}`, '', '');
    proxied.write(lines.join('\r\n'));
    if (head?.length) proxied.write(head);
    proxied.pipe(socket);
    socket.pipe(proxied);
  });
  const close = () => {
    socket.destroy();
    proxied.destroy();
  };
  proxied.on('error', close);
  socket.on('error', close);
});

server.headersTimeout = 60_000;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

/**
 * The first descriptor systemd passes to a socket-activated service.
 */
const SD_LISTEN_FDS_START = 3;

/**
 * Returns the descriptor of a listening socket handed over by systemd, or null
 * when this process has to open its own.
 *
 * This is what makes a deploy invisible. The backend and the overlay can be
 * restarted behind the gateway, which bridges the gap, but nothing could
 * bridge a restart of the gateway itself: the port went away with the process
 * and the edge answered 502 until it came back. With the socket held by
 * systemd instead, the port stays bound across the restart and arriving
 * connections wait in the kernel backlog rather than being refused.
 *
 * The pid check is not decoration. LISTEN_FDS and LISTEN_PID are inherited by
 * child processes, so a child that trusted them would try to listen on a
 * descriptor belonging to its parent.
 */
export function inheritedListenerFd(env = process.env, pid = process.pid) {
  if (env.LISTEN_PID !== String(pid)) return null;
  const count = Number(env.LISTEN_FDS);
  if (!Number.isInteger(count) || count < 1) return null;
  return SD_LISTEN_FDS_START;
}

/**
 * Listening is the default. A test that imports this file for its routing
 * table sets UNIVERSE_GATEWAY_NO_LISTEN so no socket is opened.
 *
 * The flag is explicit rather than a comparison against process.argv, because
 * the release directory is reached through a symlink and the two paths never
 * match there. That mistake takes the gateway down silently, with a clean exit
 * code and no error to read.
 */
if (process.env.UNIVERSE_GATEWAY_NO_LISTEN !== '1') {
  const inherited = inheritedListenerFd();
  const announce = () => {
    process.stdout.write(
      `Universe Explorer gateway listening on ${
        inherited === null ? `${HOST}:${PORT}` : `the socket systemd passed on fd ${inherited}`
      }
` +
      `  overlay  ${OVERLAY.origin}
` +
      `  backend  ${BACKEND.origin}
` +
      `  static   ${ROOT}
`,
    );
  };
  if (inherited === null) {
    server.listen(PORT, HOST, announce);
  } else {
    server.listen({ fd: inherited }, announce);
  }

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
