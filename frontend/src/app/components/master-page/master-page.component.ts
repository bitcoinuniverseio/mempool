import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Env, StateService } from '@app/services/state.service';
import { Observable, catchError, filter, merge, of, shareReplay, Subscription, switchMap, timer } from 'rxjs';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { ChainCapabilityEnvelope, ExplorerChain } from '@app/universe/universe.types';
import {
  explorerChainFromUrl,
  explorerSectionRoute,
  explorerSwitchTarget,
} from '@app/universe/universe-chain-routing';

@Component({
  selector: 'app-master-page',
  templateUrl: './master-page.component.html',
  styleUrls: ['./master-page.component.scss'],
  standalone: false,
})
export class MasterPageComponent implements OnInit, OnDestroy {
  @Input() headerVisible = true;
  @Input() footerVisibleOverride: boolean | null = null;

  env: Env;
  network$: Observable<string>;
  connectionState$: Observable<number>;
  navCollapsed = false;
  isMobile = window.innerWidth <= 767.98;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  officialMempoolSpaceBuild = this.stateService.isMempoolSpaceBuild;
  urlLanguage: string;
  subdomain = '';
  networkPaths: { [network: string]: string };
  networkPaths$: Observable<Record<string, string>>;
  footerVisible = true;
  user: any = undefined;
  isDropdownVisible: boolean;
  readonly explorerChains: readonly ExplorerChain[] = ['bitcoin', 'dogecoin', 'zcash'];
  activeChain: ExplorerChain = 'bitcoin';
  chainCapabilities$: Observable<ChainCapabilityEnvelope[]>;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;
  routeInfo$: Subscription;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private enterpriseService: EnterpriseService,
    private navigationService: NavigationService,
    private storageService: StorageService,
    private router: Router,
    private universeApi: UniverseApiService,
    private universeLocal: UniverseLocalService,
  ) { }

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.connectionState$ = this.stateService.connectionState$;
    this.network$ = merge(of(''), this.stateService.networkChanged$);
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.subdomain = this.enterpriseService.getSubdomain();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
      if (this.footerVisibleOverride === null) {
        if (paths.mainnet.indexOf('docs') > -1) {
          this.footerVisible = false;
        } else {
          this.footerVisible = true;
        }
      } else {
        this.footerVisible = this.footerVisibleOverride;
      }
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe(info => {
      this.enterpriseInfo = info;
    });

    this.refreshAuth();
    this.setDropdownVisibility();
    this.activeChain = explorerChainFromUrl(this.router.url);
    this.routeInfo$ = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    ).subscribe((event) => {
      this.activeChain = explorerChainFromUrl(event.urlAfterRedirects);
    });
    this.chainCapabilities$ = this.stateService.isBrowser
      ? timer(0, 15_000).pipe(
          switchMap(() => this.universeApi.getChains$().pipe(catchError(() => of([])))),
          shareReplay({ bufferSize: 1, refCount: true }),
        )
      : of([]);
  }

  setDropdownVisibility(): void {
    const networks = [
      this.env.TESTNET_ENABLED,
      this.env.TESTNET4_ENABLED,
      this.env.SIGNET_ENABLED,
      this.env.REGTEST_ENABLED,
      this.env.LIQUID_ENABLED,
      this.env.LIQUID_TESTNET_ENABLED,
      this.env.MAINNET_ENABLED,
    ];
    const enabledNetworksCount = networks.filter((networkEnabled) => networkEnabled).length;
    this.isDropdownVisible = enabledNetworksCount > 1;
  }

  /**
   * The chain currently being explored, in words.
   *
   * The picker used to show only a symbol. Reading a testnet page believing it
   * is mainnet is the most expensive mistake this interface can invite, so the
   * chain is always named next to its mark.
   */
  networkLabel(network: string): string {
    switch (network) {
      case '': return $localize`:@@master-page.network-mainnet:Mainnet`;
      case 'testnet': return $localize`:@@master-page.network-testnet3:Testnet3`;
      case 'testnet4': return $localize`:@@master-page.network-testnet4:Testnet4`;
      case 'signet': return $localize`:@@master-page.network-signet:Signet`;
      case 'regtest': return $localize`:@@master-page.network-regtest:Regtest`;
      case 'liquid': return $localize`:@@master-page.network-liquid:Liquid`;
      case 'liquidtestnet': return $localize`:@@master-page.network-liquidtestnet:Liquid Testnet`;
      default: return network;
    }
  }

  collapse(): void {
    this.navCollapsed = !this.navCollapsed;
  }

  isSmallScreen(): boolean {
    return window.innerWidth <= 767.98;
  }

  onResize(): void {
    this.isMobile = this.isSmallScreen();
  }

  brandClick(e): void {
    this.stateService.resetScroll$.next(true);
  }

  refreshAuth(): void {
    this.user = this.storageService.getAuth()?.user ?? null;
  }

  chainName(chain: ExplorerChain): string {
    switch (chain) {
      case 'bitcoin': return 'Bitcoin';
      case 'dogecoin': return 'Dogecoin';
      case 'zcash': return 'Zcash';
    }
  }

  chainTicker(chain: ExplorerChain): string {
    switch (chain) {
      case 'bitcoin': return 'BTC';
      case 'dogecoin': return 'DOGE';
      case 'zcash': return 'ZEC';
    }
  }

  chainCapability(capabilities: ChainCapabilityEnvelope[], chain: ExplorerChain): ChainCapabilityEnvelope | undefined {
    return capabilities.find((capability) => capability.chain === chain);
  }

  chainState(capability: ChainCapabilityEnvelope | undefined): string {
    if (!capability) {return 'status unavailable';}
    return capability.ready ? 'ready' : 'degraded';
  }

  chainDetail(capability: ChainCapabilityEnvelope | undefined): string {
    if (!capability) {return 'Tip and mempool unavailable';}
    const tip = capability.tip?.heightAtomic ?? 'unknown tip';
    return `Tip ${tip}; mempool ${capability.mempool.state}, ${capability.mempool.completeness}`;
  }

  chainRoute(kind: 'dashboard' | 'mempool' | 'protocols'): string {
    return explorerSectionRoute(this.activeChain, kind);
  }

  switchChain(chain: ExplorerChain): void {
    if (chain === this.activeChain) {return;}
    const sourceChain = this.activeChain;
    const target = explorerSwitchTarget(this.router.url, chain);
    this.universeLocal.setSelectedChain(chain);
    if (target.droppedObject) {
      void this.router.navigate([target.path], { queryParams: { switchedFrom: sourceChain } });
      return;
    }
    void this.router.navigateByUrl(target.path);
  }

  ngOnDestroy(): void {
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
    if (this.routeInfo$) {
      this.routeInfo$.unsubscribe();
    }
  }

}
