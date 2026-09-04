import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import crypto from 'node:crypto';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Creates and starts a localhost static build server with identity verification.
 */
export class GatewayServer {
  /**
   * @param {object} options
   * @param {string} options.buildDir Local directory containing built frontend
   * @param {string} options.role 'candidate' or 'reference'
   * @param {string} options.sourceCommit Git SHA
   * @param {string} options.buildHash Build fingerprint
   * @param {number} [options.preferredPort=0] 0 picks a random loopback port
   */
  constructor({
    buildDir,
    role = 'candidate',
    sourceCommit = 'unknown',
    buildHash = 'unknown',
    preferredPort = 0,
  }) {
    this.buildDir = resolve(buildDir);
    this.role = role;
    this.sourceCommit = sourceCommit;
    this.buildHash = buildHash;
    this.preferredPort = preferredPort;
    this.nonce = crypto.randomBytes(16).toString('hex');
    this.runningBuildHash = buildHash;
    this.server = null;
    this.port = null;
    this.host = '127.0.0.1';
  }

  async start() {
    if (!existsSync(this.buildDir)) {
      throw new Error(`Build directory does not exist: ${this.buildDir}`);
    }

    return new Promise((resolvePromise, rejectPromise) => {
      this.server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, `http://${this.host}:${this.port}`);
        const pathname = parsedUrl.pathname;

        // Health and identity check endpoint
        if (pathname === '/__gateway/health' || pathname === '/api/v1/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'healthy',
              role: this.role,
              pid: process.pid,
              buildDir: this.buildDir,
              buildHash: this.runningBuildHash,
              sourceCommit: this.sourceCommit,
              gatewayNonce: this.nonce,
              port: this.port,
            }),
          );
          return;
        }

        // Static file serving with SPA fallback
        let filePath = join(this.buildDir, pathname);
        if (existsSync(filePath) && statSync(filePath).isDirectory()) {
          filePath = join(filePath, 'index.html');
        }

        if (!existsSync(filePath)) {
          filePath = join(this.buildDir, 'index.html');
        }

        if (!existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        try {
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const content = readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': contentType,
            'X-Gateway-Nonce': this.nonce,
          });
          res.end(content);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(String(err));
        }
      });

      this.server.on('error', (err) => {
        rejectPromise(err);
      });

      this.server.listen(this.preferredPort, this.host, () => {
        const address = this.server.address();
        this.port = address.port;
        resolvePromise({
          host: this.host,
          port: this.port,
          url: `http://${this.host}:${this.port}`,
          nonce: this.nonce,
        });
      });
    });
  }

  /**
   * Verifies that the server at this port has the exact expected identity.
   */
  async verifyIdentity(expected = {}) {
    if (!this.port) {
      throw new Error('Server is not running');
    }

    const expectedNonce = expected.nonce ?? this.nonce;
    const expectedBuildHash = expected.buildHash ?? this.buildHash;
    const expectedCommit = expected.sourceCommit ?? this.sourceCommit;
    const expectedRole = expected.role ?? this.role;

    const healthUrl = `http://${this.host}:${this.port}/__gateway/health`;
    const response = await fetch(healthUrl);
    if (!response.ok) {
      throw new Error(`Gateway health check failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (payload.gatewayNonce !== expectedNonce) {
      throw new Error(
        `Gateway nonce mismatch: expected ${expectedNonce}, received ${payload.gatewayNonce}`,
      );
    }
    if (payload.buildHash !== expectedBuildHash) {
      throw new Error(
        `Build hash mismatch: expected ${expectedBuildHash}, received ${payload.buildHash}`,
      );
    }
    if (payload.sourceCommit !== expectedCommit) {
      throw new Error(
        `Source commit mismatch: expected ${expectedCommit}, received ${payload.sourceCommit}`,
      );
    }
    if (payload.role !== expectedRole) {
      throw new Error(
        `Role mismatch: expected ${expectedRole}, received ${payload.role}`,
      );
    }

    return true;
  }

  async stop() {
    if (!this.server) return;
    return new Promise((resolvePromise) => {
      this.server.close(() => {
        this.server = null;
        resolvePromise();
      });
    });
  }
}
