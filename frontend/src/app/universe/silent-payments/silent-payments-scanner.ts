import { Point } from '@noble/secp256k1';
import type { SilentPaymentBlockBundle, SilentPaymentBlockManifest } from './silent-payments.service';

const order = Point.CURVE().n;
const encoder = new TextEncoder();
const concat = (...parts: Uint8Array[]) => { const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; };
const bytes = (hex: string) => {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(hex)) throw new Error('Invalid hexadecimal scan data.');
  return Uint8Array.from(hex.match(/../g)!, part => parseInt(part, 16));
};
const hex = (value: Uint8Array) => Array.from(value, b => b.toString(16).padStart(2, '0')).join('');
const ser32 = (value: number, little = false) => { const data = new Uint8Array(4); new DataView(data.buffer).setUint32(0, value, little); return data; };
async function sha256(value: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value as BufferSource)); }
async function tagged(tag: string, value: Uint8Array): Promise<Uint8Array> { const t = await sha256(encoder.encode(tag)); return sha256(concat(t, t, value)); }
function scalar(value: Uint8Array): bigint { const n = BigInt('0x' + hex(value)); if (n === 0n || n >= order) throw new Error('Invalid BIP352 scalar.'); return n; }
function compressed(value: string): Point { if (!/^(02|03)[0-9a-fA-F]{64}$/.test(value)) throw new Error('Expected a compressed public key.'); return Point.fromHex(value).assertValidity(); }

export interface SilentPaymentMatch { height: number; txid: string; vout: number; pubkey: string; amount_sats: string }

export function validateSilentScanInputs(scanKey: string, spendKey: string, maxLabel: number): void {
  if (!/^[0-9a-fA-F]{64}$/.test(scanKey)) throw new Error('Scan capability must be a 32-byte private scan key.');
  if (!Number.isSafeInteger(maxLabel) || maxLabel < 0 || maxLabel > 100) throw new Error('Maximum label must be between 0 and 100.');
  const scan = bytes(scanKey);
  try { scalar(scan); compressed(spendKey); } finally { scan.fill(0); }
}

export async function verifySilentBundle(raw: string, manifest: SilentPaymentBlockManifest, network: string, requestedHeight = manifest.height): Promise<SilentPaymentBlockBundle> {
  if (raw.length > 16 * 1024 * 1024) throw new Error('Block bundle exceeds scan size limit.');
  if (hex(await sha256(encoder.encode(raw))) !== manifest.bundle_hash) throw new Error('Block bundle integrity check failed.');
  const bundle = JSON.parse(raw) as SilentPaymentBlockBundle;
  if (manifest.schema_version !== 1 || bundle.schema_version !== 1 || bundle.chain !== 'bitcoin' || manifest.chain !== 'bitcoin' || bundle.network !== network || manifest.network !== network || !Number.isSafeInteger(requestedHeight) || requestedHeight < 0 || requestedHeight > 0xffffffff || manifest.height !== requestedHeight || bundle.height !== manifest.height || !/^[0-9a-f]{64}$/.test(manifest.block_hash) || !/^[0-9a-f]{64}$/.test(manifest.previous_block_hash) || bundle.block_hash !== manifest.block_hash || bundle.previous_block_hash !== manifest.previous_block_hash || !Array.isArray(bundle.transactions)) throw new Error('Bundle does not match the requested network/checkpoint.');
  if (bundle.transactions.length > 100000) throw new Error('Too many scan transactions.');
  return bundle;
}

/** The private scan capability is used only in this browser computation. No spending key is required. */
export async function scanSilentBundle(bundle: SilentPaymentBlockBundle, scanKey: string, spendKey: string, maxLabel = 0, cancelled: () => boolean = () => false): Promise<SilentPaymentMatch[]> {
  validateSilentScanInputs(scanKey, spendKey, maxLabel);
  const scanBytes = bytes(scanKey); const scan = scalar(scanBytes); const spend = compressed(spendKey);
  const labels = [spend];
  for (let m = 0; m <= maxLabel; m++) {
    const tweak = scalar(await tagged('BIP0352/Label', concat(scanBytes, ser32(m))));
    labels.push(spend.add(Point.BASE.multiply(tweak)));
  }
  const matches: SilentPaymentMatch[] = [];
  try {
    for (const tx of bundle.transactions) {
      if (cancelled()) throw new Error('Scan cancelled.');
      if (!/^[0-9a-f]{64}$/.test(tx.txid) || !Array.isArray(tx.input_pubkeys) || !tx.input_pubkeys.length || !Array.isArray(tx.spent_outpoints) || !tx.spent_outpoints.length || !Array.isArray(tx.candidate_outputs) || tx.candidate_outputs.length > 100000) throw new Error('Malformed scanning transaction.');
      const sum = tx.input_pubkeys.reduce((point, key) => point.add(compressed(key)), Point.ZERO);
      if (sum.is0()) continue;
      const outpoints = tx.spent_outpoints.map(out => {
        if (!/^[0-9a-f]{64}$/.test(out.txid) || !Number.isSafeInteger(out.vout) || out.vout < 0 || out.vout > 0xffffffff) throw new Error('Invalid scanning outpoint.');
        return concat(bytes(out.txid).reverse(), ser32(out.vout, true));
      }).sort((a, b) => { for (let i = 0; i < 36; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
      const inputHash = scalar(await tagged('BIP0352/Inputs', concat(outpoints[0], sum.toBytes())));
      const shared = sum.multiply((inputHash * scan) % order).toBytes();
      const remaining = [...tx.candidate_outputs];
      for (const out of remaining) {
        if (!/^[0-9a-f]{64}$/.test(out.pubkey) || !Number.isSafeInteger(out.vout) || out.vout < 0 || !/^(0|[1-9][0-9]*)$/.test(out.amount_sats) || BigInt(out.amount_sats) > 2100000000000000n) throw new Error('Invalid candidate output.');
      }
      for (let k = 0; k < 2323 && remaining.length; k++) {
        if (cancelled()) throw new Error('Scan cancelled.');
        const tweak = scalar(await tagged('BIP0352/SharedSecret', concat(shared, ser32(k))));
        const delta = Point.BASE.multiply(tweak);
        const keys = new Set(labels.map(label => label.add(delta)).filter(point => !point.is0()).map(point => point.toHex().slice(2)));
        let found = false;
        for (let i = remaining.length - 1; i >= 0; i--) if (keys.has(remaining[i].pubkey)) {
          matches.push({ height: bundle.height, txid: tx.txid, ...remaining[i] });
          remaining.splice(i, 1); found = true;
        }
        if (!found) break;
      }
    }
    return matches;
  } finally { scanBytes.fill(0); }
}
