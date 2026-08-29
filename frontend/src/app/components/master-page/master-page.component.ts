import { AfterViewInit, Component, ElementRef, OnInit, OnDestroy, Input, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Env, StateService } from '@app/services/state.service';
import { Observable, catchError, filter, merge, of, shareReplay, Subscription, switchMap, timer } from 'rxjs';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { UniverseViewportService } from '@app/universe/universe-viewport.service';
import { ChainCapabilityEnvelope, ExplorerChain } from '@app/universe/universe.types';
import { describeChainReasons } from '@app/universe/multichain-explorer/chain-reasons';
import {
  availabilityLabel,
  completenessLabel,
  formatExactInteger,
} from '@app/universe/multichain-explorer/multichain-view';
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
export class MasterPageComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() headerVisible = true;
  @Input() footerVisibleOverride: boolean | null = null;

  @ViewChild('navList') navList?: ElementRef<HTMLElement>;

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
    private viewport: UniverseViewportService,
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
      this.revealActiveDestination();
    });

    // The one piece of adaptive behaviour that is not expressible in CSS. See
    // UniverseViewportService: on iOS the software keyboard covers the page
    // rather than shortening it, so no viewport unit knows it is there.
    this.viewport.track();
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

  ngAfterViewInit(): void {
    this.revealActiveDestination();
  }

  /**
   * Scroll the current destination into the bottom bar's visible run.
   *
   * Below the breakpoint the bar is a horizontal scroller, because six or more
   * destinations cannot be full-size targets and all on screen at 320 pixels
   * at once. Everything that follows from that choice is handled in CSS: the
   * scroll shadows say which side has more, and the targets keep their size.
   * What CSS cannot do is put the scroller at the right starting offset.
   *
   * Without this, arriving on Charts from a link showed a bar scrolled to its
   * left end with Dashboard highlighted-looking and Charts off the right edge,
   * so the bar disagreed with the page about where the visitor was. It runs
   * after every navigation and once on first paint.
   *
   * The bar's own `scrollLeft` is moved, rather than calling `scrollIntoView`
   * on the destination. `scrollIntoView` adjusts every scrollable ancestor it
   * can find, including the document, so a navigation could have moved the
   * reading position of the page as a side effect of tidying the bar. Writing
   * one offset on one element cannot do anything but what it says.
   *
   * A destination already fully inside the bar is left alone, so the common
   * case moves nothing at all.
   */
  private revealActiveDestination(): void {
    // There is no scroller and no animation frame on the server.
    if (!this.stateService.isBrowser) {
      return;
    }
    const list = this.navList?.nativeElement;
    if (!list || typeof list.scrollWidth !== 'number') {
      return;
    }
    // Nothing to reveal when the bar is not a scroller, which is every width
    // at and above the breakpoint.
    if (list.scrollWidth <= list.clientWidth) {
      return;
    }
    // After the router has swapped the active class on, not before it.
    requestAnimationFrame(() => {
      const active = list.querySelector('.nav-item.active');
      if (!active) {
        return;
      }
      const item = active.getBoundingClientRect();
      const bar = list.getBoundingClientRect();
      // A margin so the revealed destination does not sit flush against the
      // edge looking like the last one, when it is only the last one visible.
      const margin = 24;
      if (item.left < bar.left) {
        list.scrollLeft -= (bar.left - item.left) + margin;
      } else if (item.right > bar.right) {
        list.scrollLeft += (item.right - bar.right) + margin;
      }
    });
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
    if (!capability) {return availabilityLabel(null);}
    return capability.ready ? availabilityLabel('ready') : availabilityLabel('degraded');
  }

  /**
   * The line under a chain's name in the switcher.
   *
   * It used to read "Tip 964557; mempool ready, complete" whether the chain
   * said it was ready or not, so a chain marked degraded sat beside a sentence
   * in which nothing was wrong, in the wire's words rather than in English.
   * The reason is in the same document the verdict came from, so a degraded
   * chain leads with it and a ready one keeps the tip and pending reading.
   */
  chainDetail(capability: ChainCapabilityEnvelope | undefined): string {
    if (!capability) {
      return $localize`:@@master-page.chain-status-unavailable:This chain did not report its status.`;
    }
    // Grouped the way the status rail groups it. A block height printed as a
    // bare run of digits in one place and as 2,884,120 in another is the same
    // fact in two voices, and the long one is where it is hardest to read.
    const tip = formatExactInteger(capability.tip?.heightAtomic ?? null);
    const height = tip
      ? $localize`:@@master-page.chain-tip:Block ${tip.display}:HEIGHT:`
      : $localize`:@@master-page.chain-tip-none:No tip reported`;
    if (!capability.ready) {
      const [first] = describeChainReasons(capability.degradedReasons ?? []);
      return first ? `${height}. ${first.text}` : height;
    }
    if (!capability.mempool.supported) {
      return height;
    }
    const coverage = completenessLabel(capability.mempool.completeness);
    return $localize`:@@master-page.chain-ready-detail:${height}:BLOCK:. Pending coverage ${coverage}:COVERAGE:.`;
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
