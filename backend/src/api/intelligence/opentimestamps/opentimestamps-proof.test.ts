import { readFileSync } from 'fs';
import { join } from 'path';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import openTimestampsService, { OpenTimestampsService } from './opentimestamps.service';
import { parseDetachedProof, PROOF_LIMITS } from './opentimestamps-proof';

jest.mock('../../bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: { $getBlockHash: jest.fn(), $getBlockHeader: jest.fn() },
}));

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '__fixtures__', name));
const proof = (name = 'hello-world.txt.ots'): string => fixture(name).toString('base64');
const GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const DIGEST = '03ba204e50d126e4674c005e04d82e84c21366780af1f43bd54a37816b6ab340';
const HEADER: { height: number; hash: string; header: string } = JSON.parse(fixture('bitcoin-358391-header.json').toString());
const getHash = jest.mocked(bitcoinApi.$getBlockHash);
const getHeader = jest.mocked(bitcoinApi.$getBlockHeader);

describe('official OpenTimestamps detached proof vectors', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getHash.mockImplementation(async height => {
      if (height === 0) {
        return GENESIS;
      }
      if (height === HEADER.height) {
        return HEADER.hash;
      }
      throw new Error('unknown fixture height');
    });
    getHeader.mockResolvedValue(HEADER.header);
  });

  it('verifies the official hello-world proof against the captured owned Bitcoin header', async () => {
    await expect(Promise.resolve().then(() => openTimestampsService.verifyProof({ proof: proof(), digest: DIGEST })))
      .resolves.toMatchObject({
        status: 'bitcoin_attestation_verified', verified: true, digest_matches: true,
        file_digest: DIGEST, file_hash_algorithm: 'sha256', network: 'mainnet',
        earliest_proven_block_height: 358391, earliest_proven_time_utc: '2015-05-28T15:41:18.000Z',
        bitcoin_block_hash: HEADER.hash, attestation_type: 'bitcoin',
      });
    expect(getHash).toHaveBeenCalledWith(0);
    expect(getHash).toHaveBeenCalledWith(358391);
    expect(getHeader).toHaveBeenCalledWith(HEADER.hash);
  });

  it('rejects the official bad-stamp Bitcoin commitment even though its embedded digest matches the document', async () => {
    await expect(Promise.resolve().then(() => openTimestampsService.verifyProof({
      proof: proof('bad-stamp.txt.ots'), digest: '7e3717bbe020f53cdc6c40154a1a8e55bddc13a28c8bb3c82e9ee64b81b44872',
    }))).resolves.toMatchObject({ status: 'bitcoin_attestation_invalid', verified: false, digest_matches: true });
    expect(getHeader).toHaveBeenCalledWith(HEADER.hash);
  });

  it('does not confuse a supplied document digest mismatch with a bad Bitcoin commitment', async () => {
    await expect(openTimestampsService.verifyProof({ proof: proof(), digest: 'ff'.repeat(32) }))
      .resolves.toMatchObject({ status: 'file_mismatch', verified: false, digest_matches: false });
    expect(getHash).not.toHaveBeenCalled();
  });

  it('reports the official incomplete proof as pending without fetching its calendar URL', async () => {
    await expect(Promise.resolve().then(() => openTimestampsService.verifyProof({ proof: proof('incomplete.txt.ots') })))
      .resolves.toMatchObject({ status: 'pending_calendar_attestation', verified: false, digest_matches: null,
        calendar_attestations: [expect.objectContaining({ status: 'pending' })] });
    expect(getHash).not.toHaveBeenCalled();
    expect(getHeader).not.toHaveBeenCalled();
  });

  it('reports the official unknown-notary proof as unsupported', async () => {
    await expect(Promise.resolve().then(() => openTimestampsService.verifyProof({ proof: proof('unknown-notary.txt.ots') })))
      .resolves.toMatchObject({ status: 'unsupported_attestation', verified: false, digest_matches: null });
    expect(getHash).not.toHaveBeenCalled();
  });

  it('verifies embedded-digest anchoring without claiming a separate file was checked', async () => {
    await expect(openTimestampsService.verifyProof({ proof: proof() }))
      .resolves.toMatchObject({ status: 'bitcoin_attestation_verified', verified: true, digest_matches: null });
  });

  it('binds the requested network to the configured reader before reading any headers', async () => {
    await expect(openTimestampsService.verifyProof({ proof: proof(), network: 'signet' }))
      .resolves.toMatchObject({ status: 'network_mismatch', verified: false, network: 'mainnet' });
    expect(getHash).not.toHaveBeenCalled();
  });

  it('checks the owned reader genesis rather than trusting its configured network name', async () => {
    const signet = new OpenTimestampsService({ reader: bitcoinApi, network: 'signet' });
    await expect(signet.verifyProof({ proof: proof(), network: 'signet' }))
      .resolves.toMatchObject({ status: 'network_mismatch', verified: false });
    expect(getHeader).not.toHaveBeenCalled();
  });

  it('reports a reader failure as unavailable and does not reuse an earlier verified anchor', async () => {
    expect((await openTimestampsService.verifyProof({ proof: proof() })).verified).toBe(true);
    getHeader.mockRejectedValue(new Error('offline'));
    await expect(openTimestampsService.verifyProof({ proof: proof() }))
      .rejects.toMatchObject({ code: 'unavailable-bitcoin-header', status: 503 });
  });

  it.each(['00', 'zz'.repeat(80), HEADER.header.slice(0, -2) + '00'])(
    'rejects malformed or mismatched owned headers rather than marking the proof invalid', async header => {
      getHeader.mockResolvedValue(header);
      await expect(openTimestampsService.verifyProof({ proof: proof() }))
        .rejects.toMatchObject({ code: 'unavailable-bitcoin-header', status: 503 });
    });

  it('reports an active-chain change between the header reads as a reorg', async () => {
    getHash.mockResolvedValueOnce(GENESIS).mockResolvedValueOnce(HEADER.hash).mockResolvedValueOnce('f'.repeat(64));
    await expect(openTimestampsService.verifyProof({ proof: proof() }))
      .resolves.toMatchObject({ status: 'bitcoin_attestation_reorg', verified: false });
  });

  it('rechecks an earlier anchor after reading the other branches', async () => {
    // Controlled reader race: both attestations use the same commitment. Once
    // the later branch is read, the first height no longer names its old hash.
    const commitment = Buffer.from(HEADER.header, 'hex').subarray(36, 68);
    const attestation = (height: number): Buffer => {
      const encoded = uint(height);
      return Buffer.concat([Buffer.from([0]), Buffer.from('0588960d73d71901', 'hex'), uint(encoded.length), encoded]);
    };
    const bytes = Buffer.concat([PREFIX.subarray(0, -32), commitment, Buffer.from([0xff]),
      attestation(HEADER.height), attestation(HEADER.height + 1)]);
    let laterBranchRead = false;
    getHash.mockImplementation(async height => {
      if (height === 0) {
        return GENESIS;
      }
      if (height === HEADER.height + 1) {
        laterBranchRead = true;
        return HEADER.hash;
      }
      return laterBranchRead ? 'f'.repeat(64) : HEADER.hash;
    });
    await expect(openTimestampsService.verifyProof({ proof: bytes.toString('base64') }))
      .resolves.toMatchObject({ status: 'bitcoin_attestation_reorg', verified: false });
  });

  it('rejects malformed block-hash responses with a typed unavailable state', async () => {
    getHash.mockResolvedValueOnce(GENESIS).mockResolvedValueOnce('not-a-hash');
    await expect(openTimestampsService.verifyProof({ proof: proof() }))
      .rejects.toMatchObject({ code: 'unavailable-bitcoin-header', status: 503 });
    expect(getHeader).not.toHaveBeenCalled();
  });
});

