import openTimestampsService from './opentimestamps.service';

describe('OpenTimestampsService', () => {
  it('should return overview with active calendars and anchors', () => {
    const overview = openTimestampsService.getOverview();
    expect(overview.total_active_calendars).toBeGreaterThanOrEqual(3);
    expect(overview.active_calendars.length).toBeGreaterThanOrEqual(3);
    expect(overview.recent_anchors.length).toBeGreaterThanOrEqual(1);
    expect(overview.recent_batches.length).toBeGreaterThanOrEqual(1);
  });

  it('should list calendars and retrieve details by id', () => {
    const res = openTimestampsService.listCalendars();
    expect(res.calendars.length).toBeGreaterThanOrEqual(3);
    const alice = openTimestampsService.getCalendar('alice-universe');
    expect(alice).toBeDefined();
    expect(alice?.health_status).toBe('online');
  });

  it('should stamp local file digest and return pending commitment', () => {
    const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const stampRes = openTimestampsService.stampDigest(digest);
    expect(stampRes.digest).toBe(digest);
    expect(stampRes.pending_attestation).toBeDefined();
    expect(stampRes.notices).toContain('The file itself was not uploaded.');
  });

  it('should verify completed Bitcoin block attestation and pending calendar attestation', () => {
    const completed = openTimestampsService.verifyProof({
      digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ots_proof: 'verified-proof-data',
    });
    expect(completed.verified).toBe(true);
    expect(completed.status).toBe('bitcoin_attestation_verified');
    expect(completed.earliest_proven_block_height).toBe(864205);
    expect(completed.notices[0]).toContain('This proves the committed data existed no later than');

    const pending = openTimestampsService.verifyProof({
      digest: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
      ots_proof: 'pending-proof-data',
    });
    expect(pending.verified).toBe(false);
    expect(pending.status).toBe('pending_calendar_attestation');
  });

  it('should upgrade pending proof with confirmed Bitcoin block proof', () => {
    const upgraded = openTimestampsService.upgradeProof({
      ots_proof: 'pending-proof-data',
    });
    expect(upgraded.upgraded).toBe(true);
    expect(upgraded.bitcoin_block_height).toBe(864205);
  });
});
