import { Transaction } from '@interfaces/electrs.interface';
import { PrivacyInput, PrivacyOutput, PrivacyTransaction } from './privacy-rules';

/**
 * Turns a transaction the explorer already has into the shape the rules read.
 *
 * The rules deliberately know nothing about the explorer's types, so that
 * they can be given a transaction decoded locally from raw hex just as
 * easily as one the server answered with. This is the only place the two
 * meet.
 *
 * An input whose previous output is not loaded keeps a null value rather than
 * a zero. A rule that compares amounts then declines to run, which is the
 * right outcome: a comparison against a value that was never read is not a
 * comparison.
 */
export function toPrivacyTransaction(tx: Transaction): PrivacyTransaction {
  const inputs: PrivacyInput[] = (tx.vin ?? []).map((vin, index) => ({
    index,
    valueSats: typeof vin?.prevout?.value === 'number' ? vin.prevout.value : null,
    scriptType: vin?.prevout?.scriptpubkey_type ?? 'unknown',
    address: vin?.prevout?.scriptpubkey_address ?? null,
    // An absent sequence reads as final, which is what a missing field means
    // rather than a signal this transaction never made.
    sequence: typeof vin?.sequence === 'number' ? vin.sequence : 0xffffffff,
  }));

  const outputs: PrivacyOutput[] = (tx.vout ?? []).map((vout, index) => ({
    index,
    valueSats: typeof vout?.value === 'number' ? vout.value : 0,
    scriptType: vout?.scriptpubkey_type ?? 'unknown',
    address: vout?.scriptpubkey_address ?? null,
  }));

  return {
    txid: tx.txid,
    version: tx.version,
    locktime: tx.locktime,
    inputs,
    outputs,
    confirmedHeight: tx.status?.confirmed && typeof tx.status.block_height === 'number'
      ? tx.status.block_height
      : null,
  };
}

/**
 * True when a transaction spends a coinbase, which has no previous output.
 *
 * Worth stating on the page rather than letting the rules stay quiet: a
 * coinbase input has nothing to link to and several rules will find nothing
 * for a reason that has nothing to do with privacy.
 */
export function isCoinbase(tx: Transaction): boolean {
  return (tx.vin ?? []).some((vin) => vin?.is_coinbase === true);
}
