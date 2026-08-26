#!/usr/bin/env node
/**
 * Universe Explorer gateway.
 *
 * One loopback listener that fronts the whole product:
 *
 *   /api/v1/universe/*  ->  the protocol overlay
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
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Build output is content hashed, so it can be cached hard. Entry points cannot. */
const HASHED_ASSET = /\.[0-9a-f]{16,}\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|avif|wasm)$/i;

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

function proxy(request, response, route) {
  const upstream = route.upstream;
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
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  proxied.on('timeout', () => proxied.destroy(new Error('upstream timeout')));
  proxied.on('error', () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    // A dead upstream is reported as a gateway failure, never as an empty
    // success: a caller must be able to tell the two apart.
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'upstream-unavailable' }));
  });
  request.pipe(proxied);
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
  response.writeHead(status, headers);
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
  const upstream = BACKEND;
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
 * Only listen when this file is the program being run. Importing it for a test
 * must not open a socket.
 */
const startedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (startedDirectly) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(
      `Universe Explorer gateway listening on ${HOST}:${PORT}
` +
      `  overlay  ${OVERLAY.origin}
` +
      `  backend  ${BACKEND.origin}
` +
      `  static   ${ROOT}
`,
    );
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
