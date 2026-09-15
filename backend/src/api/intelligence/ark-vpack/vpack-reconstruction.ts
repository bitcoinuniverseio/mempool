import { execFile } from 'child_process';
import { resolve } from 'path';
import { Transaction } from 'bitcoinjs-lib';
import { verifySchnorr } from 'tiny-secp256k1';
import { AnchorReader, AnchorReadError } from './anchor-reader';
import { WorkbenchCoreReader, ownedWorkbenchCore } from '../workbench/workbench-core';
import { verifyTransactionScripts } from '../workbench/transaction-script-verifier';

let active = 0;
export async function reconstructVpack(request: any, core: WorkbenchCoreReader = ownedWorkbenchCore) {
  if (!request || request.network !== core.network) throw new AnchorReadError('wrong-network', 'Supply the currently configured network for this package.', 400);
  const input = JSON.stringify({ state: request.state, vpack_hex: request.vpack_hex, bark_hex: request.bark_hex, arkade: request.arkade });
  if (input.length > 2_100_000 || ([request.state, request.vpack_hex, request.bark_hex, request.arkade].filter(value => value !== undefined).length !== 1)) throw new AnchorReadError('invalid-package', 'Supply exactly one bounded V-PACK hex, Bark native hex, Arkade native tree or schema 1.0 state envelope.', 400);
  if (active >= 2) throw new AnchorReadError('reconstructor-busy', 'The bounded package reconstructor is busy.');
  active++;
  let result: any;
  try {
    result = await new Promise<any>((accept, reject) => {
      const executable = request.arkade ? process.execPath : process.env.UNIVERSE_VPACK_ENGINE || resolve(__dirname, '../../../../../rust/vpack-engine/target/release/universe-vpack-engine' + (process.platform === 'win32' ? '.exe' : ''));
      const args = request.arkade ? [process.env.UNIVERSE_ARKADE_CODEC || resolve(__dirname, '../../../../../rust/arkade-codec/codec.mjs')] : [];
      const child = execFile(executable, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(new AnchorReadError(error.code === 2 ? 'invalid-package' : 'unavailable-reconstructor', error.code === 2 ? 'The pinned V-PACK parser rejected this package.' : 'The pinned V-PACK reconstructor is unavailable.', error.code === 2 ? 400 : 503));
        try {
          const parsed = JSON.parse(stdout);
          if (!['libvpack-rs e1f783a02489680b84121c71388a6a96122f5c63', 'ark-lib 0.7.1', '@arkade-os/sdk 0.4.72'].includes(parsed.engine) || !Array.isArray(parsed.transactions) || parsed.transactions.length === 0 || parsed.transactions.length > 512 || !/^[0-9a-f]{64}:\d+$/.test(parsed.anchor_outpoint)) throw Error('Invalid engine result');
          accept(parsed);
        } catch { reject(new AnchorReadError('invalid-engine-result', 'The pinned V-PACK engine returned invalid reconstruction data.')); }
      });
      child.stdin?.on('error', () => { /* Bounded callback handles process failure. */ });
      child.stdin?.end(request.arkade ? JSON.stringify(request.arkade) : input);
    });
  } finally { active--; }
  const anchor = await new AnchorReader(core).verify(result.anchor_outpoint);
  const checks = verifyReconstructedTransactions(result.transactions, anchor);
  let scripts: Awaited<ReturnType<typeof verifyTransactionScripts>> | null = null;
  if (anchor.amount_sats !== null && anchor.script_pub_key !== null) {
    const contexts = result.transactions.map((hex: string, index: number) => {
      const tx = Transaction.fromHex(hex);
      const previous = index ? Transaction.fromHex(result.transactions[index - 1]).outs[tx.ins[0].index] : null;
      return { transaction_hex: hex, previous_amount_sats: previous?.value ?? anchor.amount_sats!, previous_script_hex: previous?.script.toString('hex') ?? anchor.script_pub_key! };
    });
    scripts = await verifyTransactionScripts(contexts);
  }
  const finalTransaction = Transaction.fromHex(result.transactions[result.transactions.length - 1]);
  const identity = String(result.vtxo_id).split(':');
  if (identity[0] !== finalTransaction.getId()) throw new AnchorReadError('identity-mismatch', 'The native VTXO identity does not match its reconstructed transaction.', 400);
  if (identity.length === 2) {
    const output = finalTransaction.outs[Number(identity[1])];
    if (!output || output.value !== result.amount_sats || output.script.toString('hex') !== result.script_pub_key) throw new AnchorReadError('identity-output-mismatch', 'The native VTXO amount or script does not match the reconstructed output.', 400);
  }
  const expected = request.expected_vtxo_id;
  if (expected !== undefined && (typeof expected !== 'string' || !/^[0-9a-f]{64}(?::\d+)?$/i.test(expected))) throw new AnchorReadError('invalid-vtxo-id', 'Expected VTXO ID must be a transaction hash or outpoint.', 400);
  return { ...result, anchor, transaction_checks: checks, script_execution: scripts, expected_id_matches: expected ? expected.toLowerCase() === result.vtxo_id : null,
    signature_verification: checks.every(check => check.signature_valid === true) ? true : checks.some(check => check.signature_valid === false) ? false : null,
    exit_viable: null, protocol_verified: null,
    verification_scope: 'Pinned V-PACK identity reconstruction, owned anchor evidence, independent transaction links/value checks and supported Taproot key-path signatures. Full Ark lifecycle, script-path witnesses, policy acceptance and exit viability are not established.' };
}

