import { Block, Transaction, script, opcodes as O, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { WorkbenchCoreReader, ownedWorkbenchCore } from '../workbench/workbench-core';
import { verifyTransactionScripts, TransactionScriptContext } from '../workbench/transaction-script-verifier';

export class OffchainVerificationError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const requireThat = (ok: unknown, message: string): void => { if (!ok) throw new OffchainVerificationError('invalid-package', message); };
function transaction(hex: unknown): Transaction {
  requireThat(typeof hex === 'string' && /^(?:[0-9a-f]{2}){10,100000}$/i.test(hex), 'Provide bounded serialized transaction hex.');
  try {
    const tx = Transaction.fromHex(hex as string);
    requireThat(tx.toHex() === (hex as string).toLowerCase() && tx.ins.length === 1 && tx.outs.length === 1 && tx.outs[0].value > 0, 'Supported transactions have exactly one input and one positive output.');
    return tx;
  } catch { throw new OffchainVerificationError('invalid-transaction', 'Invalid canonical single-input single-output transaction.'); }
}
function outpoint(tx: Transaction) { return { txid: Buffer.from(tx.ins[0].hash).reverse().toString('hex'), vout: tx.ins[0].index }; }
function sats(value: unknown): number {
  const text = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(8) : String(value);
  requireThat(typeof value !== 'number' || Number(text) === value, 'Owned source amount has sub-satoshi precision.');
  requireThat(/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(text), 'Owned source returned an invalid Bitcoin amount.');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
  requireThat(amount > 0n && amount <= 2100000000000000n, 'Amount is outside the monetary bound.');
  return Number(amount);
}

/** Exact Teleport contract template from bitcoin-teleport/teleport-transactions contracts.rs. */
export function teleportContract(hex: string) {
  requireThat(typeof hex === 'string' && /^[0-9a-f]{2,1000}$/i.test(hex) && hex.length % 2 === 0, 'Provide the public Teleport contract redeem script.');
  const bytes = Buffer.from(hex, 'hex'), chunks = script.decompile(bytes);
  requireThat(chunks?.length === 19, 'Unsupported CoinSwap contract algorithm/template.');
  const c = chunks!;
  for (const [index, op] of [[0,O.OP_SIZE],[1,O.OP_SWAP],[2,O.OP_HASH160],[4,O.OP_EQUAL],[5,O.OP_IF],[8,O.OP_1],[9,O.OP_ELSE],[11,O.OP_0],[13,O.OP_ENDIF],[14,O.OP_CHECKSEQUENCEVERIFY],[15,O.OP_DROP],[16,O.OP_ROT],[17,O.OP_EQUALVERIFY],[18,O.OP_CHECKSIG]]) requireThat(c[index] === op, 'Unsupported CoinSwap contract algorithm/template.');
  requireThat(Buffer.isBuffer(c[3]) && (c[3] as Buffer).length === 20 && Buffer.isBuffer(c[7]) && (c[7] as Buffer).equals(Buffer.from([32])), 'Invalid hash160 or preimage size commitment.');
  for (const index of [6,10]) requireThat(Buffer.isBuffer(c[index]) && (c[index] as Buffer).length === 33 && ecc.isPoint(c[index] as Buffer), 'Invalid contract public key.');
  const delay = typeof c[12] === 'number' ? (c[12] as number) - O.OP_1 + 1 : script.number.decode(c[12] as Buffer, 3, true);
  requireThat(delay > 1 && delay <= 65535 && script.compile(c).equals(bytes), 'Invalid canonical block-based CSV delay.');
  return { hashlock: (c[3] as Buffer).toString('hex'), delay, script: bytes };
}

let active = 0;
export class OffchainPackageVerifier {
  constructor(private core: WorkbenchCoreReader = ownedWorkbenchCore) {}
  private async call(method: string, params: unknown[]) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([this.core.call(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timeout')), 5000); })]);
    } catch { throw new OffchainVerificationError('unavailable-source', 'The owned Bitcoin node could not provide verification evidence.', 503); }
    finally { clearTimeout(timer!); }
  }
  private async checkpoint() {
    const info: any = await this.call('getblockchaininfo', []);
    const expected = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' }[this.core.network];
    requireThat(expected && info.chain === expected && info.initialblockdownload === false && Number.isSafeInteger(info.blocks) && info.blocks >= 0 && /^[0-9a-f]{64}$/.test(info.bestblockhash), 'Owned node network or synced checkpoint is invalid.');
    const raw: any = await this.call('getblockheader', [info.bestblockhash, false]);
    const header: any = await this.call('getblockheader', [info.bestblockhash, true]);
    const atHeight: any = await this.call('getblockhash', [info.blocks]);
    requireThat(typeof raw === 'string' && /^[0-9a-f]{160}$/i.test(raw) && Block.fromHex(raw).getId() === info.bestblockhash && header.hash === info.bestblockhash && header.height === info.blocks && header.confirmations > 0 && atHeight === info.bestblockhash, 'Owned checkpoint header hash and height do not agree.');
    return { network: this.core.network, chain: info.chain, block_hash: info.bestblockhash, block_height: info.blocks, header_hex: raw };
  }
  async verify(data: any, kind: 'statechain' | 'coinswap') {
    requireThat(data && typeof data === 'object' && !Array.isArray(data) && JSON.stringify(data).length <= 1000000, 'Invalid or oversized package.');
    const profile = kind === 'statechain' ? 'bitcoin-backup-sequence-v1' : 'teleport-p2wsh-contracts-v1';
    requireThat(data.verification_profile === profile, `Unsupported protocol proof. Required public transaction profile: ${profile}.`);
    requireThat(!('current_height' in data), 'Caller current_height cannot authorize recovery.');
    const entries = kind === 'statechain' ? data.backup_transactions : data.contracts;
    requireThat(Array.isArray(entries) && entries.length >= (kind === 'statechain' ? 1 : 2) && entries.length <= 32, 'Provide a bounded nonempty transaction sequence.');
    const allowedRoot = ['verification_profile', 'network', kind === 'statechain' ? 'backup_transactions' : 'contracts', ...(kind === 'statechain' ? ['deposit_amount_sats'] : [])];
    requireThat(Object.keys(data).every(key => allowedRoot.includes(key)), 'Unknown package fields are not authenticated by this profile.');
    if (active >= 2) throw new OffchainVerificationError('verifier-busy', 'The bounded offchain verifier is busy.', 503);
    active++;
    try {
      const checkpoint = await this.checkpoint();
      requireThat(data.network === checkpoint.network, 'Package network differs from the owned checkpoint.');
      const contexts: TransactionScriptContext[] = [], findings: any[] = [], observed: any[] = [];
      let previousLock = Infinity, deposit: string | undefined;
      const seen = new Set<string>();
      for (const entry of entries) {
        const allowedEntry = kind === 'statechain' ? ['transaction_hex', 'txid', 'locktime', 'input_outpoint', 'output_value_sats', 'fee_sats'] : ['role', 'transaction_hex', 'refund_transaction_hex', 'redeem_script_hex'];
        requireThat(entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).every(key => allowedEntry.includes(key)), 'Unknown transaction metadata is not authenticated by this profile.');
        const tx = transaction(entry.transaction_hex), point = outpoint(tx), id = `${point.txid}:${point.vout}`;
        requireThat(!seen.has(tx.getId()), 'Duplicate transaction in package.'); seen.add(tx.getId());
        const utxo: any = await this.call('gettxout', [point.txid, point.vout, true]);
        requireThat(utxo && utxo.bestblock === checkpoint.block_hash && Number.isSafeInteger(utxo.confirmations) && utxo.confirmations > 0 && typeof utxo.coinbase === 'boolean' && (!utxo.coinbase || utxo.confirmations >= 100), 'Funding output is unavailable, spent, unconfirmed, immature, or its checkpoint changed.');
        const amount = sats(utxo.value), prevScript = utxo.scriptPubKey?.hex;
        observed.push({ ...point, value: utxo.value, script: prevScript, confirmations: utxo.confirmations });
        requireThat(typeof prevScript === 'string' && /^(?:[0-9a-f]{2}){1,10000}$/i.test(prevScript) && tx.outs[0].value < amount, 'Invalid funding script or nonpositive transaction fee.');
        contexts.push({ transaction_hex: tx.toHex(), input_index: 0, previous_outputs: [{ ...point, script_hex: prevScript, amount_sats: amount }] });
        if (kind === 'statechain') {
          requireThat(/^5120[0-9a-f]{64}$/i.test(prevScript) && tx.ins[0].witness.length === 1 && (tx.ins[0].witness[0].length === 64 || tx.ins[0].witness[0].length === 65 && tx.ins[0].witness[0][64] === 1), 'Only fully signed Taproot key-path backups committing to every input/output are supported.');
          requireThat(tx.locktime > 0 && tx.locktime < 500000000 && tx.locktime < previousLock && tx.ins[0].sequence === 0xfffffffe, 'Backup heights must strictly decrease; time locks and relative sequences are unsupported.');
          requireThat(!deposit || deposit === id, 'All backups must spend the same deposit.');
          for (const [field,value] of Object.entries({ txid: tx.getId(), locktime: tx.locktime, input_outpoint: id, output_value_sats: tx.outs[0].value, fee_sats: amount - tx.outs[0].value })) if (field in entry) requireThat(entry[field] === value, `Backup ${field} does not match signed transaction bytes.`);
          requireThat(data.deposit_amount_sats === undefined || data.deposit_amount_sats === amount, 'Deposit amount differs from the owned UTXO.');
          deposit = id; previousLock = tx.locktime;
          findings.push({ txid: tx.getId(), input_outpoint: id, amount_sats: amount, output_value_sats: tx.outs[0].value, locktime: tx.locktime, earliest_inclusion_height: tx.locktime + 1 });
        } else {
          requireThat(!findings.some(f => f.input_outpoint === id), 'CoinSwap legs must have distinct funding outputs.');
          const contract = teleportContract(entry.redeem_script_hex), witness = tx.ins[0].witness;
          const multisig = witness.length === 4 ? script.decompile(witness[3]) : null;
          requireThat(multisig?.length === 5 && multisig[0] === O.OP_2 && multisig[3] === O.OP_2 && multisig[4] === O.OP_CHECKMULTISIG && Buffer.isBuffer(multisig[1]) && Buffer.isBuffer(multisig[2]) && (multisig[1] as Buffer).length === 33 && (multisig[2] as Buffer).length === 33 && ecc.isPoint(multisig[1] as Buffer) && ecc.isPoint(multisig[2] as Buffer) && !(multisig[1] as Buffer).equals(multisig[2] as Buffer) && witness[1]?.[witness[1].length - 1] === 1 && witness[2]?.[witness[2].length - 1] === 1, 'Require fully signed SIGHASH_ALL 2-of-2 P2WSH funding spends.');
          requireThat(payments.p2wsh({ redeem: { output: witness[3] } }).output!.toString('hex') === prevScript && tx.version === 2 && tx.locktime === 0 && tx.ins[0].sequence === 0 && tx.outs[0].script.equals(payments.p2wsh({ redeem: { output: contract.script } }).output!), 'Contract transaction does not match the Teleport funding/script template.');
          const refund = transaction(entry.refund_transaction_hex), refundPoint = outpoint(refund), rw = refund.ins[0].witness;
          requireThat(refundPoint.txid === tx.getId() && refundPoint.vout === 0 && refund.version === 2 && refund.locktime === 0 && refund.ins[0].sequence === contract.delay && rw.length === 3 && rw[0][rw[0].length - 1] === 1 && rw[1].length === 0 && rw[2].equals(contract.script) && refund.outs[0].value < tx.outs[0].value, 'Timeout refund must bind the contract output, CSV delay and signed empty-preimage branch.');
          contexts.push({ transaction_hex: refund.toHex(), input_index: 0, previous_outputs: [{ ...refundPoint, script_hex: tx.outs[0].script.toString('hex'), amount_sats: tx.outs[0].value }] });
          requireThat(entry.role === 'forward_contract' || entry.role === 'backward_contract', 'Specify forward_contract or backward_contract.');
          findings.push({ role: entry.role, txid: tx.getId(), refund_txid: refund.getId(), input_outpoint: id, csv_delay_blocks: contract.delay, hashlock: contract.hashlock, value_sats: tx.outs[0].value });
        }
      }
      if (kind === 'coinswap') {
        requireThat(findings.length === 2 && findings[0].role !== findings[1].role && findings[0].hashlock === findings[1].hashlock, 'Supported two-leg contracts require distinct roles and identical hash commitments.');
        requireThat(findings.find(f => f.role === 'forward_contract').csv_delay_blocks > findings.find(f => f.role === 'backward_contract').csv_delay_blocks, 'Forward CSV delay must exceed backward CSV delay.');
      }
      const execution = await verifyTransactionScripts(contexts);
      requireThat(execution.results.every(result => result.script_valid), 'A transaction signature or spending script failed independent Bitcoin script execution.');
      for (const point of observed) {
        const current: any = await this.call('gettxout', [point.txid, point.vout, true]);
        requireThat(current && current.bestblock === checkpoint.block_hash && current.value === point.value && current.scriptPubKey?.hex === point.script && current.confirmations === point.confirmations, 'Funding UTXO changed during verification; retry.');
      }
      const after: any = await this.call('getblockchaininfo', []);
      requireThat(after.chain === checkpoint.chain && after.blocks === checkpoint.block_height && after.bestblockhash === checkpoint.block_hash, 'Chain changed during verification; retry.');
      return { is_valid: true, verification_profile: profile, protocol_verified: null, recovery_state: 'unknown', recoverable_state: 'unknown', checkpoint, script_engine: execution.engine, transactions: findings, backup_transactions_count: kind === 'statechain' ? findings.length : undefined, signatures_reconciled: null, earliest_unilateral_exit_height: kind === 'statechain' ? previousLock + 1 : null, current_block_height: checkpoint.block_height, watchtower_coverage_verified: false, errors: [], warnings: [kind === 'statechain' ? 'Signed Bitcoin backup sequence verified. Mercury handover/key rotation and operator signature-count authenticity remain unverified.' : 'Signed Teleport two-leg contracts and timeout refunds verified. CSV ages start when each contract confirms; ordering delays alone does not establish cross-leg recovery safety.'], verification_scope: 'Signed public Bitcoin transaction scripts and current owned-node funding UTXOs. No transaction broadcast, protocol ownership transfer, future unspentness or recovery execution is established.' };
    } finally { active--; }
  }
}
