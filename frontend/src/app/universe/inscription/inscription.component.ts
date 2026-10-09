import { assetRouteContext$, assetRouteState$ } from '../asset-route-context';
import {
  NamesAssetViewState,
  NAMES_INSCRIPTION_ID,
  namesAssetState$,
  namesObservationState$,
} from '../names-explorer-asset';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  Optional,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import {
  Observable,
  Subscription,
  switchMap,
  combineLatest,
  of,
  shareReplay,
  catchError,
  Subject,
  startWith,
  defer,
  map,
  distinctUntilChanged,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import {
  OrdInscriptionView,
  ExplorerNetwork,
} from '@app/universe/universe.types';
import {
  AssetViewState,
  assetState$,
  ASSET_LOOKUP_GATEWAY_RESPONSE_MS,
  assetStatusMessage,
  assetTone,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import {
  formatAtomicAmount,
  shortenIdentifier,
} from '@app/universe/universe-evidence';

const INSCRIPTION_ID = /^[0-9a-f]{64}i(0|[1-9][0-9]{0,9})$/;
const INSCRIPTION_NUMBER = /^-?(0|[1-9][0-9]{0,18})$/;

/**
 * One inscription, as the first-party ord authority reports it.
 *
 * The page never renders inscription content. Rendering arbitrary inscribed
 * data would mean executing whatever a stranger put on chain inside the
 * explorer's own origin, and no view is worth that.
 */
@Component({
  selector: 'app-universe-inscription',
  standalone: true,
  imports: [CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './inscription.component.html',
  styleUrls: ['./inscription.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InscriptionComponent implements OnInit, OnDestroy {
  state$: Observable<AssetViewState<OrdInscriptionView>>;
  namesState$: Observable<NamesAssetViewState>;

  readonly shorten = shortenIdentifier;
  readonly statusMessage = assetStatusMessage;
  readonly tone = assetTone;
  readonly utc = utcFromSeconds;
  readonly amount = formatAtomicAmount;

  private readonly namesRetryTrigger$ = new Subject<void>();
  private readonly retryTrigger$ = new Subject<void>();
  private visitSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    public api: UniverseApiService,
    private local: UniverseLocalService,
    private seo: SeoService,
    @Optional() private router?: Router
  ) {}

  ngOnInit(): void {
    const reference$ = this.route.paramMap.pipe(
      map((params) => (params.get('reference') || '').trim()),
      distinctUntilChanged()
    );
    const network$ = defer(() => this.api.selectedNetwork$()).pipe(
      catchError(() => of(null))
    );
    const ordinaryEqual = (
      a: { reference: string; network: ExplorerNetwork | null },
      b: { reference: string; network: ExplorerNetwork | null }
    ): boolean => a.reference === b.reference && a.network === b.network;
    const ordinaryContext$ = assetRouteContext$(
      combineLatest([reference$, network$]).pipe(
        map(([reference, network]) => ({ reference, network })),
        distinctUntilChanged(ordinaryEqual)
      ),
      this.router
    );
    this.state$ = this.retryTrigger$.pipe(
      startWith(undefined),
      switchMap(() =>
        assetRouteState$(
          ordinaryContext$,
          ({ reference, network }) => {
            this.seo.setTitle(
              `Inscription ${shortenIdentifier(reference, 10)}`
            );
            return assetState$<OrdInscriptionView>(
              reference,
              () => {
                if (network === null) {
                  throw new Error('Unsupported inscription network context');
                }
                return this.api.getInscription$(reference, network);
              },
              {
                firstResponseTimeoutMs:
                  this.api.assetLookupDeadlineMs ??
                  ASSET_LOOKUP_GATEWAY_RESPONSE_MS,
              }
            );
          },
          ({ reference }): AssetViewState<OrdInscriptionView> => ({
            kind: 'loading',
            reference,
          }),
          ({ reference }): AssetViewState<OrdInscriptionView> => ({
            kind: 'unavailable',
            reference,
          }),
          ordinaryEqual
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    const protocols$ = this.route.queryParamMap.pipe(
      map((query) => query.getAll('protocol')),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
    const namesEqual = (
      a: {
        reference: string;
        network: ExplorerNetwork | null;
        protocols: string[];
      },
      b: {
        reference: string;
        network: ExplorerNetwork | null;
        protocols: string[];
      }
    ): boolean =>
      ordinaryEqual(a, b) &&
      JSON.stringify(a.protocols) === JSON.stringify(b.protocols);
    const namesContext$ = assetRouteContext$(
      combineLatest([reference$, protocols$, network$]).pipe(
        map(([reference, protocols, network]) => ({
          reference,
          protocols,
          network,
        })),
        distinctUntilChanged(namesEqual)
      ),
      this.router
    );
    this.namesState$ = this.namesRetryTrigger$.pipe(
      startWith(undefined),
      switchMap(() =>
        assetRouteState$(
          namesContext$,
          ({
            reference,
            protocols,
            network,
          }): Observable<NamesAssetViewState> => {
            if (!protocols.includes('names')) {
              return of({ kind: 'absent' });
            }
            if (protocols.length !== 1 || protocols[0] !== 'names') {
              return of({
                kind: 'unavailable',
                reason:
                  'Names context query must be a single protocol=names value.',
              });
            }
            if (!NAMES_INSCRIPTION_ID.test(reference)) {
              return of({
                kind: 'unavailable',
                reason: 'Names details require an exact inscription id.',
              });
            }
            if (network === null) {
              return of({
                kind: 'unavailable',
                reason: 'The selected Names network context is unavailable.',
              });
            }
            return namesAssetState$(
              this.api.getNamesObject$(reference, network),
              reference,
              network
            );
          },
          ({ protocols }): NamesAssetViewState =>
            protocols.includes('names')
              ? { kind: 'loading' }
              : { kind: 'absent' },
          (): NamesAssetViewState => ({
            kind: 'unavailable',
            reason: 'The selected Names network context is unavailable.',
          }),
          namesEqual,
          (state) => namesObservationState$(state)
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {
        return;
      }
      const inscription = state.result.value;
      this.local.recordVisit({
        chain: 'bitcoin',
        network: this.api.network,
        kind: 'inscription',
        value: inscription.id,
        path: this.networkPath(`/inscription/${inscription.id}`),
        label: `Inscription ${inscription.numberAtomic}`,
      });
    });
  }

  retryNames(): void {
    this.namesRetryTrigger$.next();
  }

  retry(): void {
    this.retryTrigger$.next();
  }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  static valid(reference: string): boolean {
    return INSCRIPTION_ID.test(reference) || INSCRIPTION_NUMBER.test(reference);
  }

  /** The output the inscription currently sits on, so it can be opened directly. */
  outpointRoute(satpoint: string | null): string[] | null {
    if (!satpoint) {
      return null;
    }
    const parts = satpoint.split(':');
    if (parts.length !== 3) {
      return null;
    }
    const [txid, vout] = parts;
    if (!/^[0-9a-f]{64}$/.test(txid) || !/^(0|[1-9][0-9]{0,9})$/.test(vout)) {
      return null;
    }
    return [this.networkPath('/outpoint'), txid, vout];
  }

  /** The transaction that revealed this inscription, taken from its own id. */
  revealTxid(id: string): string | null {
    return INSCRIPTION_ID.test(id) ? id.slice(0, 64) : null;
  }

  networkPath(path: string): string {
    return (
      (this.api.network === 'mainnet' ? '' : '/' + this.api.network) + path
    );
  }

  charmLabel(charm: string): string {
    return charm.replace(/[_-]+/g, ' ');
  }
}
