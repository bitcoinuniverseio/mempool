const http = require('http');
const https = require('https');
import { readFileSync } from 'fs';

const JsonRPC = function (opts) {
  // @ts-ignore
  this.opts = opts || {};
  // @ts-ignore
  this.http = this.opts.ssl ? https : http;
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
 * Preparation only; executable transport behavior is unchanged.
 */
JsonRPC.prototype.call = function (method, params) {
  return new Promise((resolve, reject) => {
    const time = Date.now();
    let requestJSON;

    if (Array.isArray(method)) {
      // multiple rpc batch call
      requestJSON = [];
      method.forEach(function (batchCall, i) {
        requestJSON.push({
          id: time + '-' + i,
          method: batchCall.method,
          params: batchCall.params
        });
      });
    } else {
      // single rpc call
      requestJSON = {
        id: time,
        method: method,
        params: params
      };
    }

    // First we encode the request into JSON
    requestJSON = JSON.stringify(requestJSON);

    // prepare request options
    const requestOptions = {
      host: this.opts.host || 'localhost',
      port: this.opts.port || 8332,
      method: 'POST',
      path: '/',
      headers: {
        'Host': this.opts.host || 'localhost',
        'Content-Length': requestJSON.length
      },
      agent: false,
      rejectUnauthorized: this.opts.ssl && this.opts.sslStrict !== false
    };

    if (this.opts.ssl && this.opts.sslCa) {
    // @ts-ignore
      requestOptions.ca = this.opts.sslCa;
    }

    // use HTTP auth if user and password set
    if (this.opts.cookie) {
      if (!this.cachedCookie) {
        this.cachedCookie = readFileSync(this.opts.cookie).toString();
      }
      // @ts-ignore
      requestOptions.auth = this.cachedCookie;
    } else if (this.opts.user && this.opts.pass) {
      // @ts-ignore
      requestOptions.auth = this.opts.user + ':' + this.opts.pass;
    }

    // Now we'll make a request to the server
    let cbCalled = false;
    const request = this.http.request(requestOptions);

    // start request timeout timer
    const reqTimeout = setTimeout(function () {
      if (cbCalled) {return;}
      cbCalled = true;
      request.abort();
      const err = new Error('ETIMEDOUT');
      // @ts-ignore
      err.code = 'ETIMEDOUT';
      reject(err);
    }, this.opts.timeout || 30000);

    // set additional timeout on socket in case of remote freeze after sending headers
    request.setTimeout(this.opts.timeout || 30000, function () {
      if (cbCalled) {return;}
      cbCalled = true;
      request.abort();
      const err = new Error('ESOCKETTIMEDOUT');
      // @ts-ignore
      err.code = 'ESOCKETTIMEDOUT';
      reject(err);
    });

    request.on('error', function (err) {
      if (cbCalled) {return;}
      cbCalled = true;
      clearTimeout(reqTimeout);
      reject(err);
    });

    request.on('response', (response) => {
      clearTimeout(reqTimeout);

      // We need to buffer the response chunks in a nonblocking way.
      let buffer = '';
      response.on('data', function (chunk) {
        buffer = buffer + chunk;
      });
      // When all the responses are finished, we decode the JSON and
      // depending on whether it's got a result or an error, we call
      // emitSuccess or emitError on the promise.
      response.on('end', () => {
        let err;

        if (cbCalled) {return;}
        cbCalled = true;

        try {
          var decoded = JSON.parse(buffer);
        } catch (e) {
          // if we authenticated using a cookie and it failed, read the cookie file again
          if (
            response.statusCode === 401 /* Unauthorized */ &&
            this.opts.cookie
          ) {
            this.cachedCookie = undefined;
          }

          if (response.statusCode !== 200) {
            err = new Error('Invalid params, response status code: ' + response.statusCode);
            err.code = -32602;
            reject(err);
          } else {
            err = new Error('Problem parsing JSON response from server');
            err.code = -32603;
            reject(err);
          }
          return;
        }

        if (!Array.isArray(decoded)) {
          decoded = [decoded];
        }

        // iterate over each response, normally there will be just one
        // unless a batch rpc call response is being processed
        decoded.forEach(function (decodedResponse, i) {
          if (decodedResponse.hasOwnProperty('error') && decodedResponse.error != null) {
            if (reject) {
              err = new Error(decodedResponse.error.message || '');
              if (decodedResponse.error.code) {
                err.code = decodedResponse.error.code;
              }
              reject(err);
            }
          } else if (decodedResponse.hasOwnProperty('result')) {
            // @ts-ignore
            resolve(decodedResponse.result, response.headers);
          } else {
            if (reject) {
              err = new Error(decodedResponse.error.message || '');
              if (decodedResponse.error.code) {
                err.code = decodedResponse.error.code;
              }
              reject(err);
            }
          }
        });
      });
    });
    request.end(requestJSON);
  });
};

module.exports.JsonRPC = JsonRPC;
