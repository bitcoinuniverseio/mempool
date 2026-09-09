import { createHash } from 'crypto';
import { Block } from 'bitcoinjs-lib';
import { OpenTimestampsService, TimestampEvidenceError } from './opentimestamps.service';
import { CalendarClient, CalendarHttp, DEFAULT_CALENDARS, calendarDirectoryFromEnvironment } from './ots-calendar-client';
import { MemoryTimestampRecordStore } from './opentimestamps-store';
import { ATTESTATION_BITCOIN, ATTESTATION_PENDING, applyOperation } from './ots-timestamp';
import { parseDetachedProof } from './opentimestamps-proof';

const GENESIS_MAINNET = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const sha256 = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

function varint(value: number): Buffer {
  const out: number[] = [];
  let rest = value;
  do { const byte = rest & 0x7f; rest = Math.floor(rest / 128); out.push(rest > 0 ? byte | 0x80 : byte); } while (rest > 0);
  return Buffer.from(out);
}

/**
 * A fake calendar that behaves like the real ones: it appends its own nonce,
 * hashes, and first promises, then later attests to a Bitcoin block whose
 * Merkle root it "committed" to. The header the fake reader serves carries
 * exactly that root, so the existing verifier accepts the upgraded proof.
 */
class FakeCalendar {
  public readonly nonce = Buffer.alloc(16, 0x42);
  public readonly submissions: Buffer[] = [];
  public readonly upgrades: Buffer[] = [];
  public anchoredHeight: number | null = null;
  public offline = false;
  constructor(public readonly url: string) {}

  answer(commitment: Buffer): Buffer {
    const uri = Buffer.from(this.url, 'ascii');
    return Buffer.concat([
      Buffer.from([0xf0, this.nonce.length]), this.nonce, Buffer.from([0x08]),
      Buffer.from([0x00]), Buffer.from(ATTESTATION_PENDING, 'hex'), Buffer.from([uri.length + 1, uri.length]), uri,
    ]);
  }

  /**
   * The calendar keys its promise by its own commitment, the message after
   * its append and hash, and answers an upgrade for that message with the
   * Bitcoin attestation alone.
   */
  upgraded(): Buffer {
    const height = varint(this.anchoredHeight as number);
    return Buffer.concat([Buffer.from([0x00]), Buffer.from(ATTESTATION_BITCOIN, 'hex'), Buffer.from([height.length]), height]);
  }

  /** The message the Bitcoin attestation covers: sha256(commitment || nonce). */
  merkleRootFor(commitment: Buffer): Buffer {
    return applyOperation(0x08, applyOperation(0xf0, commitment, this.nonce));
  }
}

function fakeHttp(calendars: FakeCalendar[]): CalendarHttp {
  const find = (url: string): FakeCalendar => {
    const calendar = calendars.find(candidate => url.startsWith(candidate.url + '/'));
    if (!calendar) {throw new Error(`unexpected host ${url}`);}
    if (calendar.offline) {throw new Error('connect ECONNREFUSED');}
    return calendar;
  };
  return {
    async post(url, body) {
      const calendar = find(url);
      expect(url).toBe(`${calendar.url}/digest`);
      calendar.submissions.push(Buffer.from(body));
      return { status: 200, body: calendar.answer(body) };
    },
    async get(url) {
      const calendar = find(url);
      const commitment = Buffer.from(url.slice(`${calendar.url}/timestamp/`.length), 'hex');
      calendar.upgrades.push(commitment);
      if (calendar.anchoredHeight === null || !calendar.submissions.some(submitted => calendar.merkleRootFor(submitted).equals(commitment))) {
        return { status: 404, body: Buffer.from('Pending confirmation in Bitcoin blockchain') };
      }
      return { status: 200, body: calendar.upgraded() };
    },
  };
}

