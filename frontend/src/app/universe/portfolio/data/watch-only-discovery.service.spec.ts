import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { WatchOnlyDiscoveryService } from './watch-only-discovery.service';
import { deriveAddressBatch } from '../shared/derivation';

const key = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const derived = deriveAddressBatch({ key, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 20 }).addresses;

class OwnedWorker {
  static instances: OwnedWorker[] = [];
  static hold = false;
  onmessage: any; onerror: any; request: any;
  terminate = vi.fn();
  constructor() { OwnedWorker.instances.push(this); }
  postMessage(request: any) {
    this.request = request;
    if (!OwnedWorker.hold) queueMicrotask(() => this.onmessage({ data: { id: request.id, ok: true,
      addresses: deriveAddressBatch({ ...request, key, script: 'p2wpkh', testnet: false, branch: 'external' }).addresses } }));
  }
}
function setup() {
  vi.stubGlobal('Worker', OwnedWorker); OwnedWorker.instances = []; OwnedWorker.hold = false;
  let kind = 'unlocked'; let active = 'owned';
  const account: any = { id: 'account', name: 'Owned', chain: 'bitcoin', network: 'mainnet', kind: 'xpub',
    xpub: { key, script: 'p2wpkh', gapLimit: 20, branches: ['external'] } };
  let portfolio: any = { id: 'owned', accounts: [account] };
  const store = { vaultKind: () => kind, activePortfolioId: () => active, updatePortfolio: vi.fn(async (_id, update) => { portfolio = update(portfolio); }) };
  const network = new BehaviorSubject('');
  const http = { get: vi.fn((url: string) => of(url.endsWith('backend-info') ? { chainSync: { chain: 'main' } }
    : url.endsWith('tip/hash') ? 'a'.repeat(64) : { address: decodeURIComponent(url.split('/').pop()!), chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } })) };
  const injector = Injector.create({ providers: [{ provide: HttpClient, useValue: http },
    { provide: StateService, useValue: { isBrowser: true, env: { ROOT_NETWORK: 'mainnet' }, networkChanged$: network } }, { provide: PortfoliosStore, useValue: store }] });
  const service = runInInjectionContext(injector, () => new WatchOnlyDiscoveryService());
  return { service, account, store, http, network, portfolio: () => portfolio, lock: () => { kind = 'locked'; }, switchPortfolio: () => { active = 'other'; } };
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('public worker discovery consumer', () => {
  it('persists only a validated bounded public-address gap range without key transmission', async () => {
    const f = setup(); await f.service.advance('owned', f.account);
    const discovery = f.portfolio().accounts[0].discovery;
    expect(discovery.derivedExternal).toHaveLength(20); expect(discovery.lastIndexExternal).toBe(19);
    expect(discovery.complete).toBe(true); expect(discovery.boundary).toBe('gap-limit');
    expect(f.store.updatePortfolio).toHaveBeenCalledOnce(); expect(f.service.busy()).toBe(false);
    expect(f.http.get.mock.calls.every(call => !call[0].includes(f.account.xpub.key))).toBe(true);
    expect(OwnedWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('retains saved state on an address failure and allows retry', async () => {
    const f = setup(); const ordinary = f.http.get.getMockImplementation()!;
    f.http.get.mockImplementation(url => url.endsWith(derived[5].address) ? throwError(() => Error('Source unavailable')) as any : ordinary(url));
    await f.service.advance('owned', f.account); expect(f.store.updatePortfolio).not.toHaveBeenCalled();
    expect(f.service.message()).toContain('unchanged');
    f.http.get.mockImplementation(ordinary); await f.service.advance('owned', f.account);
    expect(f.store.updatePortfolio).toHaveBeenCalledOnce();
  });
  it('rejects mismatching source network before worker or address reads', async () => {
    const f = setup(); f.http.get.mockReturnValue(of({ chainSync: { chain: 'signet' } }) as any);
    await f.service.advance('owned', f.account); expect(OwnedWorker.instances).toHaveLength(0);
    expect(f.store.updatePortfolio).not.toHaveBeenCalled(); expect(f.service.message()).toContain('does not match');
  });
  it.each(['cancel', 'network', 'destroy'])('cancels a held worker on %s without saving and guards duplicate calls', async cause => {
    const f = setup(); OwnedWorker.hold = true;
    const pending = f.service.advance('owned', f.account);
    await vi.waitFor(() => expect(OwnedWorker.instances).toHaveLength(1));
    await f.service.advance('owned', f.account); expect(OwnedWorker.instances).toHaveLength(1);
    if (cause === 'network') f.network.next('signet'); else if (cause === 'destroy') f.service.ngOnDestroy(); else f.service.cancel();
    await pending; expect(OwnedWorker.instances[0].terminate).toHaveBeenCalled();
    expect(f.store.updatePortfolio).not.toHaveBeenCalled(); expect(f.service.busy()).toBe(false);
  });
  it('does not persist if vault locks during a held source read', async () => {
    const f = setup(), held = new Subject<any>(); const ordinary = f.http.get.getMockImplementation()!;
    f.http.get.mockImplementation(url => url.endsWith(derived[0].address) ? held as any : ordinary(url));
    const pending = f.service.advance('owned', f.account);
    await vi.waitFor(() => expect(f.http.get.mock.calls.some(call => call[0].endsWith(derived[0].address))).toBe(true));
    f.lock(); held.next({ address: derived[0].address, chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } }); held.complete();
    await pending; expect(f.store.updatePortfolio).not.toHaveBeenCalled();
  });
  it('rejects moved confirmed checkpoint before saving and refuses stale continuation', async () => {
    const f = setup(), ordinary = f.http.get.getMockImplementation()!; let tips = 0;
    f.http.get.mockImplementation(url => url.endsWith('tip/hash') ? of((++tips === 1 ? 'a' : 'b').repeat(64)) as any : ordinary(url));
    await f.service.advance('owned', f.account);
    expect(f.store.updatePortfolio).not.toHaveBeenCalled(); expect(f.service.message()).toContain('source moved');
    f.account.discovery = { observedTipHash: 'c'.repeat(64), complete: false, lastIndexExternal: 19, derivedExternal: derived.map(row => row.address) };
    f.http.get.mockImplementation(ordinary);
    await f.service.advance('owned', f.account);
    expect(f.service.message()).toContain('Restart'); expect(f.store.updatePortfolio).not.toHaveBeenCalled();
  });
  it('reports partial saved progress when activity interrupts the declared gap and continues exact next index', async () => {
    const f = setup(), ordinary = f.http.get.getMockImplementation()!;
    f.http.get.mockImplementation(url => url.endsWith(derived[10].address) ? of({ address: derived[10].address, chain_stats: { tx_count: 1 }, mempool_stats: { tx_count: 0 } }) as any : ordinary(url));
    await f.service.advance('owned', f.account);
    const first = f.portfolio().accounts[0]; expect(first.discovery.complete).toBe(false); expect(first.discovery.highestUsedExternal).toBe(10);
    await f.service.advance('owned', first);
    const next = f.portfolio().accounts[0]; expect(OwnedWorker.instances[1].request.start).toBe(20);
    expect(next.discovery.complete).toBe(true); expect(next.discovery.lastIndexExternal).toBe(30);
    expect(next.discovery.derivedExternal).toHaveLength(31);
  });
  it('restart preserves account material/other accounts and permits fresh index-zero scanning', async () => {
    const f = setup(); await f.service.advance('owned', f.account);
    const account = f.portfolio().accounts[0];
    await f.service.restart('owned', account);
    expect(f.portfolio().accounts[0].xpub).toEqual(f.account.xpub); expect(f.portfolio().accounts[0].discovery).toBeUndefined();
    await f.service.advance('owned', f.portfolio().accounts[0]);
    expect(OwnedWorker.instances[1].request.start).toBe(0);
  });
});
