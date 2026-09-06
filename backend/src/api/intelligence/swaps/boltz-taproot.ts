import { address, crypto, initEccLib, networks, payments, script, Psbt, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { SwapContext, SwapPackage } from './swaps.models';
import { SwapEvidenceError } from './swaps-evidence';

initEccLib(ecc);
const op = script.OPS;
const fail = (message: string): never => { throw new SwapEvidenceError('invalid', message); };
export const bitcoinNetwork = (context: SwapContext) => context.network === 'mainnet' ? networks.bitcoin : context.network === 'regtest' ? networks.regtest : networks.testnet;

function key(value: unknown, name: string): Buffer {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) return fail(`${name} must be an x-only public key.`);
  const bytes = Buffer.from(value, 'hex');
  if (!ecc.isXOnlyPoint(bytes)) return fail(`${name} is not a secp256k1 point.`);
  return bytes;
}

/** Bitcoin two-leaf Boltz submarine/reverse trees only. No provider identity claim.
 * Format reference: BoltzExchange/boltz-core a932d49c4daaeae3d7940dc1519bf77ef92e6dc1,
 * lib/swap/SwapTree.ts and lib/swap/ReverseSwapTree.ts.
 */
export function boltzContract(pkg: Partial<SwapPackage>, context: SwapContext) {
  if (pkg.protocol_id !== 'boltz_submarine_v2' || !['submarine', 'reverse'].includes(pkg.swap_type || '')) {
    throw new SwapEvidenceError('unsupported-adapter', 'This generator supports the Bitcoin two-leaf Boltz submarine/reverse Taproot script format. This package requires a different protocol proof adapter.');
  }
  if (typeof pkg.preimage_hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pkg.preimage_hash)) return fail('Preimage hash must be 32 bytes hex.');
  if (!Number.isSafeInteger(pkg.timeout_height) || pkg.timeout_height! < 1 || pkg.timeout_height! >= 500_000_000) return fail('Timeout must be an absolute block height below 500000000.');
  const claimKey = key(pkg.claim_public_key, 'claim_public_key');
  const refundKey = key(pkg.refund_public_key, 'refund_public_key');
  const internalKey = key(pkg.internal_key, 'internal_key');
  const claim = script.compile([
    ...(pkg.swap_type === 'reverse' ? [op.OP_SIZE, script.number.encode(32), op.OP_EQUALVERIFY] : []),
    op.OP_HASH160, crypto.ripemd160(Buffer.from(pkg.preimage_hash, 'hex')), op.OP_EQUALVERIFY, claimKey, op.OP_CHECKSIG,
  ]);
  const refund = script.compile([refundKey, op.OP_CHECKSIGVERIFY, script.number.encode(pkg.timeout_height!), op.OP_CHECKLOCKTIMEVERIFY]);
  const tree: [{ output: Buffer }, { output: Buffer }] = [{ output: claim }, { output: refund }];
  const payment = payments.p2tr({ network: bitcoinNetwork(context), internalPubkey: internalKey, scriptTree: tree, redeem: { output: refund, redeemVersion: 0xc0 } });
  if (pkg.lockup_address !== payment.address) return fail('Lockup address does not match the expected protocol scripts, keys and selected address network.');
  return { claim, refund, claimKey, refundKey, internalKey, output: payment.output!, controlBlock: payment.witness![1], merkleRoot: payment.hash! };
}

