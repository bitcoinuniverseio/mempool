import { Component, OnInit, ChangeDetectionStrategy, EventEmitter, Output, ViewChild, HostListener, ElementRef, Input } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { EventType, NavigationStart, Router } from '@angular/router';
import { AssetsService } from '@app/services/assets.service';
import { Env, StateService } from '@app/services/state.service';
import { Observable, of, Subject, zip, BehaviorSubject, combineLatest } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, map, startWith,  tap } from 'rxjs/operators';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ApiService } from '@app/services/api.service';
import { SearchResultsComponent } from '@components/search-form/search-results/search-results.component';
import { Network, findOtherNetworks, getRegex, getTargetUrl, needBaseModuleChange } from '@app/shared/regex.utils';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { UniverseIdentifier, classifyUniverseQuery, identifierKindLabel } from '@app/universe/universe-identifier';
import { ExplorerChain, ExplorerProtocolDefinition, UniverseSearchResponse } from '@app/universe/universe.types';

@Component({
  selector: 'app-search-form',
  templateUrl: './search-form.component.html',
  styleUrls: ['./search-form.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchFormComponent implements OnInit {
  @Input() hamburgerOpen = false;
  @Input() activeChain: ExplorerChain = 'bitcoin';
  searchAllChains = false;
  private readonly searchAllChains$ = new BehaviorSubject<boolean>(false);
  env: Env;
  network = '';
  assets: object = {};
  pools: object[] = [];
  isSearching = false;
  isTypeaheading$ = new BehaviorSubject<boolean>(false);
  typeAhead$: Observable<any>;
  searchForm: UntypedFormGroup;
  dropdownHidden = false;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event) {
    if (this.elementRef.nativeElement.contains(event.target)) {
      this.dropdownHidden = false;
    } else {
      this.dropdownHidden = true;
    }
  }

  regexAddress = getRegex('address', 'mainnet'); // Default to mainnet
  regexBlockhash = getRegex('blockhash', 'mainnet');
  regexTransaction = getRegex('transaction');
  regexBlockheight = getRegex('blockheight');
  regexDate = getRegex('date');
  regexUnixTimestamp = getRegex('timestamp');

  focus$ = new Subject<string>();
  click$ = new Subject<string>();

  /**
   * The protocol registry, used to offer protocol names as search results.
   * It is fetched once and cached; a failure just means protocol-name matching
   * stays off, and every other kind of search keeps working.
   */
  private universeProtocols: ExplorerProtocolDefinition[] = [];
  readonly universeKindLabel = identifierKindLabel;

  @Output() searchTriggered = new EventEmitter();
  @ViewChild('searchResults') searchResults: SearchResultsComponent;
  @HostListener('keydown', ['$event']) keydown($event): void {
    this.handleKeyDown($event);
  }

  @ViewChild('searchInput') searchInput: ElementRef;

  constructor(
    private formBuilder: UntypedFormBuilder,
    private router: Router,
    private assetsService: AssetsService,
    private stateService: StateService,
    private electrsApiService: ElectrsApiService,
    private apiService: ApiService,
    private relativeUrlPipe: RelativeUrlPipe,
    private elementRef: ElementRef,
    private universeApiService: UniverseApiService,
    private universeLocalService: UniverseLocalService,
  ) {
  }

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.stateService.networkChanged$.subscribe((network) => {
      this.network = network;
      // TODO: Eventually change network type here from string to enum of consts
      this.regexAddress = getRegex('address', network as any || 'mainnet');
      this.regexBlockhash = getRegex('blockhash', network as any || 'mainnet');
    });

    this.router.events.subscribe((e: NavigationStart) => { // Reset search focus when changing page
      if (this.searchInput && e.type === EventType.NavigationStart) {
        this.searchInput.nativeElement.blur();
      }
    });

    this.stateService.searchFocus$.subscribe(() => {
      if (!this.searchInput) { // Try again a bit later once the view is properly initialized
        setTimeout(() => this.searchInput.nativeElement.focus(), 100);
      } else if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    });

    this.searchForm = this.formBuilder.group({
      searchText: ['', Validators.required],
    });

    if (this.stateService.isBrowser) {
      this.universeApiService.getProtocols$()
        .pipe(catchError(() => of({ protocols: [] as ExplorerProtocolDefinition[] } as any)))
        .subscribe((response) => {
          this.universeProtocols = response?.protocols || [];
        });
    }

    if (this.network === 'liquid' || this.network === 'liquidtestnet') {
      this.assetsService.getAssetsMinimalJson$
        .subscribe((assets) => {
          this.assets = assets;
        });
    }

    const searchText$ = this.searchForm.get('searchText').valueChanges
    .pipe(
      map((text) => {
        return text.trim();
      }),
      tap((text) => {
        this.stateService.searchText$.next(text);
      }),
      distinctUntilChanged(),
    );

    const searchResults$ = combineLatest([searchText$, this.searchAllChains$]).pipe(
      debounceTime(200),
      switchMap(([text, allChains]) => {
        if (!text.length) {
          return of([
            [],
            { nodes: [], channels: [] },
            this.pools
          ]);
        }
        this.isTypeaheading$.next(true);
        if (this.activeChain !== 'bitcoin' || allChains) {
          return this.universeApiService.search$(text, this.activeChain, allChains).pipe(
            map((response) => [[], { nodes: [], channels: [] }, [], response]),
            catchError(() => of([[], { nodes: [], channels: [] }, [], null])),
          );
        }
        if (!this.stateService.networkSupportsLightning()) {
          return zip(
            this.electrsApiService.getAddressesByPrefix$(text).pipe(catchError(() => of([]))),
            [{ nodes: [], channels: [] }],
            this.getMiningPools()
          );
        }
        return zip(
          this.electrsApiService.getAddressesByPrefix$(text).pipe(catchError(() => of([]))),
          this.apiService.lightningSearch$(text).pipe(catchError(() => of({
            nodes: [],
            channels: [],
          }))),
          this.getMiningPools()
        );
      }),
      map((result: any[]) => {
        return result;
      }),
      tap(() => {
        this.isTypeaheading$.next(false);
      })
    );

    this.typeAhead$ = combineLatest(
      [
        searchText$,
        searchResults$.pipe(
        startWith([
          [],
          {
            nodes: [],
            channels: [],
          },
          this.pools
        ]))
      ]
      ).pipe(
        map((latestData) => {
          this.pools = latestData[1][2] || [];

          let searchText = latestData[0];
          if (!searchText.length) {
            return {
              searchText: '',
              hashQuickMatch: false,
              blockHeight: false,
              txId: false,
              address: false,
              otherNetworks: [],
              addresses: [],
              nodes: [],
              channels: [],
              liquidAsset: [],
              pools: [],
              universe: [],
              universeRecent: this.recentEntries(),
              universeFailures: [],
              universeNotice: '',
            };
          }

          const result = latestData[1];
          const addressPrefixSearchResults = result[0];
          const lightningResults = result[1];
          const alternateChain = this.activeChain !== 'bitcoin';
          const remoteUniverse = alternateChain || this.searchAllChains;

          // Do not show date and timestamp results for liquid
          const isNetworkBitcoin = this.network === '' || this.network === 'testnet' || this.network === 'testnet4' || this.network === 'signet';

          const matchesBlockHeight = !remoteUniverse && this.regexBlockheight.test(searchText) && parseInt(searchText) <= this.stateService.latestBlockHeight;
          const matchesDateTime = !remoteUniverse && this.regexDate.test(searchText) && new Date(searchText).toString() !== 'Invalid Date' && new Date(searchText).getTime() <= Date.now() && isNetworkBitcoin;
          const matchesUnixTimestamp = !remoteUniverse && this.regexUnixTimestamp.test(searchText) && parseInt(searchText) <= Math.floor(Date.now() / 1000) && isNetworkBitcoin;
          const matchesTxId = !remoteUniverse && this.regexTransaction.test(searchText) && !this.regexBlockhash.test(searchText);
          const matchesBlockHash = !remoteUniverse && this.regexBlockhash.test(searchText);
          const matchesAddress = !remoteUniverse && !matchesTxId && this.regexAddress.test(searchText);
          const publicKey = matchesAddress && searchText.startsWith('0');
          const otherNetworks = findOtherNetworks(searchText, this.network as any || 'mainnet', this.env);
          const liquidAsset = this.assets ? (this.assets[searchText] || []) : [];
          const pools = this.pools.filter(pool => pool['name'].toLowerCase().includes(searchText.toLowerCase())).slice(0, 10);

          if (matchesDateTime && searchText.indexOf('/') !== -1) {
            searchText = searchText.replace(/\//g, '-');
          }

          if (publicKey) {
            otherNetworks.length = 0;
          }

          return {
            searchText: searchText,
            hashQuickMatch: +(matchesBlockHeight || matchesBlockHash || matchesTxId || matchesAddress || matchesUnixTimestamp || matchesDateTime),
            blockHeight: matchesBlockHeight,
            dateTime: matchesDateTime,
            unixTimestamp: matchesUnixTimestamp,
            txId: matchesTxId,
            blockHash: matchesBlockHash,
            address: matchesAddress,
            publicKey: publicKey,
            addresses: matchesAddress && addressPrefixSearchResults.length === 1 && searchText === addressPrefixSearchResults[0] ? [] : addressPrefixSearchResults, // If there is only one address and it matches the search text, don't show it in the dropdown
            otherNetworks: remoteUniverse ? [] : otherNetworks,
            nodes: lightningResults.nodes,
            channels: lightningResults.channels,
            liquidAsset: liquidAsset,
            pools: pools,
            universe: remoteUniverse
              ? this.remoteUniverseMatches(result[3] as UniverseSearchResponse | null)
              : this.universeMatches(searchText),
            universeRecent: [],
            universeFailures: remoteUniverse
              ? this.remoteUniverseFailures(result[3] as UniverseSearchResponse | null)
              : [],
            universeNotice: remoteUniverse && result[3]
              ? (result[3] as UniverseSearchResponse).privacy.zcash
              : '',
          };
        })
      );
  }

  handleKeyDown($event): void {
    this.searchResults.handleKeyDown($event);
  }

  /**
   * Universe identifier candidates for the current query.
   *
   * Classification is local: the query is never sent anywhere to work out what
   * it is. Only identifier classes whose pages exist are offered, so a result
   * in the list always leads somewhere real.
   */
  private universeMatches(searchText: string): any[] {
    if (this.env.BASE_MODULE !== 'mempool' || this.network) {
      // The protocol overlay serves Bitcoin mainnet only.
      return [];
    }
    return classifyUniverseQuery(searchText, this.universeProtocols)
      .slice(0, 6)
      .map((identifier: UniverseIdentifier) => ({
        universeRoute: identifier.route,
        kind: identifier.kind,
        kindLabel: identifierKindLabel(identifier.kind),
        label: this.universeLabel(identifier),
      }));
  }

  private universeLabel(identifier: UniverseIdentifier): string {
    if (identifier.kind !== 'protocol') {
      return identifier.value;
    }
    const protocol = this.universeProtocols.find((entry) => entry.id === identifier.value);
    return protocol?.displayName || identifier.value;
  }

  /** Recently viewed items, offered when the box is empty. Read from this browser only. */
  private recentEntries(): any[] {
    return this.universeLocalService.recentSnapshot()
      .filter((entry) => this.searchAllChains || entry.chain === this.activeChain)
      .slice(0, 5).map((entry) => ({
      universeRoute: [entry.path],
      kind: entry.kind,
      kindLabel: `${entry.chain} ${entry.kind}`,
      label: entry.label,
    }));
  }

  private remoteUniverseMatches(response: UniverseSearchResponse | null): any[] {
    if (!response) {return [];}
    return response.groups.flatMap((group) => group.results.map((entry) => ({
      universeRoute: [entry.path],
      kind: entry.kind,
      kindLabel: `${entry.chain} ${entry.kind}`,
      label: entry.label,
    })));
  }

  private remoteUniverseFailures(response: UniverseSearchResponse | null): string[] {
    if (!response) {return ['Search service unavailable'];}
    return response.failures.map(
      (failure) => `${failure.chain} search ${failure.code}`,
    );
  }

  private navigateUniverse(route: string[]): void {
    this.router.navigate(route);
    this.searchTriggered.emit();
    this.searchForm.setValue({ searchText: '' });
    this.isSearching = false;
  }

  setSearchAllChains(enabled: boolean): void {
    this.searchAllChains = enabled;
    this.searchAllChains$.next(enabled);
  }

  itemSelected(): void {
    setTimeout(() => this.search());
  }

  selectedResult(result: any): void {
    if (result && typeof result === 'object' && result.universeRoute) {
      this.navigateUniverse(result.universeRoute);
      return;
    }
    if (typeof result === 'string') {
      this.search(result);
    } else if (typeof result === 'number' && result <= this.stateService.latestBlockHeight) {
      this.navigate('/block/', result.toString());
    } else if (result.alias) {
      this.navigate('/lightning/node/', result.public_key);
    } else if (result.short_id) {
      this.navigate('/lightning/channel/', result.id);
    } else if (result.network) {
      if (result.isNetworkAvailable) {
        this.navigate('/address/', result.address, undefined, result.network);
      } else {
        this.searchForm.setValue({
          searchText: '',
        });
        this.isSearching = false;
      }
    } else if (result.slug) {
      this.navigate('/mining/pool/', result.slug);
    }
  }

  search(result?: string): void {
    const searchText = result || this.searchForm.value.searchText.trim();
    if (searchText) {
      this.isSearching = true;

      if (this.activeChain !== 'bitcoin' || this.searchAllChains) {
        this.universeApiService.search$(searchText, this.activeChain, this.searchAllChains)
          .pipe(catchError(() => of(null)))
          .subscribe((response) => {
            const first = this.remoteUniverseMatches(response)[0];
            if (first) {
              this.navigateUniverse(first.universeRoute);
            } else {
              this.isSearching = false;
            }
          });
        return;
      }

      // Universe identifiers that no base Bitcoin pattern can match are
      // resolved first, so submitting an outpoint or a rune name from the
      // keyboard lands on the right page without a round trip.
      const universe = this.universeMatches(searchText);
      const exact = universe.find((candidate) => candidate.kind !== 'protocol');
      if (exact) {
        this.navigateUniverse(exact.universeRoute);
        return;
      }

      if (!this.regexTransaction.test(searchText) && this.regexAddress.test(searchText)) {
        this.navigate('/address/', searchText);
      } else if (this.regexBlockhash.test(searchText)) {
        this.navigate('/block/', searchText);
      } else if (this.regexBlockheight.test(searchText)) {
        parseInt(searchText) <= this.stateService.latestBlockHeight ? this.navigate('/block/', searchText) : this.isSearching = false;
      } else if (this.regexTransaction.test(searchText)) {
        const matches = this.regexTransaction.exec(searchText);
        if (this.network === 'liquid' || this.network === 'liquidtestnet') {
          if (this.assets[matches[0]]) {
            this.navigate('/assets/asset/', matches[0]);
          }
          this.electrsApiService.getAsset$(matches[0])
            .subscribe(
              () => { this.navigate('/assets/asset/', matches[0]); },
              () => {
                this.electrsApiService.getBlock$(matches[0])
                  .subscribe(
                    (block) => { this.navigate('/block/', matches[0], { state: { data: { block } } }); },
                    () => { this.navigate('/tx/', matches[0]); });
              }
            );
        } else {
          this.navigate('/tx/', matches[0]);
        }
      } else if (this.regexDate.test(searchText) || this.regexUnixTimestamp.test(searchText)) {
        let timestamp: number;
        this.regexDate.test(searchText) ? timestamp = Math.floor(new Date(searchText).getTime() / 1000) : timestamp = searchText;
        // Check if timestamp is too far in the future or before the genesis block
        if (timestamp > Math.floor(Date.now() / 1000)) {
          this.isSearching = false;
          return;
        }
        this.apiService.getBlockDataFromTimestamp$(timestamp).subscribe(
          (data) => { this.navigate('/block/', data.hash); },
          (error) => { console.log(error); this.isSearching = false; }
        );
      } else {
        this.isSearching = false;
      }
    }
  }


  navigate(url: string, searchText: string, extras?: any, swapNetwork?: string) {
    if (needBaseModuleChange(this.env.BASE_MODULE as 'liquid' | 'mempool', swapNetwork as Network)) {
      window.location.href = getTargetUrl(swapNetwork as Network, searchText, this.env);
    } else {
      this.router.navigate([this.relativeUrlPipe.transform(url, swapNetwork), searchText], extras);
      this.searchTriggered.emit();
      this.searchForm.setValue({
        searchText: '',
      });
      this.isSearching = false;
    }
  }

  getMiningPools(): Observable<any> {
    return this.pools.length ? of(this.pools) : combineLatest([
      this.apiService.listPools$(undefined),
      this.apiService.listPools$('1y')
    ]).pipe(
      map(([poolsResponse, activePoolsResponse]) => {
        const activePoolSlugs = new Set(activePoolsResponse.body.pools.map(pool => pool.slug));

        return poolsResponse.body.map(pool => ({
          name: pool.name,
          slug: pool.slug,
          active: activePoolSlugs.has(pool.slug)
        }))
          // Sort: active pools first, then alphabetically
          .sort((a, b) => {
            if (a.active && !b.active) {return -1;}
            if (!a.active && b.active) {return 1;}
            return a.slug < b.slug ? -1 : 1;
          });

      }),
      catchError(() => of([]))
    );
  }
}
