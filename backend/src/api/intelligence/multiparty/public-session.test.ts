import fs from 'fs';
import path from 'path';
import multipartyService from './multiparty.service';
import { MuSig2PublicSessionSchema } from './multiparty.models';

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors/sig_agg_vectors.json'), 'utf8'));
interface SigAggCase { key_indices: number[]; nonce_indices: number[]; psig_indices: number[]; tweak_indices: number[]; aggnonce: string; expected: string; }
const untweaked: SigAggCase[] = vectors.valid_test_cases.filter(test => test.tweak_indices.length === 0);
const transcript = (test = untweaked[0]): Partial<MuSig2PublicSessionSchema> => ({
  participant_public_keys: test.key_indices.map(index => vectors.pubkeys[index]),
  public_nonces: test.nonce_indices.map(index => vectors.pnonces[index]),
  partial_signatures: test.psig_indices.map(index => vectors.psigs[index]),
  aggregate_nonce: test.aggnonce,
  message_hash: vectors.msg,
  final_signature: test.expected,
});

describe('untweaked BIP327 public transcript verification', () => {
  it.each(untweaked)('verifies every supplied contribution and the official final signature', test => {
    const result = multipartyService.verifyPublicSession(transcript(test));
    expect(result).toMatchObject({ verified: true, stage: 'verified-session',
      key_aggregation_verified: true, nonce_aggregation_verified: true,
      partial_signature_validity: [true, true], final_bip340_valid: true,
      final_signature: test.expected.toLowerCase(), participant_count: 2 });
  });

  it('aggregates and verifies a final signature even when the caller has not supplied it', () => {
    const session = transcript();
    delete session.final_signature;
    expect(multipartyService.verifyPublicSession(session)).toMatchObject({
      verified: true, final_bip340_valid: true, final_signature: untweaked[0].expected.toLowerCase(),
    });
  });

  it('returns real key aggregation without claiming the absent rounds were verified', () => {
    const session = transcript();
    expect(multipartyService.verifyPublicSession({ participant_public_keys: session.participant_public_keys,
      message_hash: session.message_hash })).toMatchObject({ verified: false, stage: 'partial-session',
      key_aggregation_verified: true, nonce_aggregation_verified: false, final_bip340_valid: null });
  });

  it('does not equate a verified final signature with a complete nonce and partial transcript', () => {
    const session = transcript();
    delete session.public_nonces;
    delete session.partial_signatures;
    delete session.aggregate_nonce;
    expect(multipartyService.verifyPublicSession(session)).toMatchObject({
      verified: false, stage: 'partial-session', final_bip340_valid: true,
    });
  });

  it('ignores claimed round completion and duplicate status in favor of actual contributions', () => {
    const session = transcript();
    expect(multipartyService.verifyPublicSession({ participant_public_keys: session.participant_public_keys,
      message_hash: session.message_hash, is_round_one_complete: true, is_round_two_complete: true,
      has_duplicate_nonces: false })).toMatchObject({ verified: false, stage: 'partial-session',
      nonce_aggregation_verified: false, partial_signature_validity: [], final_bip340_valid: null });
  });

  it('verifies actual nonce aggregation without claiming absent partial signatures', () => {
    const session = transcript();
    delete session.partial_signatures;
    delete session.final_signature;
    expect(multipartyService.verifyPublicSession(session)).toMatchObject({ verified: false, stage: 'partial-session',
      nonce_aggregation_verified: true, aggregate_nonce: untweaked[0].aggnonce.toLowerCase(), final_bip340_valid: null });
  });

  it.each(['tweaks', 'is_xonly', 'taproot_merkle_root'])('rejects unsupported %s instead of silently verifying an untweaked session', field => {
    expect(multipartyService.verifyPublicSession({ ...transcript(), [field]: ['01'.repeat(32)] })).toMatchObject({
      verified: false, stage: 'invalid-input',
    });
    expect(multipartyService.verifyPublicSession({ ...transcript(), [field]: [] }).error).toMatch(/untweaked/);
  });

  it.each(['public_nonces', 'partial_signatures'] as const)('requires the %s list to align with every participant', field => {
    const session = transcript();
    session[field] = session[field]!.slice(0, 1);
    expect(multipartyService.verifyPublicSession(session)).toMatchObject({ verified: false, stage: 'invalid-input' });
  });

  it.each(['participant_public_keys', 'public_nonces', 'partial_signatures'] as const)('binds %s order instead of accepting a reshuffled transcript', field => {
    const session = transcript();
    session[field] = [...session[field]!].reverse();
    expect(multipartyService.verifyPublicSession(session).verified).toBe(false);
  });

  it.each([
    { message_hash: '00'.repeat(32) },
    { message_hash: 'z'.repeat(64) },
    { aggregate_public_key: '00'.repeat(32) },
    { aggregate_nonce: '00'.repeat(66) },
    { public_nonces: ['00'.repeat(66), vectors.pnonces[1]] },
    { partial_signatures: ['ff'.repeat(32), vectors.psigs[1]] },
    { partial_signatures: ['00'.repeat(32), vectors.psigs[1]] },
    { final_signature: '00'.repeat(64) },
  ])('rejects a corrupted transcript: %j', changed => {
    expect(multipartyService.verifyPublicSession({ ...transcript(), ...changed })).toMatchObject({
      verified: false, stage: 'invalid-input',
    });
  });
});
