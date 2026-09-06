import openTimestampsService, { TimestampEvidenceError } from './opentimestamps.service';

describe('OpenTimestampsService', () => {
  it('does not report invented calendar health, batches or confirmed anchors', () => {
    for (const read of [() => openTimestampsService.getOverview(), () => openTimestampsService.listCalendars(),
      () => openTimestampsService.getCalendar('alice-universe'), () => openTimestampsService.listAnchors(),
      () => openTimestampsService.getBatch('batch-864205-01')]) expect(read).toThrow(TimestampEvidenceError);
  });

  it('validates digest syntax and requires an actual calendar response', () => {
    expect(() => openTimestampsService.stampDigest('z'.repeat(64))).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => openTimestampsService.stampDigest('ab'.repeat(32)))
      .toThrow(expect.objectContaining({ code: 'unavailable-calendar', status: 503 }));
  });

  it.each(['verified-proof-data', 'pending-proof-data'])('does not classify a proof from the text %s', async ots_proof => {
    await expect(openTimestampsService.verifyProof({ digest: 'ab'.repeat(32), ots_proof }))
      .rejects.toMatchObject({ code: 'invalid-proof', status: 400 });
  });

  it('validates the actual browser proof field without inventing a verdict', async () => {
    await expect(openTimestampsService.verifyProof({ proof: 'BAAAAAAAb3Rz' }))
      .rejects.toMatchObject({ code: 'invalid-proof', status: 400 });
    await expect(openTimestampsService.verifyProof({})).rejects.toMatchObject({ status: 400 });
  });

  it('cannot upgrade a pending proof without a verified calendar response', () => {
    expect(() => openTimestampsService.upgradeProof({ ots_proof: 'pending-proof-data' }))
      .toThrow(expect.objectContaining({ code: 'unavailable-calendar' }));
  });
});
