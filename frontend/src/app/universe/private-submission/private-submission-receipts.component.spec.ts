import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { PrivateSubmissionApiService } from './private-submission.service';
import { PrivateSubmissionReceiptsComponent } from './private-submission-receipts.component';
import { PrivateSubmissionAcceleratorsComponent } from './private-submission-accelerators.component';
import { validProvider } from './submission-validation';

const receipt = {
  receipt_id: 'receipt',
  provider_id: 'provider',
  txid: 'ab'.repeat(32),
  provider_fee_sats: 1200,
  submitted_at_utc: '2026-09-17T00:00:00.000Z',
};

const directory = { source: '/etc/universe/accelerators.json', revision: 'r7', loaded_at_utc: '2026-09-17T00:00:00.000Z' };

const verified = {
  verified: true,
  stage: 'verified',
  errors: [],
  provider_id: 'provider',
  receipt_id: 'receipt',
  key_id: 'k1',
  algorithm: 'ed25519',
  verified_at_utc: '2026-09-17T00:00:01.000Z',
  directory,
  scope: 'Signature over the declared terms only.',
};

describe('receipt verification presentation', () => {
  it.each([
    {},
    { verified: false },
    { verified: true, signature_valid: false },
    { verified: true, stage: 'verified', errors: [] },
    { ...verified, receipt_id: 'other' },
  ])(
    'cannot badge an unverified, incomplete or mismatched HTTP 200 as signature valid',
    (response) => {
      const api = {
        verifyReceipt$: vi.fn(() => of(response)),
      } as unknown as PrivateSubmissionApiService;
      const component = new PrivateSubmissionReceiptsComponent(api);
      component.receiptJson = JSON.stringify(receipt);
      component.verifyReceipt();
      expect(component.verificationResult).toBeNull();
      expect(component.verdict).toBeNull();
      expect(component.loadError).toMatch(/did not verify|different receipt/);
    }
  );

  it('does not trust a future unsupported signature-shaped response without an implemented authority contract', () => {
    const response = { ...receipt, verified: true, signature_valid: true };
    const component = new PrivateSubmissionReceiptsComponent({
      verifyReceipt$: () => of(response),
    } as unknown as PrivateSubmissionApiService);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verificationResult).toBeNull();
    expect(component.loadError).toContain('authenticated provider trust');
  });

  it('renders a 200 verified result with the directory key and the pasted terms as inputs', () => {
    const component = new PrivateSubmissionReceiptsComponent({
      verifyReceipt$: () => of(verified),
    } as unknown as PrivateSubmissionApiService);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.loadError).toBeNull();
    expect(component.verdict?.stage).toBe('verified');
    expect(component.verdict?.httpStatus).toBe(200);
    expect(component.verificationResult?.key_id).toBe('k1');
    expect(component.requested?.['provider_fee_sats']).toBe(1200);
    expect(component.stageTitle('verified')).toContain('owned directory');
    expect(component.stageExplanation(component.verdict!)).toContain('remain unverified');
  });

  it.each([
    [400, 'invalid', ['provider_signature does not verify.']],
    [400, 'unsupported', ['secp256k1-schnorr is not verifiable here.']],
    [400, 'wrong-network', ['Receipt names mainnet; this backend serves signet.']],
    [400, 'expired', ['expires_at_utc has passed.']],
    [409, 'duplicate', []],
    [503, 'unavailable-trust', ['No accelerator directory is configured.']],
  ])('renders the %s %s stage distinctly, never as verified', (status, stage, errors) => {
    const body: any = { verified: false, stage, errors, provider_id: 'provider', receipt_id: 'receipt' };
    if (stage === 'duplicate') body.replay = { first_verified_at_utc: '2026-09-16T00:00:00.000Z', seen_count: 2 };
    const component = new PrivateSubmissionReceiptsComponent({
      verifyReceipt$: () => throwError(() => ({ status, error: body })),
    } as unknown as PrivateSubmissionApiService);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verificationResult).toBeNull();
    expect(component.loadError).toBeNull();
    expect(component.verdict?.stage).toBe(stage);
    expect(component.verdict?.httpStatus).toBe(status);
    expect(component.verdict?.result.errors).toEqual(errors);
    expect(component.stageTitle(stage as any)).not.toContain('verified against');
    expect(component.stageClass(stage as any)).not.toBe('bg-success');
    if (stage === 'duplicate') expect(component.verdict?.result.replay?.seen_count).toBe(2);
  });

  it('reports a failure without a typed body as the transport failure', () => {
    const component = new PrivateSubmissionReceiptsComponent({
      verifyReceipt$: () => throwError(() => ({ status: 0 })),
    } as unknown as PrivateSubmissionApiService);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verdict).toBeNull();
    expect(component.loadError).toBeTruthy();
  });

  it('clears a verdict on a network switch', () => {
    const network$ = new BehaviorSubject('signet');
    const component = new PrivateSubmissionReceiptsComponent({
      network$,
      verifyReceipt$: () => of(verified),
    } as unknown as PrivateSubmissionApiService);
    component.ngOnInit();
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verdict?.stage).toBe('verified');
    network$.next('testnet');
    expect(component.verdict).toBeNull();
    component.ngOnDestroy();
  });
});

