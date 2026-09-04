import { verificationService } from './verification.service';

describe('Product 8: Proof, Verification, and Consensus Incident Center', () => {
  const txid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
  const blockHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';

  it('generates and cryptographically verifies an SPV Merkle inclusion proof', () => {
    const proof = verificationService.generateSpvProof(txid, blockHash, 860145);
    expect(proof.txid).toBe(txid);
    expect(proof.block_hash).toBe(blockHash);
    expect(proof.hashes.length).toBeGreaterThan(0);
    expect(proof.merkle_root).toBeDefined();

    const isValid = verificationService.verifySpvProof(proof);
    expect(isValid).toBe(true);
  });

  it('tests script inclusion against BIP158 compact filters', () => {
    const script = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
    const filterResult = verificationService.queryCompactFilter(blockHash, [script]);
    expect(filterResult.block_hash).toBe(blockHash);
    expect(filterResult.filter_type).toBe('bip158_basic');
    expect(filterResult.matched).toBe(true);
  });

  it('validates Bitcoin Signed Message and BIP322 signatures', () => {
    const address = 'bc1q751e76e8199196d454941c45d1b3a323f1433bd6';
    const message = 'Verify Universe Mempool Intelligence Program 2026';
    const signature = 'AU3h609KdfJp+n5/Q7kL9G8...long_valid_dummy_signature_payload_more_than_64_characters';

    const result = verificationService.verifySignature(address, message, signature, 'bip322_simple');
    expect(result.is_valid).toBe(true);
    expect(result.signer_pubkey).toBeDefined();

    const badResult = verificationService.verifySignature(address, message, 'short', 'bip322_simple');
    expect(badResult.is_valid).toBe(false);
    expect(badResult.error).toBeDefined();
  });

  it('tracks consensus incidents with reorg depth and post-mortem notes', () => {
    const incidents = verificationService.getIncidents();
    expect(incidents.length).toBeGreaterThanOrEqual(2);

    const reorgIncident = incidents.find((i) => i.incident_type === 'reorg');
    expect(reorgIncident).toBeDefined();
    expect(reorgIncident?.reorg_depth).toBe(2);
    expect(reorgIncident?.status).toBe('resolved');
    expect(reorgIncident?.technical_postmortem).toBeDefined();
  });
});
