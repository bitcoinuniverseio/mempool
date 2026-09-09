import { createHash } from 'crypto';
import {
  ATTESTATION_BITCOIN, ATTESTATION_PENDING, mergeTimestamps, nonceCommitment, parseDetachedProofTree, parseTimestamp,
  serializeDetachedProof, serializeTimestamp, walkTimestamp,
} from './ots-timestamp';
import { parseDetachedProof } from './opentimestamps-proof';

const sha256 = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

/** A calendar's usual answer: append its own nonce, hash, promise. */
function calendarAnswer(commitment: Buffer, uri: string, calendarNonce = Buffer.alloc(16, 7)): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0xf0, calendarNonce.length]), calendarNonce);
  parts.push(Buffer.from([0x08]));
  const uriBytes = Buffer.from(uri, 'ascii');
  parts.push(Buffer.from([0x00]), Buffer.from(ATTESTATION_PENDING, 'hex'), Buffer.from([uriBytes.length + 1, uriBytes.length]), uriBytes);
  void commitment;
  return Buffer.concat(parts);
}

/** A calendar's upgraded answer for the same commitment: the promise became a Bitcoin attestation. */
function bitcoinAnswer(height: number, calendarNonce = Buffer.alloc(16, 7)): Buffer {
  const heightBytes = varint(height);
  return Buffer.concat([
    Buffer.from([0xf0, calendarNonce.length]), calendarNonce,
    Buffer.from([0x08]),
    Buffer.from([0x00]), Buffer.from(ATTESTATION_BITCOIN, 'hex'), Buffer.from([heightBytes.length]), heightBytes,
  ]);
}

function varint(value: number): Buffer {
  const out: number[] = [];
  let rest = value;
  do { const byte = rest & 0x7f; rest = Math.floor(rest / 128); out.push(rest > 0 ? byte | 0x80 : byte); } while (rest > 0);
  return Buffer.from(out);
}

describe('ots-timestamp', () => {
  it('round-trips a calendar answer through parse and serialize', () => {
    const commitment = sha256(Buffer.from('commitment'));
    const bytes = calendarAnswer(commitment, 'https://alice.btc.calendar.opentimestamps.org');
    const tree = parseTimestamp(bytes, commitment);
    expect(tree.operations).toHaveLength(1);
    expect(tree.operations[0].tag).toBe(0xf0);
    const leaf = tree.operations[0].result.operations[0].result;
    expect(leaf.attestations).toEqual([{ kind: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' }]);
    expect(serializeTimestamp(tree).equals(bytes)).toBe(true);
  });

  it('rejects trailing bytes and unsupported operations', () => {
    const commitment = sha256(Buffer.from('x'));
    expect(() => parseTimestamp(Buffer.concat([calendarAnswer(commitment, 'https://a.example'), Buffer.from([0x00])]), commitment)).toThrow(/trailing|truncated/);
    expect(() => parseTimestamp(Buffer.from([0x99]), commitment)).toThrow(/unsupported/);
  });

  it('builds a detached proof that the existing verifier parses and evaluates', () => {
    const digest = sha256(Buffer.from('a file'));
    const { commitment, timestamp } = nonceCommitment(digest, Buffer.alloc(16, 1));
    const leaf = timestamp.operations[0].result.operations[0].result;
    mergeTimestamps(leaf, parseTimestamp(calendarAnswer(commitment, 'https://alice.btc.calendar.opentimestamps.org'), commitment));
    mergeTimestamps(leaf, parseTimestamp(calendarAnswer(commitment, 'https://bob.btc.calendar.opentimestamps.org', Buffer.alloc(16, 9)), commitment));
    const proof = serializeDetachedProof(digest, timestamp);
    const parsed = parseDetachedProof(proof.toString('base64'));
    expect(parsed.digest.equals(digest)).toBe(true);
    expect(parsed.attestations.map(attestation => attestation.kind === 'pending' ? attestation.uri : attestation.kind).sort()).toEqual([
      'https://alice.btc.calendar.opentimestamps.org', 'https://bob.btc.calendar.opentimestamps.org',
    ]);
    const tree = parseDetachedProofTree(proof);
    expect(tree.algorithm).toBe('sha256');
    expect(serializeDetachedProof(tree.digest, tree.timestamp).equals(proof)).toBe(true);
  });

  it('merges an upgraded calendar answer over the pending promise it replaces', () => {
    const digest = sha256(Buffer.from('another file'));
    const { commitment, timestamp } = nonceCommitment(digest, Buffer.alloc(16, 2));
    const leaf = timestamp.operations[0].result.operations[0].result;
    mergeTimestamps(leaf, parseTimestamp(calendarAnswer(commitment, 'https://alice.btc.calendar.opentimestamps.org'), commitment));
    const pendingNodes: string[] = [];
    walkTimestamp(timestamp, node => { for (const attestation of node.attestations) { if (attestation.kind === 'pending') {pendingNodes.push(node.message.toString('hex'));} } });
    expect(pendingNodes).toHaveLength(1);
    // The calendar answers for the same commitment with the same first ops, so
    // the merge lands the Bitcoin attestation on the same node as the promise.
    mergeTimestamps(leaf, parseTimestamp(bitcoinAnswer(864205), commitment));
    const kinds: string[] = [];
    walkTimestamp(timestamp, node => { for (const attestation of node.attestations) {kinds.push(attestation.kind);} });
    expect(kinds.sort()).toEqual(['bitcoin', 'pending']);
    const parsed = parseDetachedProof(serializeDetachedProof(digest, timestamp).toString('base64'));
    expect(parsed.attestations.some(attestation => attestation.kind === 'bitcoin' && attestation.height === 864205)).toBe(true);
  });

  it('refuses to merge timestamps that commit to different messages', () => {
    const a = nonceCommitment(sha256(Buffer.from('a'))).timestamp;
    const b = nonceCommitment(sha256(Buffer.from('b'))).timestamp;
    expect(() => mergeTimestamps(a, b)).toThrow(/different messages/);
  });
});