describe('accelerator directory presentation', () => {
  const provider = {
    provider_id: 'acc-1',
    identity_key: 'aa'.repeat(32),
    name: 'Owned Accelerator',
    supported_networks: ['signet'],
    submission_modes: ['configured_accelerator'],
    minimum_fee_sats: 1000,
    maximum_tx_vsize: 100000,
    payment_methods: ['lightning'],
    partner_mining_claims: [],
    status_endpoint: null,
    health_status: 'unmeasured',
    effective_from: '2026-01-01T00:00:00.000Z',
    expires_at: null,
    provider_signature: null,
    issuer: 'universe',
    protocol_version: '1',
    keys: [{ kid: 'k1', algorithm: 'ed25519', publicKey: 'aa'.repeat(32), validFrom: '2026-01-01T00:00:00.000Z', validUntil: null }],
    directory,
  };

  it('accepts the owned directory view and renders identity, keys, validity and terms', () => {
    expect(validProvider(provider)).toBe(true);
    expect(validProvider({ ...provider, health_status: 'probed' })).toBe(false);
    expect(validProvider({ ...provider, keys: [{ kid: 'k', algorithm: 'rsa', publicKey: 'x', validFrom: 'a', validUntil: null }] })).toBe(false);
    const component = new PrivateSubmissionAcceleratorsComponent({
      network$: new BehaviorSubject('signet'),
      listAccelerators$: () => of({ providers: [provider], network: 'signet', directory }),
    } as unknown as PrivateSubmissionApiService);
    component.ngOnInit();
    expect(component.loadError).toBeNull();
    expect(component.providers).toHaveLength(1);
    expect(component.directory?.revision).toBe('r7');
    expect(component.network).toBe('signet');
    expect(component.isExpired(provider as any)).toBe(false);
    expect(component.healthLabel(provider as any)).toContain('Not measured');
    expect(component.healthClass('unmeasured')).toBe('bg-secondary');
    component.ngOnDestroy();
  });

  it('reports an unconfigured directory as the typed failure and an expired key window as expired', () => {
    const component = new PrivateSubmissionAcceleratorsComponent({
      network$: new BehaviorSubject('signet'),
      listAccelerators$: () => throwError(() => ({ status: 503, error: { stage: 'unavailable-registry', error: 'No accelerator directory is configured (reason: unconfigured)' } })),
    } as unknown as PrivateSubmissionApiService);
    component.ngOnInit();
    expect(component.providers).toEqual([]);
    expect(component.loaded).toBe(false);
    expect(component.loadError).toContain('unconfigured');
    expect(component.isExpired({ ...provider, expires_at: '2020-01-01T00:00:00.000Z' } as any)).toBe(true);
    expect(component.healthLabel({ ...provider, expires_at: '2020-01-01T00:00:00.000Z' } as any)).toContain('EXPIRED');
    component.ngOnDestroy();
  });
});
