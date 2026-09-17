import privateSubmissionService, { SubmissionEvidenceError } from './private-submission.service';
import { setPrivateRelayRuntime } from './private-relay.runtime';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: two accelerator providers, a diagnosis whose numbers did not
 * depend on its argument, a queued broadcast nothing relayed, and a receipt
 * that verified on four non-empty fields. Passing those proved the constants
 * were still present, not that any of it worked.
 */
describe('PrivateSubmissionService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code });

  // The private relay itself (queueing, worker, abort, overview and capabilities)
  // is covered in private-relay.test.ts with fakes for the durable store and
  // the transport. Here: without a database the whole feature reports the
  // missing store rather than queueing a broadcast nothing sends.
  it('reports the missing durable store rather than queueing a broadcast nothing sends', async () => {
    setPrivateRelayRuntime({ network: 'signet', endpoints: { endpoints: [], issues: [], unconfigured: true }, store: null, worker: null, coreVersion: () => '?' });
    try {
      await expect(privateSubmissionService.submitPrivate({ raw_tx: '02'.repeat(80), method: 'privatebroadcast_tor' }))
        .rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getPrivateSubmission('tok-priv-1', 'ab'.repeat(32))).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.abortPrivateSubmission('tok-priv-1', 'ab'.repeat(32))).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getOverview()).rejects.toMatchObject({ code: 'durable-store-unavailable' });
      await expect(privateSubmissionService.getCapabilities()).rejects.toMatchObject({ code: 'durable-store-unavailable' });
    } finally {
      setPrivateRelayRuntime(null);
    }
  });

  it('reports the missing diagnosis source rather than a fixed feerate verdict', () => {
    expect(() => privateSubmissionService.diagnoseTransaction(
      '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    )).toThrow(unavailable('unavailable-source'));
  });

  it('reports the missing provider registry rather than a directory of providers', () => {
    expect(() => privateSubmissionService.listAcceleratorProviders()).toThrow(unavailable('unavailable-registry'));
    expect(() => privateSubmissionService.getAcceleratorProvider('any-provider')).toThrow(unavailable('unavailable-registry'));
  });

  it('reports a structurally complete receipt as unverified while the trust source is absent', () => {
    const complete = privateSubmissionService.verifyAcceleratorReceipt({
      provider_id: 'provider-under-test',
      receipt_id: 'rcp-1',
      txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      provider_signature: 'signature-bytes',
    });
    expect(complete.verified).toBe(false);
    expect(complete.stage).toBe('unavailable-registry');
  });

  it('still names the faults in a receipt it can read', () => {
    const malformed = privateSubmissionService.verifyAcceleratorReceipt({ provider_id: '', txid: 'bad' });
    expect(malformed.verified).toBe(false);
    expect(malformed.stage).toBe('invalid');
    expect(malformed.errors).toContain('provider_id is required');
    expect(malformed.errors).toContain('Valid 32-byte txid is required');
  });

  it('rejects a 64-character nonhex txid and never treats signature-shaped bytes as trusted', () => {
    const receipt = { provider_id: 'provider', receipt_id: 'receipt', provider_signature: 'ab'.repeat(64), txid: 'z'.repeat(64) };
    expect(privateSubmissionService.verifyAcceleratorReceipt(receipt)).toMatchObject({ verified: false, stage: 'invalid' });
    expect(privateSubmissionService.verifyAcceleratorReceipt({ ...receipt, txid: 'ab'.repeat(32) }))
      .toMatchObject({ verified: false, stage: 'unavailable-registry' });
  });

  it('reports the missing ordering sensor rather than evidence for invented transactions', () => {
    expect(() => privateSubmissionService.getTransactionOrdering('9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb'))
      .toThrow(unavailable('unavailable-source'));
    expect(() => privateSubmissionService.getBlockOrdering('00'.repeat(32))).toThrow(unavailable('unavailable-source'));
    expect(() => privateSubmissionService.listOrderingFindings()).toThrow(unavailable('unavailable-source'));
  });

  it('raises the typed error the routes map to a 503', () => {
    try {
      privateSubmissionService.listAcceleratorProviders();
      throw new Error('expected the registry read to refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(SubmissionEvidenceError);
    }
  });
});
