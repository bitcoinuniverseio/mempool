import { NamesAssetViewState, NAMES_INSCRIPTION_ID, namesAssetState$ } from '../names-explorer-asset';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, Subscription, switchMap, combineLatest, of, shareReplay, catchError, Subject, startWith, defer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { OrdInscriptionView } from '@app/universe/universe.types';
import {
  AssetViewState,
  assetState$,
  ASSET_LOOKUP_GATEWAY_RESPONSE_MS,
  assetStatusMessage,
  assetTone,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';

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
  ) {}

  ngOnInit(): void {
    this.state$ = this.retryTrigger$.pipe(startWith(undefined), switchMap(() =>
      combineLatest([this.route.paramMap, defer(() => this.api.selectedNetwork$()).pipe(catchError(() => of(null)))]).pipe(
        switchMap(([params, network]) => {
          const reference = (params.get('reference') || '').trim();
          this.seo.setTitle(`Inscription ${shortenIdentifier(reference, 10)}`);
          return assetState$<OrdInscriptionView>(reference, () => {
            if (network === null) {throw new Error('Unsupported inscription network context');}
            return this.api.getInscription$(reference, network);
          }, {firstResponseTimeoutMs:this.api.assetLookupDeadlineMs ?? ASSET_LOOKUP_GATEWAY_RESPONSE_MS});
        }),
      )), shareReplay({bufferSize:1,refCount:true}),
    );

    this.namesState$ = this.namesRetryTrigger$.pipe(startWith(undefined), switchMap(() =>
      combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      switchMap(([params, query]) => {
        const protocols = query.getAll('protocol');
        if (!protocols.includes('names')) {return of<NamesAssetViewState>({kind:'absent'});}
        if (protocols.length !== 1 || protocols[0] !== 'names') {return of<NamesAssetViewState>({kind:'unavailable',reason:'Names context query must be a single protocol=names value.'});}
        const reference = (params.get('reference') || '').trim();
        if (!NAMES_INSCRIPTION_ID.test(reference)) {return of<NamesAssetViewState>({kind:'unavailable',reason:'Names details require an exact inscription id.'});}
        return this.api.selectedNetwork$().pipe(switchMap(network =>
          namesAssetState$(this.api.getNamesObject$(reference, network), reference, network)));
      }), catchError(() => of<NamesAssetViewState>({kind:'unavailable',reason:'The selected Names network context is unavailable.'})))),
      shareReplay({bufferSize:1,refCount:true}),
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {return;}
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

  retryNames(): void { this.namesRetryTrigger$.next(); }

  retry(): void { this.retryTrigger$.next(); }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  static valid(reference: string): boolean {
    return INSCRIPTION_ID.test(reference) || INSCRIPTION_NUMBER.test(reference);
  }

  /** The output the inscription currently sits on, so it can be opened directly. */
  outpointRoute(satpoint: string | null): string[] | null {
    if (!satpoint) {return null;}
    const parts = satpoint.split(':');
    if (parts.length !== 3) {return null;}
    const [txid, vout] = parts;
    if (!/^[0-9a-f]{64}$/.test(txid) || !/^(0|[1-9][0-9]{0,9})$/.test(vout)) {return null;}
    return [this.networkPath('/outpoint'), txid, vout];
  }

  /** The transaction that revealed this inscription, taken from its own id. */
  revealTxid(id: string): string | null {
    return INSCRIPTION_ID.test(id) ? id.slice(0, 64) : null;
  }

  networkPath(path: string): string {
    return (this.api.network === 'mainnet' ? '' : '/' + this.api.network) + path;
  }

  charmLabel(charm: string): string {
    return charm.replace(/[_-]+/g, ' ');
  }
}
