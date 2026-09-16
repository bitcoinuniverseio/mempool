import { createHash } from 'crypto';
import { address as bitcoinAddress, initEccLib, networks, payments, script, Transaction } from 'bitcoinjs-lib';
import * as secp from 'tiny-secp256k1';
import config from '../../../config';
import { verifyTransactionScripts } from '../workbench/transaction-script-verifier';
import { VerificationEvidenceError } from './verification-errors';

type Format = 'bip137' | 'bip322_simple' | 'bip322_full';
// bitcoinjs-lib requires the native ECC backend before decoding Taproot outputs.
initEccLib(secp);
const sha = (bytes: Buffer): Buffer => createHash('sha256').update(bytes).digest();
const unsupported = (): never => { throw new VerificationEvidenceError('unsupported-signature-script', 'This verifier supports BIP137 and BIP322 single-key or standard witness-multisig scripts. Other scripts and proof-of-funds require additional verification; no verdict was established.'); };
function compact(value: number): Buffer {
  if (value < 253) return Buffer.from([value]);
  if (value <= 65535) { const out = Buffer.alloc(3); out[0] = 253; out.writeUInt16LE(value, 1); return out; }
  const out = Buffer.alloc(5); out[0] = 254; out.writeUInt32LE(value, 1); return out;
}
function base64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) throw Error('Invalid base64 signature.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw Error('Noncanonical base64 signature.');
  return bytes;
}
function witness(bytes: Buffer): Buffer[] {
  let offset = 0;
  const size = (): number => {
    if (offset >= bytes.length) throw Error('Truncated witness.');
    const prefix = bytes[offset++];
    if (prefix < 253) return prefix;
    if (prefix === 255) throw Error('Oversized witness.');
    const width = prefix === 253 ? 2 : 4;
    if (offset + width > bytes.length) throw Error('Truncated witness.');
    const value = width === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset); offset += width;
    if (value < (width === 2 ? 253 : 65536)) throw Error('Noncanonical witness.');
    return value;
  };
  const count = size(); if (count > 100) throw Error('Too many witness items.');
  const result: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const length = size(); if (length > 10000 || offset + length > bytes.length) throw Error('Invalid witness item.');
    result.push(bytes.subarray(offset, offset + length)); offset += length;
  }
  if (offset !== bytes.length) throw Error('Trailing witness bytes.');
  return result;
}
export function messageTransactions(message: string, output: Buffer): { spend: Transaction; sign: Transaction } {
  const tag = sha(Buffer.from('BIP0322-signed-message'));
  const digest = sha(Buffer.concat([tag, tag, Buffer.from(message, 'utf8')]));
  const spend = new Transaction(); spend.version = 0;
  spend.addInput(Buffer.alloc(32), 0xffffffff, 0, Buffer.concat([Buffer.from([0, 32]), digest]));
  spend.addOutput(output, 0);
  const sign = new Transaction(); sign.version = 0; sign.addInput(spend.getHash(), 0, 0); sign.addOutput(Buffer.from([0x6a]), 0);
  return { spend, sign };
}
function allSignature(value: Buffer): void {
  const decoded = script.signature.decode(value);
  if (decoded.hashType !== Transaction.SIGHASH_ALL) throw Error('BIP322 requires SIGHASH_ALL or Taproot SIGHASH_DEFAULT.');
}
/** Restrict the interpreter to understood script forms, including BIP322's additional sighash rules. */
function checkScriptForm(tx: Transaction, output: Buffer, full: boolean): void {
  const input = tx.ins[0], stack = input.witness;
  if (output.length === 22 && output[0] === 0 && output[1] === 20) {
    if (input.script.length || stack.length !== 2 || stack[1].length !== 33) throw Error('Invalid P2WPKH witness.');
    allSignature(stack[0]); return;
  }
  if (output.length === 34 && output[0] === 0x51 && output[1] === 32) {
    if (input.script.length) throw Error('Invalid Taproot scriptSig.');
    if (stack.length !== 1) unsupported();
    if (stack[0].length !== 64 && !(stack[0].length === 65 && stack[0][64] === 1)) throw Error('Invalid Taproot message signature or sighash.');
    return;
  }
  if (output.length === 34 && output[0] === 0 && output[1] === 32) {
    if (input.script.length || stack.length < 2) throw Error('Invalid P2WSH witness.');
    const code = stack[stack.length - 1];
    if (!sha(code).equals(output.subarray(2))) throw Error('Witness script does not match address.');
    const ops = script.decompile(code);
    if (!ops || ops.length < 4 || ops[ops.length - 1] !== 0xae || typeof ops[0] !== 'number' || typeof ops[ops.length - 2] !== 'number') unsupported();
    const required = (ops![0] as number) - 0x50, keys = (ops![ops!.length - 2] as number) - 0x50;
    if (required < 1 || required > keys || keys > 16 || ops!.length !== keys + 3 || !ops!.slice(1, -2).every(key => Buffer.isBuffer(key) && key.length === 33)) unsupported();
    if (stack.length !== required + 2 || stack[0].length !== 0 || !script.compile(ops!).equals(code)) throw Error('Invalid multisig witness.');
    stack.slice(1, -1).forEach(allSignature); return;
  }
  if (full && output.length === 25 && output.toString('hex').startsWith('76a914') && output.toString('hex').endsWith('88ac')) {
    const pushes = script.decompile(input.script);
    if (stack.length || !pushes || pushes.length !== 2 || !pushes.every(Buffer.isBuffer) || !script.compile(pushes).equals(input.script)) throw Error('Invalid P2PKH scriptSig.');
    allSignature(pushes[0] as Buffer); return;
  }
  if (full && output.length === 23 && output[0] === 0xa9 && output[1] === 20 && output[22] === 0x87) {
    const pushes = script.decompile(input.script);
    if (!pushes || pushes.length !== 1 || !Buffer.isBuffer(pushes[0]) || !script.compile(pushes).equals(input.script)) unsupported();
    const redeem = pushes![0] as Buffer;
    if (redeem.length !== 22 || redeem[0] !== 0 || redeem[1] !== 20) unsupported();
    if (stack.length !== 2 || stack[1].length !== 33) throw Error('Invalid nested witness.');
    allSignature(stack[0]); return;
  }
  unsupported();
}

