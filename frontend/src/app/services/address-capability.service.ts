import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer, of, shareReplay, catchError, map } from 'rxjs';
import { StateService } from '@app/services/state.service';

/**
 * What the deployment says about its own Bitcoin address index.
 *
 * The page needs this because the difference between "there is no index" and
 * "the index is at block 700,000 of 964,769" is the difference between an
 * apology and a progress report, and the failing request itself cannot tell
 * the two apart: both arrive as an upstream that would not answer.
 *
 * It is deliberately a read of the deployment's own capability document rather
 * than a second opinion formed here. The backend, the release preflight and
 * the production check all read the same document, so the page cannot end up
 * describing a state none of them believe in.
 */

export type AddressLookupState = 'ready' | 'syncing' | 'degraded' | 'unavailable' | 'disabled';

export interface AddressLookupCapability {
  readonly enabled: boolean;
  readonly routesRegistered: boolean;
  readonly state: AddressLookupState;
  readonly indexedTip: number | null;
  readonly bitcoinCoreTip: number | null;
  readonly lagBlocks: number | null;
  readonly degradedReason: string | null;
}

interface CapabilitiesResponse {
  features?: Record<string, Partial<AddressLookupCapability>>;
}

/** What the page assumes when the deployment will not say. */
const UNKNOWN: AddressLookupCapability = {
  enabled: false,
  routesRegistered: false,
  state: 'unavailable',
  indexedTip: null,
  bitcoinCoreTip: null,
  lagBlocks: null,
  degradedReason: null,
};

@Injectable({ providedIn: 'root' })
export class AddressCapabilityService {
  private apiBaseUrl: string;
  private inFlight: Observable<AddressLookupCapability> | null = null;
  private fetchedAt = 0;
  private cachedNetwork: string | null = null;

  /**
   * How long an answer is reused.
   *
   * Long enough that a reader clicking between address pages during an outage
   * does not put a request on the wire for each one, short enough that an
   * index finishing its sync is reflected while somebody is still looking at
   * the page that told them it was building.
   */
  private static readonly TTL_MS = 15_000;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = '';
    if (!stateService.isBrowser) {
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }

  /**
   * The address index state, cached briefly and shared between subscribers.
   *
   * It never throws. A page that cannot read the capability document is in no
   * position to explain anything, and an error here would replace one unhelpful
   * message with another.
   */
  getAddressLookup$(): Observable<AddressLookupCapability> {
    // Resolve cache identity at subscription time, when HttpClient's network
    // interceptor resolves the request, rather than when an observable is made.
    return defer(() => {
      const now = Date.now();
      const network = this.stateService.network;
      if (!this.inFlight || this.cachedNetwork !== network || now - this.fetchedAt > AddressCapabilityService.TTL_MS) {
        this.cachedNetwork = network;
        this.fetchedAt = now;
        this.inFlight = this.httpClient.get<CapabilitiesResponse>(this.apiBaseUrl + '/api/v1/capabilities').pipe(
          map(report => this.read(report)),
          catchError(() => of(UNKNOWN)),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
      }
      return this.inFlight;
    });
  }

  private read(report: CapabilitiesResponse): AddressLookupCapability {
    const feature = report?.features?.addressLookup;
    if (!feature) {
      return UNKNOWN;
    }
    return {
      enabled: feature.enabled === true,
      routesRegistered: feature.routesRegistered === true,
      state: ['ready', 'syncing', 'degraded', 'unavailable', 'disabled'].includes(feature.state ?? '') ? feature.state! : 'unavailable',
      // A height that is absent stays absent. Rendering a missing number as
      // zero would tell a reader the index has indexed nothing, which is a
      // different and much worse claim than not knowing.
      indexedTip: Number.isSafeInteger(feature.indexedTip) && feature.indexedTip! >= 0 ? feature.indexedTip! : null,
      bitcoinCoreTip: Number.isSafeInteger(feature.bitcoinCoreTip) && feature.bitcoinCoreTip! >= 0 ? feature.bitcoinCoreTip! : null,
      lagBlocks: Number.isSafeInteger(feature.lagBlocks) && feature.lagBlocks! >= 0 ? feature.lagBlocks! : null,
      degradedReason: typeof feature.degradedReason === 'string' ? feature.degradedReason : null,
    };
  }
}