export function verifyReconstructedTransactions(hexes: string[], anchor: { anchor_outpoint: string; amount_sats: number | null; script_pub_key: string | null }) {
  let previousOutpoint = anchor.anchor_outpoint;
  let previousValue = anchor.amount_sats;
  let previousScript = anchor.script_pub_key;
  const checks: Array<{ txid: string; input_outpoint: string; fee_sats: number | null; signature_valid: boolean | null }> = [];
  for (let index = 0; index < hexes.length; index++) {
    let tx: Transaction;
    try { tx = Transaction.fromHex(hexes[index]); } catch { throw new AnchorReadError('invalid-engine-transaction', 'The native engine reconstructed a malformed transaction.'); }
    if (tx.ins.length !== 1) throw new AnchorReadError('unsupported-transaction', 'Only single-input V-PACK reconstruction is currently supported.', 400);
    const input = tx.ins[0];
    const outpoint = Buffer.from(input.hash).reverse().toString('hex') + ':' + input.index;
    if (outpoint !== previousOutpoint) throw new AnchorReadError('disconnected-path', 'A reconstructed transaction does not spend the preceding output.', 400);
    const outputValue = tx.outs.reduce((sum, out) => sum + out.value, 0);
    const fee = previousValue === null ? null : previousValue - outputValue;
    if (!Number.isSafeInteger(outputValue) || outputValue > 2100000000000000 || (fee !== null && fee < 0)) throw new AnchorReadError('invalid-value', 'Reconstructed outputs exceed their known input value.', 400);
    let signatureValid: boolean | null = null;
    if (previousValue !== null && previousScript && /^5120[0-9a-f]{64}$/.test(previousScript) && input.witness.length === 1) {
      const signature = input.witness[0];
      const hashType = signature.length === 64 ? 0 : signature.length === 65 ? signature[64] : -1;
      if (![0, 1, 2, 3, 129, 130, 131].includes(hashType) || (signature.length === 65 && hashType === 0)) signatureValid = false;
      else {
        try { signatureValid = verifySchnorr(tx.hashForWitnessV1(0, [Buffer.from(previousScript, 'hex')], [previousValue], hashType), Buffer.from(previousScript.slice(4), 'hex'), signature.subarray(0, 64)); }
        catch { signatureValid = false; }
      }
    }
    checks.push({ txid: tx.getId(), input_outpoint: outpoint, fee_sats: fee, signature_valid: signatureValid });
    if (index + 1 < hexes.length) {
      const next = Transaction.fromHex(hexes[index + 1]);
      const nextIndex = next.ins[0]?.index;
      if (!tx.outs[nextIndex]) throw new AnchorReadError('invalid-path-output', 'The next transaction refers to a nonexistent reconstructed output.', 400);
      previousOutpoint = tx.getId() + ':' + nextIndex;
      previousValue = tx.outs[nextIndex].value;
      previousScript = tx.outs[nextIndex].script.toString('hex');
    }
  }
  return checks;
}
