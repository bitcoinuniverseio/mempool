import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { resolve } from 'path';
import config from '../../config';
import { TaprootAssetsEvidenceError } from './taproot-assets.service';

export interface Bolt12DecodedOffer {
  status: 'decoded'; syntax_valid: true; engine: 'lightning-0.2.6'; network: string;
  input_sha256: string; offer_id: string; normalized_offer: string; tlv_hex: string;
  description: string | null; issuer: string | null; issuer_signing_pubkey: string | null;
  amount: null | { kind: 'bitcoin'; amount_msat: string } | { kind: 'currency'; currency: string; amount_minor_units: string };
  quantity: { kind: 'one' | 'unbounded' } | { kind: 'bounded'; maximum: string };
  absolute_expiry: string | null; expired: boolean; network_compatible: boolean; unknown_required_features: boolean;
  usable_for_invoice_request: boolean; chain_hashes_wire_order: string[]; blinded_path_count: number;
  signature_status: 'not-applicable-unsigned-offer'; payment_verified: false; scope: string;
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const atomic = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
let active = 0;
export async function decodeBolt12Offer(request: any, network = config.MEMPOOL.NETWORK): Promise<Bolt12DecodedOffer> {
  if (!request || typeof request.offer !== 'string' || !request.offer.length || Buffer.byteLength(request.offer, 'utf8') > 16384 ||
      request.network !== network || !['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network)) {
    throw new TaprootAssetsEvidenceError('invalid-input', 'Supply a BOLT12 offer of at most 16 KiB and the selected backend network.', 400);
  }
  if (active >= 2) throw new TaprootAssetsEvidenceError('unavailable-offer-decoder', 'The bounded native offer decoder is busy.');
  active++;
  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await new Promise<any>((accept, reject) => {
      // A fixed bundled engine path; no shell, ambient PATH executable, or request-supplied binary.
      const executable = resolve(__dirname, '../../../../tools/bolt12-proof/bin/universe-bolt12-proof' + (process.platform === 'win32' ? '.exe' : ''));
      const child = execFile(executable, [], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) return reject(new TaprootAssetsEvidenceError('unavailable-offer-decoder', 'The pinned native offer decoder is unavailable.'));
        try { accept(JSON.parse(stdout)); } catch { reject(new TaprootAssetsEvidenceError('unavailable-offer-decoder', 'The native offer decoder returned malformed evidence.')); }
      });
      child.stdin?.on('error', () => { /* The bounded child completion callback handles this failure. */ });
      child.stdin?.end(JSON.stringify({ offer: request.offer, network, now }));
    });
    if (result?.status === 'invalid' && result?.syntax_valid === false) throw new TaprootAssetsEvidenceError('invalid-offer', 'The native BOLT12 parser rejected this offer.', 400);
    const amount = result?.amount;
    const amountValid = amount === null || amount?.kind === 'bitcoin' && atomic(amount.amount_msat) && amount.amount_msat !== '0' ||
      amount?.kind === 'currency' && /^[A-Z]{3}$/.test(amount.currency) && atomic(amount.amount_minor_units) && amount.amount_minor_units !== '0';
    if (result?.status !== 'decoded' || result.syntax_valid !== true || result.engine !== 'lightning-0.2.6' || result.network !== network ||
        !hash(result.offer_id) || typeof result.canonical_offer !== 'string' || !result.canonical_offer.startsWith('lno1') || result.canonical_offer.length > 16384 ||
        typeof result.tlv_hex !== 'string' || result.tlv_hex.length > 32768 || !/^(?:[0-9a-f]{2})+$/.test(result.tlv_hex) || !amountValid ||
        ![result.expired, result.network_compatible, result.unknown_required_features, result.usable_for_invoice_request].every(v => typeof v === 'boolean') ||
        result.usable_for_invoice_request !== (result.network_compatible && !result.expired && !result.unknown_required_features) ||
        ![result.description, result.issuer].every(v => v === null || typeof v === 'string') ||
        !(result.issuer_signing_pubkey === null || /^(02|03)[0-9a-f]{64}$/.test(result.issuer_signing_pubkey)) ||
        !(result.absolute_expiry === null || atomic(result.absolute_expiry)) ||
        result.expired !== (result.absolute_expiry !== null && BigInt(now) > BigInt(result.absolute_expiry)) ||
        !['one', 'unbounded', 'bounded'].includes(result.quantity?.kind) || result.quantity.kind === 'bounded' && (!atomic(result.quantity.maximum) || result.quantity.maximum === '0') ||
        !Array.isArray(result.chain_hashes_wire_order) || !result.chain_hashes_wire_order.length || !result.chain_hashes_wire_order.every(hash) ||
        !Number.isSafeInteger(result.blinded_path_count) || result.blinded_path_count < 0 ||
        result.signature_status !== 'not-applicable-unsigned-offer' || result.payment_verified !== false || typeof result.scope !== 'string') {
      throw new TaprootAssetsEvidenceError('unavailable-offer-decoder', 'The native offer decoder returned inconsistent evidence.');
    }
    // The pinned engine names the re-encoded offer canonical_offer; the public
    // contract carries it as normalized_offer.
    const { canonical_offer: normalizedOffer, ...decoded } = result;
    return { ...decoded, normalized_offer: normalizedOffer, input_sha256: createHash('sha256').update(request.offer, 'utf8').digest('hex') };
  } finally { active--; }
}
