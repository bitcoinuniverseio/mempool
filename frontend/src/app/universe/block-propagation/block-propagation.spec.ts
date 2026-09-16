import { describe, expect, it, vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { convertToParamMap } from '@angular/router';
import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { BlockPropagationApiService, branchVerdict } from './block-propagation.service';
import { BlockPropagationBlockDetailComponent } from './block-propagation-block-detail.component';
import { BlockPropagationRaceDetailComponent } from './block-propagation-race-detail.component';
import { BlockPropagationLiveComponent } from './block-propagation-live.component';
import { BlockPropagationStaleTipsComponent } from './block-propagation-stale-tips.component';
import { BlockPropagationFibreComponent } from './block-propagation-fibre.component';
import { BlockPropagationCompactBlocksComponent } from './block-propagation-compact-blocks.component';
import { BlockPropagationForkRacesComponent } from './block-propagation-fork-races.component';
import { BlockPropagationOverviewComponent } from './block-propagation-overview.component';

const hash = 'ab'.repeat(32), other = 'cd'.repeat(32);
const state = { networkChanged$: of('regtest') };
const compact = { block_hash: hash, height: 1, bip152_version: 2, prefilled_tx_count: 1,
  short_id_count: 2, missing_tx_count: 1, collision_count: 0, reconstruction_success: false,
  merkle_root_verified: false, witness_commitment_verified: false, full_block_fallback: true };
const fibre = { block_hash: hash, height: 1, fibre_delivery_time_ms: 200, bip152_delivery_time_ms: 100,
  chunk_count: 3, chunk_loss_pct: 25, fec_recovery_succeeded: false, time_saved_ms: -100 };
const branch = (tip: string) => ({ branch_id: tip.slice(0, 2), tip_block_hash: tip, tip_height: 1,
  accumulated_work: '100', status: 'competing_block_observed', first_observed_sensor_id: 'sensor-a', first_observed_utc: '2026-09-15T00:00:00Z' });
const race = { race_id: 'race-real-shape', divergence_height: 1, discovered_at_utc: '2026-09-15T00:00:00Z',
  resolution_status: 'resolved_to_most_work', winning_tip_hash: other, branches: [branch(hash), branch(other)], notes: [] };
function apiFor(response: unknown) { return new BlockPropagationApiService({ get: () => of(response) } as never, state as never); }

describe('propagation backend response contracts', () => {
  it('unwraps compact_blocks and preserves failed reconstruction verdicts', async () => {
    const api = apiFor({ compact_blocks: [compact] });
    expect(await firstValueFrom(api.getCompactBlocks$())).toEqual([compact]);
    const page = new BlockPropagationCompactBlocksComponent(api); page.ngOnInit();
    expect(page.compactBlocks?.[0].reconstruction_success).toBe(false); page.ngOnDestroy();
  });
  it('unwraps fork_races and identifies the winning hash instead of choosing first branch', async () => {
    const api = apiFor({ fork_races: [race] }); const result = await firstValueFrom(api.getForkRaces$());
    expect(branchVerdict(result[0], result[0].branches[0])).not.toContain('winning');
    expect(branchVerdict(result[0], result[0].branches[1])).toBe('Source-reported winning tip');
    expect(branchVerdict({ ...result[0], resolution_status: 'unresolved' }, result[0].branches[1])).not.toContain('winning');
    const page = new BlockPropagationForkRacesComponent(api); page.ngOnInit(); expect(page.forkRaces?.length).toBe(1); page.ngOnDestroy();
  });
  it('preserves slower FIBRE delivery and failed FEC without inventing mesh health', () => {
    const page = new BlockPropagationFibreComponent(apiFor({ fibre_observations: [fibre] })); page.ngOnInit();
    expect(page.fibre?.[0].time_saved_ms).toBe(-100); expect(page.fibre?.[0].fec_recovery_succeeded).toBe(false); page.ngOnDestroy();
  });
  it('rejects old bare arrays and missing boolean verdicts', async () => {
    await expect(firstValueFrom(apiFor([compact]).getCompactBlocks$())).rejects.toThrow('Malformed');
    await expect(firstValueFrom(apiFor({ compact_blocks: [{ ...compact, reconstruction_success: undefined }] }).getCompactBlocks$())).rejects.toThrow('Malformed');
  });
  it('rejects race responses for a different request ID', async () => {
    await expect(firstValueFrom(apiFor(race).getForkRace$('different'))).rejects.toThrow('Malformed');
  });
  it('does not promote arbitrary live/stale-tip HTTP200 to observation evidence', async () => {
    await expect(firstValueFrom(apiFor({ live_blocks: [] }).getLive$())).rejects.toThrow('contract');
    await expect(firstValueFrom(apiFor([]).getStaleTips$())).rejects.toThrow('contract');
  });
});

describe('propagation error and cancellation boundaries', () => {
  const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));
  it('all eight original reads display source failure outside data states', () => {
    const api = { getOverview$: unavailable, getLive$: unavailable, getBlock$: unavailable, getCompactBlocks$: unavailable,
      getForkRaces$: unavailable, getForkRace$: unavailable, getStaleTips$: unavailable, getFibre$: unavailable } as never;
    const route = { paramMap: of(convertToParamMap({ blockHash: hash, raceId: 'race-real-shape' })) } as never;
    const pages = [new BlockPropagationOverviewComponent(api), new BlockPropagationLiveComponent(api), new BlockPropagationBlockDetailComponent(route, api),
      new BlockPropagationCompactBlocksComponent(api), new BlockPropagationForkRacesComponent(api), new BlockPropagationRaceDetailComponent(route, api),
      new BlockPropagationStaleTipsComponent(api), new BlockPropagationFibreComponent(api)];
    for (const page of pages) { page.ngOnInit(); expect(page.loading).toBe(false); expect(page.loadError).toBe('The service behind this panel is unavailable.'); page.ngOnDestroy(); }
  });
  it('route and network changes immediately clear detail and cancel previous requests', () => {
    const params = new Subject<any>(), networks = new Subject<string>(), response = new Subject<any>();
    const api = { networkChanged$: networks, getForkRace$: vi.fn(() => response) };
    const page = new BlockPropagationRaceDetailComponent({ paramMap: params } as never, api as never);
    page.ngOnInit(); networks.next('regtest'); params.next(convertToParamMap({ raceId: 'one' }));
    response.next(race); expect(page.race).toEqual(race);
    params.next(convertToParamMap({ raceId: 'two' })); expect(page.race).toBeNull(); expect(page.loading).toBe(true);
    response.next(race); networks.next('signet'); expect(page.race).toBeNull(); expect(api.getForkRace$).toHaveBeenCalledTimes(3);
    page.ngOnDestroy(); expect(response.observed).toBe(false); expect(params.observed).toBe(false); expect(networks.observed).toBe(false);
  });
  it('does not substitute a fabricated block hash when route parameter is absent', () => {
    const get = vi.fn(); const api = new BlockPropagationApiService({ get } as never, state as never);
    const page = new BlockPropagationBlockDetailComponent({ paramMap: of(convertToParamMap({})) } as never, api);
    page.ngOnInit(); expect(get).not.toHaveBeenCalled(); expect(page.block).toBeNull(); expect(page.loadError).toBeTruthy(); page.ngOnDestroy();
  });
});
