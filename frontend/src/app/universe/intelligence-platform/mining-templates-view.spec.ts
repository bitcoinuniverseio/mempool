// @vitest-environment jsdom
import 'zone.js';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { MiningTemplatesComponent } from './mining-templates.component';

function observed() {
  const source = { source_id: 'src-core-gbt', name: 'Bitcoin Core getblocktemplate', source_type: 'core_gbt', endpoint: null, software_version: null, status: 'offline', last_template_at: '2026-10-04T19:00:00Z', last_error: 'Owned source temporarily unavailable' };
  const context = { schema: 'universe-template-observation-context-v1', chain: 'bitcoin', network: 'signet', genesis_hash: 'c'.repeat(64), block_one_hash: 'd'.repeat(64), signet_challenge: '51', checkpoint: { height: 3187, block_hash: 'a'.repeat(64) }, observed_at_utc: '2026-10-04T19:00:00Z', provenance: 'bitcoin-core-gbt', input_core_template_id: null };
  const template = (id: string) => ({ configured_network: 'signet', observation_context: context, weight_basis: 'core-transaction-weights', estimated_weight: null, txids_returned_count: 0, txids_truncated: false, template_id: id, source_id: source.source_id, source_name: source.name, source_type: source.source_type, height: 3188, prev_block_hash: 'a'.repeat(64), tx_count: 0, total_weight: 1, total_fees_sats: 1, sigops_count: null, coinbase_value_sats: null, fingerprint_hash: 'b'.repeat(64), observed_at_utc: '2026-10-04T19:00:00Z', txids: [] });
  return { configured_network: 'signet', current_observation_context: context, sources_count: 1, candidate_templates_count: 2, sources: [source], latest_templates: [template('tmpl-core-3188-1'), template('tmpl-core-3188-2')] };
}

describe('Mining template actual consumer view', () => {
  beforeAll(() => {
    Object.defineProperty(MiningTemplatesComponent, 'ctorParameters', { configurable: true, value: () => [{ type: IntelligenceApiService }, { type: ChangeDetectorRef }, { type: StateService }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());
  function render(unavailable = false, value: any = observed()) {
    const diffTemplates$ = vi.fn(() => of({ observation_context_a: observed().latest_templates[0].observation_context, observation_context_b: observed().latest_templates[0].observation_context, comparison_context: 'same-observed-context', template_a_id: 'tmpl-core-3188-2', template_b_id: 'tmpl-core-3188-1', height: 3188, similarity_score: 0, added_to_b: [], removed_from_b: [], reordered_count: 0, fee_delta_sats: 0, weight_delta: 0, explanation: 'No transaction IDs observed in these two retained templates.' }));
    TestBed.configureTestingModule({ providers: [{ provide: IntelligenceApiService, useValue: { getTemplateOverview$: () => unavailable ? throwError(() => new Error('Owned source unavailable')) : of(value), diffTemplates$ } }, { provide: StateService, useValue: { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() } }] });
    const fixture = TestBed.createComponent(MiningTemplatesComponent); fixture.detectChanges(); return { fixture, diffTemplates$ };
  }
  it('renders exact one-satoshi fees, reported WU and observed offline status without inventing active software', () => {
    const { fixture } = render(); const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('0 reported active / 1 configured sources'); expect(element.textContent).toContain('0.00000001 BTC'); expect(element.textContent).toContain('1 WU'); expect(element.textContent).toContain('Software version not reported');
    expect(element.querySelector('.badge-danger')?.textContent).toContain('OFFLINE'); expect(element.textContent).toContain('Observed genesis:'); expect(element.textContent).toContain('not an independent operator profile');
    expect(element.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Collected mining templates');
  });
  it('submits the two template IDs actually chosen through native select controls', async () => {
    const { fixture, diffTemplates$ } = render(); const element = fixture.nativeElement as HTMLElement;
    const a = element.querySelector('#templateA') as HTMLSelectElement, b = element.querySelector('#templateB') as HTMLSelectElement;
    a.value = 'tmpl-core-3188-2'; a.dispatchEvent(new Event('change')); b.value = 'tmpl-core-3188-1'; b.dispatchEvent(new Event('change')); await fixture.whenStable(); fixture.detectChanges();
    const button = [...element.querySelectorAll('button')].find(node => node.textContent.includes('Diff Selected Templates')) as HTMLButtonElement; button.click(); fixture.detectChanges();
    expect(diffTemplates$).toHaveBeenCalledWith('tmpl-core-3188-2', 'tmpl-core-3188-1'); expect(element.textContent).toContain('Template B minus template A');
  });
  it('displays unavailable source as an alert instead of an empty active template directory', () => {
    const { fixture } = render(true); const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('unavailable'); expect(element.querySelectorAll('tbody tr')).toHaveLength(0); expect(element.textContent).not.toContain('Template Sources Active');
  });
  it('renders nullable projection weight as an explicit estimate and missing Core association as not reported', () => {
    const value: any = observed(); const source = { ...value.sources[0], source_id: 'src-projection', name: 'Backend projection', source_type: 'mempool_projection' }; value.sources.push(source); value.sources_count++;
    Object.assign(value.latest_templates[1], { source_id: source.source_id, source_name: source.name, source_type: source.source_type, total_weight: null, estimated_weight: 4, weight_basis: 'vsize-derived-estimate', observation_context: { ...value.current_observation_context, provenance: 'backend-mempool-projection', input_core_template_id: null } });
    const { fixture } = render(false,value); const text = fixture.nativeElement.textContent; expect(text).toContain('4 WU (vsize-derived estimate; measured weight unavailable)'); expect(text).toContain('Core template input: Not reported'); expect(text).toContain('Non-coinbase transaction weight');
  });
  it('retains historical templates while current chain identity is unavailable without labeling them current', () => {
    const value: any = observed(); value.current_observation_context = null; const { fixture } = render(false,value); const text = fixture.nativeElement.textContent;
    expect(text).toContain('Current observed chain identity unavailable'); expect(text).toContain('Retained templates may have historical observations'); expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('discloses incomplete browser membership for a source comparison with more than 5000 transactions', () => {
    const value: any = observed(); const txids = Array.from({ length: 5000 }, (_,i) => i.toString(16).padStart(64,'0')); for (const t of value.latest_templates) { Object.assign(t,{ tx_count: 5001, txids: [...txids], txids_returned_count: 5000, txids_truncated: true }); }
    const { fixture } = render(false,value); const page = fixture.componentInstance; page.selectedTemplateA = 'tmpl-core-3188-2'; page.selectedTemplateB = 'tmpl-core-3188-1'; page.compareActiveTemplates(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Full transaction membership unavailable to this browser'); expect(fixture.nativeElement.textContent).toContain('local set verification is partial');
  });

});