/** A reader whose block at `height` carries `merkleRoot`. */
function fakeReader(height: number, merkleRoot: Buffer): { reader: { $getBlockHash: (h: number) => Promise<string>; $getBlockHeader: (hash: string) => Promise<string> }; hash: string; timestamp: number } {
  const block = new Block();
  block.version = 0x20000000;
  block.prevHash = Buffer.alloc(32, 3);
  block.merkleRoot = Buffer.from(merkleRoot);
  block.timestamp = 1757400000;
  block.bits = 0x17030000;
  block.nonce = 1;
  const hash = block.getId();
  return {
    hash, timestamp: block.timestamp,
    reader: {
      $getBlockHash: async (requested: number) => requested === 0 ? GENESIS_MAINNET : requested === height ? hash : 'ff'.repeat(32),
      $getBlockHeader: async (requested: string) => requested === hash ? block.toBuffer(true).toString('hex') : '00'.repeat(80),
    },
  };
}

function service(calendars: FakeCalendar[], reader?: ReturnType<typeof fakeReader>['reader'], now = () => new Date('2026-09-09T12:00:00.000Z')) {
  const directory = calendars.map(calendar => ({ calendar_id: new URL(calendar.url).hostname.split('.')[0], name: calendar.url, url: calendar.url }));
  const store = new MemoryTimestampRecordStore();
  const client = new CalendarClient(directory, fakeHttp(calendars), 1000);
  return { store, client, service: new OpenTimestampsService({ calendars: client, store, reader, network: 'mainnet', now, upgradeAfterMs: 0, healthProbeTtlMs: 0 }) };
}

