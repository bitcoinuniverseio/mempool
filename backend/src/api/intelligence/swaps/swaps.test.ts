import { crypto, initEccLib, networks, payments, Psbt, script, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { SwapsService } from './swaps.service';
import { BitcoinSwapAuthority, SwapAuthority, swapContext } from './swaps-evidence';
import { SwapContext, SwapPackage } from './swaps.models';
import { SwapObservationStore } from './swaps-observations';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import config from '../../../config';
import routes from './swaps.routes';

jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getBlockchainInfo: jest.fn(), getRawTransaction: jest.fn(), getTxOut: jest.fn(), getBlockHeader: jest.fn(), getBlockHash: jest.fn() } }));
initEccLib(ecc);
const ctx: SwapContext = { chain: 'bitcoin', network: 'signet' };
// Controlled unit-test secrets and fabricated transactions, never chain acceptance fixtures.
const refundSecret = Buffer.alloc(32, 1), claimSecret = Buffer.alloc(32, 2);
const refundKey = Buffer.from(ecc.xOnlyPointFromScalar(refundSecret)), claimKey = Buffer.from(ecc.xOnlyPointFromScalar(claimSecret));
const internalKey = Buffer.from(ecc.xOnlyPointFromScalar(Buffer.alloc(32, 3))), preimage = Buffer.alloc(32, 4);
const hash = crypto.sha256(preimage);
const claim = script.compile([script.OPS.OP_HASH160, crypto.ripemd160(hash), script.OPS.OP_EQUALVERIFY, claimKey, script.OPS.OP_CHECKSIG]);
const refund = script.compile([refundKey, script.OPS.OP_CHECKSIGVERIFY, script.number.encode(200), script.OPS.OP_CHECKLOCKTIMEVERIFY]);
const tree: [{ output: Buffer }, { output: Buffer }] = [{ output: claim }, { output: refund }];
const payment = payments.p2tr({ network: networks.testnet, internalPubkey: internalKey, scriptTree: tree, redeem: { output: refund, redeemVersion: 0xc0 } });
const destination = payments.p2wpkh({ network: networks.testnet, pubkey: Buffer.from(ecc.pointFromScalar(refundSecret)!) }).address!;
const lockup = new Transaction(); lockup.addInput(Buffer.alloc(32, 8), 0); lockup.addOutput(Buffer.from('6a', 'hex'), 0); lockup.addOutput(payment.output!, 100000);
const pkg: Partial<SwapPackage> = { ...ctx, protocol_id: 'boltz_submarine_v2', swap_type: 'submarine', lockup_transaction: lockup.getId(), lockup_vout: 1,
  lockup_address: payment.address, expected_amount_sats: 100000, preimage_hash: hash.toString('hex'), timeout_height: 200,
  claim_public_key: claimKey.toString('hex'), refund_public_key: refundKey.toString('hex'), internal_key: internalKey.toString('hex'), destination_address: destination, fee_sats: 1000 };
const checkpoint = { ...ctx, source_id: 'controlled-unit-authority', block_height: 200, block_hash: '11'.repeat(32), observed_at: '2026-09-05T00:00:00.000Z' };
const evidence = { transaction: lockup, confirmations: 3, context: checkpoint, unspent: true };
const authority = (): jest.Mocked<SwapAuthority> => ({ lockup: jest.fn().mockResolvedValue(evidence), transaction: jest.fn() });
const store = (): jest.Mocked<SwapObservationStore> => ({ save: jest.fn().mockResolvedValue(undefined), recent: jest.fn().mockResolvedValue([]) });
function signedSpend(isRefund: boolean): Transaction {
  const tx = new Transaction(); tx.version = 2; tx.locktime = isRefund ? 200 : 0;
  tx.addInput(Buffer.from(lockup.getId(), 'hex').reverse(), 1, 0xfffffffd);
  tx.addOutput(payments.p2wpkh({ network: networks.testnet, address: destination }).output!, 99000);
  const leaf = isRefund ? refund : claim;
  const leafHash = crypto.taggedHash('TapLeaf', Buffer.concat([Buffer.from([0xc0, leaf.length]), leaf]));
  const sig = Buffer.from(ecc.signSchnorr(tx.hashForWitnessV1(0, [payment.output!], [100000], 0, leafHash), isRefund ? refundSecret : claimSecret));
  const control = payments.p2tr({ network: networks.testnet, internalPubkey: internalKey, scriptTree: tree, redeem: { output: leaf, redeemVersion: 0xc0 } }).witness![1];
  tx.setWitness(0, isRefund ? [sig, leaf, control] : [sig, preimage, leaf, control]); return tx;
}

