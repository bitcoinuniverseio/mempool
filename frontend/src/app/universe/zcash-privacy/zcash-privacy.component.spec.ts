import { describe, expect, it, vi } from 'vitest';
import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { ZcashPrivacyComponent, validZcashSummary } from './zcash-privacy.component';

function summary(): any {
  return {schema: 'zcash-node-accounting-v1', network: 'testnet', source: {implementation: 'zebra', genesis: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38', tipHash: 'a'.repeat(64), branchId: '76b809bb', nextBranchId: '76b809bb', observedAt: '2026-10-04T00:00:00Z'}, tipHeight: 42, nodeAccountedSupplyZat: '100000003', nodeAccountedSupplyZec: '1.00000003', totalShieldedSupplyZat: '3', shieldedPercentage: '0.00', totalCirculatingSupplyZat: null, historyStatus: 'unavailable', recentFlows: null, upgrades: [], pools: ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'].map((id, index) => ({id, balanceZat: index === 0 ? '100000000' : index === 3 ? '3' : '0', balanceZec: index === 0 ? '1.00000000' : index === 3 ? '0.00000003' : '0.00000000', percentageOfSupply: index === 0 ? '99.99' : '0.00', monitored: index === 0 || index === 3, shielded: ['sprout', 'sapling', 'orchard', 'ironwood'].includes(id), txCount: null}))};
}
function fixture(read: any) {
  const networkChanged$ = new Subject<string>();
  const component = new ZcashPrivacyComponent({getZcashPrivacySummary$: read} as any, {setTitle: () => {}} as any, {networkChanged$} as any);
  component.ngOnInit(); return {component, networkChanged$};
}
describe('Zcash observation consumer', () => {
  it('finds pools by identity and formats atomic values without Number rounding', () => {
    const {component} = fixture(vi.fn(() => of(summary())));
    const value = summary(); value.pools.reverse();
    expect(validZcashSummary(value)).toBe(true);
    expect(component.pool(value, 'orchard')?.balanceZec).toBe('0.00000003');
    expect(component.zec('9007199254740993')).toBe('90071992.54740993'); component.ngOnDestroy();
  });
  it.each(['duplicate', 'sum', 'foreignGenesis', 'inventedHistory', 'missingIronwood'])('rejects %s evidence', mutation => {
    const value = summary();
    if (mutation === 'duplicate') value.pools[5].id = 'sprout';
    if (mutation === 'sum') value.nodeAccountedSupplyZat = '100000004';
    if (mutation === 'foreignGenesis') value.source.genesis = 'b'.repeat(64);
    if (mutation === 'inventedHistory') value.recentFlows = [];
    if (mutation === 'missingIronwood') value.pools.pop();
    expect(validZcashSummary(value)).toBe(false);
  });
  it('recovers after source failure without ending network changes', async () => {
    const read = vi.fn().mockReturnValueOnce(throwError(() => ({status: 503, error: {error: 'Syncing'}}))).mockReturnValue(of(summary()));
    const {component, networkChanged$} = fixture(read);
    expect((await firstValueFrom(component.vm$)).kind).toBe('error');
    component.retry(); expect((await firstValueFrom(component.vm$)).kind).toBe('ready');
    networkChanged$.next('signet'); expect(read).toHaveBeenCalledTimes(3); component.ngOnDestroy();
  });
  it('cancels pending reads and clears the old view on context change and destruction', async () => {
    const first = new Subject<any>(), second = new Subject<any>();
    const {component, networkChanged$} = fixture(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second));
    expect(first.observed).toBe(true); networkChanged$.next('signet');
    expect(first.observed).toBe(false); expect((await firstValueFrom(component.vm$)).kind).toBe('loading');
    component.ngOnDestroy(); expect(second.observed).toBe(false);
  });
});