export function refundPsbt(pkg: Partial<SwapPackage>, context: SwapContext, prevout: Transaction) {
  const contract = boltzContract(pkg, context);
  let destination: Buffer;
  try { destination = address.toOutputScript(pkg.destination_address!, bitcoinNetwork(context)); }
  catch { return fail('Destination is invalid for the selected address network.'); }
  const fee = pkg.fee_sats;
  const value = prevout.outs[pkg.lockup_vout!].value;
  if (!Number.isSafeInteger(fee) || fee! < 1 || fee! >= value) return fail('Fee must be a positive integer below the trusted input value.');
  // Conservative dust floor for standard destinations. It is not a node fee estimate.
  if (value - fee! < 546) return fail('Destination output would be below the conservative 546 satoshi dust floor.');
  const psbt = new Psbt({ network: bitcoinNetwork(context) });
  psbt.setVersion(2).setLocktime(pkg.timeout_height!);
  psbt.addInput({ hash: prevout.getId(), index: pkg.lockup_vout!, sequence: 0xfffffffd,
    nonWitnessUtxo: prevout.toBuffer(), witnessUtxo: prevout.outs[pkg.lockup_vout!],
    tapInternalKey: contract.internalKey, tapMerkleRoot: contract.merkleRoot,
    tapLeafScript: [{ leafVersion: 0xc0, script: contract.refund, controlBlock: contract.controlBlock }],
  });
  psbt.addOutput({ script: destination, value: value - fee! });
  // Parse the complete serialized artifact before it can be returned.
  const encoded = psbt.toBase64();
  const decoded = Psbt.fromBase64(encoded, { network: bitcoinNetwork(context) });
  if (decoded.txInputs.length !== 1 || decoded.txOutputs.length !== 1 || decoded.txOutputs[0].value !== value - fee!) return fail('Generated PSBT consistency check failed.');
  return { encoded, decoded: { txid: prevout.getId(), vout: pkg.lockup_vout!, destination: pkg.destination_address!, output_value_sats: value - fee!, fee_sats: fee!, locktime: decoded.locktime, sequence: decoded.txInputs[0].sequence!, input_count: 1, output_count: 1 } };
}

export function verifyBoltzSpend(pkg: Partial<SwapPackage>, context: SwapContext, lockup: Transaction, spend: Transaction, refund: boolean) {
  const contract = boltzContract(pkg, context);
  // More complex spends require complete per-input evidence; never guess their fees or sighashes.
  if (spend.ins.length !== 1 || spend.outs.length !== 1) throw new SwapEvidenceError('unsupported-spend', 'This verifier requires one lockup input and one committed destination output.');
  const input = spend.ins[0];
  if (Buffer.from(input.hash).reverse().toString('hex') !== lockup.getId() || input.index !== pkg.lockup_vout) return fail('Spending transaction does not reference the lockup outpoint.');
  const witness = input.witness;
  if (witness.length !== (refund ? 3 : 4)) return fail('Unsupported or invalid spending witness.');
  const leaf = witness[witness.length - 2];
  if (!leaf.equals(refund ? contract.refund : contract.claim)) return fail('Spending witness selected a different script path.');
  payments.p2tr({ output: contract.output, witness, network: bitcoinNetwork(context) });
  if (!refund && (witness[1].length !== 32 || !crypto.sha256(witness[1]).equals(Buffer.from(pkg.preimage_hash!, 'hex')))) return fail('Claim preimage does not match its commitment.');
  if (refund && (spend.locktime < pkg.timeout_height! || spend.locktime >= 500_000_000 || input.sequence === 0xffffffff)) return fail('Refund locktime or input sequence does not satisfy the contract.');
  let destination: Buffer;
  try { destination = address.toOutputScript(pkg.destination_address!, bitcoinNetwork(context)); }
  catch { return fail('A valid destination commitment is required to verify a spend.'); }
  if (!destination.equals(spend.outs[0].script)) return fail('Spending destination does not match the requested commitment.');
  const output = lockup.outs[pkg.lockup_vout!];
  const fee = output.value - spend.outs[0].value;
  if (!Number.isSafeInteger(pkg.fee_sats) || fee < 0 || fee !== pkg.fee_sats) return fail('Spending fee does not match the requested commitment.');
  const signature = witness[0];
  if (signature.length !== 64 && signature.length !== 65) return fail('Invalid Schnorr signature size.');
  const hashType = signature.length === 65 ? signature[64] : Transaction.SIGHASH_DEFAULT;
  if (![Transaction.SIGHASH_DEFAULT, Transaction.SIGHASH_ALL].includes(hashType) || (signature.length === 65 && hashType === 0)) return fail('Only default or SIGHASH_ALL signatures are supported.');
  // Both supported leaves are below 253 bytes, so CompactSize is one byte.
  const leafHash = crypto.taggedHash('TapLeaf', Buffer.concat([Buffer.from([0xc0, leaf.length]), leaf]));
  const digest = spend.hashForWitnessV1(0, [output.script], [output.value], hashType, leafHash);
  if (!ecc.verifySchnorr(digest, refund ? contract.refundKey : contract.claimKey, signature.subarray(0, 64))) return fail('Spending Schnorr signature is invalid.');
  return { fee_sats: fee };
}
