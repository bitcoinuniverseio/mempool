import { Transaction } from 'bitcoinjs-lib';
const tx = new Transaction();
tx.addInput(Buffer.alloc(32, 1), 0);
tx.addOutput(Buffer.from([0x51]), 1000);
const raw = tx.toHex();
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import {
  PrivateSubmissionApiService,
  PrivateBroadcastRecord,
  SubmissionCapabilities,
} from './private-submission.service';
import {
  PrivateSubmissionBroadcastComponent,
  methodChoices,
  statusPresentation,
} from './private-submission-broadcast.component';
import { PrivateSubmissionAcceleratorsComponent } from './private-submission-accelerators.component';

const capabilities: SubmissionCapabilities = {
  public_p2p_enabled: true,
  privatebroadcast_tor_enabled: true,
  privatebroadcast_i2p_enabled: false,
  core_version: '31.0.0',
  tor_active: true,
  i2p_active: false,
  queue_limit: 10,
  current_queue_count: 2,
};
const record = (
  status: PrivateBroadcastRecord['status'],
  extra: Partial<PrivateBroadcastRecord> = {}
): PrivateBroadcastRecord => ({
  submission_token: 'tok',
  txid: tx.getId(),
  method: 'privatebroadcast_tor',
  network: 'signet',
  queued_at_utc: '2026-09-15T00:00:00Z',
  status,
  retry_count: 0,
  can_abort: status === 'queued',
  ...extra,
});
const unavailable = new HttpErrorResponse({
  status: 503,
  error: {
    stage: 'unavailable-relay',
    error: 'Private broadcast is unavailable (PRE-01).',
  },
});

function component(
  api: Partial<PrivateSubmissionApiService>
): PrivateSubmissionBroadcastComponent {
  return new PrivateSubmissionBroadcastComponent({
    network: 'signet',
    network$: of('signet'),
    ...api,
  } as PrivateSubmissionApiService);
}

describe('private broadcast: choices come from reported capabilities', () => {
  it('offers only enabled relay paths and none when the relay is unavailable', () => {
    expect(methodChoices(capabilities).map((c) => c.method)).toEqual([
      'privatebroadcast_tor',
      'public_p2p',
    ]);
    expect(
      methodChoices({
        ...capabilities,
        privatebroadcast_tor_enabled: false,
        public_p2p_enabled: false,
      })
    ).toEqual([]);
    expect(methodChoices(null)).toEqual([]);
  });

  it('shows the backend reason and cannot submit when capabilities are unavailable', () => {
    const submit = vi.fn();
    const c = component({
      getCapabilities$: () => throwError(() => unavailable),
      submitPrivate$: submit,
    });
    c.ngOnInit();
    expect(c.capabilityError).toContain('PRE-01');
    c.rawTxHex = raw;
    expect(c.canSubmit).toBe(false);
    c.submitPrivate();
    expect(submit).not.toHaveBeenCalled();
  });

  it('carries the selected method in the request', () => {
    const submit = vi.fn(() => of(record('queued')));
    const c = component({
      getCapabilities$: () => of(capabilities),
      submitPrivate$: submit,
    });
    c.ngOnInit();
    c.rawTxHex = ' ' + raw + ' ';
    c.method = 'public_p2p';
    c.submitPrivate();
    expect(submit).toHaveBeenCalledWith({ raw_tx: raw, method: 'public_p2p' });
    c.method = 'privatebroadcast_tor';
    c.submitPrivate();
    expect(submit).toHaveBeenLastCalledWith({
      raw_tx: raw,
      method: 'privatebroadcast_tor',
    });
  });
});