export async function verifyMessageSignature(address: string, message: string, signature: string, format: Format, network: string = config.MEMPOOL.NETWORK) {
  if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network) || !['bip137', 'bip322_simple', 'bip322_full'].includes(format)
    || typeof address !== 'string' || address.length > 200 || typeof message !== 'string' || Buffer.byteLength(message) > 65536 || typeof signature !== 'string' || signature.length > 100000) {
    throw new VerificationEvidenceError('invalid-signature-input', 'Provide bounded message-signature fields and a supported Bitcoin network and format.', 400);
  }
  const net = network === 'mainnet' ? networks.bitcoin : network === 'regtest' ? networks.regtest : networks.testnet;
  const base = { address, message, signature, format, network, verification_scope: 'Message/address signature verification only. This does not establish ownership, solvency, unspent funds, or transaction authorization.' };
  let output: Buffer;
  try { output = bitcoinAddress.toOutputScript(address, net); } catch { return { ...base, is_valid: false, error: 'Address checksum or network is invalid.' }; }
  let tx: Transaction;
  try {
    if (format === 'bip137') {
      const encoded = base64(signature), header = encoded[0];
      if (encoded.length !== 65 || header < 27 || header > 42) throw Error('Invalid BIP137 compact signature.');
      const messageBytes = Buffer.from(message, 'utf8'), prefix = Buffer.from('Bitcoin Signed Message:\n');
      const digest = sha(sha(Buffer.concat([compact(prefix.length), prefix, compact(messageBytes.length), messageBytes])));
      const kind = Math.floor((header - 27) / 4), recovery = (header - 27) % 4;
      const recovered = secp.recover(digest, encoded.subarray(1), recovery as 0 | 1 | 2 | 3, kind !== 0);
      if (!recovered) throw Error('Signature recovery failed.');
      const pubkey = Buffer.from(recovered);
      const expected = kind < 2 ? payments.p2pkh({ pubkey, network: net }).output : kind === 2 ? payments.p2sh({ redeem: payments.p2wpkh({ pubkey, network: net }), network: net }).output : payments.p2wpkh({ pubkey, network: net }).output;
      return { ...base, is_valid: !!expected?.equals(output), signer_pubkey: pubkey.toString('hex'), engine: 'libsecp256k1 recoverable ECDSA' };
    }
    const full = format === 'bip322_full', prefix = full ? 'ful' : 'smp';
    if (/^(smp|ful|pof)/.test(signature) && !signature.startsWith(prefix)) throw Error('Signature variant does not match the selected format.');
    if (full && !signature.startsWith('ful')) throw Error('BIP322 full signatures require the ful prefix.');
    const raw = base64(signature.startsWith(prefix) ? signature.slice(3) : signature);
    const virtual = messageTransactions(message, output);
    tx = full ? Transaction.fromBuffer(raw) : virtual.sign;
    if (full && !tx.toBuffer().equals(raw)) throw Error('Noncanonical full transaction.');
    if (!full) tx.setWitness(0, witness(raw));
    if (![0, 2].includes(tx.version)) unsupported();
    if (tx.ins.length !== 1 || tx.outs.length !== 1 || !tx.ins[0].hash.equals(virtual.spend.getHash()) || tx.ins[0].index !== 0 || tx.outs[0].value !== 0 || tx.outs[0].script.toString('hex') !== '6a') throw Error('Invalid virtual transaction binding.');
    checkScriptForm(tx, output, full);
  } catch (error) {
    if (error instanceof VerificationEvidenceError) throw error;
    return { ...base, is_valid: false, error: error instanceof Error ? error.message : 'Invalid message signature.' };
  }
  let result: Awaited<ReturnType<typeof verifyTransactionScripts>>;
  try { result = await verifyTransactionScripts([{ transaction_hex: tx!.toHex(), previous_script_hex: output.toString('hex'), previous_amount_sats: 0 }]); }
  catch { throw new VerificationEvidenceError('unavailable-signature-verifier', 'The native transaction script verifier could not establish a message-signature verdict.'); }
  return { ...base, is_valid: result.results[0].script_valid, engine: result.engine, lock_time: tx!.locktime, sequence: tx!.ins[0].sequence, ...(result.results[0].script_valid ? {} : { error: 'Native script execution rejected the message signature.' }) };
}
