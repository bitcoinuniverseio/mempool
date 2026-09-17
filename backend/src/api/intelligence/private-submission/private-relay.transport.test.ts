import * as http from 'http';
import * as net from 'net';
import { AddressInfo } from 'net';
import { SocksPrivateRelayTransport, classifyResponse, describeTransportError } from './private-relay.transport';
import { PrivateRelayEndpoint } from './private-relay.types';

/**
 * The real SOCKS transport against a fake SOCKS5 server on localhost. The
 * fake accepts the no-auth handshake, records the hostname the client asked
 * for (which is how we know the onion name went to the proxy rather than to
 * DNS), and pipes the connection to a local HTTP server standing in for the
 * owned endpoint.
 */
const TXID = 'ab'.repeat(32);
const RAW_TX = '0200000001' + '00'.repeat(60);

interface FakeSocks {
  port: number;
  requestedHosts: string[];
  close(): Promise<void>;
}

function startFakeSocks(targetPort: number): Promise<FakeSocks> {
  const requestedHosts: string[] = [];
  const server = net.createServer((client) => {
    let stage: 'greeting' | 'request' | 'piped' = 'greeting';
    client.on('data', (chunk) => {
      if (stage === 'greeting') {
        if (chunk[0] !== 0x05) { client.destroy(); return; }
        client.write(Buffer.from([0x05, 0x00]));
        stage = 'request';
        return;
      }
      if (stage === 'request') {
        if (chunk[0] !== 0x05 || chunk[1] !== 0x01 || chunk[3] !== 0x03) { client.destroy(); return; }
        const length = chunk[4];
        requestedHosts.push(chunk.subarray(5, 5 + length).toString('utf8'));
        const upstream = net.connect(targetPort, '127.0.0.1', () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream).pipe(client);
        });
        upstream.on('error', () => client.destroy());
        stage = 'piped';
      }
    });
    client.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        requestedHosts,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function startTarget(handler: (body: string, res: http.ServerResponse, req: http.IncomingMessage) => void): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => handler(body, res, req));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: (server.address() as AddressInfo).port,
      close: () => new Promise((done) => server.close(() => done())),
    }));
  });
}

function endpoint(proxyPort: number, overrides: Partial<PrivateRelayEndpoint> = {}): PrivateRelayEndpoint {
  return {
    id: 'tor-test', transport: 'tor', proxy: `socks5h://127.0.0.1:${proxyPort}`,
    submitUrl: 'http://ownedexplorertestonionname.onion/api/tx', network: 'signet', timeoutMs: 5_000, ...overrides,
  };
}

describe('SocksPrivateRelayTransport', () => {
  const transport = new SocksPrivateRelayTransport();

  it('posts the raw hex through the SOCKS proxy to the onion name and reads the txid back', async () => {
    const seen: { method?: string; path?: string; contentType?: string; body?: string } = {};
    const target = await startTarget((body, res, req) => {
      seen.method = req.method; seen.path = req.url; seen.contentType = req.headers['content-type']; seen.body = body;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(TXID);
    });
    const socks = await startFakeSocks(target.port);
    try {
      const outcome = await transport.submit(endpoint(socks.port), RAW_TX, TXID);
      expect(outcome).toEqual({ kind: 'submitted', txid: TXID, httpStatus: 200 });
      expect(socks.requestedHosts).toEqual(['ownedexplorertestonionname.onion']);
      expect(seen).toEqual({ method: 'POST', path: '/api/tx', contentType: 'text/plain', body: RAW_TX });
      expect(await transport.probeProxy(endpoint(socks.port))).toBe(true);
    } finally {
      await socks.close();
      await target.close();
    }
  });

  it('maps the endpoint rejection text to a rejected outcome and does not retry through the proxy', async () => {
    let hits = 0;
    const target = await startTarget((_body, res) => {
      hits++;
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('sendrawtransaction RPC error: {"code":-25,"message":"bad-txns-inputs-missingorspent"}');
    });
    const socks = await startFakeSocks(target.port);
    try {
      const outcome = await transport.submit(endpoint(socks.port), RAW_TX, TXID);
      expect(outcome).toMatchObject({ kind: 'rejected', httpStatus: 400, reason: expect.stringContaining('missingorspent') });
      expect(hits).toBe(1);
    } finally {
      await socks.close();
      await target.close();
    }
  });

  it('reports a proxy that is not listening as unreachable, without a raw transaction in the reason', async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
    const freePort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const outcome = await transport.submit(endpoint(freePort, { timeoutMs: 2_000 }), RAW_TX, TXID);
    expect(outcome.kind).toBe('unreachable');
    expect(JSON.stringify(outcome)).not.toContain(RAW_TX);
    expect(await transport.probeProxy(endpoint(freePort, { timeoutMs: 2_000 }))).toBe(false);
  });
});

describe('private relay response classification', () => {
  it('treats a different txid as a rejection, a 5xx as unreachable, and a bare 2xx as submitted', () => {
    expect(classifyResponse(200, 'cd'.repeat(32), TXID)).toEqual({ kind: 'rejected', reason: 'endpoint-returned-different-txid', httpStatus: 200 });
    expect(classifyResponse(200, TXID.toUpperCase() + '\n', TXID)).toEqual({ kind: 'submitted', txid: TXID, httpStatus: 200 });
    expect(classifyResponse(202, '', TXID)).toEqual({ kind: 'submitted', txid: TXID, httpStatus: 202 });
    expect(classifyResponse(502, 'bad gateway', TXID)).toEqual({ kind: 'unreachable', reason: 'http-502' });
    expect(classifyResponse(422, 'x'.repeat(1000), TXID)).toMatchObject({ kind: 'rejected', reason: 'x'.repeat(200) });
  });

  it('describes transport errors by code and strips long hex from messages', () => {
    expect(describeTransportError({ code: 'ECONNREFUSED' })).toBe('econnrefused');
    expect(describeTransportError(new Error('failed ' + RAW_TX))).toBe('failed <hex>');
    expect(describeTransportError('?')).toBe('transport-error');
  });
});
