import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { IncidentCenterComponent } from './incident-center.component';

function setup() {
  const requests: Subject<any>[] = [];
  const api = { getIncidents$: vi.fn(() => { const request = new Subject<any>(); requests.push(request); return request; }) };
  const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() };
  const page = new (IncidentCenterComponent as any)(api, { markForCheck() {} }, state) as IncidentCenterComponent;
  page.ngOnInit();
  return { page, requests, state, api };
}

describe('Incident observations selected-context lifecycle', () => {
  const record = () => ({ incident_id: 'controlled-record', title: 'Controlled parser fixture', summary: 'Controlled fixture only', technical_postmortem: '',
    incident_type: 'reorg', status: 'resolved', block_hash: 'a'.repeat(64), detected_at_utc: '2026-10-04T12:00:00Z', resolved_at_utc: '2026-10-04T12:01:00Z',
    block_height: 1, duration_seconds: 60, reorg_depth: 1, displaced_tx_count: 0, double_spend_attempts_count: 0 });
  it('cancels the old context and reloads without retaining incident records', () => {
    const { page, requests, state, api } = setup();
    page.incidents = [{ status: 'resolved' }];
    state.network = 'testnet4'; state.networkChanged$.next('testnet4');
    expect(requests[0].observed).toBe(false);
    expect(page.incidents).toEqual([]);
    expect(api.getIncidents$).toHaveBeenCalledTimes(2);
    requests[0].next({ incidents: [{ status: 'resolved' }] });
    expect(page.incidents).toEqual([]); page.ngOnDestroy();
  });
  it('rejects malformed successful responses rather than projecting an empty incident ledger', () => {
    const { page, requests } = setup(); requests[0].next({ incidents: 'unavailable' });
    expect(page.incidents).toEqual([]); expect(page.loadError).toMatch(/invalid|incomplete/i); page.ngOnDestroy();
  });
  it('does not retain historical records when the selected producer fails', () => {
    const { page, requests } = setup(); page.incidents = [{ status: 'resolved' }];
    requests[0].error({ status: 503, error: { error: 'owned ledger unavailable' } });
    expect(page.incidents).toEqual([]); expect(page.loadError).toContain('unavailable'); page.ngOnDestroy();
  });
  it('closes both network and source subscriptions on destruction', () => {
    const { page, requests, state, api } = setup(); page.ngOnDestroy();
    expect(requests[0].observed).toBe(false); state.networkChanged$.next('testnet4');
    expect(api.getIncidents$).toHaveBeenCalledTimes(1);
  });
  it('labels an actual empty response as observed records without consensus inference', () => {
    const { page, requests } = setup(); requests[0].next({ incidents: [], count: 0 });
    expect(page.observed).toBe(true); expect(page.loadError).toBeNull(); page.ngOnDestroy();
  });
  it('rejects count mismatch and incomplete incident bodies', () => {
    for (const response of [{ incidents: [], count: 1 }, { incidents: [{ status: 'resolved' }], count: 1 }]) {
      const { page, requests } = setup(); requests[0].next(response);
      expect(page.observed).toBe(false); expect(page.incidents).toEqual([]); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
    }
  });
  it('projects a shape-valid retained observation without inferring source agreement', () => {
    const { page, requests } = setup(); const incident = record(); requests[0].next({ incidents: [incident], count: 1 });
    expect(page.incidents).toEqual([incident]); expect(page.observed).toBe(true); expect(page.activeIncidentsCount).toBe(0); page.ngOnDestroy();
  });
  it('rejects impossible calendar dates and unsafe quantities', () => {
    for (const patch of [{ detected_at_utc: '2026-02-31T12:00:00Z' }, { displaced_tx_count: Number.MAX_SAFE_INTEGER + 1 }]) {
      const { page, requests } = setup(); requests[0].next({ incidents: [{ ...record(), ...patch }], count: 1 });
      expect(page.incidents).toEqual([]); expect(page.observed).toBe(false); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
    }
  });
});
