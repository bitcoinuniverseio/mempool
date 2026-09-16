import { Application, Request, Response } from 'express';
import workbenchRoutes from './workbench.routes';
import { WorkbenchEvidenceError, WorkbenchService, workbenchService } from './workbench.service';
import { Psbt, payments, Transaction } from 'bitcoinjs-lib';
import * as secp from 'tiny-secp256k1';
import express from 'express';
import { request } from 'http';

jest.mock('./workbench-core', () => ({ ownedWorkbenchCore: { network: 'signet', call: async () => { throw new Error('offline'); } } }));

describe('Owned Core script and public descriptor reads', () => {
  const key = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const bitcoin = require('bitcoinjs-lib');
  const payment = payments.p2wpkh({ pubkey: Buffer.from(key, 'hex'), network: bitcoin.networks.testnet });
  const calls: string[] = [];
  const reader = { network: 'signet', call: jest.fn(async (method: string) => {
    calls.push(method);
    if (method === 'getblockchaininfo') return { chain: 'signet', bestblockhash: 'ab'.repeat(32) };
    if (method === 'getdescriptorinfo') return { descriptor: `wpkh(${key})#checksum`, checksum: 'checksum', isrange: false, hasprivatekeys: false };
    if (method === 'deriveaddresses') return [payment.address];
    if (method === 'decodescript') return { asm: '0 ' + payment.hash!.toString('hex'), type: 'witness_v0_keyhash' };
    throw new Error('unexpected operation');
  }) };
  beforeEach(() => { calls.length = 0; reader.call.mockClear(); });

  it('disassembles with the real source contract without claiming consensus or policy validity', async () => {
    const result = await new WorkbenchService(reader).analyzeScript(payment.output!.toString('hex'));
    expect(result).toMatchObject({ script_type: 'witness_v0_keyhash', consensus_valid: null, is_standard: null, max_satisfaction_weight: null, source: { chain: 'signet' } });
    expect(calls).toEqual(['getblockchaininfo', 'decodescript']);
  });

  it('derives public addresses and reconstructs their exact output scripts on the selected network', async () => {
    const result = await new WorkbenchService(reader).parseDescriptor(`wpkh(${key})`);
    expect(result).toMatchObject({ is_valid: true, script_type: 'p2wpkh', is_range: false,
      derived_samples: [{ index: 0, address: payment.address, script_pub_key: payment.output!.toString('hex') }] });
    expect(calls).toEqual(['getblockchaininfo', 'getdescriptorinfo', 'deriveaddresses']);
  });

  it('refuses a wrong-chain source before descriptor or script calls', async () => {
    const call = jest.fn(async () => ({ chain: 'main', bestblockhash: 'ab'.repeat(32) }));
    const service = new WorkbenchService({ network: 'signet', call });
    await expect(service.parseDescriptor(`wpkh(${key})`)).rejects.toMatchObject({ code: 'wrong-network' });
    await expect(service.analyzeScript('51')).rejects.toMatchObject({ code: 'wrong-network' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('rejects private descriptors, unbounded ranges and malformed scripts before RPC', async () => {
    const service = new WorkbenchService(reader);
    await expect(service.parseDescriptor('wpkh(xprv' + 'A'.repeat(100) + ')')).rejects.toMatchObject({ code: 'private-key-forbidden' });
    await expect(service.parseDescriptor(`wpkh(${key})`, [0, 1000])).rejects.toMatchObject({ code: 'invalid-range' });
    await expect(service.analyzeScript('0014ab')).rejects.toMatchObject({ code: 'invalid-script' });
    expect(calls).toEqual([]);
  });

  it('maps Core invalid-input errors into a sanitized client error', async () => {
    const service = new WorkbenchService({ network: 'signet', call: async (method) => {
      if (method === 'getblockchaininfo') return { chain: 'signet', bestblockhash: 'ab'.repeat(32) };
      throw { code: -5, message: 'sensitive supplied descriptor text' };
    } });
    await expect(service.parseDescriptor('wpkh(invalid)')).rejects.toMatchObject({ code: 'invalid-input', status: 400 });
  });
});

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: every script consensus-valid, a stack simulation that always ran
 * one successful OP_CHECKSIG, one Miniscript for every policy, random derived
 * addresses, and a PSBT whose txid and fee never changed. Passing those proved
 * the constants were present, not that anything was analysed.
 */
describe('Product 7: Bitcoin Script, Descriptor, Miniscript, and PSBT Workbench', () => {
  const p2wpkhScript = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports an offline reader and missing execution engine separately', async () => {
    await expect(workbenchService.analyzeScript(p2wpkhScript)).rejects.toThrow(unavailable('unavailable-bitcoin-reader'));
    await expect(workbenchService.simulateStack(p2wpkhScript, ['30440220...', '0279be66...'])).rejects.toThrow(expect.objectContaining({ status: 400 }));
    await expect(workbenchService.compileMiniscript('and(pk(A),older(144))')).rejects.toThrow(expect.objectContaining({ code: 'invalid-policy', status: 400 }));
  });

  it('reports an unavailable descriptor source rather than random derived addresses', async () => {
    await expect(workbenchService.parseDescriptor('wpkh([d34db33f/84h/0h/0h]xpub6ERApfZtsWPgv2EZpqRz12345/0/*)#abc12345'))
      .rejects.toThrow(unavailable('unavailable-bitcoin-reader'));
  });

  it('rejects malformed PSBT bytes with a client error', () => {
    expect(() => workbenchService.analyzePsbt('70736274ff0100520200000001000000')).toThrow(expect.objectContaining({ code: 'invalid-psbt', status: 400 }));
  });

  it('never resolves an absent engine as an empty analysis', async () => {
    for (const read of [
      () => workbenchService.analyzeScript(p2wpkhScript),
      () => workbenchService.simulateStack(p2wpkhScript),
      () => workbenchService.compileMiniscript('pk(A)'),
      () => workbenchService.parseDescriptor('wpkh(A)'),
      () => workbenchService.analyzePsbt('70736274ff'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(WorkbenchEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Workbench HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const posts = new Map<string, Handler>();
    const app = {
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    workbenchRoutes.initRoutes(app as unknown as Application);
    return posts;
  }

  it('distinguishes malformed PSBT input from unavailable engines', async () => {
    const posts = mount();
    expect(posts.size).toBe(7);
    expect(posts.has('/api/v1/intelligence/workbench/transaction/verify')).toBe(true);
    const body = { script_hex: '0014' + 'ab'.repeat(20), witness: [], policy: 'pk(A)', descriptor: 'wpkh(A)', psbt: '70736274ff' };
    for (const [route, handler] of posts.entries()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ body } as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(route.endsWith('psbt/analyze') || route.endsWith('miniscript/compile') || route.endsWith('script/simulate') || route.endsWith('transaction/verify') ? 400 : 503);
      const answer = res.json.mock.calls[0][0];
      expect(answer.stage).toMatch(route.endsWith('psbt/analyze') ? /^invalid-psbt$/ : route.endsWith('miniscript/compile') ? /^invalid-policy$/ : route.endsWith('script/simulate') ? /^transaction-context-required$/ : route.endsWith('transaction/verify') ? /^invalid-transaction-context$/ : /^unavailable-/);
      expect(typeof answer.error).toBe('string');
      expect(answer).not.toHaveProperty('steps');
      expect(answer).not.toHaveProperty('derived');
      expect(answer).not.toHaveProperty('is_complete');
    }
  });

  it('keeps a 400 for a request with nothing to analyse', async () => {
    const posts = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await posts.get('/api/v1/intelligence/workbench/psbt/analyze')!({ body: {} } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('Actual offline PSBT inspection', () => {
  const privateKey = Buffer.alloc(32, 1); // deterministic, worthless test fixture only
  const publicKey = Buffer.from(secp.pointFromScalar(privateKey)!);
  const output = payments.p2wpkh({ pubkey: publicKey }).output!;
  const fixture = (withUtxo = true): Psbt => new Psbt()
    .addInput({ hash: '01'.repeat(32), index: 0, ...(withUtxo ? { witnessUtxo: { script: output, value: 10000 } } : {}) })
    .addOutput({ script: output, value: 9000 });

  const u32 = (value: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
  const u64 = (value: number): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
  const map = (entries: Array<[string, Buffer]>): Buffer => Buffer.concat(entries.flatMap(([key, value]) => {
    const raw = Buffer.from(key, 'hex'); return [Buffer.from([raw.length]), raw, Buffer.from([value.length]), value];
  }).concat([Buffer.from([0])]));
  const v2 = (extra: Array<Array<[string, Buffer]>> = [[]]): string => Buffer.concat([
    Buffer.from('70736274ff', 'hex'), map([['fb', u32(2)], ['02', u32(2)], ['03', u32(77)], ['04', Buffer.from([extra.length])], ['05', Buffer.from([1])]]),
    ...extra.map((fields, i) => map([['0e', Buffer.alloc(32, i + 1)], ['0f', u32(0)], ['10', u32(42)], ['01', Buffer.concat([u64(10000), Buffer.from([output.length]), output])], ...fields])),
    map([['03', u64(9000)], ['04', output]])
  ]).toString('base64');

  it('reconstructs actual BIP370 transaction fields and distinct zero-sequence PSBT identity', () => {
    const result = workbenchService.analyzePsbt(v2());
    const tx = new Transaction(); tx.version = 2; tx.locktime = 77; tx.addInput(Buffer.alloc(32, 1), 0, 42); tx.addOutput(output, 9000);
    expect(result).toMatchObject({ version: 2, txid: tx.getId(), total_fee_sats: 1000 });
    tx.ins[0].sequence = 0;
    expect(result.psbt_id).toBe(tx.getId());
    expect(result.psbt_id).not.toBe(result.txid);
  });

  it('uses BIP370 required locktime intersection, prefers height and rejects incompatible types', () => {
    const tx = new Transaction(); tx.version = 2; tx.locktime = 144; tx.addInput(Buffer.alloc(32, 1), 0, 42); tx.addOutput(output, 9000);
    const result = workbenchService.analyzePsbt(v2([[['11', u32(500000010)], ['12', u32(144)]]]));
    expect(result.txid).toBe(tx.getId());
    expect(() => workbenchService.analyzePsbt(v2([[['11', u32(500000010)]], [['12', u32(144)]]]))).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => workbenchService.analyzePsbt(v2([[['12', u32(0)]]]))).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('decodes both encodings and derives counts, unsigned txid and actual fee', () => {
    const psbt = fixture();
    const result = workbenchService.analyzePsbt(psbt.toBase64());
    expect(result).toEqual(workbenchService.analyzePsbt(psbt.toHex()));
    expect(result).toMatchObject({ version: 0, transaction_version: 2, input_count: 1, output_count: 1,
      total_fee_sats: 1000, feerate_sats_vb: null, is_complete: false, chain_validated: false });
    const changed = fixture().addOutput({ script: output, value: 1 });
    expect(workbenchService.analyzePsbt(changed.toHex()).txid).not.toBe(result.txid);
  });

  it('reports unknown fee and signers for missing UTXO data', () => {
    const result = workbenchService.analyzePsbt(fixture(false).toHex());
    expect(result.total_fee_sats).toBeNull();
    expect(result.inputs_status[0]).toMatchObject({ has_utxo: false, required_sigs: null, missing_signers: null });
  });

  it('cryptographically validates partial signatures and computes finalized virtual size', () => {
    const psbt = fixture();
    psbt.signInput(0, { publicKey, sign: hash => Buffer.from(secp.sign(hash, privateKey)) });
    const signed = workbenchService.analyzePsbt(psbt.toBase64());
    expect(signed.inputs_status[0]).toMatchObject({ required_sigs: 1, present_sigs: 1, partial_signatures_valid: true });
    expect(signed.is_complete).toBe(false);
    psbt.finalizeAllInputs();
    const result = workbenchService.analyzePsbt(psbt.toBase64());
    expect(result.is_complete).toBe(true);
    expect(result.chain_validated).toBe(false);
    expect(result.txid_kind).toBe('finalized-transaction');
    expect(result.txid).toBe(psbt.extractTransaction().getId());
    expect(result.feerate_sats_vb).toBe(1000 / psbt.extractTransaction().virtualSize());
  });

  it('does not validate a mutated signature', () => {
    const psbt = fixture();
    psbt.signInput(0, { publicKey, sign: hash => Buffer.from(secp.sign(hash, privateKey)) });
    psbt.data.inputs[0].partialSig![0].signature[10] ^= 1;
    expect(workbenchService.analyzePsbt(psbt.toHex()).inputs_status[0].partial_signatures_valid).not.toBe(true);
  });

  it('rejects a substituted previous transaction and inconsistent UTXO amounts', () => {
    const tx = new Transaction();
    tx.addInput(Buffer.alloc(32, 2), 0);
    tx.addOutput(output, 10000);
    const bad = fixture();
    bad.updateInput(0, { nonWitnessUtxo: tx.toBuffer() });
    expect(() => workbenchService.analyzePsbt(bad.toHex())).toThrow(expect.objectContaining({ status: 400 }));
    const conflicting = new Psbt().addInput({ hash: tx.getId(), index: 0, nonWitnessUtxo: tx.toBuffer(), witnessUtxo: { script: output, value: 9999 } }).addOutput({ script: output, value: 9000 });
    expect(() => workbenchService.analyzePsbt(conflicting.toHex())).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('rejects malformed encodings, excessive size and incompatible PSBT version', () => {
    for (const text of ['70736274ff0', fixture().toBase64() + '!', 'a'.repeat(2 * 1024 * 1024 + 1)]) {
      expect(() => workbenchService.analyzePsbt(text)).toThrow(expect.objectContaining({ status: 400 }));
    }
    const psbt = fixture();
    psbt.addUnknownKeyValToGlobal({ key: Buffer.from([0xfb]), value: Buffer.from([2, 0, 0, 0]) });
    expect(() => workbenchService.analyzePsbt(psbt.toHex())).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('serves a real HTTP analysis from serialized PSBT bytes and rejects tampering', async () => {
    const app = express();
    app.use(express.json());
    workbenchRoutes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const post = (psbt: string): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: address.port, path: '/api/v1/intelligence/workbench/psbt/analyze',
        method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ psbt }));
    });
    try {
      const result = await post(fixture().toBase64());
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ input_count: 1, total_fee_sats: 1000, is_complete: false, chain_validated: false });
      const bad = await post('70736274ff');
      expect(bad).toMatchObject({ status: 400, body: { stage: 'invalid-psbt' } });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
