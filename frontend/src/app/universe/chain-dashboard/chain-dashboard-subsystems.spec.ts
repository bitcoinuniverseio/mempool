// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ChainDashboardComponent } from './chain-dashboard.component';
import { ChainDashboardView, ChainSubsystemHealth } from '../universe.types';

describe('chain dashboard subsystem readings', () => {
  const component = () => {
    const router = { url: '/dogecoin/dashboard' };
    const state = { network: '', env: {} };
    const instance = new ChainDashboardComponent(router as never, {} as never, {} as never, state as never);
    return instance as unknown as {
      viewModel(
        capability: null,
        view: ChainDashboardView | null,
        viewError: string | null,
        pendingPayload: null,
        pendingError: string | null,
        viewStale?: boolean
      ): {
        subsystems: readonly { id: string; stateLabel: string; tone: string; observed: string | null; reasons: readonly { code: string; text: string }[] }[];
        viewStale: boolean;
        viewObserved: string | null;
      };
    };
  };
  const view = (subsystems: ChainSubsystemHealth[]): ChainDashboardView =>
    ({
      chain: 'dogecoin', network: 'mainnet', subsystems, observedAt: new Date(Date.now() - 20_000).toISOString(),
      recentBlocks: null, buckets: null, fees: null, mempool: null, mining: null, tip: null, schemaVersion: 'x',
    } as unknown as ChainDashboardView);

  it('shows unknown evidence as Not stated, not as an outage, and lists attributed reasons', () => {
    const vm = component().viewModel(null, view([
      { id: 'address-history', state: 'unavailable', availability: 'unknown', reasonIds: ['address-reads-unverified'], observedAt: new Date(Date.now() - 5_000).toISOString() },
      { id: 'protocol-indexers', state: 'degraded', availability: 'degraded', reasonIds: ['dunes:authority-capability-disabled'] },
      { id: 'mempool', state: 'degraded', availability: 'degraded', reasonIds: ['bucket-view-timeout', 'pending-set-retained'], lastFailureKind: 'timeout', stale: true },
      { id: 'core-node', state: 'ready', reasonIds: [] },
    ]), null, null, null, true);
    const byId = new Map(vm.subsystems.map(row => [row.id, row]));
    expect(byId.get('address-history')).toMatchObject({ stateLabel: 'Not stated', tone: 'neutral' });
    expect(byId.get('address-history')?.reasons.map(r => r.code)).toEqual(['address-reads-unverified']);
    expect(byId.get('address-history')?.observed).toBeTruthy();
    expect(byId.get('protocol-indexers')?.reasons[0].text).toMatch(/^Dunes: /);
    expect(byId.get('mempool')?.reasons.map(r => r.code)).toEqual(['bucket-view-timeout', 'pending-set-retained']);
    // Legacy rows without the additive fields still read from their state.
    expect(byId.get('core-node')).toMatchObject({ stateLabel: 'Ready', tone: 'proven', reasons: [] });
    expect(vm.viewStale).toBe(true);
    expect(vm.viewObserved).toBeTruthy();
  });
});
