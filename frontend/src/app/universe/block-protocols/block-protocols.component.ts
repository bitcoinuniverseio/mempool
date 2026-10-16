import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AssetLookupResult, OrdBlockInscriptionsView } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

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
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  templateUrl: './block-protocols.component.html',
  styleUrls: ['./block-protocols.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/**
 * IMPLEMENTATION-HANDOFF [WP-FE-BLOCK] ANN-FE-BLOCK-COMPONENT | preparation 2026-10-16
 * F-FE-01; C-FE-BLOCK-ALL, C-FE-BLOCK-PAGES, C-FE-BLOCK-REORG.
 * Verified: this component requests only inscriptions revealed at height, shows
 * 24 IDs, and has no continuation control or other asset protocol inventory.
 * Prerequisites: WP-BE-CONTRACT, WP-BE-BLOCK, WP-FE-REG.
 * 1. Reconcile existing local candidate commit
 * 6c2f1db897cdbcc51da69f26b131111db698df87 on
 * claude/block-asset-explorer-38d2b0 before editing. Its block-assets component,
 * view and tests are candidate implementation, not accepted functionality.
 * Root preserves the commit in the handoff; do not merge it blindly.
 * 2. Replace this reveal-only integration with the owned block asset summary
 * contract. Bind chain/network/block hash and height; verify all response
 * identifiers and checkpoint/hash before displaying membership. Preserve the
 * inscription reveal view as an action facet within the full block inventory.
 * 3. Render grouped protocol/subprotocol assets with exact quantities and
 * distinct transaction membership/action counts. Page assets and transactions
 * using stable snapshot cursors. Never request enrichment for every transaction
 * from the browser or present the first page as a complete block.
 * 4. Add or adapt block-assets specs (PROPOSED NEW relative to this baseline)
 * for more than 24 IDs, more than one page, transfers without reveals, mixed
 * protocols, zero versus unavailable, reorg, stale hash and cancellation.
 * Run frontend npm test -- src/app/universe/block-assets after wiring; NOT RUN,
 * path is present only in the saved candidate until integrated.
 * Acceptance: every matching block transaction and asset is reachable with exact
 * scope; real supported test-network readback survives navigation/reload.
 * Rollback the block consumer and endpoint together, retaining old reveal API
 * compatibility until rollout completes. ANNOTATED does not mean implemented.
 * Source: user scope and supplied preparation brief; pinned source at aef1d00038b7c3b438ad6264e1d6b3f13ccf84e7; governing protocol semantics in reports/integrated-protocol-research.json.
 */
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
