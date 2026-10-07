import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultVtxo } from '@arkade-os/sdk';
import { Transaction } from '@scure/btc-signer';
import { decodeArkade } from './codec.mjs';

function fixture(sequence = 0xffffffff, seconds = false) {
  const pubkey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const server = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
  const policy = new DefaultVtxo.Script({ pubKey: Buffer.from(pubkey, 'hex'), serverPubKey: Buffer.from(server, 'hex'), csvTimelock: { type: seconds ? 'seconds' : 'blocks', value: seconds ? 86016n : 144n } });
  const tx = new Transaction({ version: 3, allowUnknownOutputs: true });
  tx.addInput({ txid: new Uint8Array(32).fill(1), index: 0, sequence, witnessUtxo: { script: policy.pkScript, amount: 1000n } });
  tx.addOutput({ script: policy.pkScript, amount: 1000n });
  return { nodes: [{ txid: tx.id, tx: Buffer.from(tx.toPSBT()).toString('base64'), children: {} }], leaf_outpoint: tx.id + ':0', default_vtxo: { pubkey, server_pubkey: server, ...(seconds ? { version: 2, exit_delay_seconds: 86016 } : { exit_delay_blocks: 144 }) } };
}
test('official native codec preserves original PSBT and verifies public leaf policy', () => {
  const pkg = fixture(), original = JSON.stringify(pkg), result = decodeArkade(pkg);
  assert.equal(JSON.stringify(result.arkade), original); assert.equal(result.exit_delta, 144); assert.equal(result.amount_sats, 1000); assert.equal(result.expiry, null); assert.deepEqual(result.finalized, [false]);
});
test('official Arkade codec rejects the native Bark sequence rather than rewriting a signed identity', () => assert.throws(() => decodeArkade(fixture(0)), /sequence/));
test('rejects altered leaf policy and undeclared package data', () => {
  const pkg = fixture(); pkg.default_vtxo.exit_delay_blocks = 145; assert.throws(() => decodeArkade(pkg), /does not match/);
  assert.throws(() => decodeArkade({ ...fixture(), unknownPolicy: true }), /data loss/);
});
test('rejects cyclic native tree before calling the recursive SDK decoder', () => {
  const pkg = fixture(); pkg.nodes[0].children[0] = pkg.nodes[0].txid; assert.throws(() => decodeArkade(pkg), /cyclic/);
});

test('native seconds policy preserves original PSBT and BIP68 time flag without block reinterpretation', () => {
  const pkg = fixture(0xffffffff, true), original = JSON.stringify(pkg), result = decodeArkade(pkg);
  assert.equal(JSON.stringify(result.arkade), original);
  assert.equal(result.exit_delta, null);
  assert.deepEqual(result.exit_locktime, { version: 2, unit: 'seconds', value: 86016 });
  assert.equal(result.exit_path.sequence, 0x400000 | 168);
  assert.match(result.exit_path.script_hex, /^03a80040b275/);
  assert.equal(result.expiry, null); assert.equal(result.exit_viable, null);
});

test('rejects ambiguous units, unsupported versions, unrounded and overflow seconds', () => {
  for (const change of [{ exit_delay_blocks: 168 }, { version: 3 }, { exit_delay_seconds: 86017 }, { exit_delay_seconds: 0 }, { exit_delay_seconds: 33554432 }]) {
    const pkg = fixture(0xffffffff, true); Object.assign(pkg.default_vtxo, change); assert.throws(() => decodeArkade(pkg), /policy/);
  }
});

test('rejects changed seconds policy even when both values have legal encoding', () => {
  const pkg = fixture(0xffffffff, true); pkg.default_vtxo.exit_delay_seconds = 86528;
  assert.throws(() => decodeArkade(pkg), /does not match/);
});
