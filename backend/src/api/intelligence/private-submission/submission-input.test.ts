import express from 'express';
import { AddressInfo } from 'net';
import { Transaction } from 'bitcoinjs-lib';
import routes from './private-submission.routes';
import privateSubmissionService from './private-submission.service';
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
  it('serves all12 actual HTTP operations with their exact source states and malformed diagnosis as400', async () => {
    privateSubmissionService.diagnosisReaders = { mempoolEntry: () => undefined, mempoolInfo: () => null, replaces: () => undefined, replacedBy: () => undefined };
    const app = express();
    app.use(express.json());
    routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const base =
      'http://127.0.0.1:' +
      (server.address() as AddressInfo).port +
      '/api/v1/intelligence';
    // Relay-backed routes: absent integration, 503. Owned-source routes:
    // an unknown transaction or block is a 404, an empty observer answers
    // its state, an unconfigured directory is a 503, an unsupported
    // receipt encoding is a 400. Nothing answers success.
    const requests: [string, string, number, string, any?][] = [
      ['GET', '/submission/overview', 503, 'unavailable-source'],
      ['GET', '/submission/capabilities', 503, 'unavailable-source'],
      ['POST', '/submission/diagnose', 404, 'transaction-not-in-mempool', { txid: tx.getId() }],
      ['POST', '/submission/private', 503, 'unavailable-relay', { raw_tx: raw, method: 'public_p2p' }],
      ['GET', '/submission/private/token', 503, 'unavailable-relay'],
      ['POST', '/submission/private/token/abort', 503, 'unavailable-relay', {}],
      ['GET', '/accelerators/providers', 503, 'unavailable-registry'],
      ['GET', '/accelerators/providers/provider', 503, 'unavailable-registry'],
      [
        'POST',
        '/accelerators/receipts/verify',
        400,
        'unsupported',
        {
          provider_id: 'p',
          receipt_id: 'r',
          txid: tx.getId(),
          provider_signature: 'untrusted',
        },
      ],
      ['GET', '/ordering/transactions/' + tx.getId(), 404, 'transaction-not-observed'],
      ['GET', '/ordering/blocks/' + 'ab'.repeat(32), 404, 'block-not-observed'],
      ['GET', '/ordering/findings', 200, 'no-blocks-observed'],
    ];
    try {
      for (const [method, url, status, stage, body] of requests) {
        const res = await fetch(base + url, {
          method,
          ...(body
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : {}),
        });
        expect([url, res.status]).toEqual([url, status]);
        const v: any = await res.json();
        expect(v.stage ?? v.state).toBe(stage);
        expect(v.verified).not.toBe(true);
        expect(v.findings ?? []).toEqual([]);
      }
      const bad = await fetch(base + '/submission/diagnose', {
        method: 'POST',
      });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as any).stage).toBe('invalid-input');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
