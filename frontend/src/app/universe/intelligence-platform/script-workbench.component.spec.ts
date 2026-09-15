import { ChangeDetectorRef, provideZonelessChangeDetection } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { ScriptWorkbenchComponent } from './script-workbench.component';

function setup() {
  const network = new Subject<string>();
  const pending = new Subject<any>();
  const api = { analyzeScript$: vi.fn(() => pending), parseDescriptor$: vi.fn(() => pending), analyzePsbt$: vi.fn(() => pending) };
  const http = { post: vi.fn(() => pending) };
  const component = new ScriptWorkbenchComponent(api as unknown as IntelligenceApiService,
    { markForCheck: vi.fn() } as unknown as ChangeDetectorRef,
    { networkChanged$: network } as unknown as StateService, http as unknown as HttpClient);
  component.ngOnInit();
  return { component, network, pending, api, http };
}

describe('Workbench result ownership', () => {
  it('clears edited results and ignores an older request after another submission', () => {
    const { component, pending, api } = setup();
    component.scriptInput = '51';
    component.analyzeScript();
    const second = new Subject<any>();
    api.analyzeScript$.mockReturnValue(second);
    component.scriptInput = '52';
    component.analyzeScript();
    pending.next({ asm: 'old' });
    expect(component.scriptResult).toBeNull();
    expect(component.loading).toBe(true);
    second.next({ asm: '2', op_count: 0, is_standard: null });
    expect(component.scriptResult.asm).toBe('2');
    component.invalidateResults();
    expect(component.scriptResult).toBeNull();
    second.next({ asm: 'late' });
    expect(component.scriptResult).toBeNull();
    component.ngOnDestroy();
  });

  it('clears every result on network change, failure, samples and component destruction', () => {
    const { component, pending, network, api } = setup();
    component.psbtInput = 'payload';
    component.inspectPsbt();
    network.next('signet');
    pending.next({ input_count: 99 });
    expect(component.psbtResult).toBeNull();
    expect(component.loading).toBe(false);
    api.analyzePsbt$.mockReturnValue(throwError(() => ({ error: { error: 'Malformed PSBT' } })) as any);
    component.psbtResult = { input_count: 1 };
    component.inspectPsbt();
    expect(component.loadError).toBe('Malformed PSBT');
    expect(component.psbtResult).toBeNull();
    component.loadSamplePsbt();
    expect(component.loadError).toBeNull();
    component.ngOnDestroy();
    expect(pending.observed).toBe(false);
  });

  it('submits actual compiler and simulation contracts without inventing results', () => {
    const { component, http, pending } = setup();
    component.scriptInput = '51'; component.witnessInput = '01\n02'; component.simulate();
    expect(http.post).toHaveBeenLastCalledWith('/api/v1/intelligence/workbench/script/simulate', { script_hex: '51', witness: ['01', '02'] });
    expect(component.simulationResult).toBeNull();
    pending.error({ error: { error: 'Script engine unavailable' } });
    expect(component.loadError).toBe('Script engine unavailable');
    http.post.mockReturnValue(of({ miniscript: 'pk(key)', scope: 'Compile only' }) as any);
    component.policyInput = 'pk(key)'; component.compile();
    expect(http.post).toHaveBeenLastCalledWith('/api/v1/intelligence/workbench/miniscript/compile', { policy: 'pk(key)' });
    expect(component.compileResult.scope).toBe('Compile only');
    component.ngOnDestroy();
  });
});

async function render(tab: string, result: any): Promise<string> {
  return renderApplication(async context => {
    const app = await bootstrapApplication(ScriptWorkbenchComponent, { providers: [
      provideZonelessChangeDetection(),
      { provide: IntelligenceApiService, useValue: {} },
      { provide: StateService, useValue: { networkChanged$: new Subject<string>() } },
      { provide: HttpClient, useValue: {} },
    ] }, context);
    const component = app.components[0].instance as ScriptWorkbenchComponent;
    component.activeTab = tab;
    if (tab === 'script') component.scriptResult = result;
    if (tab === 'descriptor' || tab === 'taproot') component.descriptorResult = result;
    if (tab === 'simulate') component.simulationResult = result;
    if (tab === 'psbt') component.psbtResult = result;
    app.components[0].changeDetectorRef.detectChanges();
    return app;
  }, { document: '<html><body><app-script-workbench></app-script-workbench></body></html>', url: 'http://localhost/', allowedHosts: ['localhost'] });
}

describe('Workbench rendered contract labels', () => {
  it('renders a failed native trace and its execution scope', async () => {
    const html = await render('simulate', { completed: true, script_succeeded: false, error: 'OP_VERIFY failed', scope: 'Standalone execution only', steps: [] });
    expect(html).toContain('Standalone script failed'); expect(html).toContain('OP_VERIFY failed'); expect(html).toContain('Standalone execution only');
  });

  it('renders actual Taproot leaves and commitment scope', async () => {
    const html = await render('taproot', { is_valid: true, script_type: 'p2tr', derived_samples: [], taproot_trees: [{ branch: 0, index: 0, internal_key: 'internal', output_key: 'output', merkle_root: 'root', scope: 'Commitments only', leaves: [{ depth: 1, miniscript: 'pk(public)', leaf_hash: 'leaf', script_hex: 'script', control_block: 'control', commitment_verified: true }] }] });
    expect(html).toContain('Control-block commitment verified'); expect(html).toContain('Commitments only'); expect(html).toContain('>leaf<');
    expect(html).not.toContain('awaiting tree evidence');
  });
  it('renders unknown standardness and the actual opcode count', async () => {
    const html = await render('script', { is_standard: null, op_count: 7, asm: 'OP_CHECKSIG', script_type: 'pubkey', analysis_scope: 'Disassembly only', malleability_warnings: ['No spending transaction evaluated'] });
    expect(html).toContain('Not evaluated'); expect(html).toContain('>7<');
    expect(html).toContain('Disassembly only'); expect(html).toContain('No spending transaction evaluated');
    expect(html).not.toContain('Non-Standard');
    expect(html).toContain('Stack execution'); expect(html).toContain('Miniscript'); expect(html).toContain('Taproot tree');
  });

  it('renders real descriptor validity and derivation', async () => {
    const html = await render('descriptor', { is_valid: true, script_type: 'p2wpkh', checksum: 'checksum', derived_samples: [{ index: 0, address: 'derived-by-core', script_pub_key: '0014' }] });
    expect(html).toContain('Valid Descriptor'); expect(html).toContain('p2wpkh'); expect(html).toContain('derived-by-core');
  });

  it('renders null fees as unknown and structural finalization without chain validation', async () => {
    const html = await render('psbt', { input_count: 2, output_count: 3, total_fee_sats: null, is_complete: true, completion_scope: 'Structural finalization only', warnings: ['Input availability not checked'] });
    expect(html).toContain('>2<'); expect(html).toContain('>3<'); expect(html).toContain('Unknown');
    expect(html).toContain('Final scripts present'); expect(html).toContain('Structural finalization only');
    expect(html).toContain('Input availability not checked'); expect(html).toContain('Chain validation: Not evaluated');
    expect(html).not.toContain('Pending Signatures');
  });
});
