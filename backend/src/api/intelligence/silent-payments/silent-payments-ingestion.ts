import { createHash } from 'crypto';
import { script, crypto as bitcoinCrypto } from 'bitcoinjs-lib';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import { compressedPoint, SP_NETWORKS } from './silent-payments-parsers';
import { SilentPaymentBlockBundle, SilentPaymentBlockManifest, SilentPaymentScanTransaction } from './silent-payments.models';

export const SILENT_PAYMENTS_SCHEMA_QUERIES = [
  `CREATE TABLE IF NOT EXISTS intelligence_silent_payment_blocks (
    chain VARCHAR(16) NOT NULL,
    network VARCHAR(16) NOT NULL,
    height INT UNSIGNED NOT NULL,
    block_hash CHAR(64) NOT NULL,
    previous_block_hash CHAR(64) NOT NULL,
    bundle_hash CHAR(64) NOT NULL,
    manifest_json JSON NOT NULL,
    bundle_json LONGTEXT NOT NULL,
    PRIMARY KEY (chain, network, height),
    UNIQUE KEY uq_sp_network_block (chain, network, block_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
  `CREATE TABLE IF NOT EXISTS intelligence_silent_payment_support (
    wallet_id VARCHAR(128) NOT NULL,
    wallet_version VARCHAR(64) NOT NULL,
    observed_at DATETIME(6) NOT NULL,
    evidence_hash CHAR(64) NOT NULL,
    claim_json JSON NOT NULL,
    PRIMARY KEY (wallet_id, wallet_version, evidence_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
];

const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
const hex = (value: string) => {
  if (typeof value !== 'string' || !/^(?:[a-fA-F0-9]{2})*$/.test(value)) {throw new Error('Malformed source script or witness.');}
  return Buffer.from(value, 'hex');
};

/** BIP352 eligible input keys from actual prevouts and witness/scriptSig data. */
export function eligibleInputKey(input: IEsploraApi.Vin): string | null {
  if (!input.prevout) {throw new Error('Source omitted prevout data required for BIP352 scanning.');}
  const prev = hex(input.prevout.scriptpubkey);
  const witness = (input.witness || []).map(hex);
  if (prev.length === 34 && prev[0] === 0x51 && prev[1] === 32) {
    if (!witness.length) {throw new Error('Source omitted Taproot witness data required to check input eligibility.');}
    if (witness.length >= 2 && witness[witness.length - 1][0] === 0x50) {witness.pop();}
    if (witness.length >= 2) {
      const control = witness[witness.length - 1];
      if (control.length < 33 || (control.length - 33) % 32) {throw new Error('Malformed Taproot control block from source.');}
      if (control.subarray(1, 33).toString('hex') === NUMS) {return null;}
    }
    const pub = Buffer.concat([Buffer.from([2]), prev.subarray(2)]);
    if (!compressedPoint(pub)) {throw new Error('Invalid Taproot source point.');}
    return pub.toString('hex');
  }
  let keyHash: Buffer | undefined;
  if (prev.length === 22 && prev[0] === 0 && prev[1] === 20) {keyHash = prev.subarray(2);}
  else if (prev.length === 23 && prev[0] === 0xa9 && prev[1] === 20 && prev[22] === 0x87) {
    const sig = hex(input.scriptsig);
    if (sig.length === 23 && sig[0] === 22 && sig[1] === 0 && sig[2] === 20 && bitcoinCrypto.hash160(sig.subarray(1)).equals(prev.subarray(2, 22))) {keyHash = sig.subarray(3);}
  }
  if (keyHash) {
    if (witness.length !== 2) {throw new Error('Source omitted or malformed P2WPKH witness data.');}
    const pub = witness[witness.length - 1];
    return pub && compressedPoint(pub) && bitcoinCrypto.hash160(pub).equals(keyHash) ? pub.toString('hex') : null;
  }
  if (prev.length === 25 && prev.subarray(0, 3).equals(Buffer.from('76a914', 'hex')) && prev.subarray(23).equals(Buffer.from('88ac', 'hex'))) {
    const chunks = script.decompile(hex(input.scriptsig));
    if (!chunks?.length) {throw new Error('Cannot parse source P2PKH scriptSig.');}
    for (const item of [...chunks].reverse()) {
      if (Buffer.isBuffer(item) && compressedPoint(item) && bitcoinCrypto.hash160(item).equals(prev.subarray(3, 23))) {return item.toString('hex');}
    }
  }
  return null;
}

export function buildSilentPaymentBundle(network: string, block: IEsploraApi.Block, txs: IEsploraApi.Transaction[]): { bundle: SilentPaymentBlockBundle; manifest: SilentPaymentBlockManifest; bytes: string } {
  if (!SP_NETWORKS.includes(network) || !Number.isSafeInteger(block.height) || block.height < 0 || !/^[0-9a-f]{64}$/.test(block.id) || !/^[0-9a-f]{64}$/.test(block.previousblockhash) || txs.length !== block.tx_count) {throw new Error('Incomplete block source or invalid network identity.');}
  const transactions: SilentPaymentScanTransaction[] = [];
  for (const tx of txs) {
    if (tx.vin.some(input => input.is_coinbase)) {continue;}
    if (!/^[0-9a-f]{64}$/.test(tx.txid)) {throw new Error('Invalid source transaction identity.');}
    const candidates = tx.vout.flatMap((out, vout) => {
      if (!/^5120[0-9a-f]{64}$/.test(out.scriptpubkey)) {return [];}
      if (!Number.isSafeInteger(out.value) || out.value < 0) {throw new Error('Source output has invalid satoshi amount.');}
      return [{ vout, pubkey: out.scriptpubkey.slice(4), amount_sats: String(out.value) }];
    });
    if (!candidates.length) {continue;}
    if (tx.vin.some(input => !input.prevout)) {throw new Error('Source omitted prevouts; eligible coverage is unavailable.');}
    if (tx.vin.some(input => {
      const prev = hex(input.prevout!.scriptpubkey);
      return prev.length >= 4 && prev.length <= 42 && prev[0] >= 0x52 && prev[0] <= 0x60 && prev[1] === prev.length - 2;
    })) {continue;}
    const keys = tx.vin.map(eligibleInputKey).filter((key): key is string => !!key);
    if (!keys.length) {continue;}
    const spent = tx.vin.map(input => {
      if (!/^[0-9a-f]{64}$/.test(input.txid) || !Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff) {throw new Error('Invalid source outpoint.');}
      return { txid: input.txid, vout: input.vout };
    });
    transactions.push({ txid: tx.txid, spent_outpoints: spent, input_pubkeys: keys, candidate_outputs: candidates });
  }
  const bundle: SilentPaymentBlockBundle = { schema_version: 1, chain: 'bitcoin', network, height: block.height, block_hash: block.id, previous_block_hash: block.previousblockhash, transactions };
  // Fixed property order and integer/string representation define the served bytes.
  const bytes = JSON.stringify(bundle);
  const manifest: SilentPaymentBlockManifest = {
    schema_version: 1, chain: 'bitcoin', network, height: block.height, block_hash: block.id, previous_block_hash: block.previousblockhash,
    num_inputs: transactions.reduce((n, tx) => n + tx.input_pubkeys.length, 0),
    candidate_output_count: transactions.reduce((n, tx) => n + tx.candidate_outputs.length, 0),
    bundle_hash: createHash('sha256').update(bytes).digest('hex'),
    bundle_url: `/api/v1/intelligence/payments/silent/blocks/${block.height}/bundle?chain=bitcoin&network=${network}`,
    created_at: new Date(block.timestamp * 1000).toISOString(),
  };
  return { bundle, manifest, bytes };
}
