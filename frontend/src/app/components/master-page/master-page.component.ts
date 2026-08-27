import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { Router } from '@angular/router';
import { Env, StateService } from '@app/services/state.service';
import { Observable, merge, of, Subscription } from 'rxjs';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';

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

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private enterpriseService: EnterpriseService,
    private navigationService: NavigationService,
    private storageService: StorageService,
    private router: Router,
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

  ngOnDestroy(): void {
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
  }

}