describe('Swap evidence and unsigned recovery with controlled unit authority', () => {
  it('removes synthetic overview, provider records, metrics and settlement assertions', /** @asyncUnsafe Jest owns rejected test promises. */ async () => {
    const service = new SwapsService(authority(), store()), overview = await service.getOverview(ctx);
    expect(overview.total_swaps_observed).toBeNull(); expect(overview.total_volume_sats).toBeNull(); expect(overview.active_providers_count).toBeNull();
    expect(overview.recent_swaps).toEqual([]); expect(service.listProviders()).toEqual([]); expect(service.getProviderHistory('boltz-exchange')).toBeNull(); expect(service.listProtocols()).toHaveLength(4);
    expect(service.reconcileCrossLayer('swp-boltz-887412-002').reconciliation_state).toBe('insufficient_private_evidence');
  });
  it('reports absent durable observation storage', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const db = store(); db.recent.mockRejectedValue(new Error('offline')); expect((await new SwapsService(authority(), db).getOverview(ctx)).observation_status).toBe('unavailable-storage'); });
  it('rejects the original fabricated lockup counterexample', /** @asyncUnsafe Jest owns rejected test promises. */ async () => {
    const result = await new SwapsService(authority(), store()).verifyLockup({ lockup_address: 'x', expected_amount_sats: 1, preimage_hash: '!'.repeat(64), timeout_height: 864300, lockup_transaction: 'fake' }, ctx);
    expect(result.verified).toBe(false); expect(result.current_confirmations).toBe(0); expect(result.script_matches).toBe(false);
  });
  it.each([{ preimage_hash: '!'.repeat(64) }, { expected_amount_sats: 99999 }, { lockup_vout: 0 }, { network: 'mainnet' }, { internal_key: 'ff'.repeat(32) }, { lockup_address: 'bc1qfake' }, { lockup_transaction: 'not-a-txid' }, { timeout_height: 500000000 }])('rejects invalid package %j', /** @asyncUnsafe Jest owns rejected test promises. */ async changes => { expect((await new SwapsService(authority(), store()).verifyLockup({ ...pkg, ...changes }, ctx)).verified).toBe(false); });
  it('checks trusted output index, amount, script and confirmations', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { expect(await new SwapsService(authority(), store()).verifyLockup(pkg, ctx)).toMatchObject({ verified: true, current_confirmations: 3, output_index: 1, script_matches: true, amount_matches: true }); });
  it('does not treat unconfirmed evidence as confirmed', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const node = authority(); node.lockup.mockResolvedValue({ ...evidence, confirmations: 0 }); expect((await new SwapsService(node, store()).verifyLockup(pkg, ctx)).verified).toBe(false); });
  it('builds a complete unsigned PSBT from the trusted nonzero outpoint', /** @asyncUnsafe Jest owns rejected test promises. */ async () => {
    const plan = await new SwapsService(authority(), store()).planRecovery({ ...pkg, status: 'claimed' }, ctx);
    expect(plan.stage).toBe('unsigned-plan-ready'); const psbt = Psbt.fromBase64(plan.unsigned_recovery_psbt!);
    expect(psbt.txInputs[0].index).toBe(1); expect(psbt.txInputs[0].sequence).toBe(0xfffffffd); expect(psbt.locktime).toBe(200); expect(psbt.version).toBe(2);
    expect(psbt.txOutputs[0].value).toBe(99000); expect(psbt.data.inputs[0].witnessUtxo?.value).toBe(100000); expect(psbt.data.inputs[0].tapLeafScript?.[0].script).toEqual(refund);
    expect(psbt.data.inputs[0].tapScriptSig).toBeUndefined(); expect(plan.current_state).toBe('unknown');
  });
  it('independently checks the reverse-swap two-leaf format and builds its refund', /** @asyncUnsafe Jest owns rejected test promises. */ async () => {
    const reverseClaim = script.compile([script.OPS.OP_SIZE, script.number.encode(32), script.OPS.OP_EQUALVERIFY, script.OPS.OP_HASH160, crypto.ripemd160(hash), script.OPS.OP_EQUALVERIFY, claimKey, script.OPS.OP_CHECKSIG]);
    const reversePayment = payments.p2tr({ network: networks.testnet, internalPubkey: internalKey, scriptTree: [{ output: reverseClaim }, { output: refund }], redeem: { output: refund, redeemVersion: 0xc0 } });
    const reverseLockup = lockup.clone(); reverseLockup.outs[1].script = reversePayment.output!;
    const node = authority(); node.lockup.mockResolvedValue({ ...evidence, transaction: reverseLockup });
    const reversePackage = { ...pkg, swap_type: 'reverse' as const, lockup_address: reversePayment.address, lockup_transaction: reverseLockup.getId() };
    const service = new SwapsService(node, store()); expect((await service.verifyLockup(reversePackage, ctx)).verified).toBe(true);
    const plan = await service.planRecovery(reversePackage, ctx); expect(plan.stage).toBe('unsigned-plan-ready');
    expect(Psbt.fromBase64(plan.unsigned_recovery_psbt!).data.inputs[0].tapLeafScript?.[0].controlBlock).toEqual(reversePayment.witness![1]);
  });
  it('produces an artifact usable by a controlled Taproot signer', /** @asyncUnsafe Jest owns rejected test promises. */ async () => {
    const plan = await new SwapsService(authority(), store()).planRecovery(pkg, ctx), psbt = Psbt.fromBase64(plan.unsigned_recovery_psbt!);
    psbt.signInput(0, { publicKey: Buffer.from(ecc.pointFromScalar(refundSecret)!), signSchnorr: data => Buffer.from(ecc.signSchnorr(data, refundSecret)), sign: () => { throw new Error('ECDSA unexpected'); } }); psbt.finalizeInput(0);
    const tx = psbt.extractTransaction(); expect(tx.ins[0].witness).toHaveLength(3); expect(tx.ins[0].witness[1]).toEqual(refund);
  });
  it.each([{ fee_sats: 0 }, { fee_sats: 100001 }, { fee_sats: 1.5 }, { destination_address: payments.p2wpkh({ pubkey: Buffer.from(ecc.pointFromScalar(refundSecret)!) }).address }])('rejects unsafe recovery %j', /** @asyncUnsafe Jest owns rejected test promises. */ async changes => { const plan = await new SwapsService(authority(), store()).planRecovery({ ...pkg, ...changes }, ctx); expect(plan.unsigned_recovery_psbt).toBeUndefined(); expect(plan.stage).toBe('invalid'); });
  it('does not equate a spent output with the claimed caller status', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const node = authority(); node.lockup.mockResolvedValue({ ...evidence, unspent: false }); const plan = await new SwapsService(node, store()).planRecovery({ ...pkg, status: 'claimed' }, ctx); expect(plan.stage).toBe('already-spent'); expect(plan.current_state).toBe('unknown'); expect(plan.unsigned_recovery_psbt).toBeUndefined(); });
  it('withholds artifacts before authoritative maturity', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const node = authority(); node.lockup.mockResolvedValue({ ...evidence, context: { ...checkpoint, block_height: 199 } }); const plan = await new SwapsService(node, store()).planRecovery(pkg, ctx); expect(plan.stage).toBe('not-yet-mature'); expect(plan.blocks_until_refund).toBe(1); expect(plan.unsigned_recovery_psbt).toBeUndefined(); });
  it('maturity cannot verify a completed refund', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const result = await new SwapsService(authority(), store()).verifyRefund(pkg, ctx); expect(result.timeout_matured).toBe(true); expect(result.verified).toBe(false); expect(result.witness_valid).toBe(false); });
  it.each([true, false])('verifies controlled actual spending signatures refund=%s', /** @asyncUnsafe Jest owns rejected test promises. */ async refundPath => {
    const node = authority(), tx = signedSpend(refundPath); node.lockup.mockResolvedValue({ ...evidence, unspent: false }); node.transaction.mockResolvedValue({ transaction: tx, confirmations: 1 });
    const service = new SwapsService(node, store()); const result = refundPath ? await service.verifyRefund({ ...pkg, refund_transaction: tx.getId() }, ctx) : await service.verifyClaim({ ...pkg, claim_transaction: tx.getId() }, ctx); expect(result.verified).toBe(true); expect(result.witness_valid).toBe(true);
  });
  it('rejects an invalid witness despite a claimed status', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const node = authority(), tx = signedSpend(false); tx.ins[0].witness[0][0] ^= 1; node.lockup.mockResolvedValue({ ...evidence, unspent: false }); node.transaction.mockResolvedValue({ transaction: tx, confirmations: 1 }); const result = await new SwapsService(node, store()).verifyClaim({ ...pkg, claim_transaction: tx.getId(), status: 'claimed' }, ctx); expect(result.verified).toBe(false); expect(result.witness_valid).toBe(false); });
  it.each(['boltz_chain_v1', 'lightning_loop_v1', 'ark_vhtlc_v1'])('keeps %s separate and unverified', /** @asyncUnsafe Jest owns rejected test promises. */ async protocol_id => { expect((await new SwapsService(authority(), store()).planRecovery({ ...pkg, protocol_id }, ctx)).stage).toBe('unsupported-adapter'); });
  it('rejects fabricated and unknown signed manifests', () => { const service = new SwapsService(authority(), store()); expect(service.verifyProviderManifest({ provider_id: 'x', identity_key: 'not-key', provider_signature: 'not-signature', protocols: ['boltz_submarine_v2'] }).valid).toBe(false); expect(service.verifyProviderManifest({ provider_id: 'x', identity_key: '02' + refundKey.toString('hex'), provider_signature: '00'.repeat(64) }).valid).toBe(false); });
});

