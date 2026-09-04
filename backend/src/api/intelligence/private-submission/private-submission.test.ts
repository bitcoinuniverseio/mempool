import privateSubmissionService from './private-submission.service';

describe('PrivateSubmissionService', () => {
  it('should return overview with capabilities and active accelerator providers', () => {
    const overview = privateSubmissionService.getOverview();
    expect(overview.capabilities.public_p2p_enabled).toBe(true);
    expect(overview.capabilities.privatebroadcast_tor_enabled).toBe(true);
    expect(overview.active_accelerator_providers.length).toBeGreaterThanOrEqual(2);
  });

  it('should diagnose raw transaction or txid for policy compliance and fee-bump alternatives', () => {
    const diagnosis = privateSubmissionService.diagnoseTransaction('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b');
    expect(diagnosis.is_policy_compliant).toBe(true);
    expect(diagnosis.rbf_eligible).toBe(true);
    expect(diagnosis.available_methods).toContain('privatebroadcast_tor');
  });

  it('should queue and safely abort a private broadcast submission', () => {
    const record = privateSubmissionService.submitPrivate({
      raw_tx: '0200000001...',
      method: 'privatebroadcast_tor',
    });
    expect(record.status).toBe('queued');
    expect(record.can_abort).toBe(true);

    const fetched = privateSubmissionService.getPrivateSubmission(record.submission_token);
    expect(fetched).toBeDefined();

    const abortRes = privateSubmissionService.abortPrivateSubmission(record.submission_token);
    expect(abortRes.success).toBe(true);
    expect(abortRes.status).toBe('aborted');
  });

  it('should list accelerator providers and verify receipts', () => {
    const res = privateSubmissionService.listAcceleratorProviders();
    expect(res.providers.length).toBeGreaterThanOrEqual(2);

    const validReceipt = privateSubmissionService.verifyAcceleratorReceipt({
      provider_id: 'mempool-acc-fast',
      receipt_id: 'rcp-887412-001',
      txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      provider_signature: 'sig-data',
    });
    expect(validReceipt.verified).toBe(true);

    const invalidReceipt = privateSubmissionService.verifyAcceleratorReceipt({
      provider_id: '',
      txid: 'bad',
    });
    expect(invalidReceipt.verified).toBe(false);
  });

  it('should correlate ordering evidence and identify protocol-sensitive inclusion', () => {
    const ordering = privateSubmissionService.getTransactionOrdering('9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb');
    expect(ordering).toBeDefined();
    expect(ordering?.evidence_state).toBe('included_without_public_observation');
    expect(ordering?.is_ordering_sensitive).toBe(true);

    const findings = privateSubmissionService.listOrderingFindings();
    expect(findings.findings.length).toBeGreaterThanOrEqual(1);
  });
});
