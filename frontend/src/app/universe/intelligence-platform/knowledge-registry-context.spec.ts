import { describe, expect, it, vi } from 'vitest';
import { ReplaySubject, Subject } from 'rxjs';
import { KnowledgeRegistryComponent } from './knowledge-registry.component';

const label = () => ({ label_id: 'pool-controlled', entity_type: 'pool', entity_id: 'pool-controlled', name: 'Controlled pool', category: 'mining_pool', confidence_level: 2, confidence_score: 0.7, status: 'verified', source: 'pools_definition', evidence: [{ evidence_type: 'coinbase_tag', reference_uri: 'https://example.test/definition', verified_at_utc: '2026-10-04T12:00:00.000Z', description: 'Controlled definition only' }], created_at: '2026-10-04T12:00:00.000Z', updated_at: '2026-10-04T12:00:00.000Z' });
const labels = (network='signet') => ({ schema: 'universe-knowledge-labels-v1', network, labels: [label()], count: 1 });
const audit = (network='signet') => ({ schema: 'universe-knowledge-audit-v1', network, audit_events: [], count: 0 });
function setup(replayed=false) {
  const changes = replayed ? new ReplaySubject<string>(1) : new Subject<string>();
  if (replayed) changes.next('');
  const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changes };
  const requests = { labels: [] as Subject<any>[], audit: [] as Subject<any>[] };
  const api = { getKnowledgeLabels$: vi.fn(() => { const request=new Subject<any>();requests.labels.push(request);return request; }), getKnowledgeAuditLog$: vi.fn(() => { const request=new Subject<any>();requests.audit.push(request);return request; }) };
  const page = new (KnowledgeRegistryComponent as any)(api, { markForCheck() {} }, state) as KnowledgeRegistryComponent;
  page.ngOnInit(); return { page, state, changes, requests, api };
}
describe('Knowledge Registry selected context, controlled responses only', () => {
  it('accepts actual selected root network and preserves the source and reference URI', () => {
    const {page,requests}=setup();requests.labels[0].next(labels());requests.audit[0].next(audit());
    expect(page.labels).toHaveLength(1);expect(page.labels[0].source).toBe('pools_definition');
    expect(page.referenceHref(page.labels[0].evidence[0].reference_uri)).toBe('https://example.test/definition');
    expect(page.loadError).toBeNull();expect(page.auditError).toBeNull();page.ngOnDestroy();
  });
  it('rejects an explicit foreign-network labels response', () => {
    const {page,requests}=setup(); requests.labels[0].next(labels('mainnet'));
    expect(page.labels).toEqual([]);expect(page.loadError).toBeTruthy();page.ngOnDestroy();
  });
  it('keeps one initial read for an already replayed context', () => {
    const {page,api,changes}=setup(true);expect(api.getKnowledgeLabels$).toHaveBeenCalledTimes(1);
    changes.next('');expect(api.getKnowledgeLabels$).toHaveBeenCalledTimes(1);page.ngOnDestroy();
  });
  it('clears labels, audit and selected evidence and retires both old reads on network change', () => {
    const {page,state,changes,requests}=setup();requests.labels[0].next(labels());requests.audit[0].next(audit());
    page.selectedEvidence=page.labels[0];state.network='testnet4';changes.next('testnet4');
    expect(page.labels).toEqual([]);expect(page.auditLog).toEqual([]);expect(page.selectedEvidence).toBeNull();
    expect(requests.labels[0].observed).toBe(false);expect(requests.audit[0].observed).toBe(false);
    requests.labels[0].next(labels());expect(page.labels).toEqual([]);expect(requests.labels).toHaveLength(2);page.ngOnDestroy();
  });
  it.each([['count',2],['schema','old'],['labels',null]])('rejects malformed %s instead of reporting an empty catalogue', (field,value) => {
    const {page,requests}=setup();requests.labels[0].next({...labels(),[field]:value});
    expect(page.labels).toEqual([]);expect(page.loadError).toBeTruthy();page.ngOnDestroy();
  });
  it('retires pending reads on destruction', () => {
    const {page,requests}=setup();page.ngOnDestroy();
    expect(requests.labels[0].observed).toBe(false);expect(requests.audit[0].observed).toBe(false);
  });
  it('preserves successful labels while reporting a foreign audit response as unavailable', () => {
    const {page,requests}=setup();requests.labels[0].next(labels());requests.audit[0].next(audit('mainnet'));
    expect(page.labels).toHaveLength(1);expect(page.auditLog).toEqual([]);expect(page.auditError).toBeTruthy();page.ngOnDestroy();
  });
  it('bounds unresolved reads, then retries with fresh request context', () => {
    vi.useFakeTimers();const {page,requests}=setup();
    try {vi.advanceTimersByTime(10001);expect(page.loadError).toBeTruthy();expect(page.auditError).toBeTruthy();
      page.reload();expect(requests.labels).toHaveLength(2);requests.labels[1].next(labels());requests.audit[1].next(audit());
      expect(page.labels).toHaveLength(1);expect(page.loadError).toBeNull();expect(page.auditError).toBeNull();
    } finally {page.ngOnDestroy();vi.useRealTimers();}
  });
  it('does not create executable links for non-web reference schemes', () => {
    const {page}=setup();expect(page.referenceHref('javascript:alert(1)')).toBeNull();expect(page.referenceHref('urn:controlled:proof')).toBeNull();page.ngOnDestroy();
  });
});
