import bootstrapService from './bootstrap/bootstrap.service';
import timestampsService from './opentimestamps/opentimestamps.service';
import multipartyService from './multiparty/multiparty.service';
import express from 'express';
import { Server } from 'http';
import fs from 'fs';
import path from 'path';
import bootstrapRoutes from './bootstrap/bootstrap.routes';
import timestampRoutes from './opentimestamps/opentimestamps.routes';
import multipartyRoutes from './multiparty/multiparty.routes';

// Public BIP340 test vector 0; no wallet or user key material is involved.
// https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv
const publicKey = 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9';
const message = '00'.repeat(32);
const signature = 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0';
const participants = [
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
];

describe('verification evidence integrity', () => {
  it('cannot verify an unknown snapshot without a trusted manifest or snapshot bytes', () => {
    expect(() => bootstrapService.verifySnapshot({ snapshot_id: 'unknown', file_sha256: '00'.repeat(32),
      base_height: 840000, expected_txoutset_hash: '00'.repeat(32) })).toThrow(/unavailable/i);
  });

  it('cannot start a node job when no authorized executor or durable job store exists', () => {
    expect(() => bootstrapService.createOperatorJob({ job_type: 'load_snapshot', node_id: 'missing', snapshot_id: 'unknown' }))
      .toThrow(/unavailable/i);
  });

  it('does not manufacture calendar receipts, proof upgrades or Bitcoin attestations', () => {
    expect(() => timestampsService.stampDigest('ab'.repeat(32))).toThrow(/unavailable/i);
    expect(() => timestampsService.upgradeProof({ ots_proof: 'pending-proof-data' })).toThrow(/unavailable/i);
  });

  it('rejects malformed successful proof inputs instead of verifying an empty object', /** @asyncUnsafe Jest awaits this test and reports its rejection. */ async () => {
    await expect(timestampsService.verifyProof({})).rejects.toThrow(/proof/i);
    expect(() => timestampsService.stampDigest('z'.repeat(64))).toThrow(/digest/i);
  });

  it('does not certify a final signature by its length and computes the participant aggregate independently', () => {
    const result = multipartyService.verifyPublicSession({ participant_public_keys: participants,
      aggregate_public_key: publicKey, message_hash: message, final_signature: '00'.repeat(64) });
    expect(result).toMatchObject({ verified: false, key_aggregation_verified: true, final_bip340_valid: false });
    expect(result.aggregate_public_key).not.toBe(publicKey.toLowerCase());
  });

  it('rejects a valid unrelated BIP340 signature whose key is not the participant aggregate', () => {
    const result = multipartyService.verifyPublicSession({ participant_public_keys: participants,
      aggregate_public_key: publicKey, message_hash: message, final_signature: signature });
    expect(result).toMatchObject({ verified: false, stage: 'invalid-input',
      key_aggregation_verified: true, final_bip340_valid: false });
    expect(result.errors).toContain('The supplied aggregate public key does not match the ordered participant aggregation.');
    const wrongMessage = multipartyService.verifyPublicSession({ participant_public_keys: participants,
      aggregate_public_key: publicKey, message_hash: '01'.repeat(32), final_signature: signature });
    expect(wrongMessage.final_bip340_valid).toBe(false);
  });

  it('does not verify a vendor manifest merely because it contains a signature string', () => {
    expect(multipartyService.verifyManifest({ product_id: 'untrusted', signature: 'arbitrary' }))
      .toMatchObject({ verified: false, stage: 'unavailable-vendor-trust' });
  });
});

describe('verification HTTP contracts', () => {
  let server: Server;
  let origin: string;
  beforeAll(/** @asyncUnsafe Jest awaits this hook and reports its rejection. */ async () => {
    const app = express();
    app.use(express.json());
    bootstrapRoutes.initRoutes(app);
    timestampRoutes.initRoutes(app);
    multipartyRoutes.initRoutes(app);
    await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing isolated test listener');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(/** @asyncUnsafe Jest awaits this hook and reports its rejection. */ async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  it.each([
    ['/bootstrap/overview', 'unavailable-node-source'],
    ['/timestamps/overview', 'unavailable-calendar-source'],
    ['/multiparty/overview', 'unavailable-signing-source'],
  ])('keeps %s offered and returns source unavailability rather than invented records', /** @asyncUnsafe Jest awaits this test and reports its rejection. */ async (route, stage) => {
    const response = await fetch(origin + '/api/v1/intelligence' + route);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ stage });
  });

  it.each([
    ['/bootstrap/verifications', { height: 840000, sha256: 'ab'.repeat(32), utxo_hash: 'cd'.repeat(32) }, 503, 'unavailable-manifest'],
    ['/timestamps/proofs/verify', { proof: 'BAAAAAAAb3Rz' }, 400, 'invalid-proof'],
    ['/timestamps/proofs/verify', {}, 400, 'invalid-input'],
    ['/multiparty/public-sessions/verify', { participant_public_keys: participants, message_hash: message }, 200, 'partial-session'],
    ['/multiparty/manifests/verify', { product_id: 'untrusted', signature: 'arbitrary' }, 503, 'unavailable-vendor-trust'],
  ])('classifies the actual %s request', /** @asyncUnsafe Jest awaits this test and reports its rejection. */ async (route, body, status, stage) => {
    const response = await fetch(origin + '/api/v1/intelligence' + route, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ stage });
  });

  it('does not convert an unrelated valid BIP340 signature into successful transcript verification', /** @asyncUnsafe Jest awaits this test and reports its rejection. */ async () => {
    const response = await fetch(origin + '/api/v1/intelligence/multiparty/public-sessions/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        participant_public_keys: participants, aggregate_public_key: publicKey, message_hash: message, final_signature: signature,
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ verified: false, final_bip340_valid: false,
      key_aggregation_verified: true, stage: 'invalid-input' });
  });

  it('verifies an official complete BIP327 public transcript over HTTP and rejects a corrupted contribution', /** @asyncUnsafe Jest awaits this test and reports its rejection. */ async () => {
    const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'multiparty/vectors/sig_agg_vectors.json'), 'utf8'));
    const test = vectors.valid_test_cases[0];
    const session = {
      participant_public_keys: test.key_indices.map(index => vectors.pubkeys[index]),
      public_nonces: test.nonce_indices.map(index => vectors.pnonces[index]),
      partial_signatures: test.psig_indices.map(index => vectors.psigs[index]),
      message_hash: vectors.msg, aggregate_nonce: test.aggnonce, final_signature: test.expected,
    };
    const response = await fetch(origin + '/api/v1/intelligence/multiparty/public-sessions/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(session),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verified: true, stage: 'verified-session',
      key_aggregation_verified: true, nonce_aggregation_verified: true,
      partial_signature_validity: [true, true], final_bip340_valid: true,
      final_signature: test.expected.toLowerCase() });
    session.partial_signatures.reverse();
    const invalid = await fetch(origin + '/api/v1/intelligence/multiparty/public-sessions/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(session),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ verified: false, stage: 'invalid-input',
      partial_signature_validity: [false, false] });
  });
});
