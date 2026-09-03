import { knowledgeRegistryService } from './knowledge-registry.service';

describe('Product 11: Evidence-Backed Labels and Public Knowledge Registry', () => {
  it('retrieves verified entity labels with cryptographic evidence citations', () => {
    const labels = knowledgeRegistryService.getLabels('exchange');
    expect(labels.length).toBeGreaterThan(0);

    const binance = labels[0];
    expect(binance.confidence_level).toBe(3);
    expect(binance.confidence_score).toBe(1.0);
    expect(binance.status).toBe('verified');
    expect(binance.evidence.length).toBeGreaterThan(0);
    expect(binance.evidence[0].cryptographic_proof).toBeDefined();
  });

  it('strictly rejects label submission without verifiable evidence', () => {
    expect(() => {
      knowledgeRegistryService.submitLabel(
        'actor-unverified',
        'address',
        'bc1qtest12345',
        'Guessed Whale Wallet',
        'custodian',
        [] // empty evidence!
      );
    }).toThrow(/Evidence-backed policy violation/);
  });

  it('accepts label with public disclosure and sets provisional confidence', () => {
    const label = knowledgeRegistryService.submitLabel(
      'actor-verified',
      'address',
      'bc1qvalidaddress5678',
      'Kraken Deposit Cluster Output',
      'exchange',
      [
        {
          evidence_type: 'public_disclosure',
          reference_uri: 'https://kraken.com/security/addresses',
          description: 'Official exchange documentation listing static deposit addresses.',
          verified_at_utc: new Date().toISOString(),
        },
      ]
    );

    expect(label.label_id).toBeDefined();
    expect(label.confidence_level).toBe(2);
    expect(label.status).toBe('provisional');
  });

  it('handles label dispute challenges and records audit trail', () => {
    const labels = knowledgeRegistryService.getLabels();
    const targetLabel = labels[0];

    const challenged = knowledgeRegistryService.challengeLabel(
      targetLabel.label_id,
      'challenger-01',
      'Address belonged to consolidated legacy pool output no longer active.',
      'https://github.com/bitcoinuniverseio/disputes/12'
    );

    expect(challenged).toBe(true);

    const updated = knowledgeRegistryService.getLabelByEntity(targetLabel.label_id);
    expect(updated?.status).toBe('contested');
    expect(updated?.dispute_reason).toContain('consolidated legacy pool');

    const auditLog = knowledgeRegistryService.getAuditLog();
    expect(auditLog.some((a) => a.action === 'challenged')).toBe(true);
  });
});