describe('OpenTimestampsService', () => {
  it('stamps a digest through every allowlisted calendar and keeps the proof', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const bob = new FakeCalendar('https://bob.example');
    const { service: ots, store } = service([alice, bob]);
    const digest = sha256(Buffer.from('a document')).toString('hex');
    const result = await ots.stampDigest(digest);
    expect(result.status).toBe('pending');
    expect(result.calendars_contacted.map(contact => contact.status)).toEqual(['pending', 'pending']);
    expect(alice.submissions).toHaveLength(1);
    expect(bob.submissions[0].equals(alice.submissions[0])).toBe(true);
    // The calendar saw the nonced commitment, never the digest itself.
    expect(alice.submissions[0].toString('hex')).not.toBe(digest);
    const parsed = parseDetachedProof(result.ots_proof_base64);
    expect(parsed.digest.toString('hex')).toBe(digest);
    expect(parsed.attestations.map(attestation => attestation.kind === 'pending' ? attestation.uri : attestation.kind).sort()).toEqual(['https://alice.example', 'https://bob.example']);
    expect((await store.stats()).pending).toBe(1);
    const batch = await ots.getBatch(result.record_id);
    expect(batch).toMatchObject({ batch_id: result.record_id, status: 'pending', digest, calendar_id: 'alice,bob' });
  });

  it('records an unreachable calendar truthfully and still stamps through the others', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const bob = new FakeCalendar('https://bob.example');
    bob.offline = true;
    const { service: ots } = service([alice, bob]);
    const result = await ots.stampDigest('ab'.repeat(32));
    expect(result.calendars_contacted.find(contact => contact.calendar_id === 'bob')).toMatchObject({ status: 'unreachable', error: expect.stringContaining('did not answer') });
    expect(parseDetachedProof(result.ots_proof_base64).attestations).toHaveLength(1);
    const calendars = await ots.listCalendars();
    expect(calendars.calendars.map(calendar => [calendar.calendar_id, calendar.health_status])).toEqual([['alice', 'online'], ['bob', 'offline']]);
  });

  it('creates no proof when no calendar accepts the digest', async () => {
    const alice = new FakeCalendar('https://alice.example');
    alice.offline = true;
    const { service: ots, store } = service([alice]);
    await expect(ots.stampDigest('cd'.repeat(32))).rejects.toMatchObject({ code: 'calendar-unreachable', status: 503 });
    expect((await store.stats()).total).toBe(0);
  });

  it('validates digest syntax before contacting anything', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const { service: ots } = service([alice]);
    await expect(ots.stampDigest('z'.repeat(64))).rejects.toMatchObject({ status: 400 });
    await expect(ots.stampDigest('ab')).rejects.toMatchObject({ status: 400 });
    expect(alice.submissions).toHaveLength(0);
  });

  it('upgrades a pending proof from the allowlisted calendar and verifies it against the owned reader', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const { service: initial } = service([alice]);
    const digest = sha256(Buffer.from('anchored later')).toString('hex');
    const stamped = await initial.stampDigest(digest);
    const commitment = alice.submissions[0];
    alice.anchoredHeight = 864205;
    const chain = fakeReader(864205, alice.merkleRootFor(commitment));
    const { service: ots, store } = service([alice], chain.reader);
    await store.insert({
      record_id: stamped.record_id, digest_hex: digest, algorithm: 'sha256', network: 'mainnet', commitment_hex: commitment.toString('hex'),
      proof_base64: stamped.ots_proof_base64, status: 'pending', calendars: stamped.calendars_contacted.map(contact => ({ ...contact, contacted_at: stamped.timestamp })),
      submitted_at: stamped.timestamp, updated_at: stamped.timestamp,
    });
    const upgraded = await ots.upgradeProof({ ots_proof: stamped.ots_proof_base64, digest });
    expect(upgraded.upgraded).toBe(true);
    expect(upgraded.calendars).toEqual([{ calendar_id: 'alice', calendar_url: 'https://alice.example', status: 'verified', detail: expect.any(String) }]);
    expect(upgraded.verification).toMatchObject({ status: 'bitcoin_attestation_verified', verified: true, earliest_proven_block_height: 864205, bitcoin_block_hash: chain.hash, digest_matches: true });
    const parsed = parseDetachedProof(upgraded.ots_proof_base64);
    expect(parsed.attestations).toEqual([{ kind: 'bitcoin', height: 864205, message: expect.any(Buffer) }]);
    const record = await store.get(stamped.record_id);
    expect(record).toMatchObject({ status: 'anchored', anchor_block_height: 864205, anchor_block_hash: chain.hash });
    const anchors = await ots.listAnchors();
    expect(anchors.anchors).toEqual([expect.objectContaining({ calendar_id: 'alice', block_height: 864205, block_hash: chain.hash, batch_count: 1 })]);
    const overview = await ots.getOverview();
    expect(overview).toMatchObject({ total_proofs_tracked: 1, bitcoin_confirmed_proofs: 1, pending_calendar_attestations: 0, latest_anchored_block_height: 864205, storage: 'memory' });
  });

  it('leaves a proof unchanged while the calendar is still pending', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const { service: ots } = service([alice]);
    const stamped = await ots.stampDigest('ef'.repeat(32));
    const result = await ots.upgradeProof({ ots_proof: stamped.ots_proof_base64 });
    expect(result).toMatchObject({ upgraded: false, changed: false, status: 'pending_calendar_attestation', verified: false });
    expect(result.calendars[0]).toMatchObject({ status: 'pending' });
    expect(alice.upgrades).toHaveLength(1);
  });

  it('never contacts a calendar that a proof names but the allowlist does not', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const stranger = new FakeCalendar('https://stranger.example');
    const { service: initial } = service([alice, stranger]);
    const stamped = await initial.stampDigest('12'.repeat(32));
    const { service: ots } = service([alice]);
    const result = await ots.upgradeProof({ ots_proof: stamped.ots_proof_base64 });
    expect(stranger.upgrades).toHaveLength(0);
    expect(result.calendars.find(calendar => calendar.calendar_url === 'https://stranger.example')).toMatchObject({ status: 'unreachable', detail: expect.stringContaining('allowlist') });
  });

  it('reconciles pending records on read and anchors what the calendars now attest', async () => {
    const alice = new FakeCalendar('https://alice.example');
    const { service: initial } = service([alice]);
    const stamped = await initial.stampDigest(sha256(Buffer.from('reconciled')).toString('hex'));
    alice.anchoredHeight = 864300;
    const chain = fakeReader(864300, alice.merkleRootFor(alice.submissions[0]));
    let clock = Date.parse('2026-09-09T13:00:00.000Z');
    const { service: ots, store } = service([alice], chain.reader, () => new Date(clock));
    await store.insert({
      record_id: stamped.record_id, digest_hex: parseDetachedProof(stamped.ots_proof_base64).digest.toString('hex'), algorithm: 'sha256', network: 'mainnet',
      commitment_hex: alice.submissions[0].toString('hex'), proof_base64: stamped.ots_proof_base64, status: 'pending',
      calendars: stamped.calendars_contacted.map(contact => ({ ...contact, contacted_at: stamped.timestamp })), submitted_at: stamped.timestamp, updated_at: stamped.timestamp,
    });
    expect(await ots.reconcilePending()).toEqual({ examined: 1, anchored: 1 });
    expect((await store.get(stamped.record_id))?.status).toBe('anchored');
    clock += 1000;
    expect(await ots.reconcilePending()).toEqual({ examined: 0, anchored: 0 });
  });

  it.each(['verified-proof-data', 'pending-proof-data'])('does not classify a proof from the text %s', async ots_proof => {
    const { service: ots } = service([new FakeCalendar('https://alice.example')]);
    await expect(ots.verifyProof({ digest: 'ab'.repeat(32), ots_proof })).rejects.toMatchObject({ code: 'invalid-proof', status: 400 });
    await expect(ots.upgradeProof({ ots_proof })).rejects.toMatchObject({ code: 'invalid-proof', status: 400 });
  });

  it('validates the actual browser proof field without inventing a verdict', async () => {
    const { service: ots } = service([new FakeCalendar('https://alice.example')]);
    await expect(ots.verifyProof({ proof: 'BAAAAAAAb3Rz' })).rejects.toMatchObject({ code: 'invalid-proof', status: 400 });
    await expect(ots.verifyProof({})).rejects.toMatchObject({ status: 400 });
    await expect(ots.upgradeProof({})).rejects.toBeInstanceOf(TimestampEvidenceError);
  });

  it('answers unknown calendars and batches with nothing rather than an invented entry', async () => {
    const { service: ots } = service([new FakeCalendar('https://alice.example')]);
    expect(await ots.getCalendar('nobody')).toBeUndefined();
    expect(await ots.getBatch('batch-864205-01')).toBeUndefined();
  });
});

