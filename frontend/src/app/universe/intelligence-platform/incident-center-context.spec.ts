import { describe, expect, it, vi } from 'vitest';
import { ReplaySubject, Subject } from 'rxjs';
import { createHash } from 'node:crypto';
import { IncidentCenterComponent } from './incident-center.component';

function setup() {
  const requests: Subject<any>[] = [];
  const api = { getIncidents$: vi.fn(() => { const request = new Subject<any>(); requests.push(request); return request; }) };
  const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() };
  const page = new (IncidentCenterComponent as any)(api, { markForCheck() {} }, state) as IncidentCenterComponent;
  page.ngOnInit();
  return { page, requests, state, api };
}

// Controlled fixtures only; these do not qualify a native source.
export function controlledIncidentResponse(): any {
  const at = '2026-10-04T12:00:00.000Z';
  const profile = { schema: 'universe-incident-profile-v1', network: 'signet', stale_after_seconds: 30, sources: [{
    source_id: 'controlled-core', independence_id: 'controlled-host', implementation: 'bitcoin-core', source_revision: null,
    binary_sha256: '1'.repeat(64), configuration_sha256: '2'.repeat(64), genesis_hash: '3'.repeat(64), block_one_hash: '4'.repeat(64), signet_challenge: '51' }] };
  return { schema: 'universe-incident-observations-v1', network: 'signet', profile,
    profile_sha256: createHash('sha256').update(JSON.stringify(profile)).digest('hex'), observed_at_utc: at,
    sources: [{ source_id: 'controlled-core', status: 'observed', checkpoint: {height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}, observed_at_utc: at }],
    coverage: { started_at_utc: at, last_observed_at_utc: at, retained_header_limit: 128, retained_incident_limit: 256,
      observation_count: 1, gaps: [], complete_monitoring: false, global_consensus_verified: false,
      invalid_block_validation: 'unavailable', consensus_validation: 'unavailable', displaced_transactions: 'unmeasured', double_spend_attempts: 'unmeasured' },
    incidents: [], count: 0 };
}

describe('versioned incident source boundary (controlled fixtures)', () => {
  it('rejects a foreign selected network even with an empty list', () => {
    const {page, requests} = setup(); requests[0].next({...controlledIncidentResponse(),network:'mainnet'});
    expect(page.observed).toBe(false); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
  });
  it('rejects a changed profile digest', () => {
    const {page, requests} = setup(); requests[0].next({...controlledIncidentResponse(),profile_sha256:'f'.repeat(64)});
    expect(page.observed).toBe(false); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
  });
  it('accepts nullable unresolved node-tip observations without invented counts', () => {
    const {page, requests} = setup(); const response = controlledIncidentResponse();
    response.profile.sources.push({...response.profile.sources[0],source_id:'controlled-two',independence_id:'controlled-two-host'});
    response.profile_sha256=createHash('sha256').update(JSON.stringify(response.profile)).digest('hex');
    response.sources.push({...response.sources[0],source_id:'controlled-two'});
    response.incidents = [{incident_id:'b'.repeat(64),incident_type:'node_tip_divergence',title:'Controlled node-tip record',
      block_height:2,block_hash:'a'.repeat(64),detected_at_utc:response.observed_at_utc,resolved_at_utc:null,duration_seconds:null,
      reorg_depth:null,displaced_tx_count:null,double_spend_attempts_count:null,status:'investigating',summary:'Controlled fixture',technical_postmortem:'',
      source_ids:['controlled-core','controlled-two'],evidence:{before:[{height:2,hash:'c'.repeat(64),parent:'4'.repeat(64),timestamp:1}],after:[{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}],common_ancestor:null},timeline:[{observed_at_utc:response.observed_at_utc,stage:'detected',source_ids:['controlled-core']}]}]; response.count=1;
    requests[0].next(response); expect(page.observed).toBe(true); expect(page.incidents).toHaveLength(1); page.ngOnDestroy();
  });
});