describe('private broadcast: the receipt shows the exact backend status', () => {
  it.each(['queued', 'acknowledged', 'aborted', 'failed'] as const)(
    '%s is never presented as completed',
    (status) => {
      const c = component({
        getCapabilities$: () => of(capabilities),
        submitPrivate$: () =>
          of(
            record(status, {
              last_error: status === 'failed' ? 'relay refused' : undefined,
            })
          ),
      });
      c.ngOnInit();
      c.rawTxHex = raw;
      c.submitPrivate();
      expect(c.broadcastReceipt?.status).toBe(status);
      expect(c.presentation.tone).not.toBe('success');
      expect(c.presentation.badge).not.toMatch(/RELAYED|COMPLETED/);
    }
  );

  it('a completed status alone is only a relay report', () => {
    expect(statusPresentation('broadcast_completed')).toMatchObject({
      tone: 'secondary',
      badge: 'REPORTED COMPLETED',
    });
  });

  it('a 503 leaves no receipt and shows the backend message', () => {
    const c = component({
      getCapabilities$: () => of(capabilities),
      submitPrivate$: () => throwError(() => unavailable),
    });
    c.ngOnInit();
    c.rawTxHex = raw;
    c.submitPrivate();
    expect(c.broadcastReceipt).toBeNull();
    expect(c.loadError).toContain('PRE-01');
  });

  it('a 200 without a broadcast record is rejected instead of rendered', () => {
    const c = component({
      getCapabilities$: () => of(capabilities),
      submitPrivate$: () =>
        of({ ok: true } as unknown as PrivateBroadcastRecord),
    });
    c.ngOnInit();
    c.rawTxHex = raw;
    c.submitPrivate();
    expect(c.broadcastReceipt).toBeNull();
    expect(c.loadError).toContain('not a broadcast record');
  });

  it('refresh and abort use the submission token and re-read the record', () => {
    const get = vi.fn(() => of(record('cancelled')));
    const abort = vi.fn(() => of({ success: true, status: 'cancelled' }));
    const c = component({
      getCapabilities$: () => of(capabilities),
      submitPrivate$: () => of({ ...record('queued'), owner_token: 'a'.repeat(64) }),
      getPrivateSubmission$: get,
      abortPrivate$: abort,
    });
    c.ngOnInit();
    c.rawTxHex = raw;
    c.submitPrivate();
    expect(c.broadcastReceipt?.can_abort).toBe(true);
    c.abort();
    expect(abort).toHaveBeenCalledWith('tok', 'a'.repeat(64));
    expect(get).toHaveBeenCalledWith('tok', 'a'.repeat(64));
    expect(c.broadcastReceipt?.status).toBe('cancelled');
  });
});

describe('accelerator directory reads the providers envelope', () => {
  const provider = {
    provider_id: 'p1',
    identity_key: 'k',
    name: 'One',
    supported_networks: ['signet'],
    submission_modes: ['configured_accelerator'],
    minimum_fee_sats: 1000,
    maximum_tx_vsize: 100000,
    payment_methods: ['lightning'],
    partner_mining_claims: ['pool-a'],
    status_endpoint: 'https://example.invalid/status',
    health_status: 'online',
    effective_from: '2019-01-01T00:00:00Z',
    expires_at: '2020-01-01T00:00:00Z',
    provider_signature: 'sig',
  } as const;

  it('renders a populated and an empty envelope', () => {
    const c = new PrivateSubmissionAcceleratorsComponent({
      network$: of('signet'),
      listAccelerators$: () => of({ providers: [provider] }),
    } as unknown as PrivateSubmissionApiService);
    c.ngOnInit();
    expect(c.providers.map((p) => p.provider_id)).toEqual(['p1']);
    expect(c.isExpired(c.providers[0])).toBe(true);
    const empty = new PrivateSubmissionAcceleratorsComponent({
      network$: of('signet'),
      listAccelerators$: () => of({ providers: [] }),
    } as unknown as PrivateSubmissionApiService);
    empty.ngOnInit();
    expect(empty.loaded).toBe(true);
    expect(empty.providers).toEqual([]);
  });

  it('a bare array or malformed body is an error, not a directory', () => {
    for (const body of [[provider], null, { providers: 'nope' }]) {
      const c = new PrivateSubmissionAcceleratorsComponent({
        network$: of('signet'),
        listAccelerators$: () => of(body),
      } as unknown as PrivateSubmissionApiService);
      c.ngOnInit();
      expect(c.providers).toEqual([]);
      expect(c.loadError).toBeTruthy();
    }
  });

  it('a 503 shows the registry reason', () => {
    const err = new HttpErrorResponse({
      status: 503,
      error: {
        stage: 'unavailable-registry',
        error: 'registry unavailable (PRE-04)',
      },
    });
    const c = new PrivateSubmissionAcceleratorsComponent({
      network$: of('signet'),
      listAccelerators$: () => throwError(() => err),
    } as unknown as PrivateSubmissionApiService);
    c.ngOnInit();
    expect(c.loadError).toContain('PRE-04');
  });
});
