import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subject, Subscription, catchError, defer, merge, of, startWith, switchMap, take, tap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ZcashPrivacySummary } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ZcashHistoryComponent } from './zcash-history.component';

interface PrivacyViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly summary?: ZcashPrivacySummary;
  readonly message?: string;
}

@Component({
  selector: 'app-zcash-privacy',
  templateUrl: './zcash-privacy.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, ZcashHistoryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZcashPrivacyComponent implements OnInit, OnDestroy {
  private readonly retries = new Subject<void>();
  private subscription?: Subscription;
  private readonly state = new BehaviorSubject<PrivacyViewModel>({ kind: 'loading' });
  readonly vm$: Observable<PrivacyViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private network: StateService,
  ) {
    this.seo.setTitle('Zcash Privacy Observatory');
  }

  ngOnInit(): void {
    this.subscription = merge(this.retries, this.network.networkChanged$).pipe(startWith(null), switchMap(() => {
      this.state.next({kind: 'loading'});
      return defer(() => this.api.getZcashPrivacySummary$()).pipe(take(1), tap(summary => {
        if (!validZcashSummary(summary)) throw Error('Malformed Zcash pool evidence');
        this.state.next({kind: 'ready', summary});
      }), catchError(err => {
        this.state.next({kind: 'error', message: err?.error?.error || loadFailureMessage(classifyLoadFailure(err))});
        return of(null);
      }));
    })).subscribe();
  }

  retry(): void {this.retries.next();}
  ngOnDestroy(): void {this.subscription?.unsubscribe(); this.retries.complete(); this.state.complete();}
  zec(value: string): string {const amount = BigInt(value); return `${amount / 100000000n}.${(amount % 100000000n).toString().padStart(8, '0')}`;}
  pool(summary: ZcashPrivacySummary, id: string) {return summary.pools.find(pool => pool.id === id);}
}

export function validZcashSummary(value: ZcashPrivacySummary): boolean {
  const genesis: Record<string, string> = {mainnet: '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08', testnet: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38'};
  if (!value || value.schema !== 'zcash-node-accounting-v1' || !['mainnet', 'testnet'].includes(value.network) || !Number.isSafeInteger(value.tipHeight) || value.tipHeight < 0
    || !value.source || value.source.genesis !== genesis[value.network] || !['zcashd', 'zebra'].includes(value.source.implementation) || !/^[0-9a-f]{64}$/.test(value.source.tipHash) || !/^[0-9a-f]{8}$/.test(value.source.branchId) || !/^[0-9a-f]{8}$/.test(value.source.nextBranchId) || !Number.isFinite(Date.parse(value.source.observedAt))
    || !/^(0|[1-9][0-9]{0,15})$/.test(value.nodeAccountedSupplyZat) || !/^(0|[1-9][0-9]{0,15})$/.test(value.totalShieldedSupplyZat)
    || value.totalCirculatingSupplyZat !== null || value.historyStatus !== 'unavailable' || value.recentFlows !== null || !Array.isArray(value.pools) || !Array.isArray(value.upgrades)) return false;
  const ids = new Set<string>(); let total = 0n; let shielded = 0n;
  for (const upgrade of value.upgrades) {
    if (!upgrade || typeof upgrade.name !== 'string' || !/^0x[0-9a-f]{8}$/.test(upgrade.branchId) || upgrade.activationHeight !== null && (!Number.isSafeInteger(upgrade.activationHeight) || upgrade.activationHeight < 0)
      || !Array.isArray(upgrade.features) || upgrade.features.some(feature => typeof feature !== 'string') || upgrade.network !== value.network || upgrade.observation !== false) return false;
  }
  for (const pool of value.pools) {
    if (!pool || !['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'].includes(pool.id) || ids.has(pool.id) || !/^(0|[1-9][0-9]{0,15})$/.test(pool.balanceZat) || pool.txCount !== null) return false;
    ids.add(pool.id); const amount = BigInt(pool.balanceZat); total += amount;
    if (pool.balanceZec !== `${amount / 100000000n}.${(amount % 100000000n).toString().padStart(8, '0')}` || typeof pool.shielded !== 'boolean' || pool.shielded !== ['sprout', 'sapling', 'orchard', 'ironwood'].includes(pool.id) || pool.monitored !== null && typeof pool.monitored !== 'boolean' || !/^\d{1,3}\.\d{2}$/.test(pool.percentageOfSupply)) return false;
    if (['sprout', 'sapling', 'orchard', 'ironwood'].includes(pool.id)) shielded += amount;
  }
  const supply = BigInt(value.nodeAccountedSupplyZat);
  const percentage = (amount: bigint) => {const hundredths = supply === 0n ? 0n : amount * 10000n / supply; return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;};
  if (value.shieldedPercentage !== percentage(shielded) || value.pools.some(pool => pool.percentageOfSupply !== percentage(BigInt(pool.balanceZat)))) return false;
  return /^\d{1,3}\.\d{2}$/.test(value.shieldedPercentage) && ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox'].every(id => ids.has(id)) && (value.source.implementation !== 'zebra' || ids.has('ironwood'))
    && total === BigInt(value.nodeAccountedSupplyZat) && shielded === BigInt(value.totalShieldedSupplyZat);
}
