import { ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapPlannerComponent } from './bootstrap-planner.component';
import { BootstrapApiService, NodeBootstrapPlan } from './bootstrap.service';

function planner(api: Partial<BootstrapApiService>): BootstrapPlannerComponent {
  return new BootstrapPlannerComponent({ network: 'signet', networkChanged$: new BehaviorSubject('signet'), ...api } as unknown as BootstrapApiService, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
}

const measuredPlan: NodeBootstrapPlan = {
  plan_id: 'plan-1',
  network: 'signet',
  node_id: 'core-1',
  node_version: '29.0.0',
  target_height: 10,
  measurement_status: 'measured',
  measured: {
    node_observed_at: '2026-09-17T00:00:00.000Z',
    current_phase: 'traditional_ibd',
    tip_height: 5,
    headers: 12,
    blocks_on_disk_bytes: 1073741824,
    capacity: { method: 'statfs', measured_at: '2026-09-17T00:00:00.000Z', free_bytes: 10737418240, total_bytes: null },
    supports_loadtxoutset: true,
  },
  selected_snapshot: { snapshot_id: 'signet-10', height: 10, block_hash: 'aa'.repeat(32), core_version: '29.0.0', size_bytes: 2147483648, sha256: 'bb'.repeat(32), utxo_commitment: 'cc'.repeat(32), verification_id: 'run-1', verified_at: '2026-09-16T00:00:00.000Z' },
  requirements: { snapshot_file_bytes: 2147483648, chainstate_estimate_bytes: 2147483648, headroom_bytes: 429496729, required_bytes: 4724464025, free_bytes: 10737418240, feasible: true },
  assumptions: ['No bandwidth was declared, so no download time is estimated.'],
  caller_declared: { available_disk_gb: null, bandwidth_mbps: null, matches_measurement: null },
  estimates: { snapshot_download_hours: null, ibd_download_hours: null, basis: 'not estimated' },
  expected_transitions: ['snapshot_loading', 'snapshot_active_syncing_to_tip', 'background_validation', 'fully_validated'],
  actions_not_executed: ['loadtxoutset utxo-10.dat on core-1 through an authorized operator job'],
  rollback_instructions: ['Stop the node and remove the chainstate_snapshot directory.'],
  created_at: '2026-09-17T00:00:01.000Z',
};

describe('bootstrap planner source failures', () => {
  it('does not fabricate a projection when the owned planner is unavailable', () => {
    const component = planner({ generateBootstrapPlan$: () => throwError(() => ({ status: 503, error: { stage: 'unavailable-node-source', error: 'Bootstrap evidence is unavailable.' } })) });
    component.calculatePlan();
    expect(component.plan).toBeNull();
    expect(component.calculating).toBe(false);
    expect(component.failure).toBeTruthy();
    expect(component.rejection?.stage).toBe('unavailable-node-source');
    expect(component.rejectionTitle(component.rejection!)).toBe('Planning source unavailable');
  });

  it('clears a previous failure while retrying and rejects a projection that is not a measured plan', () => {
    const response = new Subject<unknown>();
    const component = planner({ generateBootstrapPlan$: vi.fn()
      .mockReturnValueOnce(throwError(() => ({ status: 503 })))
      .mockReturnValueOnce(response) });
    component.calculatePlan();
    component.calculatePlan();
    expect(component.failure).toBeNull();
    expect(component.plan).toBeNull();
    expect(component.calculating).toBe(true);
    const plan = { network: 'signet', measurement_status: 'measured', assumeutxo_ready_hours: 4, traditional_ibd_hours: 20, background_validation_hours: 25 };
    response.next(plan);
    response.complete();
    expect(component.plan).toBeNull();
    expect(component.failure).toContain('measured');
    expect(component.calculating).toBe(false);
  });
});

describe('bootstrap planner measured plans', () => {
  it('sends only declared inputs and renders the feasibility document without inventing hours', () => {
    const generateBootstrapPlan$ = vi.fn(() => of(measuredPlan));
    const component = planner({ generateBootstrapPlan$ });
    component.calculatePlan();
    expect(generateBootstrapPlan$).toHaveBeenCalledWith({});
    expect(component.plan?.plan_id).toBe('plan-1');
    expect(component.rejection).toBeNull();
    expect(component.hours(null)).toBe('not estimated');
    expect(component.hours(1.5)).toContain('assumed');
    expect(component.gb(measuredPlan.requirements.required_bytes)).toBe('4.40');
  });

  it('binds the plan to the requested height and network', () => {
    const wrongHeight = planner({ generateBootstrapPlan$: () => of({ ...measuredPlan, target_height: 11 }) });
    wrongHeight.targetHeight = 10;
    wrongHeight.bandwidthMbps = 100;
    wrongHeight.calculatePlan();
    expect(wrongHeight.plan).toBeNull();
    expect(wrongHeight.rejection?.message).toContain('network-bound');

    const wrongNetwork = planner({ generateBootstrapPlan$: () => of({ ...measuredPlan, network: 'mainnet' }) });
    wrongNetwork.calculatePlan();
    expect(wrongNetwork.plan).toBeNull();

    const sends = vi.fn(() => of(measuredPlan));
    const declared = planner({ generateBootstrapPlan$: sends });
    declared.targetHeight = 10;
    declared.availableDiskGb = 50;
    declared.bandwidthMbps = 100;
    declared.calculatePlan();
    expect(sends).toHaveBeenCalledWith({ target_height: 10, available_disk_gb: 50, bandwidth_mbps: 100 });
    expect(declared.plan?.plan_id).toBe('plan-1');
  });

  it.each([
    [409, 'no-compatible-snapshot', 'No compatible snapshot'],
    [409, 'snapshot-not-verified', 'not verified'],
    [409, 'insufficient-capacity', 'insufficient'],
    [409, 'chainstate-not-eligible', 'not eligible'],
    [409, 'stale-measurement', 'stale'],
    [404, 'node-not-observed', 'not observed'],
    [503, 'durable-store-unavailable', 'unavailable'],
  ])('renders the typed rejection %s %s', (status, stage, title) => {
    const component = planner({ generateBootstrapPlan$: () => throwError(() => ({ status, error: { stage, error: 'reason text' } })) });
    component.calculatePlan();
    expect(component.plan).toBeNull();
    expect(component.rejection).toEqual({ stage, httpStatus: status, message: 'reason text' });
    expect(component.rejectionTitle(component.rejection!)).toContain(title);
  });
});
