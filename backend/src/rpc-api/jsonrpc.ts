const http = require('http');
const https = require('https');
import { readFileSync } from 'fs';
import { createGunzip } from 'zlib';

const JsonRPC = function (this: any, opts) {
  // @ts-ignore
  this.opts = opts || {};
  // @ts-ignore
  this.http = this.opts.ssl ? https : http;
  this.agent = new this.http.Agent({ keepAlive: true, maxSockets: this.opts.maxSockets || 8, maxFreeSockets: 2 });
};

/* IMPLEMENTATION-HANDOFF [WP-BE-005]
 * Defect BE-005; coverage COV-BE-005.rpc-body-deadline, transport-recovery.
 * Real loopback reproduction: backend-reproduce.cjs uses this exact source.
 * With timeout=40ms, a trickling body resolves after about 150ms; a response
 * closed after headers leaves the promise pending beyond 250ms. The absolute
 * timer is cleared at headers and no response aborted/error/close handler
 * settles the call. Socket inactivity is not a whole-operation deadline.
 * 1. Keep one absolute deadline through headers, body and JSON decoding.
 *    Centralize settlement so success/error/timeout is delivered once; clear
 *    every timer/listener and destroy the transport on cancellation/failure.
 * 2. Handle response error, aborted and premature close; require complete
 *    framed input before parsing. Bound response bytes per RPC use case
 *    (verbose blocks need an appropriate limit), and avoid unbounded string
 *    concatenation. Validate RPC response identity, shape and batch ordering.
 * 3. Use Buffer.byteLength for outgoing JSON Content-Length. Preserve Core
 *    error codes without exposing credentials, cookies or raw sensitive
 *    parameters; do not automatically retry broadcast or other writes after
 *    an ambiguous outcome. Refresh changed authentication only deliberately.
 * 4. Add loopback transport tests for both reproduced failures, split UTF-8,
 *    malformed JSON, oversized bodies, wrong/missing IDs, timeout before/after
 *    headers, cancellation and one successful call after recovery. Exercise
 *    node outage/restart under the main loop and every shared RPC consumer.
 * Dependencies: rpc-api/index.ts, commands.ts, bitcoin-client/second-client,
 * all indexers and protocol readers sharing this transport. R-BE-NODE is the
 * official HTTP lifecycle/deadline reference in the handoff register.
 * Acceptance: each call settles inside its total budget, buffers are bounded,
 * no transport failure stalls the indexer, and no uncertain write is replayed.
 * Rollback: restore the previous client only with bounded caller deadlines;
 * no database migration is required. Keep logs free of credentials/raw txs.
 * Historical preparation annotation; the transport below now implements the lifecycle
 * guards and negotiated bounded gzip. Component tests do not qualify live fee data.
 */
