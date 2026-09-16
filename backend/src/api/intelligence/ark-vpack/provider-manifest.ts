import { createHash } from 'crypto';
import { isPoint, verifySchnorr } from 'tiny-secp256k1';

/** Project-defined signed statement, not an assertion that Ark providers publish this format. */
export function verifyProviderManifest(request: any, trustedKeys: string[] = [], now = Date.now()) {
  const errors: string[] = [];
  let signatureVerified = false;
  let payload: any = null;
  let key = '';
  if (request?.format !== 'universe-ark-provider-manifest-v1') errors.push('Unsupported manifest format; use an explicitly versioned signed statement.');
  if (typeof request?.signed_payload !== 'string' || request.signed_payload.length > 16384) errors.push('signed_payload must be the exact public JSON bytes of at most 16384 characters.');
  else {
    try {
      payload = JSON.parse(request.signed_payload);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error();
      if (!['provider_id', 'network', 'endpoint_url', 'vpack_version', 'identity_key', 'expires_at'].every(field => typeof payload[field] === 'string' && payload[field].length > 0)) throw Error();
      const endpoint = new URL(payload.endpoint_url);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw Error();
      if (!Number.isFinite(Date.parse(payload.expires_at)) || Date.parse(payload.expires_at) <= now) errors.push('The signed statement is expired or has an invalid expiry.');
      const identity = payload.identity_key;
      if (/^[0-9a-f]{64}$/i.test(identity) && isPoint(Buffer.from('02' + identity, 'hex'))) key = identity.toLowerCase();
      else if (/^0[23][0-9a-f]{64}$/i.test(identity) && isPoint(Buffer.from(identity, 'hex'))) key = identity.slice(2).toLowerCase();
      else errors.push('The identity key is not a valid public secp256k1 key.');
    } catch { errors.push('The public manifest payload has an invalid required field or endpoint.'); }
  }
  if (typeof request?.signature !== 'string' || !/^[0-9a-f]{128}$/i.test(request.signature)) errors.push('A 64-byte BIP340 signature is required.');
  if (!errors.length) {
    const digest = createHash('sha256').update('Universe Ark provider manifest v1\n').update(request.signed_payload, 'utf8').digest();
    try { signatureVerified = verifySchnorr(digest, Buffer.from(key, 'hex'), Buffer.from(request.signature, 'hex')); } catch { signatureVerified = false; }
    if (!signatureVerified) errors.push('The signature does not authenticate the exact supplied statement.');
  }
  const trusted = signatureVerified && trustedKeys.some(value => value.toLowerCase().replace(/^0[23](?=[0-9a-f]{64}$)/, '') === key);
  if (signatureVerified && !trusted) errors.push('The signer is not independently pinned in this provider registry.');
  return { valid: signatureVerified && trusted, signature_verified: signatureVerified, signer_trusted: trusted,
    provider_id: payload?.provider_id ?? null, errors,
    verification_scope: 'BIP340 authentication of the exact domain-separated public statement and explicitly pinned signer identity only. No provider health, endpoint ownership or protocol safety is inferred.' };
}