const PREFIX = Buffer.concat([
  Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex'),
  Buffer.from([1, 8]), Buffer.from(DIGEST, 'hex'),
]);
const UNKNOWN = Buffer.concat([Buffer.from([0]), Buffer.alloc(8, 0xaa), Buffer.from([0])]);
const uint = (value: number): Buffer => {
  const bytes: number[] = [];
  do { bytes.push(value % 128 | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
};
const detached = (tree: Buffer): string => Buffer.concat([PREFIX, tree]).toString('base64');

describe('bounded .ots parsing', () => {
  it.each(['', 'not base64!', 'AAAA=', 'A==='])('rejects invalid base64 %j', value => {
    expect(() => parseDetachedProof(value)).toThrow(expect.objectContaining({ code: 'invalid-proof', status: 400 }));
  });

  it('rejects trailing bytes after an otherwise valid official proof', () => {
    expect(() => parseDetachedProof(Buffer.concat([fixture('hello-world.txt.ots'), Buffer.from([0])]).toString('base64')))
      .toThrow('trailing data');
  });

  it('rejects truncated official proof bytes at every offset', () => {
    const bytes = fixture('hello-world.txt.ots');
    for (let length = 0; length < bytes.length; length++) {
      expect(() => parseDetachedProof(bytes.subarray(0, length).toString('base64'))).toThrow();
    }
  });

  it('rejects oversized files before traversing their operations', () => {
    expect(() => parseDetachedProof(Buffer.alloc(PROOF_LIMITS.bytes + 1).toString('base64'))).toThrow('oversized');
  });

  it('rejects excessive operation depth', () => {
    expect(() => parseDetachedProof(detached(Buffer.concat([Buffer.alloc(PROOF_LIMITS.depth, 8), UNKNOWN]))))
      .toThrow('depth limit');
  });

  it('rejects a shallow tree that exceeds the total operation budget', () => {
    const branch = Buffer.concat([Buffer.alloc(101, 8), UNKNOWN]);
    const branches = Array.from({ length: 100 }, (_unused, index) => Buffer.concat([index < 99 ? Buffer.from([0xff]) : Buffer.alloc(0), branch]));
    expect(() => parseDetachedProof(detached(Buffer.concat(branches)))).toThrow('too many operations');
  });

  it('rejects too many attestations even when no operations are required', () => {
    const branches = Array.from({ length: PROOF_LIMITS.attestations + 1 }, (_unused, index) => Buffer.concat([index < PROOF_LIMITS.attestations ? Buffer.from([0xff]) : Buffer.alloc(0), UNKNOWN]));
    expect(() => parseDetachedProof(detached(Buffer.concat(branches)))).toThrow('too many attestations');
  });

  it('rejects append or hexlify results larger than the protocol message bound', () => {
    const append = Buffer.concat([Buffer.from([0xf0]), uint(4096), Buffer.alloc(4096, 1), UNKNOWN]);
    expect(() => parseDetachedProof(detached(append))).toThrow('exceeds 4096');
    const hexlify = Buffer.concat([Buffer.alloc(8, 0xf3), UNKNOWN]);
    expect(() => parseDetachedProof(detached(hexlify))).toThrow('exceeds 4096');
  });

  it('rejects empty binary operation arguments and nonminimal integers', () => {
    expect(() => parseDetachedProof(detached(Buffer.concat([Buffer.from([0xf0, 0]), UNKNOWN])))).toThrow('argument is empty');
    expect(() => parseDetachedProof(detached(Buffer.concat([Buffer.from([0xf0, 0x81, 0]), Buffer.from([1]), UNKNOWN])))).toThrow('not minimally encoded');
  });

  it('reports an unknown operation explicitly instead of treating its bytes as a known proof', () => {
    expect(() => parseDetachedProof(detached(Buffer.from([0x99])))).toThrow(expect.objectContaining({ code: 'unsupported-operation' }));
  });

  it('consumes the complete known attestation payload', () => {
    const malformed = Buffer.concat([Buffer.from([0]), Buffer.from('0588960d73d71901', 'hex'), Buffer.from([2, 1, 0])]);
    expect(() => parseDetachedProof(detached(malformed))).toThrow('trailing data');
  });

  it('preserves independent messages when parsing branched operations', () => {
    const tree = Buffer.concat([Buffer.from([0xff, 0xf2]), UNKNOWN, Buffer.from([8]), UNKNOWN]);
    expect(parseDetachedProof(detached(tree))).toMatchObject({ operationCount: 2, attestations: [{ kind: 'unknown' }, { kind: 'unknown' }] });
  });
});
