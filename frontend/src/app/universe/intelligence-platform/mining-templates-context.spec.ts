import { describe, expect, it, vi } from 'vitest';
import { ReplaySubject, Subject } from 'rxjs';
import { MiningTemplatesComponent } from './mining-templates.component';

function fixture() {
  const source = { source_id: 'src-core-gbt', name: 'Bitcoin Core getblocktemplate', source_type: 'core_gbt', endpoint: 'rpc://owned-source', software_version: null, status: 'active', last_template_at: '2026-10-04T19:00:00Z', last_error: null };
  const context = { schema: 'universe-template-observation-context-v1', chain: 'bitcoin', network: 'signet', genesis_hash: 'c'.repeat(64), block_one_hash: 'd'.repeat(64), signet_challenge: '51', checkpoint: { height: 3187, block_hash: 'a'.repeat(64) }, observed_at_utc: '2026-10-04T19:00:00Z', provenance: 'bitcoin-core-gbt', input_core_template_id: null };
  const template = (id: string) => ({ configured_network: 'signet', observation_context: context, weight_basis: 'core-transaction-weights', estimated_weight: null, txids_returned_count: 0, txids_truncated: false, template_id: id, source_id: source.source_id, source_name: source.name, source_type: source.source_type, height: 3188, prev_block_hash: 'a'.repeat(64), tx_count: 0, total_weight: 0, total_fees_sats: 1, sigops_count: null, coinbase_value_sats: null, fingerprint_hash: 'b'.repeat(64), observed_at_utc: '2026-10-04T19:00:00Z', txids: [] });
  return { configured_network: 'signet', current_observation_context: context, sources_count: 1, candidate_templates_count: 2, sources: [source], latest_templates: [template('tmpl-core-3188-1'), template('tmpl-core-3188-2')] };
}
function setup(replayInitial = false) {
  const networkChanged$ = replayInitial ? new ReplaySubject<string>(1) : new Subject<string>();
  if (replayInitial) { networkChanged$.next(''); }
  const state: any = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$ };
  const overview = new Subject<any>(), replacement = new Subject<any>(), diff = new Subject<any>();
  const api: any = { getTemplateOverview$: vi.fn().mockReturnValueOnce(overview).mockReturnValue(replacement), diffTemplates$: vi.fn(() => diff) };
  const page: any = new (MiningTemplatesComponent as any)(api, { markForCheck: () => {} }, state);
  page.ngOnInit(); return { page, state, overview, replacement, diff, api };
}
function selected(page: any) { const f = fixture(); page.selectedTemplateA = f.latest_templates[0].template_id; page.selectedTemplateB = f.latest_templates[1].template_id; }
function delta() { const context = fixture().latest_templates[0].observation_context; return { observation_context_a: context, observation_context_b: context, comparison_context: 'same-observed-context', template_a_id: 'tmpl-core-3188-1', template_b_id: 'tmpl-core-3188-2', height: 3188, similarity_score: 0, added_to_b: [], removed_from_b: [], reordered_count: 0, fee_delta_sats: 0, weight_delta: 0, explanation: 'Same observed parent.' }; }

