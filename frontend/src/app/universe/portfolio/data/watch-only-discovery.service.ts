import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, Subscription, firstValueFrom, takeUntil, timeout } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import type { LocalAccount } from '../stores/portfolio-model';
import type { DiscoveryRequest, DiscoveryResponse } from '../workers/discovery.worker';
import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer';

/** Manual bounded public-address discovery. Key material stays in the browser. */
@Injectable()
export class WatchOnlyDiscoveryService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateService);
  private readonly store = inject(PortfoliosStore);
  private readonly cancelled$ = new Subject<void>();
  private revision = 0;
  private destroyed = false;
  private worker?: Worker;
  private readonly networkSub: Subscription;
  readonly busy = signal(false);
  readonly message = signal('');
  readonly checked = signal(0);

  constructor() { this.networkSub = this.state.networkChanged$.subscribe(() => this.cancel()); }

  cancel(): void {
    this.revision++; this.cancelled$.next(); this.worker?.terminate(); this.worker = undefined;
    if (this.busy()) this.message.set('Discovery cancelled. Previously saved public addresses remain; this batch was not saved.');
    this.busy.set(false);
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.cancel(); this.networkSub.unsubscribe(); this.cancelled$.complete();
  }

  async restart(portfolioId: string, account: LocalAccount): Promise<void> {
    if (this.destroyed || this.busy() || this.store.vaultKind() !== 'unlocked' || this.store.activePortfolioId() !== portfolioId) return;
    this.cancel();
    const revision = this.revision; this.busy.set(true);
    try {
      await this.store.updatePortfolio(portfolioId, current => ({ ...current, accounts: current.accounts.map(value => {
        if (value.id !== account.id) return value;
        if (JSON.stringify(value) !== JSON.stringify(account)) throw Error('Account changed');
        return { ...value, discovery: undefined };
      }) }));
      if (revision === this.revision) this.message.set('Saved discovery progress cleared. Check the next batch to restart at index zero; key material and account labels are retained.');
    } catch { if (revision === this.revision) this.message.set('Discovery reset could not be confirmed. Unlock and reopen the portfolio to review saved progress before retrying.'); }
    finally { if (revision === this.revision) this.busy.set(false); }
  }

  private prefix(network: string): string {
    if (!['mainnet', 'testnet'].includes(network)) throw Error('Choose an explicitly supported Bitcoin mainnet or testnet account context.');
    if (network === 'mainnet' && this.state.env.ROOT_NETWORK !== 'mainnet') throw Error('This frontend profile does not declare a mainnet root origin.');
    return network === this.state.env.ROOT_NETWORK || network === 'mainnet' ? '' : '/' + network;
  }

  private async derive(request: DiscoveryRequest): Promise<readonly { index: number; address: string }[]> {
    return firstValueFrom(new Observable<readonly { index: number; address: string }[]>(subscriber => {
      const worker = new Worker(new URL('../workers/discovery.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<DiscoveryResponse>) => {
        const result = event.data;
        if (result.id !== request.id) return;
        if (!result.ok || !('addresses' in result)) subscriber.error(Error('Public derivation unavailable'));
        else { subscriber.next(result.addresses); subscriber.complete(); }
      };
      worker.onerror = () => subscriber.error(Error('Public derivation worker unavailable'));
      worker.postMessage(request);
      return () => { worker.terminate(); if (this.worker === worker) this.worker = undefined; };
    }).pipe(timeout(10000), takeUntil(this.cancelled$)));
  }

  async advance(portfolioId: string, account: LocalAccount): Promise<void> {
    if (this.destroyed || this.busy()) return;
    const revision = this.revision;
    this.busy.set(true); this.message.set('Checking one bounded batch of public addresses…'); this.checked.set(0);
    const sameScope = () => !this.destroyed && revision === this.revision && this.store.vaultKind() === 'unlocked'
      && this.store.activePortfolioId() === portfolioId;
    let persisting = false;
    try {
      if (!this.state.isBrowser || account.chain !== 'bitcoin' || !sameScope()) throw Error('Discovery requires the unlocked selected local Bitcoin portfolio.');
      const prefix = this.prefix(account.network);
      const deadline = Date.now() + 60000;
      const remaining = () => { const budget = Math.min(15000, deadline - Date.now()); if (budget <= 0) throw Error('This batch deadline was reached. Continue with a fresh attempt.'); return budget; };
      const get = <T>(url: string) => firstValueFrom(this.http.get<T>(url).pipe(timeout(remaining()), takeUntil(this.cancelled$)));
      const tip = () => firstValueFrom(this.http.get(prefix + '/api/blocks/tip/hash', { responseType: 'text' }).pipe(timeout(remaining()), takeUntil(this.cancelled$)));
      const metadata = await get<{ chainSync?: { chain?: string } }>(prefix + '/api/v1/backend-info');
      if (metadata.chainSync?.chain !== (account.network === 'mainnet' ? 'main' : 'test')) throw Error('The configured source does not match this account network.');
      const before = (await tip()).trim(); if (!/^[a-f0-9]{64}$/.test(before)) throw Error('Confirmed source checkpoint unavailable.');
      const prior = account.discovery;
      if (prior?.observedTipHash && prior.observedTipHash !== before) throw Error('The confirmed checkpoint changed since this range was saved. Restart the address range before continuing.');
      const external = [...(prior?.derivedExternal ?? [])], internal = [...(prior?.derivedInternal ?? [])];
      const gap = account.xpub?.gapLimit ?? account.descriptor?.gapLimit;
      if (!Number.isSafeInteger(gap) || gap < 1 || gap > 100) throw Error('Choose a gap limit between 1 and 100.');
      const branches = account.kind === 'xpub' ? account.xpub?.branches : ['external'] as const;
      if (!branches?.length || branches.some(branch => !['external', 'internal'].includes(branch))) throw Error('No supported public derivation branch.');
      let unusedExternal = prior?.unusedExternal ?? 0, unusedInternal = prior?.unusedInternal ?? 0;
      let lastExternal = prior?.lastIndexExternal ?? -1, lastInternal = prior?.lastIndexInternal ?? -1;
      let usedExternal = prior?.highestUsedExternal ?? -1, usedInternal = prior?.highestUsedInternal ?? -1;
      const branch = branches.find(value => (value === 'external' ? unusedExternal : unusedInternal) < gap);
      if (!branch) { this.message.set('The declared gap-limit range is already scanned. This does not prove addresses beyond that range are unused.'); return; }
      const start = (branch === 'external' ? lastExternal : lastInternal) + 1;
      if (!Number.isSafeInteger(start) || start < 0 || start >= 0x80000000) throw Error('The supported non-hardened child range was exhausted. Coverage beyond this range remains unknown.');
      const fixed = account.kind === 'descriptor' && !account.descriptor?.value.includes('*');
      const count = fixed ? 1 : Math.min(20, 0x80000000 - start);
      let request: DiscoveryRequest;
      if (account.kind === 'xpub' && account.xpub) request = { id: revision, op: 'derive-batch', key: account.xpub.key, script: account.xpub.script,
        testnet: account.network !== 'mainnet', branch, start, count };
      else if (account.kind === 'descriptor' && account.descriptor) request = { id: revision, op: 'descriptor-batch', descriptor: account.descriptor.value, testnet: account.network !== 'mainnet', start, count };
      else throw Error('A public extended key or descriptor is required.');
      const addresses = await this.derive(request);
      if (!Array.isArray(addresses) || addresses.length !== count || new Set(addresses.map(row => row.address)).size !== count
        || addresses.some((row, index) => row.index !== start + index || typeof row.address !== 'string' || !row.address)) throw Error('Malformed public derivation response.');
      const addressDecoder = Address(account.network === 'mainnet' ? NETWORK : TEST_NETWORK);
      for (const row of addresses) addressDecoder.decode(row.address);
      for (const row of addresses) {
        if (!sameScope()) return;
        const observation = await get<{ address: string; chain_stats: { tx_count: number }; mempool_stats: { tx_count: number } }>(prefix + '/api/address/' + encodeURIComponent(row.address));
        const confirmed = observation.chain_stats?.tx_count, pending = observation.mempool_stats?.tx_count;
        if (observation.address !== row.address || !Number.isSafeInteger(confirmed) || confirmed < 0 || !Number.isSafeInteger(pending) || pending < 0) throw Error('Address history observation is unavailable or invalid.');
        const used = confirmed + pending > 0;
        if (branch === 'external') { external.push(row.address); lastExternal = row.index; unusedExternal = used ? 0 : unusedExternal + 1; if (used) usedExternal = row.index; }
        else { internal.push(row.address); lastInternal = row.index; unusedInternal = used ? 0 : unusedInternal + 1; if (used) usedInternal = row.index; }
        this.checked.update(value => value + 1);
        if (fixed || (branch === 'external' ? unusedExternal : unusedInternal) >= gap) break;
      }
      if ((await tip()).trim() !== before) throw Error('The confirmed source moved during this batch. Retry; no new discovery progress was saved.');
      if (!sameScope()) return;
      const complete = fixed || branches.every(value => (value === 'external' ? unusedExternal : unusedInternal) >= gap);
      persisting = true;
      await this.store.updatePortfolio(portfolioId, current => ({ ...current, accounts: current.accounts.map(value => {
        if (value.id !== account.id) return value;
        if (JSON.stringify(value) !== JSON.stringify(account)) throw Error('The account changed during discovery.');
        return { ...value, discovery: { lastIndexExternal: lastExternal, lastIndexInternal: lastInternal, highestUsedExternal: usedExternal,
          highestUsedInternal: usedInternal, derivedExternal: external, derivedInternal: internal, unusedExternal, unusedInternal,
          complete, boundary: fixed ? 'fixed-descriptor' : 'gap-limit', observedTipHash: before } };
      }) }));
      if (sameScope()) this.message.set(complete ? 'Saved the declared gap-limit or fixed-descriptor range. Addresses beyond that boundary are unknown.' : 'Saved this public-address batch. Continue manually; discovery is partial.');
    } catch (error) {
      if (revision === this.revision && !this.destroyed) this.message.set(persisting
        ? 'Discovery progress could not be confirmed saved. Unlock and reopen the portfolio to review saved progress before retrying.'
        : error instanceof Error && !/private|key|descriptor/i.test(error.message)
          ? error.message + ' Previously saved addresses remain unchanged.' : 'Public discovery could not finish. Previously saved addresses remain unchanged.');
    } finally { if (revision === this.revision) this.busy.set(false); }
  }
}