JsonRPC.prototype.call = function (method, params, options?) {
  return new Promise((resolve, reject) => {
    const signal: AbortSignal | undefined = options?.signal;
    if (signal?.aborted) { reject(Object.assign(new Error('RPC request cancelled'), {code: 'EABORTED'})); return; }
    const time = Date.now();
    const batch = Array.isArray(method);
    const calls = batch ? method.map((call, i) => ({ id: `${time}-${i}`, method: call.method, params: call.params }))
      : [{ id: time, method, params }];
    const payload = JSON.stringify(batch ? calls : calls[0]);
    const timeout = this.opts.timeout || 30000;
    const maxBytes = this.opts.maxResponseBytes || 64 * 1024 * 1024;
    const requestOptions = {
      host: this.opts.host || 'localhost', port: this.opts.port || 8332,
      method: 'POST', path: '/',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Accept-Encoding': 'gzip' },
      agent: this.agent, rejectUnauthorized: this.opts.ssl && this.opts.sslStrict !== false,
    };
    if (this.opts.ssl && this.opts.sslCa) requestOptions['ca'] = this.opts.sslCa;
    if (this.opts.cookie) {
      if (!this.cachedCookie) this.cachedCookie = readFileSync(this.opts.cookie).toString().trim();
      requestOptions['auth'] = this.cachedCookie;
    } else if (this.opts.user && this.opts.pass) {
      requestOptions['auth'] = `${this.opts.user}:${this.opts.pass}`;
    }
    let settled = false;
    let response;
    let decoder;
    const request = this.http.request(requestOptions);
    const finish = (error?, result?) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      request.setTimeout(0);
      if (error) {
        decoder?.destroy();
        response?.destroy();
        request.destroy();
        reject(error);
      } else resolve(result);
    };
    const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
    const deadline = setTimeout(() => finish(failure('ETIMEDOUT', 'RPC operation exceeded its deadline')), timeout);
    const onAbort = () => finish(failure('EABORTED', 'RPC request cancelled'));
    signal?.addEventListener('abort', onAbort, {once: true});
    request.on('error', () => finish(failure('ERPC_TRANSPORT', 'RPC transport failed')));
    request.on('response', incoming => {
      response = incoming;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let wireBytes = 0;
      const maxWireBytes = Math.min(this.opts.maxWireResponseBytes || maxBytes, maxBytes);
      const encoding = String(incoming.headers['content-encoding'] || 'identity').trim().toLowerCase();
      if (encoding !== 'identity' && encoding !== 'gzip') {
        finish(failure('ERPC_ENCODING', 'Unsupported RPC response encoding')); return;
      }
      if (incoming.statusCode === 401 && this.opts.cookie) this.cachedCookie = undefined;
      const length = incoming.headers['content-length'];
      if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > maxWireBytes) {
        finish(failure('ERPC_SIZE', 'RPC wire response exceeds the byte limit')); return;
      }
      decoder = encoding === 'gzip' ? createGunzip() : undefined;
      const body = decoder || incoming;
      if (decoder) decoder.on('error', () => finish(failure('ERPC_ENCODING', 'Invalid compressed RPC response')));
      incoming.on('data', chunk => {
        wireBytes += chunk.length;
        if (wireBytes > maxWireBytes) finish(failure('ERPC_SIZE', 'RPC wire response exceeds the byte limit'));
      });
      incoming.on('error', () => finish(failure('ERPC_BODY', 'RPC response failed')));
      incoming.on('aborted', () => finish(failure('ERPC_BODY', 'RPC response was aborted')));
      incoming.on('close', () => {
        if (!incoming.complete) finish(failure('ERPC_BODY', 'RPC response closed before completion'));
      });
      body.on('data', chunk => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) return finish(failure('ERPC_SIZE', 'RPC response exceeds the byte limit'));
        chunks.push(Buffer.from(chunk));
      });
      body.on('end', () => {
        if (settled) return;
        if (!incoming.complete) return finish(failure('ERPC_BODY', 'RPC response is incomplete'));
        // Only a matching valid200/500 JSON-RPC envelope may supply a Core domain code.
        if (incoming.statusCode !== 200 && incoming.statusCode !== 500) {
          finish(failure('ERPC_HTTP', `RPC response status ${incoming.statusCode}`)); return;
        }
        try {
          const decoded = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
          const answers = batch ? decoded : [decoded];
          if (!Array.isArray(answers) || answers.length !== calls.length) throw new Error();
          const byId = new Map();
          for (const answer of answers) {
            if (!answer || typeof answer !== 'object' || Array.isArray(answer) ||
                !calls.some(call => call.id === answer.id) || byId.has(answer.id) ||
                (!Object.prototype.hasOwnProperty.call(answer, 'result') && answer.error == null)) throw new Error();
            byId.set(answer.id, answer);
          }
          const ordered = calls.map(call => byId.get(call.id));
          for (const [index, answer] of ordered.entries()) {
            if (answer.error != null) {
              // Core codes are useful to callers; remote messages can contain request data.
              if (!Number.isSafeInteger(answer.error.code)) throw new Error();
              const code = answer.error.code;
              const message = code === -5 && calls[index].method === 'getrawtransaction'
                ? 'No such mempool or blockchain transaction'
                : code === -5 && ['getblock', 'getblockheader', 'getblockhash'].includes(calls[index].method)
                  ? 'Block not found' : 'RPC server rejected the request';
              return finish(Object.assign(new Error(message), { code }));
            }
          }
          if (incoming.statusCode !== 200) return finish(failure('ERPC_HTTP', `RPC response status ${incoming.statusCode}`));
          if (Date.now() - time >= timeout) return finish(failure('ETIMEDOUT', 'RPC operation exceeded its deadline'));
          finish(undefined, batch ? ordered.map(answer => answer.result) : ordered[0].result);
        } catch {
          finish(incoming.statusCode !== 200
            ? failure('ERPC_HTTP', `RPC response status ${incoming.statusCode}`)
            : failure('ERPC_RESPONSE', 'Malformed RPC response or mismatched identity'));
        }
      });
      if (decoder) incoming.pipe(decoder);
    });
    request.end(payload);
  });
};

module.exports.JsonRPC = JsonRPC;