describe('Mining template consumer context and captured comparison', () => {
  it('does not issue duplicate initial reads for the actual replayed network signal', () => {
    const { page, api, overview, state } = setup(true); expect(api.getTemplateOverview$).toHaveBeenCalledTimes(1);
    overview.next(fixture()); state.networkChanged$.next(''); expect(page.overview).not.toBeNull(); expect(api.getTemplateOverview$).toHaveBeenCalledTimes(1); page.ngOnDestroy();
  });
  it('releases a stalled transport and restores explicit retry without changing the selected source', () => {
    vi.useFakeTimers(); const { page, overview, replacement } = setup();
    try { vi.advanceTimersByTime(15000); expect(overview.observed).toBe(false); expect(page.loadingOverview).toBe(false); expect(page.overviewError).toMatch(/unavailable/); page.refresh(); replacement.next(fixture()); expect(page.overview).not.toBeNull(); } finally { page.ngOnDestroy(); vi.useRealTimers(); }
  });
  it('cancels pending old-context overview and clears observations on selected network change', () => {
    const { page, state, overview, api } = setup(); state.network = 'testnet4'; state.networkChanged$.next('testnet4'); overview.next(fixture());
    expect(api.getTemplateOverview$).toHaveBeenCalledTimes(2); expect(page.overview).toBeNull(); page.ngOnDestroy();
  });
  it('clears prior differences before an actual failed replacement and exposes retryable failure', () => {
    const { page, overview, diff } = setup(); overview.next(fixture()); selected(page); page.activeDiff = delta(); page.compareActiveTemplates();
    expect(page.activeDiff).toBeNull(); diff.error(new Error('native unavailable')); expect(page.loadingDiff).toBe(false); expect(page.diffError).toMatch(/unavailable|failed/i); page.ngOnDestroy();
  });
  it('rejects a response for a different pair instead of publishing its result', () => {
    const { page, overview, diff } = setup(); overview.next(fixture()); selected(page); page.compareActiveTemplates(); diff.next({ ...delta(), template_b_id: 'tmpl-core-3188-foreign' });
    expect(page.activeDiff).toBeNull(); expect(page.diffError).toMatch(/match|identity/i); page.ngOnDestroy();
  });
  it('cancels comparison when selected inputs change', () => {
    const { page, overview, diff } = setup(); overview.next(fixture()); selected(page); page.compareActiveTemplates(); page.selectedTemplateB = 'tmpl-core-3188-1';
    expect(typeof page.invalidateDiff).toBe('function'); page.invalidateDiff(); diff.next(delta()); expect(page.activeDiff).toBeNull(); expect(page.loadingDiff).toBe(false); page.ngOnDestroy();
  });
  it('rejects malformed overview before rendering', () => {
    const { page, overview } = setup(); overview.next({ ...fixture(), sources: { forged: true } });
    expect(page.overview).toBeNull(); expect(page.overviewError).toMatch(/shape|invalid|match|observations/i); page.ngOnDestroy();
  });
  it('preserves one-satoshi fees and native weight units without guessed monetary rounding', () => {
    const { page } = setup(); expect(typeof page.formatFees).toBe('function'); expect(page.formatFees(1)).toBe('0.00000001 BTC'); expect(page.formatWeight(1)).toBe('1 WU (basis unavailable)'); expect(page.formatFees(null)).toBe('Not reported'); page.ngOnDestroy();
  });
  it('uses the explicitly selected order once and rejects a different parent before I/O', () => {
    const { page, overview, api } = setup(); const value = fixture(); value.latest_templates.push({ ...value.latest_templates[0], template_id: 'tmpl-core-3188-3', prev_block_hash: 'c'.repeat(64), observation_context: { ...value.latest_templates[0].observation_context, checkpoint: { height: 3187, block_hash: 'c'.repeat(64) } } }); value.candidate_templates_count = 3;
    overview.next(value); page.selectedTemplateA = 'tmpl-core-3188-2'; page.selectedTemplateB = 'tmpl-core-3188-1'; page.compareActiveTemplates();
    expect(api.diffTemplates$).toHaveBeenCalledWith('tmpl-core-3188-2', 'tmpl-core-3188-1'); page.compareActiveTemplates(); expect(api.diffTemplates$).toHaveBeenCalledTimes(1);
    page.invalidateDiff(); page.selectedTemplateB = 'tmpl-core-3188-3'; page.compareActiveTemplates(); expect(api.diffTemplates$).toHaveBeenCalledTimes(1); expect(page.diffError).toMatch(/parents/); page.ngOnDestroy();
  });
  it('recovers from a malformed overview with a fresh correctly shaped read and never auto-compares', () => {
    const { page, overview, replacement, api } = setup(); overview.next({ ...fixture(), sources_count: 99 }); expect(page.overview).toBeNull();
    page.refresh(); replacement.next(fixture()); expect(page.overview.latest_templates).toHaveLength(2); expect(page.overviewError).toBeNull(); expect(page.activeSourceCount).toBe(1); expect(api.diffTemplates$).not.toHaveBeenCalled(); page.ngOnDestroy();
  });
  it('releases current reads and clears private differences on destruction', () => {
    const { page, overview, diff, state, api } = setup(); overview.next(fixture()); selected(page); page.compareActiveTemplates(); page.ngOnDestroy();
    diff.next(delta()); state.network = 'testnet4'; state.networkChanged$.next('testnet4'); expect(page.activeDiff).toBeNull(); expect(page.loadingDiff).toBe(false); expect(api.getTemplateOverview$).toHaveBeenCalledTimes(1);
  });
  it('publishes a correctly captured difference and rejects inconsistent reported units on retry', () => {
    const { page, overview, diff } = setup(); overview.next(fixture()); selected(page); page.compareActiveTemplates(); diff.next(delta()); expect(page.activeDiff.template_a_id).toBe('tmpl-core-3188-1');
    page.compareActiveTemplates(); diff.next({ ...delta(), fee_delta_sats: 0.5 }); expect(page.activeDiff).toBeNull(); expect(page.diffError).toMatch(/match/); page.ngOnDestroy();
  });
  it('retains distinct configured versus active status and rejects unsafe numeric amounts', () => {
    const { page, overview } = setup(); const value = fixture(); value.sources[0].status = 'offline'; overview.next(value); expect(page.activeSourceCount).toBe(0); expect(page.overview.sources).toHaveLength(1);
    for (const amount of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) { expect(page.formatFees(amount)).toBe('Not reported'); expect(page.formatWeight(amount)).toBe('Not reported'); } page.ngOnDestroy();
  });
});

