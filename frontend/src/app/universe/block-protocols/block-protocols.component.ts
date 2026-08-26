import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AssetLookupResult, OrdBlockInscriptionsView } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface BlockProtocolsState {
  readonly kind: 'loading' | 'ready' | 'unavailable' | 'skipped';
  readonly result?: AssetLookupResult<OrdBlockInscriptionsView>;
}

/** How many inscription ids to show before the list is summarised. */
const VISIBLE_LIMIT = 24;

/**
 * What protocol activity a confirmed block actually contains.
 *
 * This asks the asset authority for the inscriptions revealed in one block,
 * which is a fact it can answer in a single bounded request. It deliberately
 * does not attempt to enrich every transaction in the block: that would be
 * thousands of authority reads per page view, and a page that slow would stop
 * being used.
 */
@Component({
  selector: 'app-universe-block-protocols',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './block-protocols.component.html',
  styleUrls: ['./block-protocols.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockProtocolsComponent implements OnChanges {
  @Input() height: number | null = null;

  state$: Observable<BlockProtocolsState>;
  readonly shorten = shortenIdentifier;
  readonly visibleLimit = VISIBLE_LIMIT;

  constructor(private api: UniverseApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.height) {return;}
    if (this.height === null || this.height === undefined || this.height < 0) {
      this.state$ = of<BlockProtocolsState>({ kind: 'skipped' });
      return;
    }
    this.state$ = this.api.getBlockInscriptions$(this.height).pipe(
      map((result): BlockProtocolsState =>
        result?.status === 'ok' && result.value
          ? { kind: 'ready', result }
          : { kind: 'unavailable', result },
      ),
      catchError((error: HttpErrorResponse) => {
        const body = error?.error;
        const result =
          body && typeof body === 'object' && typeof body.status === 'string'
            ? (body as AssetLookupResult<OrdBlockInscriptionsView>)
            : undefined;
        return of<BlockProtocolsState>({ kind: 'unavailable', result });
      }),
      startWith<BlockProtocolsState>({ kind: 'loading' }),
    );
  }

  visible(ids: string[]): string[] {
    return ids.slice(0, VISIBLE_LIMIT);
  }

  hiddenCount(result: AssetLookupResult<OrdBlockInscriptionsView>): number {
    const ids = result.value?.ids ?? [];
    return Math.max(0, ids.length - VISIBLE_LIMIT);
  }

  /** Explains what the count does and does not cover, without hedging into noise. */
  summary(result: AssetLookupResult<OrdBlockInscriptionsView>): string {
    const count = result.value?.ids.length ?? 0;
    if (result.value?.more) {
      return $localize`:@@universe.block.more:The authority returned the first ${count}:count: inscriptions revealed in this block and reports there are more.`;
    }
    if (count === 0) {
      return $localize`:@@universe.block.none:No inscription was revealed in this block.`;
    }
    return $localize`:@@universe.block.count:${count}:count: inscriptions were revealed in this block.`;
  }

  unavailableMessage(result?: AssetLookupResult<OrdBlockInscriptionsView>): string {
    if (result?.status === 'unconfigured') {
      return $localize`:@@universe.block.unconfigured:This deployment has no asset authority configured, so protocol activity is not shown for blocks.`;
    }
    return $localize`:@@universe.block.unavailable:The asset authority could not be reached, so protocol activity for this block is unknown.`;
  }
}