describe('Configured first-party node authority', () => {
  const rpc = bitcoinClient as any;
  beforeEach(() => { jest.clearAllMocks(); config.MEMPOOL.NETWORK = 'signet'; rpc.getBlockchainInfo.mockResolvedValue({ chain: 'signet', blocks: 200, bestblockhash: checkpoint.block_hash, initialblockdownload: false }); rpc.getRawTransaction.mockResolvedValue({ hex: lockup.toHex(), blockhash: '22'.repeat(32) }); rpc.getBlockHeader.mockResolvedValue({ height: 198, confirmations: 3 }); rpc.getBlockHash.mockResolvedValue('22'.repeat(32)); rpc.getTxOut.mockResolvedValue({ bestblock: checkpoint.block_hash, scriptPubKey: { hex: payment.output!.toString('hex') } }); });
  it('checks active block and UTXO using the shared configured RPC', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const found = await new BitcoinSwapAuthority().lockup(ctx, lockup.getId(), 1); expect(found.confirmations).toBe(3); expect(found.unspent).toBe(true); expect(rpc.getTxOut).toHaveBeenCalledWith(lockup.getId(), 1, true); });
  it('rejects network mismatch before RPC', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { await expect(new BitcoinSwapAuthority().lockup({ ...ctx, network: 'mainnet' }, lockup.getId(), 1)).rejects.toMatchObject({ code: 'wrong-network' }); expect(rpc.getBlockchainInfo).not.toHaveBeenCalled(); });
  it('checks actual node-reported network', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { rpc.getBlockchainInfo.mockResolvedValue({ chain: 'main' }); await expect(new BitcoinSwapAuthority().lockup(ctx, lockup.getId(), 1)).rejects.toMatchObject({ code: 'wrong-network' }); });
  it('rejects displaced transactions', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { rpc.getBlockHeader.mockResolvedValue({ height: 198, confirmations: -1 }); await expect(new BitcoinSwapAuthority().lockup(ctx, lockup.getId(), 1)).rejects.toMatchObject({ code: 'reorged' }); });
  it('rejects an absent UTXO RPC result instead of treating it as unspent', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { rpc.getTxOut.mockResolvedValue(undefined); await expect(new BitcoinSwapAuthority().lockup(ctx, lockup.getId(), 1)).rejects.toMatchObject({ code: 'invalid' }); });
  it('bounds concurrent reads', /** @asyncUnsafe Jest owns rejected test promises. */ async () => { const node = new BitcoinSwapAuthority(), first = node.lockup(ctx, lockup.getId(), 1); await expect(node.lockup(ctx, lockup.getId(), 1)).rejects.toMatchObject({ code: 'source-busy' }); await first; });
});

describe('Real route handlers', () => {
  const handlers = new Map<string, any>();
  beforeAll(() => routes.initRoutes({ get: (path, handler) => handlers.set(`GET ${path}`, handler), post: (path, handler) => handlers.set(`POST ${path}`, handler) } as any));
  it.each([{ current_height: 9999999 }, { privateKey: 'sensitive' }])('rejects unsafe request fields %j', /** @asyncUnsafe Jest owns rejected test promises. */ async extra => { const res: any = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); res.json.mockReturnValue(res); await handlers.get('POST /api/v1/intelligence/swaps/chain-context')({ method: 'POST', path: '/chain-context', query: ctx, body: { ...pkg, ...extra } }, res); expect(res.status).toHaveBeenCalledWith(400); expect(res.json.mock.calls[0][0].stage).toBe('invalid'); });
  it('rejects partial network context', () => expect(() => swapContext(undefined, 'signet')).toThrow());
});