describe('Mining templates observed identity and weight boundaries', () => {
  it('rejects foreign configured and observed networks, then recovers a fresh selected-context read', () => {
    const { page, overview, replacement } = setup(); overview.next({ ...fixture(), configured_network: 'mainnet' }); expect(page.overview).toBeNull();
    page.refresh(); const value = fixture(); value.latest_templates[0].observation_context.network = 'mainnet'; replacement.next(value); expect(page.overview).toBeNull(); expect(page.overviewError).toMatch(/invalid|match/); page.ngOnDestroy();
  });
  it('retains unbound legacy templates with unavailable numeric comparison instead of inventing context', () => {
    const { page, overview, diff } = setup(); const value: any = fixture(); value.current_observation_context = null; for (const t of value.latest_templates) { t.observation_context = null; }
    overview.next(value); selected(page); page.compareActiveTemplates(); diff.next({ ...delta(), observation_context_a: null, observation_context_b: null, comparison_context: 'unavailable', fee_delta_sats: null, weight_delta: null }); expect(page.activeDiff.comparison_context).toBe('unavailable'); expect(page.activeDiff.fee_delta_sats).toBeNull(); page.ngOnDestroy();
  });
  it('never converts projection estimate to measured transaction weight or measured weight delta', () => {
    const { page, overview, diff } = setup(); const value: any = fixture(); const source = { ...value.sources[0], source_id: 'src-mempool', name: 'Backend projection', source_type: 'mempool_projection' }; value.sources.push(source); value.sources_count++;
    Object.assign(value.latest_templates[1], { source_id: source.source_id, source_name: source.name, source_type: source.source_type, total_weight: null, estimated_weight: 400, weight_basis: 'vsize-derived-estimate', observation_context: { ...value.latest_templates[0].observation_context, provenance: 'backend-mempool-projection', input_core_template_id: null } });
    overview.next(value); expect(page.overview).not.toBeNull(); expect(page.formatWeight(null,400,'vsize-derived-estimate')).toContain('estimate; measured weight unavailable'); selected(page); page.compareActiveTemplates(); diff.next({ ...delta(), observation_context_b: value.latest_templates[1].observation_context, weight_delta: null }); expect(page.activeDiff.weight_delta).toBeNull(); page.ngOnDestroy();
  });
  it('rejects changed observation identity in a response and falsely numeric incomparable deltas', () => {
    const { page, overview, diff } = setup(); const value = fixture(); value.latest_templates[1].observation_context.signet_challenge = '52'; overview.next(value); selected(page); page.compareActiveTemplates();
    diff.next({ ...delta(), observation_context_b: value.latest_templates[1].observation_context, comparison_context: 'different-observed-context', fee_delta_sats: 0, weight_delta: 0 }); expect(page.activeDiff).toBeNull(); expect(page.diffError).toMatch(/match/); page.ngOnDestroy();
  });
  it('rejects truncated-ID and checkpoint-parent inconsistencies without publishing observations', () => {
    for (const change of [(v: any) => { v.latest_templates[0].txids_returned_count = 1; }, (v: any) => { v.latest_templates[0].observation_context.checkpoint.block_hash = 'f'.repeat(64); }]) {
      const { page, overview } = setup(); const v = fixture(); change(v); overview.next(v); expect(page.overview).toBeNull(); page.ngOnDestroy();
    }
  });
  it('accepts genuine bounded source differences beyond the truncated overview membership with explicit partial verification', () => {
    const { page, overview, diff } = setup(); const value = fixture(); const txids = Array.from({ length: 5000 }, (_,i) => i.toString(16).padStart(64,'0'));
    for (const t of value.latest_templates) { Object.assign(t, { tx_count: 5001, txids: [...txids], txids_returned_count: 5000, txids_truncated: true }); }
    overview.next(value); selected(page); page.compareActiveTemplates(); diff.next({ ...delta(), added_to_b: ['f'.repeat(64)], removed_from_b: ['e'.repeat(64)] }); expect(page.activeDiff).not.toBeNull(); expect(page.diffMembershipPartial).toBe(true); page.ngOnDestroy();
  });

});
