import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UniverseSharedModule } from '@app/universe/universe-shared.module';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ExplorerProtocolDefinition } from '@app/universe/universe.types';
import { PresentedQuantity, shortenAssetId } from '@app/universe/asset-summary/asset-summary.presentation';
import { formatAtomicAmount } from '@app/universe/universe-evidence';
import { InventoryScopeKind } from './asset-inventory.types';
import {
  AssetRow,
  CoverageRow,
  EventRow,
  InventoryViewModel,
  ProtocolSection,
  SubgroupSection,
  quantityText,
} from './asset-inventory.view';
import type { InventoryLoadState } from './asset-inventory.component';

export type InventoryErrorKind =
  | 'not-found'
  | 'unconfigured'
  | 'unavailable'
  | 'timeout'
  | 'invalid'
  | 'invalid-request'
  | 'wrong-network'
  | 'stale'
  | 'error';

/** Rows shown per subgroup before the reader asks for more. All stay reachable. */
export const INVENTORY_ROWS_STEP = 50;

/**
 * Renders one asset inventory: protocol sections with their subprotocol
 * groups, each underlying asset once per group with its classifications,
 * exact quantities, placements, applied events and observations, then the
 * per-protocol coverage and source checkpoints the claims rest on.
 *
 * Shared by the transaction, block and address pages; it owns no requests and
 * only reports retry, continue and stop back to its host.
 */
@Component({
  selector: 'app-universe-asset-inventory-presenter',
  standalone: true,
  imports: [CommonModule, RouterModule, UniverseSharedModule],
  templateUrl: './asset-inventory-presenter.component.html',
  styleUrls: ['./asset-inventory-presenter.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetInventoryPresenterComponent {
  @Input() scope: InventoryScopeKind = 'transaction';
  @Input() state: InventoryLoadState | null = null;
  @Output() retry = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() stop = new EventEmitter<void>();

  readonly shorten = shortenAssetId;
  readonly quantityText = quantityText;

  private readonly visible = new Map<string, number>();
  private readonly badges = new Map<string, ExplorerProtocolDefinition>();
  private readonly relativeUrl = new RelativeUrlPipe();

  get model(): InventoryViewModel | null {
    return this.state?.model ?? null;
  }

  rowsFor(group: SubgroupSection): readonly AssetRow[] {
    return group.assets.slice(0, this.limit(group.id));
  }

  eventsFor(group: SubgroupSection, list: readonly EventRow[], kind: string): readonly EventRow[] {
    return list.slice(0, this.limit(group.id + kind));
  }

  hiddenCount(id: string, total: number): number {
    return Math.max(0, total - this.limit(id));
  }

  showMore(id: string): void {
    this.visible.set(id, this.limit(id) + INVENTORY_ROWS_STEP * 2);
  }

  private limit(id: string): number {
    return this.visible.get(id) ?? INVENTORY_ROWS_STEP;
  }

  badgeFor(section: { protocolId: string; name: string }): ExplorerProtocolDefinition {
    let badge = this.badges.get(section.protocolId);
    if (!badge || badge.shortName !== section.name) {
      badge = {
        id: section.protocolId, shortName: section.name, displayName: section.name, visualToken: section.protocolId,
      } as ExplorerProtocolDefinition;
      this.badges.set(section.protocolId, badge);
    }
    return badge;
  }

  link(route: unknown[] | null): unknown[] | null {
    return route ? [this.relativeUrl.transform(route[0] as string), ...route.slice(1)] : null;
  }

  txLink(txid: string): unknown[] {
    return [this.relativeUrl.transform('/tx'), txid];
  }

  /** Short headline with the exact value always available as its title. */
  headline(quantity: PresentedQuantity | null): string {
    return quantity && quantity.kind !== 'unknown' ? quantity.headline : '';
  }

  count(value: number | null): string {
    return value === null ? '' : formatAtomicAmount(String(value));
  }

  itemsLabel(): string {
    return this.scope === 'block'
      ? $localize`:@@universe.inventory.items.transactions:transactions`
      : $localize`:@@universe.inventory.items.outputs:outputs`;
  }

  trackSection(_: number, section: ProtocolSection): string {
    return section.id;
  }

  trackGroup(_: number, group: SubgroupSection): string {
    return group.id;
  }

  trackAsset(_: number, row: AssetRow): string {
    return row.key;
  }

  trackEvent(_: number, row: EventRow): string {
    return row.id;
  }

  trackCoverage(_: number, row: CoverageRow): string {
    return row.protocolId;
  }

  trackId(_: number, row: { id: string }): string {
    return row.id;
  }
}
