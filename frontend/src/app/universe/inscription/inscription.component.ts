import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, Subscription, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { OrdInscriptionView } from '@app/universe/universe.types';
import {
  AssetViewState,
  assetState$,
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

  readonly shorten = shortenIdentifier;
  readonly statusMessage = assetStatusMessage;
  readonly tone = assetTone;
  readonly utc = utcFromSeconds;
  readonly amount = formatAtomicAmount;

  private visitSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.state$ = this.route.paramMap.pipe(
      switchMap((params) => {
        const reference = (params.get('reference') || '').trim();
        this.seo.setTitle(`Inscription ${shortenIdentifier(reference, 10)}`);
        return assetState$<OrdInscriptionView>(
          reference,
          this.api.getInscription$(reference),
        );
      }),
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {return;}
      const inscription = state.result.value;
      this.local.recordVisit({
        kind: 'inscription',
        value: inscription.id,
        path: `/inscription/${inscription.id}`,
        label: `Inscription ${inscription.numberAtomic}`,
      });
    });
  }

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
    return ['/outpoint', txid, vout];
  }

  /** The transaction that revealed this inscription, taken from its own id. */
  revealTxid(id: string): string | null {
    return INSCRIPTION_ID.test(id) ? id.slice(0, 64) : null;
  }

  charmLabel(charm: string): string {
    return charm.replace(/[_-]+/g, ' ');
  }
}
