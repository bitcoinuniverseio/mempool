import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, Subscription, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { OrdSatView } from '@app/universe/universe.types';
import {
  AssetViewState,
  assetState$,
  assetStatusMessage,
  assetTone,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';

/**
 * One satoshi.
 *
 * Rarity here is not an opinion. It comes from where the satoshi sits in
 * Bitcoin's own issuance schedule, so the page states the rule that makes it
 * rare rather than asserting the label on its own.
 */
@Component({
  selector: 'app-universe-sat',
  standalone: true,
  imports: [CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './sat.component.html',
  styleUrls: ['./sat.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SatComponent implements OnInit, OnDestroy {
  state$: Observable<AssetViewState<OrdSatView>>;

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
        this.seo.setTitle(`Sat ${reference}`);
        return assetState$<OrdSatView>(reference, this.api.getSat$(reference));
      }),
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {return;}
      const sat = state.result.value;
      this.local.recordVisit({
        kind: 'sat',
        value: sat.numberAtomic,
        path: `/sat/${sat.numberAtomic}`,
        label: sat.name ? `Sat ${sat.name}` : `Sat ${sat.numberAtomic}`,
      });
    });
  }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  rarityLabel(rarity: string): string {
    switch (rarity) {
      case 'mythic': return $localize`:@@universe.rarity.mythic:Mythic`;
      case 'legendary': return $localize`:@@universe.rarity.legendary:Legendary`;
      case 'epic': return $localize`:@@universe.rarity.epic:Epic`;
      case 'rare': return $localize`:@@universe.rarity.rare:Rare`;
      case 'uncommon': return $localize`:@@universe.rarity.uncommon:Uncommon`;
      case 'common': return $localize`:@@universe.rarity.common:Common`;
      default: return rarity;
    }
  }

  /** The rule that produces this rarity, so the label is checkable. */
  rarityReason(sat: OrdSatView): string {
    switch (sat.rarity) {
      case 'mythic':
        return $localize`:@@universe.sat.reason-mythic:The first satoshi of the genesis block. There is exactly one.`;
      case 'legendary':
        return $localize`:@@universe.sat.reason-legendary:The first satoshi of a cycle, which happens every six halvings.`;
      case 'epic':
        return $localize`:@@universe.sat.reason-epic:The first satoshi of a halving epoch.`;
      case 'rare':
        return $localize`:@@universe.sat.reason-rare:The first satoshi of a difficulty adjustment period.`;
      case 'uncommon':
        return $localize`:@@universe.sat.reason-uncommon:The first satoshi of a block.`;
      default:
        return $localize`:@@universe.sat.reason-common:Not the first satoshi of any block, period, epoch, or cycle. Most satoshis are common.`;
    }
  }

  outpointRoute(satpoint: string | null): string[] | null {
    if (!satpoint) {return null;}
    const parts = satpoint.split(':');
    if (parts.length !== 3) {return null;}
    const [txid, vout] = parts;
    if (!/^[0-9a-f]{64}$/.test(txid) || !/^(0|[1-9][0-9]{0,9})$/.test(vout)) {return null;}
    return ['/outpoint', txid, vout];
  }
}
