import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { PrivateSubmissionApiService } from './private-submission.service';
import { PrivateSubmissionReceiptsComponent } from './private-submission-receipts.component';

const receipt = { receipt_id: 'receipt', provider_id: 'provider', txid: 'ab'.repeat(32) };

describe('receipt verification presentation', () => {
  it.each([{}, { verified: false }, { verified: true, signature_valid: false },
    { ...receipt, verified: true, signature_valid: true, txid: 'cd'.repeat(32) }])('cannot badge an unverified or mismatched HTTP 200 as signature valid', response => {
    const api = { verifyReceipt$: vi.fn(() => of(response)) } as unknown as PrivateSubmissionApiService;
    const component = new PrivateSubmissionReceiptsComponent(api);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verificationResult).toBeNull();
    expect(component.loadError).toContain('did not verify');
  });

  it('requires both an explicit signature verdict and exact receipt identity', () => {
    const response = { ...receipt, verified: true, signature_valid: true };
    const component = new PrivateSubmissionReceiptsComponent({ verifyReceipt$: () => of(response) } as unknown as PrivateSubmissionApiService);
    component.receiptJson = JSON.stringify(receipt);
    component.verifyReceipt();
    expect(component.verificationResult).toBe(response);
  });
});
