import { sha256x2 } from '@scure/btc-signer/utils.js';
import { Transaction } from '@scure/btc-signer';
import {
  AcceleratorProvider,
  SubmissionCapabilities,
} from './private-submission.models';
export function rawTransactionId(raw: string): string {
  if (raw.length > 8000000 || !/^(?:[0-9a-f]{2})+$/i.test(raw))
    throw Error('Enter complete transaction hex within4MB.');
  const tx = Transaction.fromRaw(
    Uint8Array.from(raw.match(/../g)!, (s) => parseInt(s, 16)),
    { allowUnknownInputs: true, allowUnknownOutputs: true }
  );
  if (!tx.inputsLength || !tx.outputsLength)
    throw Error('Transaction needs inputs and outputs.');
  return Array.from(sha256x2(tx.toBytes(true, false)).reverse(), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
export function validCapabilities(c: any): c is SubmissionCapabilities {
  return (
    !!c &&
    [
      'public_p2p_enabled',
      'privatebroadcast_tor_enabled',
      'privatebroadcast_i2p_enabled',
      'tor_active',
      'i2p_active',
    ].every((k) => typeof c[k] === 'boolean') &&
    typeof c.core_version === 'string' &&
    Number.isSafeInteger(c.queue_limit) &&
    c.queue_limit >= 0 &&
    Number.isSafeInteger(c.current_queue_count) &&
    c.current_queue_count >= 0 &&
    c.current_queue_count <= c.queue_limit
  );
}
export function validProvider(p: any): p is AcceleratorProvider {
  return (
    !!p &&
    [
      'provider_id',
      'identity_key',
      'name',
      'provider_signature',
      'status_endpoint',
    ].every(
      (k) =>
        typeof p[k] === 'string' &&
        p[k].trim().length > 0 &&
        p[k].length <= 8192
    ) &&
    [
      'supported_networks',
      'submission_modes',
      'payment_methods',
      'partner_mining_claims',
    ].every(
      (k) =>
        Array.isArray(p[k]) && p[k].every((v: any) => typeof v === 'string')
    ) &&
    Number.isSafeInteger(p.minimum_fee_sats) &&
    p.minimum_fee_sats >= 0 &&
    Number.isSafeInteger(p.maximum_tx_vsize) &&
    p.maximum_tx_vsize > 0 &&
    ['online', 'degraded', 'offline'].includes(p.health_status) &&
    Number.isFinite(Date.parse(p.effective_from)) &&
    Number.isFinite(Date.parse(p.expires_at)) &&
    Date.parse(p.effective_from) < Date.parse(p.expires_at)
  );
}
