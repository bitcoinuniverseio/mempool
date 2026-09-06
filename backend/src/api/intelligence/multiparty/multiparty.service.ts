import * as secp256k1 from 'tiny-secp256k1';
import { SigningProduct, MuSig2PublicSessionSchema, MultipartyOverviewResponse } from './multiparty.models';

export class MultipartyEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const missingEngine = 'MuSig2 verification is unavailable. BIP327 participant-key aggregation, public-nonce and partial-signature verification are not connected. A final BIP340 check alone cannot verify this session.';
const sourceUnavailable = (): never => {
  throw new MultipartyEvidenceError('unavailable-signing-source',
    'Signing capability evidence is unavailable. A trusted product directory and actual version-specific test results are required.');
};
const hex = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value);

export class MultipartyService {
  public getOverview(): MultipartyOverviewResponse {
    return sourceUnavailable();
  }

  public listProducts(): SigningProduct[] {
    return sourceUnavailable();
  }

  public getProduct(_productId: string): SigningProduct | undefined {
    return sourceUnavailable();
  }

  public getCompatibility(): never {
    return sourceUnavailable();
  }

  public getTestVectors(): never {
    throw new MultipartyEvidenceError('unavailable-vector-source',
      'Published MuSig2 and wallet-policy vector results are unavailable. The previous generated examples were not executed conformance tests.');
  }

  public verifyPublicSession(session: Partial<MuSig2PublicSessionSchema>): {
    verified: false;
    stage: 'invalid-input' | 'unavailable-musig2-engine';
    error: string;
    has_duplicate_nonces: boolean;
    aggregate_public_key: null;
    provided_aggregate_public_key: string | null;
    key_aggregation_verified: false;
    final_bip340_valid: boolean | null;
    final_signature_scope: string;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const object = session && typeof session === 'object' && !Array.isArray(session);
    const participants = object && Array.isArray(session.participant_public_keys) ? session.participant_public_keys : [];
    if (participants.length < 2 || participants.length > 1000) {
      errors.push('A session must contain between 2 and 1000 participant public keys.');
    }
    if (!participants.every(key => hex(key, 33) && secp256k1.isPoint(Buffer.from(key, 'hex')))) {
      errors.push('Participant public keys must encode compressed secp256k1 points.');
    }
    const participantKeys = participants.filter(key => typeof key === 'string').map(key => key.toLowerCase());
    if (new Set(participantKeys).size !== participants.length) {
      errors.push('Duplicate participant public keys are prohibited in this application.');
    }
    const nonces = object && Array.isArray(session.public_nonces) ? session.public_nonces : [];
    if (object && session.public_nonces !== undefined && !Array.isArray(session.public_nonces)) {
      errors.push('Public nonces must be an array.');
    }
    if (nonces.some(nonce => typeof nonce !== 'string')) errors.push('Each public nonce must be a string.');
    const nonceStrings = nonces.filter(nonce => typeof nonce === 'string').map(nonce => nonce.toLowerCase());
    const hasDuplicateNonces = new Set(nonceStrings).size !== nonceStrings.length;
    if (hasDuplicateNonces) warnings.push('Repeated public nonce detected. This is a local duplicate check, not verification of nonce generation or reuse across other sessions.');

    let finalSigValid: boolean | null = null;
    const providedKey = object && hex(session.aggregate_public_key, 32) ? session.aggregate_public_key : null;
    if (object && session.final_signature !== undefined) {
      if (!providedKey || !secp256k1.isXOnlyPoint(Buffer.from(providedKey, 'hex')) ||
          !hex(session.message_hash, 32) || !hex(session.final_signature, 64)) {
        errors.push('Final signature verification requires a 32-byte x-only public key, 32-byte message hash and 64-byte signature in hexadecimal.');
      } else {
        // The pinned dependency executes BIP340. This key is caller supplied;
        // its relationship to the participant list has not been established.
        try {
          finalSigValid = secp256k1.verifySchnorr(Buffer.from(session.message_hash, 'hex'),
            Buffer.from(providedKey, 'hex'), Buffer.from(session.final_signature, 'hex'));
        } catch {
          finalSigValid = false;
        }
        if (!finalSigValid) errors.push('The final BIP340 signature is invalid for the supplied public key and message hash.');
      }
    }

    return {
      verified: false,
      stage: errors.length ? 'invalid-input' : 'unavailable-musig2-engine',
      error: errors.length ? errors.join(' ') : missingEngine,
      has_duplicate_nonces: hasDuplicateNonces,
      aggregate_public_key: null,
      provided_aggregate_public_key: providedKey,
      key_aggregation_verified: false,
      final_bip340_valid: finalSigValid,
      final_signature_scope: 'BIP340 over the supplied aggregate public key and 32-byte message hash only; no participant aggregation, nonce or partial-signature verification.',
      errors,
      warnings: [...warnings, missingEngine],
    };
  }

  public verifyManifest(manifest: unknown): {
    verified: false; stage: 'invalid-input' | 'unavailable-vendor-trust'; product_id: string; error: string; errors: string[];
  } {
    const value = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
    const errors: string[] = [];
    if (typeof value.product_id !== 'string' || !value.product_id.trim()) errors.push('Product ID is required.');
    if (typeof value.signature !== 'string' || !value.signature.trim()) errors.push('Vendor signature is required.');
    return {
      verified: false,
      stage: errors.length ? 'invalid-input' : 'unavailable-vendor-trust',
      product_id: typeof value.product_id === 'string' ? value.product_id : '',
      error: errors.length ? errors.join(' ') : 'Manifest verification is unavailable. A trusted vendor-key directory, exact signed payload encoding and signature algorithm are required.',
      errors,
    };
  }
}

export default new MultipartyService();
