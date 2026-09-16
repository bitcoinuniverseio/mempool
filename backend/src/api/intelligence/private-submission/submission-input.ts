import { Transaction } from 'bitcoinjs-lib';
export class SubmissionInputError extends Error {}
export const txidInput = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v))
    throw new SubmissionInputError(
      'A32-byte transaction or block hash is required.'
    );
  return v.toLowerCase();
};
export function rawInput(v: unknown): string {
  if (
    typeof v !== 'string' ||
    v.length > 8000000 ||
    !/^(?:[0-9a-f]{2})+$/i.test(v)
  )
    throw new SubmissionInputError('Provide bounded complete transaction hex.');
  try {
    const tx = Transaction.fromHex(v);
    if (!tx.ins.length || !tx.outs.length) throw Error();
    return v.toLowerCase();
  } catch {
    throw new SubmissionInputError('Transaction serialization is malformed.');
  }
}
export function diagnosisInput(body: any): string {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1
  )
    throw new SubmissionInputError('Provide exactly one of txid or raw_tx.');
  if (Object.prototype.hasOwnProperty.call(body, 'txid'))
    return txidInput(body.txid);
  if (Object.prototype.hasOwnProperty.call(body, 'raw_tx'))
    return rawInput(body.raw_tx);
  throw new SubmissionInputError('Provide txid or raw_tx.');
}
export function submissionInput(body: any): { raw_tx: string; method: string } {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !['raw_tx', 'method'].includes(k)) ||
    ![
      'public_p2p',
      'privatebroadcast_tor',
      'privatebroadcast_i2p',
      'privatebroadcast_tor_exit',
      'configured_private_relay',
      'configured_accelerator',
      'direct_miner_submission',
    ].includes(body.method)
  )
    throw new SubmissionInputError(
      'Provide public raw_tx and an explicit supported submission method.'
    );
  return { raw_tx: rawInput(body.raw_tx), method: body.method };
}
export function tokenInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 256 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new SubmissionInputError('Provide a bounded nonempty identity.');
  return value;
}
