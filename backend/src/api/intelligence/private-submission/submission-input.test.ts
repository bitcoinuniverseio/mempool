import express from 'express';
import { AddressInfo } from 'net';
import { Transaction } from 'bitcoinjs-lib';
import routes from './private-submission.routes';
import { setPrivateRelayRuntime } from './private-relay.runtime';
import {
  diagnosisInput,
  submissionInput,
  tokenInput,
} from './submission-input';
const tx = new Transaction();
tx.addInput(Buffer.alloc(32, 1), 0);
tx.addOutput(Buffer.from([0x51]), 1000);
const raw = tx.toHex();
describe('Private submission bounded inputs and real HTTP boundary', () => {
  it.each([
    undefined,
    {},
    [],
    { txid: 'bad' },
    { txid: tx.getId(), raw_tx: raw },
    { raw_tx: '0200' },
    { raw_tx: raw + '00' },
    { raw_tx: 1 },
  ])('rejects malformed or ambiguous diagnosis %#', (body) =>
    expect(() => diagnosisInput(body)).toThrow()
  );
  it('accepts complete raw serialization or exact txid without asserting relay acceptance', () => {
    expect(diagnosisInput({ raw_tx: raw })).toBe(raw);
    expect(diagnosisInput({ txid: tx.getId() })).toBe(tx.getId());
    expect(submissionInput({ raw_tx: raw, method: 'public_p2p' })).toEqual({
      raw_tx: raw,
      method: 'public_p2p',
    });
  });
  it.each([
    { raw_tx: raw, method: 'unknown' },
    { raw_tx: '0200', method: 'public_p2p' },
    { raw_tx: raw, method: 'public_p2p', endpoint: 'http://caller' },
  ])('rejects unsupported or injected submit %#', (body) =>
    expect(() => submissionInput(body)).toThrow()
  );
  it.each(['', 'x'.repeat(257), 'bad\nvalue'])(
    'bounds submission tokens',
    (token) => expect(() => tokenInput(token)).toThrow()
  );
  it('serves all12 actual HTTP operations as unavailable authorities and malformed diagnosis as400', async () => {
    // No database in this process: the private relay routes report the
    // missing durable store, which is the unavailable authority for them.
    setPrivateRelayRuntime({ network: 'signet', endpoints: { endpoints: [], issues: [], unconfigured: true }, store: null, worker: null, coreVersion: () => '?' });
    const app = express();
    app.use(express.json());
    routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const base =
      'http://127.0.0.1:' +
      (server.address() as AddressInfo).port +
      '/api/v1/intelligence';
    const requests: [string, string, any?][] = [
      ['GET', '/submission/overview'],
      ['GET', '/submission/capabilities'],
      ['POST', '/submission/diagnose', { txid: tx.getId() }],
      ['POST', '/submission/private', { raw_tx: raw, method: 'public_p2p' }],
      ['GET', '/submission/private/token'],
      ['POST', '/submission/private/token/abort', {}],
      ['GET', '/accelerators/providers'],
      ['GET', '/accelerators/providers/provider'],
      [
        'POST',
        '/accelerators/receipts/verify',
        {
          provider_id: 'p',
          receipt_id: 'r',
          txid: tx.getId(),
          provider_signature: 'untrusted',
        },
      ],
      ['GET', '/ordering/transactions/' + tx.getId()],
      ['GET', '/ordering/blocks/' + 'ab'.repeat(32)],
      ['GET', '/ordering/findings'],
    ];
    try {
      for (const [method, url, body] of requests) {
        const res = await fetch(base + url, {
          method,
          ...(body
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : {}),
        });
        expect(res.status).toBe(503);
        const v: any = await res.json();
        expect(v.stage).toContain('unavailable');
        expect(v.verified).not.toBe(true);
      }
      const bad = await fetch(base + '/submission/diagnose', {
        method: 'POST',
      });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as any).stage).toBe('invalid-input');
    } finally {
      setPrivateRelayRuntime(null);
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