describe('calendar directory', () => {
  it('defaults to the public OpenTimestamps calendars', () => {
    expect(calendarDirectoryFromEnvironment(undefined)).toEqual(DEFAULT_CALENDARS);
  });

  it('reads an allowlist from the environment and rejects anything that is not http(s)', () => {
    expect(calendarDirectoryFromEnvironment('mine=https://calendar.example.org/ots/, https://other.example')).toEqual([
      { calendar_id: 'mine', name: 'mine', url: 'https://calendar.example.org/ots' },
      { calendar_id: 'other-example', name: 'other.example', url: 'https://other.example' },
    ]);
    expect(() => calendarDirectoryFromEnvironment('ftp://calendar.example.org')).toThrow(/http\(s\)/);
    expect(() => calendarDirectoryFromEnvironment('not a url')).toThrow(/malformed/);
  });

  it('matches pending attestation URIs only against the allowlist', () => {
    const client = new CalendarClient(DEFAULT_CALENDARS, fakeHttp([]), 10);
    expect(client.match('https://alice.btc.calendar.opentimestamps.org')?.calendar_id).toBe('alice-btc');
    expect(client.match('https://alice.btc.calendar.opentimestamps.org.evil.example')).toBeUndefined();
    expect(client.match('not a uri')).toBeUndefined();
  });

  it('rejects a calendar answer that does not parse as a timestamp', async () => {
    const http: CalendarHttp = { async post() { return { status: 200, body: Buffer.from('<html>not a timestamp</html>') }; }, async get() { return { status: 500, body: Buffer.alloc(0) }; } };
    const client = new CalendarClient(DEFAULT_CALENDARS, http, 10);
    await expect(client.submit(DEFAULT_CALENDARS[0], Buffer.alloc(32, 1))).rejects.toMatchObject({ code: 'calendar-invalid-answer' });
    await expect(client.upgrade(DEFAULT_CALENDARS[0], Buffer.alloc(32, 1))).rejects.toMatchObject({ code: 'calendar-unreachable' });
    await expect(client.submit({ calendar_id: 'x', name: 'x', url: 'https://x.example' }, Buffer.alloc(32))).rejects.toMatchObject({ code: 'calendar-not-allowlisted', status: 400 });
  });
});
