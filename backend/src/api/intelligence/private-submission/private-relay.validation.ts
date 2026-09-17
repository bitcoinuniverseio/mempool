import { Transaction } from 'bitcoinjs-lib';
import { SubmissionInputError } from './submission-input';

/**
 * Bounded checks on a raw transaction before it is allowed into the durable
 * queue. The route's submissionInput already proved the hex parses; this pass
 * adds the bounds a relay endpoint would enforce anyway (consensus weight,
 * no coinbase) and yields the txid the record is keyed on.
 */
export const MAX_PRIVATE_RELAY_TX_BYTES = 400_000;
export const MIN_PRIVATE_RELAY_TX_BYTES = 60;

export interface ValidatedPrivateRelayTransaction {
  raw_tx: string;
  txid: string;
  size_bytes: number;
}

export function validatePrivateRelayTransaction(rawTx: unknown): ValidatedPrivateRelayTransaction {
  if (typeof rawTx !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(rawTx)) {
    throw new SubmissionInputError('Provide complete transaction hex.');
  }
  const sizeBytes = rawTx.length / 2;
  if (sizeBytes > MAX_PRIVATE_RELAY_TX_BYTES) {
    throw new SubmissionInputError(`Transaction exceeds ${MAX_PRIVATE_RELAY_TX_BYTES} bytes.`);
  }
  if (sizeBytes < MIN_PRIVATE_RELAY_TX_BYTES) {
    throw new SubmissionInputError(`Transaction is smaller than ${MIN_PRIVATE_RELAY_TX_BYTES} bytes.`);
  }
  let tx: Transaction;
  try {
    tx = Transaction.fromHex(rawTx);
  } catch {
    throw new SubmissionInputError('Transaction serialization is malformed.');
  }
  if (!tx.ins.length || !tx.outs.length) {
    throw new SubmissionInputError('Transaction needs at least one input and one output.');
  }
  if (tx.isCoinbase()) {
    throw new SubmissionInputError('A coinbase transaction cannot be relayed.');
  }
  if (tx.toHex().length !== rawTx.length) {
    throw new SubmissionInputError('Transaction hex carries trailing bytes.');
  }
  return { raw_tx: rawTx.toLowerCase(), txid: tx.getId(), size_bytes: sizeBytes };
}
