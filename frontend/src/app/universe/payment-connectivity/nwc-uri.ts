import { Point, etc, utils } from '@noble/secp256k1';

export interface NwcInspection {
  valid: boolean;
  masked_uri: string;
  wallet_service_pubkey: string;
  relays: string[];
  errors: string[];
  encryption_supported: null;
}

/** Decode nested URL escapes before redacting secret copies in public fields. */
function redact(value: string, secret: string): string {
  let decoded = value;
  for (let i = 0; i < 16; i++) {
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) return decoded.replace(new RegExp(secret, 'gi'), '[REDACTED]');
    decoded = next;
  }
  return '[REDACTED ENCODED FIELD]';
}

/** NIP47 structural inspection only. No requests, storage, or capability claims. */
export function inspectNwcUri(input: string): NwcInspection {
  const failure = (message: string): NwcInspection => ({ valid: false, masked_uri: '', wallet_service_pubkey: '', relays: [], errors: [message], encryption_supported: null });
  if (typeof input !== 'string' || input.length > 8192 || /[\s#]/.test(input)) return failure('Enter a bounded NWC URI with valid URL encoding.');
  const match = /^nostr\+walletconnect:\/\/([0-9a-f]{64})\?(.+)$/i.exec(input);
  if (!match) return failure('The URI must contain a 32-byte x-only wallet public key and query parameters.');
  const publicKey = match[1].toLowerCase();
  try { Point.fromHex('02' + publicKey).assertValidity(); }
  catch { return failure('The wallet service public key is not a valid secp256k1 point.'); }
  const fields = new Map<string, string[]>();
  for (const field of match[2].split('&')) {
    const separator = field.indexOf('=');
    if (separator < 1 || field.slice(separator + 1).includes('=')) return failure('Every NWC parameter must be URL-encoded key=value data.');
    let key: string;
    let value: string;
    try { key = decodeURIComponent(field.slice(0, separator)); value = decodeURIComponent(field.slice(separator + 1)); }
    catch { return failure('An NWC parameter has invalid percent or UTF-8 encoding.'); }
    if (!['secret', 'relay', 'lud16'].includes(key)) return failure('The URI contains an unsupported NWC parameter.');
    if (key !== 'relay' && fields.has(key)) return failure('The URI contains a duplicate secret or lightning address.');
    fields.set(key, [...(fields.get(key) || []), value]);
  }
  const secret = fields.get('secret')?.[0];
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) return failure('A 32-byte hex client secret is required.');
  const secretBytes = etc.hexToBytes(secret);
  const validScalar = utils.isValidSecretKey(secretBytes);
  secretBytes.fill(0);
  if (!validScalar) return failure('The client secret is not a valid secp256k1 scalar.');
  const relays = fields.get('relay') || [];
  if (!relays.length || relays.length > 8) return failure('Declare between one and eight websocket relay URLs.');
  for (const relay of relays) {
    try {
      const parsed = new URL(relay);
      if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || /\s/.test(relay)) {
        return failure('Relay URLs must use ws:// or wss:// without credentials, fragments, or whitespace.');
      }
    } catch { return failure('A relay URL is invalid.'); }
  }
  const lud16 = fields.get('lud16')?.[0];
  if (lud16 !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lud16)) return failure('The optional lightning address is invalid.');
  const safeKey = redact(publicKey, secret);
  const safeRelays = relays.map(relay => redact(relay, secret));
  const safeQuery = safeRelays.map(relay => 'relay=' + encodeURIComponent(relay));
  safeQuery.push('secret=REDACTED');
  if (lud16 !== undefined) safeQuery.push('lud16=' + encodeURIComponent(redact(lud16, secret)));
  return { valid: true, masked_uri: `nostr+walletconnect://${safeKey}?${safeQuery.join('&')}`,
    wallet_service_pubkey: safeKey, relays: safeRelays, errors: [], encryption_supported: null };
}
