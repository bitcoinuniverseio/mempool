import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultVtxo } from '@arkade-os/sdk';
import { Transaction } from '@scure/btc-signer';
import { decodeArkade } from './codec.mjs';

function fixture(sequence = 0xffffffff) {
  const pubkey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const server = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
  const policy = new DefaultVtxo.Script({ pubKey: Buffer.from(pubkey, 'hex'), serverPubKey: Buffer.from(server, 'hex'), csvTimelock: { type: 'blocks', value: 144n } });
  const tx = new Transaction({ version: 3, allowUnknownOutputs: true });
  tx.addInput({ txid: new Uint8Array(32).fill(1), index: 0, sequence, witnessUtxo: { script: policy.pkScript, amount: 1000n } });
  tx.addOutput({ script: policy.pkScript, amount: 1000n });
  return { nodes: [{ txid: tx.id, tx: Buffer.from(tx.toPSBT()).toString('base64'), children: {} }], leaf_outpoint: tx.id + ':0', default_vtxo: { pubkey, server_pubkey: server, exit_delay_blocks: 144 } };
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
