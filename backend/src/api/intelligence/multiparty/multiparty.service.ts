import * as secp256k1 from 'tiny-secp256k1';
import { SigningProduct, MuSig2PublicSessionSchema, MuSig2VerificationResult, MultipartyOverviewResponse } from './multiparty.models';
import { aggregateKeys, aggregateNonces, aggregatePartials, publicSession, verifyPartial } from './musig2';

export class MultipartyEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

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

  public verifyPublicSession(session: Partial<MuSig2PublicSessionSchema>): MuSig2VerificationResult {
    const errors: string[] = [];
    const result: MuSig2VerificationResult = {
      verified: false, stage: 'partial-session', scope: 'bip327-untweaked-public-transcript', error: '',
      participant_count: 0, has_duplicate_nonces: false, aggregate_public_key: null,
      provided_aggregate_public_key: null, key_aggregation_verified: false,
      aggregate_nonce: null, nonce_aggregation_verified: false, partial_signature_validity: [],
      final_bip340_valid: null, final_signature: null,
      final_signature_scope: 'BIP340 over the BIP327-computed untweaked participant aggregate and supplied 32-byte message hash. No transaction sighash derivation, participant identity authentication, nonce-generation or cross-session nonce-reuse verification.',
      errors, warnings: [],
    };
    const finish = (): MuSig2VerificationResult => {
      result.error = errors.join(' ');
      if (errors.length) { result.verified = false; result.stage = 'invalid-input'; }
      else if (result.verified) result.stage = 'verified-session';
      else result.warnings.push('The supplied public transcript is incomplete; only the reported individual checks were performed.');
      return result;
    };
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      errors.push('A public-session object is required.');
      return finish();
    }
    // Reject unknown extensions rather than silently interpreting a tweaked
    // session as untweaked. Legacy UI aliases are accepted but not authoritative.
    const allowed = new Set(['session_id', 'network', 'psbt_version', 'unsigned_transaction_hash', 'input_index',
      'message_hash', 'participant_public_keys', 'aggregate_public_key', 'public_nonces', 'aggregate_nonce',
      'partial_signatures', 'final_signature', 'is_round_one_complete', 'is_round_two_complete',
      'has_duplicate_nonces', 'session_hash', 'created_at', 'cosigners', 'message_digest']);
    const unsupported = Object.keys(session).filter(field => !allowed.has(field));
    if (unsupported.length) errors.push('Unsupported public-session fields; only untweaked BIP327 transcripts are supported: ' + unsupported.join(', ') + '.');
    const participants = Array.isArray(session.participant_public_keys) ? session.participant_public_keys : [];
    result.participant_count = participants.length;
    if (participants.length < 2 || participants.length > 1000) errors.push('A session must contain between 2 and 1000 participant public keys.');
    if (!participants.every(key => hex(key, 33) && secp256k1.isPointCompressed(Buffer.from(key, 'hex')))) {
      errors.push('Participant public keys must encode compressed secp256k1 points.');
    }
    const arrayField = (field: 'public_nonces' | 'partial_signatures'): string[] => {
      const value = session[field];
      if (value === undefined) return [];
      if (!Array.isArray(value)) { errors.push(field + ' must be an array.'); return []; }
      if (value.length && value.length !== participants.length) errors.push(field + ' must have one entry per participant, in participant order.');
      return value;
    };
    const nonces = arrayField('public_nonces');
    const partials = arrayField('partial_signatures');
    const nonceStrings = nonces.filter(nonce => typeof nonce === 'string').map(nonce => nonce.toLowerCase());
    result.has_duplicate_nonces = new Set(nonceStrings).size !== nonceStrings.length;
    if (result.has_duplicate_nonces) result.warnings.push('Repeated public nonce detected. This is a local duplicate check, not verification of nonce generation or reuse across other sessions.');
    if (!nonces.every(nonce => hex(nonce, 66))) errors.push('Public nonces must be 66-byte hexadecimal values.');
    if (!partials.every(signature => hex(signature, 32))) errors.push('Partial signatures must be 32-byte hexadecimal values.');
    if (partials.length && !nonces.length) errors.push('Partial verification requires every participant public nonce.');
    if (session.message_hash !== undefined && !hex(session.message_hash, 32)) errors.push('The message hash must contain 32 bytes in hexadecimal.');
    if ((partials.length || session.final_signature !== undefined) && !hex(session.message_hash, 32)) {
      errors.push('Signature verification requires a 32-byte message hash.');
    }
    if (session.final_signature !== undefined && !hex(session.final_signature, 64)) errors.push('The final signature must contain 64 bytes in hexadecimal.');
    if (session.aggregate_public_key !== undefined) {
      if (!hex(session.aggregate_public_key, 32)) errors.push('The supplied aggregate public key must contain 32 bytes in hexadecimal.');
      else result.provided_aggregate_public_key = session.aggregate_public_key.toLowerCase();
    }
    if (session.aggregate_nonce !== undefined && !hex(session.aggregate_nonce, 66)) errors.push('The aggregate nonce must contain 66 bytes in hexadecimal.');
    if (errors.length) return finish();
    try {
      const keys = aggregateKeys(participants.map(key => Buffer.from(key, 'hex')));
      result.aggregate_public_key = Buffer.from(keys.publicKey).toString('hex');
      result.key_aggregation_verified = true;
      if (result.provided_aggregate_public_key && result.provided_aggregate_public_key !== result.aggregate_public_key) {
        errors.push('The supplied aggregate public key does not match the ordered participant aggregation.');
      }
      if (session.aggregate_nonce !== undefined) {
        const providedNonce = Buffer.from(session.aggregate_nonce, 'hex');
        for (const half of [providedNonce.subarray(0, 33), providedNonce.subarray(33)]) {
          if (!half.equals(Buffer.alloc(33)) && !secp256k1.isPointCompressed(half)) errors.push('The supplied aggregate nonce contains an invalid point.');
        }
      }
      const publicNonces = nonces.map(nonce => Buffer.from(nonce, 'hex'));
      if (publicNonces.length) {
        result.aggregate_nonce = Buffer.from(aggregateNonces(publicNonces)).toString('hex');
        result.nonce_aggregation_verified = true;
        if (session.aggregate_nonce !== undefined && session.aggregate_nonce.toLowerCase() !== result.aggregate_nonce) {
          errors.push('The supplied aggregate nonce does not match the participant public nonces.');
        }
      }
      const verifyFinal = (signature: Uint8Array): boolean => secp256k1.verifySchnorr(
        Buffer.from(session.message_hash!, 'hex'), keys.publicKey, signature);
      if (session.final_signature !== undefined) {
        result.final_bip340_valid = verifyFinal(Buffer.from(session.final_signature, 'hex'));
        if (!result.final_bip340_valid) errors.push('The final BIP340 signature is invalid for the computed participant aggregate and message.');
      }
      if (partials.length) {
        const context = publicSession(keys, publicNonces, Buffer.from(session.message_hash!, 'hex'));
        const signatures = partials.map(signature => Buffer.from(signature, 'hex'));
        result.partial_signature_validity = signatures.map((signature, index) => verifyPartial(context, index, signature));
        result.partial_signature_validity.forEach((valid, index) => {
          if (!valid) errors.push('Invalid partial signature at participant index ' + index + '.');
        });
        if (result.partial_signature_validity.every(Boolean)) {
          const finalSignature = aggregatePartials(context, signatures);
          result.final_signature = Buffer.from(finalSignature).toString('hex');
          result.final_bip340_valid = verifyFinal(finalSignature);
          if (!result.final_bip340_valid) errors.push('The computed aggregate signature does not pass BIP340 verification.');
          if (session.final_signature !== undefined && session.final_signature.toLowerCase() !== result.final_signature) {
            errors.push('The supplied final signature does not match the ordered partial transcript.');
          }
          result.verified = result.final_bip340_valid && errors.length === 0;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Invalid public transcript.');
    }
    return finish();
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
