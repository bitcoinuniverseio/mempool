import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { WatchOnlyDiscoveryService } from './watch-only-discovery.service';
import { deriveAddressBatch } from '../shared/derivation';
import type { DiscoverySourceIdentity } from './discovery-source-identity';
import { createBase58check } from '@scure/base';
import { createHash } from 'node:crypto';

const key = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const derived = deriveAddressBatch({ key, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 20 }).addresses;
const profile = { releaseSha: '1'.repeat(40), configurationSha256: '2'.repeat(64), genesisHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f', signetChallenge: null };
const identity: DiscoverySourceIdentity = { schema: 'universe-chain-source-identity-v1', chain: 'bitcoin', network: 'mainnet', ...profile,
  checkpoint: { heightAtomic: '100', blockHash: 'a'.repeat(64) }, observedAt: '2026-10-04T00:00:00Z' };

class OwnedWorker {
  static instances: OwnedWorker[] = [];
  static hold = false;
  onmessage: any; onerror: any; request: any;
  terminate = vi.fn();
  constructor() { OwnedWorker.instances.push(this); }
  postMessage(request: any) {
    this.request = request;
    if (!OwnedWorker.hold) queueMicrotask(() => this.onmessage({ data: { id: request.id, ok: true,
      addresses: deriveAddressBatch({ ...request, branch: 'external' }).addresses } }));
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
  const http = { get: vi.fn((url: string) => of(url.endsWith('chain-source/identity') ? identity
    : { address: decodeURIComponent(url.split('/').pop()!), chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } })) };
  const env = { ROOT_NETWORK: 'mainnet', WATCH_ONLY_SOURCE_PROFILES: { mainnet: profile } };
  const injector = Injector.create({ providers: [{ provide: HttpClient, useValue: http },
    { provide: StateService, useValue: { isBrowser: true, env, networkChanged$: network } }, { provide: PortfoliosStore, useValue: store }] });
  const service = runInInjectionContext(injector, () => new WatchOnlyDiscoveryService());
  return { service, account, store, http, network, env, portfolio: () => portfolio, lock: () => { kind = 'locked'; }, switchPortfolio: () => { active = 'other'; } };
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
  it('rejects unconfigured sources before any API or worker dispatch', async () => {
    const f = setup(); f.env.WATCH_ONLY_SOURCE_PROFILES = {} as any;
    await f.service.advance('owned', f.account); expect(f.http.get).not.toHaveBeenCalled(); expect(OwnedWorker.instances).toHaveLength(0);
    expect(f.store.updatePortfolio).not.toHaveBeenCalled(); expect(f.service.message()).toContain('profile');
  });
  it.each(['signet', 'testnet4'])('keeps explicit %s context separate from test-family address encoding', async network => {
    const f = setup(); const codec = createBase58check(bytes => createHash('sha256').update(bytes).digest());
    const payload = codec.decode(key); new DataView(payload.buffer, payload.byteOffset, payload.byteLength).setUint32(0, 0x043587cf);
    f.account.network = network; f.account.xpub.key = codec.encode(payload);
    const selectedProfile = { ...profile, genesisHash: network === 'signet' ? '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6'
      : '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043', signetChallenge: network === 'signet' ? '51' : null };
    f.env.WATCH_ONLY_SOURCE_PROFILES = { [network]: selectedProfile } as any;
    const ordinary = f.http.get.getMockImplementation()!;
    f.http.get.mockImplementation(url => url.endsWith('chain-source/identity') ? of({ ...identity, ...selectedProfile, network }) as any : ordinary(url));
    await f.service.advance('owned', f.account);
    expect(f.store.updatePortfolio).toHaveBeenCalledOnce(); expect(OwnedWorker.instances[0].request.testnet).toBe(true);
    expect(f.http.get.mock.calls.every(call => call[0].startsWith('/' + network + '/api/'))).toBe(true);
    expect(f.portfolio().accounts[0].discovery.sourceIdentity.network).toBe(network);
    expect(f.portfolio().accounts[0].discovery.derivedExternal[0]).toMatch(/^tb1/);
  });
  it('rejects changed configuration after derivation without saving new progress', async () => {
    const f = setup(), ordinary = f.http.get.getMockImplementation()!; let observations = 0;
    f.http.get.mockImplementation(url => url.endsWith('chain-source/identity') ? of({ ...identity,
      configurationSha256: ++observations === 1 ? profile.configurationSha256 : 'b'.repeat(64) }) as any : ordinary(url));
    await f.service.advance('owned', f.account); expect(f.store.updatePortfolio).not.toHaveBeenCalled();
    expect(f.service.message()).toContain('does not match');
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
    f.http.get.mockImplementation(url => url.endsWith('chain-source/identity') ? of({ ...identity, checkpoint: { ...identity.checkpoint, blockHash: (++tips === 1 ? 'a' : 'b').repeat(64) } }) as any : ordinary(url));
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