describe('Incident observations selected-context lifecycle', () => {
  const record = () => ({ incident_id: 'b'.repeat(64), title: 'Controlled parser fixture', summary: 'Controlled fixture only', technical_postmortem: '',
    incident_type: 'stale_tip', status: 'resolved', block_hash: 'a'.repeat(64), detected_at_utc: '2026-10-04T11:59:00.000Z', resolved_at_utc: '2026-10-04T12:00:00.000Z',
    block_height: 2, duration_seconds: 60, reorg_depth: null, displaced_tx_count: null, double_spend_attempts_count: null,
    source_ids: ['controlled-core'], evidence: {before: [{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}], after: [{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}], common_ancestor:{height:2,hash:'a'.repeat(64),parent:'4'.repeat(64),timestamp:1}},
    timeline:[{observed_at_utc:'2026-10-04T11:59:00.000Z',stage:'detected',source_ids:['controlled-core']}] });
  it('starts one read when the actual replayed context signal is already available', () => {
    const changed = new ReplaySubject<string>(1); changed.next('');
    const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changed };
    const api = { getIncidents$: vi.fn(() => new Subject<any>()) };
    const page = new (IncidentCenterComponent as any)(api, { markForCheck() {} }, state);
    page.ngOnInit(); expect(api.getIncidents$).toHaveBeenCalledTimes(1);
    changed.next(''); expect(api.getIncidents$).toHaveBeenCalledTimes(1); page.ngOnDestroy();
  });
  it('cancels the old context and reloads without retaining incident records', () => {
    const { page, requests, state, api } = setup();
    page.incidents = [{ status: 'resolved' }] as any;
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
    const { page, requests } = setup(); page.incidents = [{ status: 'resolved' }] as any;
    requests[0].error({ status: 503, error: { error: 'owned ledger unavailable' } });
    expect(page.incidents).toEqual([]); expect(page.loadError).toContain('unavailable'); page.ngOnDestroy();
  });
  it('closes both network and source subscriptions on destruction', () => {
    const { page, requests, state, api } = setup(); page.ngOnDestroy();
    expect(requests[0].observed).toBe(false); state.networkChanged$.next('testnet4');
    expect(api.getIncidents$).toHaveBeenCalledTimes(1);
  });
  it('labels an actual empty response as observed records without consensus inference', () => {
    const { page, requests } = setup(); requests[0].next(controlledIncidentResponse());
    expect(page.observed).toBe(true); expect(page.loadError).toBeNull(); page.ngOnDestroy();
  });
  it('rejects count mismatch and incomplete incident bodies', () => {
    for (const response of [{ incidents: [], count: 1 }, { incidents: [{ status: 'resolved' }], count: 1 }]) {
      const { page, requests } = setup(); requests[0].next(response);
      expect(page.observed).toBe(false); expect(page.incidents).toEqual([]); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
    }
  });
  it('projects a shape-valid retained observation without inferring source agreement', () => {
    const { page, requests } = setup(); const incident = record(); requests[0].next({ ...controlledIncidentResponse(), incidents: [incident], count: 1 });
    expect(page.incidents).toEqual([incident]); expect(page.observed).toBe(true); expect(page.activeIncidentsCount).toBe(0); page.ngOnDestroy();
  });
  it('rejects impossible calendar dates and unsafe quantities', () => {
    for (const patch of [{ detected_at_utc: '2026-02-31T12:00:00Z' }, { displaced_tx_count: Number.MAX_SAFE_INTEGER + 1 }]) {
      const { page, requests } = setup(); requests[0].next({ ...controlledIncidentResponse(), incidents: [{ ...record(), ...patch }], count: 1 });
      expect(page.incidents).toEqual([]); expect(page.observed).toBe(false); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
    }
  });
});

describe('Incident source cancellation and recovery', () => {
  it('clears full source provenance on context change and retries the current context', () => {
    const {page,requests,state,api}=setup(); requests[0].next(controlledIncidentResponse()); expect(page.response?.network).toBe('signet');
    state.network='testnet4'; state.networkChanged$.next('testnet4'); expect(page.response).toBeNull(); expect(page.observed).toBe(false);
    requests[1].error({status:503}); page.retry(); expect(api.getIncidents$).toHaveBeenCalledTimes(3); expect(page.loading).toBe(true);
    page.retry(); expect(api.getIncidents$).toHaveBeenCalledTimes(3); page.ngOnDestroy(); expect(requests[2].observed).toBe(false);
  });
  it('keeps unavailable source status instead of inventing an observed checkpoint', () => {
    const {page,requests}=setup(); const value=controlledIncidentResponse(); value.sources[0]={source_id:'controlled-core',status:'unavailable',checkpoint:null,observed_at_utc:null};
    requests[0].next(value); expect(page.response?.sources[0].status).toBe('unavailable'); expect(page.response?.sources[0].checkpoint).toBeNull(); page.ngOnDestroy();
  });
  it('bounds a silent source and permits explicit retry after the deadline', () => {
    vi.useFakeTimers(); try { const {page,requests,api}=setup(); vi.advanceTimersByTime(15000); expect(page.loading).toBe(false);
      expect(page.loadError).toBeTruthy(); expect(requests[0].observed).toBe(false); page.retry(); expect(api.getIncidents$).toHaveBeenCalledTimes(2); page.ngOnDestroy();
    } finally {vi.useRealTimers();}
  });
});

describe('Incident provenance failure clears accepted state',()=>{
  it('clears an accepted profile and observed state on a malformed later emission',()=>{
    const {page,requests}=setup();requests[0].next(controlledIncidentResponse());expect(page.observed).toBe(true);requests[0].next({schema:'foreign'});
    expect(page.response).toBeNull();expect(page.observed).toBe(false);expect(page.incidents).toEqual([]);page.ngOnDestroy();
  });
  it('clears an accepted profile if the source fails after its observation',()=>{
    const {page,requests}=setup();requests[0].next(controlledIncidentResponse());requests[0].error({status:503});
    expect(page.response).toBeNull();expect(page.observed).toBe(false);expect(page.loadError).toBeTruthy();page.ngOnDestroy();
  });
});
