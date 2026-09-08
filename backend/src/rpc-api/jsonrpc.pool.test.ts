import * as http from 'http';
import { AddressInfo } from 'net';

const { JsonRPC } = require('./jsonrpc');

describe('Bitcoin JSON-RPC connection pool', () => {
  it('rejects a socket ceiling above the Explorer fairness budget', () => {
    expect(() => new JsonRPC({ maxSockets: 9 })).toThrow(
      'Bitcoin RPC maxSockets must be an integer from 1 to 8'
    );
  });

  it('reuses a bounded number of persistent sockets during a burst', /** @asyncUnsafe The test owns every request and closes the server and pool. */
  async () => {
    let connections = 0;
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const call = JSON.parse(body);
        setTimeout(() => {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ id: call.id, result: call.method }));
        }, 20);
      });
    });
    server.on('connection', () => (connections += 1));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );

    const address = server.address() as AddressInfo;
    const rpc = new JsonRPC({
      host: '127.0.0.1',
      port: address.port,
      timeout: 2000,
      maxSockets: 2,
    });

    try {
      await expect(
        Promise.all(
          Array.from({ length: 8 }, (_, index) => rpc.call(`read-${index}`, []))
        )
      ).resolves.toEqual(
        Array.from({ length: 8 }, (_, index) => `read-${index}`)
      );
      expect(rpc.agent.options.keepAlive).toBe(true);
      expect(rpc.agent.maxSockets).toBe(2);
      expect(rpc.agent.maxTotalSockets).toBe(2);
      expect(connections).toBeGreaterThan(0);
      expect(connections).toBeLessThanOrEqual(2);
    } finally {
      rpc.agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        })
      );
    }
  });

  it('frames UTF-8 parameters without poisoning the reused connection', /** @asyncUnsafe The test owns every request and closes the server and pool. */
  async () => {
    let connections = 0;
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const call = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: call.id, result: call.params[0] }));
      });
    });
    server.on('connection', () => (connections += 1));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );

    const address = server.address() as AddressInfo;
    const rpc = new JsonRPC({
      host: '127.0.0.1',
      port: address.port,
      timeout: 2000,
      maxSockets: 1,
    });

    try {
      await expect(rpc.call('echo', ['雪'])).resolves.toBe('雪');
      await expect(rpc.call('echo', ['after'])).resolves.toBe('after');
      expect(connections).toBe(1);
    } finally {
      rpc.agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        })
      );
    }
  });

  it('rejects a partial response and releases the pool for the next call', /** @asyncUnsafe The test owns every request and closes the server and pool. */
  async () => {
    let requestCount = 0;
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        requestCount += 1;
        const call = JSON.parse(body);
        if (requestCount === 1) {
          response.writeHead(200, {
            'content-length': '100',
            'content-type': 'application/json',
          });
          response.write('{"id":');
          response.destroy();
          return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ id: call.id, result: call.method }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );

    const address = server.address() as AddressInfo;
    const rpc = new JsonRPC({
      host: '127.0.0.1',
      port: address.port,
      timeout: 500,
      maxSockets: 1,
    });

    try {
      await expect(rpc.call('partial', [])).rejects.toMatchObject({
        code: 'ECONNRESET',
      });
      await expect(rpc.call('complete', [])).resolves.toBe('complete');
    } finally {
      rpc.agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        })
      );
    }
  });

  it('applies a shorter call deadline and releases its socket', /** @asyncUnsafe The test owns every request and closes the server and pool. */
  async () => {
    let requestCount = 0;
    const server = http.createServer((_request, response) => {
      requestCount += 1;
      if (requestCount === 1) {
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: requestCount, result: 'complete' }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );

    const address = server.address() as AddressInfo;
    const rpc = new JsonRPC({
      host: '127.0.0.1',
      port: address.port,
      timeout: 1000,
      maxSockets: 1,
    });

    try {
      await expect(rpc.call('slow', [], { timeout: 25 })).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });
      await expect(rpc.call('complete', [])).resolves.toBe('complete');
    } finally {
      rpc.agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        })
      );
    }
  });
});
