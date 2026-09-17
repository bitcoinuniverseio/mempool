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
/**
 * A provider view from the owned directory. The directory file is the trust
 * root: entries carry no separate signature and name no health endpoint, so
 * both are null; health is 'unmeasured' because nothing is probed; a key with
 * no end of validity gives a null expires_at.
 */
export function validProvider(p: any): p is AcceleratorProvider {
  const text = (v: unknown): boolean =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= 8192;
  const optionalText = (v: unknown): boolean => v === null || text(v);
  return (
    !!p &&
    ['provider_id', 'identity_key', 'name'].every((k) => text(p[k])) &&
    optionalText(p.provider_signature) &&
    optionalText(p.status_endpoint) &&
    (p.keys === undefined ||
      (Array.isArray(p.keys) &&
        p.keys.every(
          (k: any) =>
            !!k &&
            text(k.kid) &&
            ['ed25519', 'secp256k1-schnorr'].includes(k.algorithm) &&
            text(k.publicKey) &&
            Number.isFinite(Date.parse(k.validFrom)) &&
            (k.validUntil === null || Number.isFinite(Date.parse(k.validUntil)))
        ))) &&
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
    ['online', 'degraded', 'offline', 'unmeasured'].includes(p.health_status) &&
    Number.isFinite(Date.parse(p.effective_from)) &&
    (p.expires_at === null ||
      (Number.isFinite(Date.parse(p.expires_at)) &&
        Date.parse(p.effective_from) < Date.parse(p.expires_at)))
  );
}
