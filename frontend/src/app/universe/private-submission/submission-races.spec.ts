import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { Transaction } from 'bitcoinjs-lib';
import { PrivateSubmissionBroadcastComponent } from './private-submission-broadcast.component';
import { PrivateSubmissionReceiptsComponent } from './private-submission-receipts.component';
import { validCapabilities, validProvider } from './submission-validation';
const tx = new Transaction();
tx.addInput(Buffer.alloc(32, 1), 0);
tx.addOutput(Buffer.from([0x51]), 1000);
const capabilities = {
  public_p2p_enabled: true,
  privatebroadcast_tor_enabled: false,
  privatebroadcast_i2p_enabled: false,
  tor_active: false,
  i2p_active: false,
  core_version: '29',
  queue_limit: 10,
  current_queue_count: 0,
};
const record = {
  submission_token: 'token',
  txid: tx.getId(),
  method: 'public_p2p',
  network: 'signet',
  queued_at_utc: '2026-09-15T00:00:00Z',
  status: 'queued',
  retry_count: 0,
  can_abort: true,
};
function make() {
  const network$ = new BehaviorSubject('signet'),
    requests: Subject<any>[] = [],
    api: any = {
      network: 'signet',
      network$,
      getCapabilities$: () => of(capabilities),
      submitPrivate$: () => {
        const r = new Subject();
        requests.push(r);
        return r;
      },
      getPrivateSubmission$: () => {
        const r = new Subject();
        requests.push(r);
        return r;
      },
      abortPrivate$: () => of({ success: false, status: 'queued' }),
    };
  const c = new PrivateSubmissionBroadcastComponent(api);
  c.ngOnInit();
  c.rawTxHex = tx.toHex();
  return { c, api, requests, network$ };
}
describe('Private submission exact identity and cancellation', () => {
  it.each([
    { txid: 'ab'.repeat(32) },
    { network: 'mainnet' },
    { method: 'privatebroadcast_tor' },
    { submission_token: '' },
    { retry_count: NaN },
  ])('rejects foreign or malformed submission response %j', (change) => {
    const { c, requests } = make();
    c.submitPrivate();
    requests[0].next({ ...record, ...change });
    expect(c.broadcastReceipt).toBeNull();
    expect(c.loadError).toContain('bound');
    c.ngOnDestroy();
  });
  it('rejects a different refresh token and never ignores failed abort', () => {
    const { c, requests } = make();
    c.submitPrivate();
    requests[0].next(record);
    c.abort();
    expect(c.loadError).toContain('did not confirm');
    c.refreshStatus();
    requests[1].next({ ...record, submission_token: 'other' });
    expect(c.broadcastReceipt).toBeNull();
    c.ngOnDestroy();
  });
  it('cancels pending submit or refresh on edit/network changes', () => {
    const { c, requests, network$ } = make();
    c.submitPrivate();
    c.reset();
    requests[0].next(record);
    expect(c.broadcastReceipt).toBeNull();
    c.submitPrivate();
    requests[1].next(record);
    c.refreshStatus();
    network$.next('testnet');
    requests[2].next({ ...record, status: 'broadcast_completed' });
    expect(c.broadcastReceipt).toBeNull();
    c.ngOnDestroy();
  });
  it('cancels an old receipt result before malformed new JSON and on network changes', () => {
    const pending = new Subject(),
      network$ = new Subject<string>(),
      api: any = { network$, verifyReceipt$: () => pending };
    const c = new PrivateSubmissionReceiptsComponent(api);
    c.ngOnInit();
    c.receiptJson = '{}';
    c.verifyReceipt();
    c.receiptJson = 'bad';
    c.verifyReceipt();
    pending.next({ verified: true, signature_valid: true });
    expect(c.verificationResult).toBeNull();
    expect(c.loadError).toContain('readable JSON');
    network$.next('signet');
    expect(c.loadError).toBeNull();
    c.ngOnDestroy();
  });
  it('rejects truthy capability strings and malformed provider dates/fields', () => {
    expect(validCapabilities({ ...capabilities, tor_active: 'false' })).toBe(
      false
    );
    expect(validProvider({ provider_id: 'p', expires_at: 'invalid' })).toBe(
      false
    );
  });
});
