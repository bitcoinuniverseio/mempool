import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { AddressCapabilityService, AddressLookupCapability } from '@app/services/address-capability.service';

@Component({
  selector: 'app-search-results',
  templateUrl: './search-results.component.html',
  styleUrls: ['./search-results.component.scss'],
  standalone: false,
})
export class SearchResultsComponent implements OnChanges, OnDestroy {
  @Input() results: any = {};
  @Output() selectedResult = new EventEmitter();

  /**
   * What the deployment says about its address index, read only once a search
   * has actually produced an address.
   *
   * The header invites a reader to search an address, and for a while this
   * deployment could not answer one. The invitation stayed, the result stayed
   * clickable, and the page behind it said the address had too many
   * transactions. Recognising an address is still right, and so is offering
   * it: the address is what the reader typed and it is the right destination.
   * What was missing is telling them, before they go, that the answer will not
   * be there yet.
   */
  addressIndex: AddressLookupCapability | null = null;
  private addressIndexSubscription: Subscription | undefined;

  isMobile = (window.innerWidth <= 1150);
  resultsFlattened = [];
  activeIdx = 0;
  focusFirst = true;
  networkName = '';

  constructor(
    public stateService: StateService,
    private addressCapabilityService: AddressCapabilityService,
    ) { }

  /** True only when the deployment says address lookups will work right now. */
  get addressLookupReady(): boolean {
    return this.addressIndex === null || this.addressIndex.state === 'ready';
  }

  ngOnInit() {
    this.networkName = this.stateService.network.charAt(0).toUpperCase() + this.stateService.network.slice(1);
  }

  /**
   * Index of the first Universe candidate. They are appended last so the
   * upstream index arithmetic above them stays exactly as it was.
   */
  get universeOffset(): number {
    if (!this.results) {
      return 0;
    }
    return (this.results.hashQuickMatch ? 1 : 0)
      + (this.results.addresses?.length || 0)
      + (this.results.pools?.length || 0)
      + (this.results.nodes?.length || 0)
      + (this.results.channels?.length || 0)
      + (this.results.otherNetworks?.length || 0);
  }

  get universeRecentOffset(): number {
    return this.universeOffset + (this.results?.universe?.length || 0);
  }

  ngOnDestroy(): void {
    this.addressIndexSubscription?.unsubscribe();
  }

  ngOnChanges() {
    this.activeIdx = 0;
    // Only once there is an address on screen, and the service caches its
    // answer, so typing does not put a request on the wire per keystroke.
    if (this.results?.address && !this.addressIndexSubscription) {
      this.addressIndexSubscription = this.addressCapabilityService.getAddressLookup$()
        .subscribe((capability) => { this.addressIndex = capability; });
    }
    if (this.results) {
      this.resultsFlattened = [...(this.results.hashQuickMatch ? [this.results.searchText] : []), ...this.results.addresses, ...this.results.pools, ...this.results.nodes, ...this.results.channels, ...this.results.otherNetworks, ...(this.results.universe || []), ...(this.results.universeRecent || [])];
      // If searchText is a public key corresponding to a node, select it by default
      if (this.results.publicKey && this.results.nodes.length > 0) {
        this.activeIdx = 1;
      }
    }
  }

  searchButtonClick() {
    if (this.resultsFlattened[this.activeIdx]) {
      this.selectedResult.emit(this.resultsFlattened[this.activeIdx]);
      this.results = null;
    }
  }

  handleKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.next();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.prev();
        break;
      case 'Enter':
        event.preventDefault();
        if (this.resultsFlattened[this.activeIdx]?.isNetworkAvailable === false) {
          return;
        }
        if (this.resultsFlattened[this.activeIdx]) {
          this.selectedResult.emit(this.resultsFlattened[this.activeIdx]);
        } else {
          this.selectedResult.emit(this.results.searchText);
        }
        this.results = null;
        break;
    }
  }

  clickItem(id: number) {
    this.selectedResult.emit(this.resultsFlattened[id]);
    this.results = null;
  }

  next() {
    if (this.activeIdx === this.resultsFlattened.length - 1) {
      this.activeIdx = this.focusFirst ? (this.activeIdx + 1) % this.resultsFlattened.length : -1;
    } else {
      this.activeIdx++;
    }
  }

  prev() {
    if (this.activeIdx < 0) {
      this.activeIdx = this.resultsFlattened.length - 1;
    } else if (this.activeIdx === 0) {
      this.activeIdx = this.focusFirst ? this.resultsFlattened.length - 1 : -1;
    } else {
      this.activeIdx--;
    }
  }

}
