/**
 * The collectibles gallery: a responsive uniform-grid gallery for
 * NFT-like holdings, with selection and a detail side sheet placeholder
 * that links to the protocol protocol object pages rather than
 * duplicating them.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfolioSessionService } from '../stores/session.service';
import { atomicToDisplay, formatExact, maskedValue } from '../shared/exact';

const COLLECTIBLE_TYPES = new Set(['nft', 'inscription', 'rare_sat', 'name', 'realm', 'subrealm', 'bitmap']);

@Component({
  selector: 'app-collectibles-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gallery">
      @if (items().length === 0) {
        <p class="soft" i18n="@@universe.portfolio.gallery.empty">
          No collectible holdings found in the included accounts.
        </p>
      } @else {
        <ul class="grid">
          @for (item of items(); track item.assetKey) {
            <li
              (click)="selected.set(item.assetKey)"
              (keydown.enter)="selected.set(item.assetKey)"
              tabindex="0"
              [class.selected]="selected() === item.assetKey"
            >
              <div class="thumb" aria-hidden="true">
                <span class="glyph">{{ item.glyph }}</span>
              </div>
              <div class="meta">
                <strong>{{ item.name }}</strong>
                <span class="sub">{{ item.protocol }}</span>
                <span class="sub">{{ session.valuesHidden() ? masked() : item.value }}</span>
              </div>
            </li>
          }
        </ul>
      }
      <p class="soft" i18n="@@universe.portfolio.gallery.note">
        Media loads only from first-party content services; unknown or external media renders
        as a generated placeholder and never executes anything.
      </p>
    </div>
  `,
  styles: [
    `
      .gallery { display: flex; flex-direction: column; gap: 12px; }
      .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
      .grid li { border: 1px solid var(--u-separator, rgba(0,0,0,0.08)); border-radius: 12px; overflow: hidden; cursor: pointer; }
      .grid li.selected { border-color: var(--u-brand, #c40059); }
      .thumb { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: var(--u-surface-raised, rgba(0,0,0,0.04)); font-size: 40px; }
      .meta { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
      .sub { color: var(--u-fg-soft, inherit); font-size: 11.5px; font-variant-numeric: tabular-nums; }
      .soft { font-size: 12.5px; color: var(--u-fg-soft, inherit); }
    `,
  ],
})
export class CollectiblesGalleryComponent {
  readonly data = inject(PortfolioDataService).state;
  readonly session = inject(PortfolioSessionService);
  readonly portfolioId = input<string>('');

  readonly selected = signal('');

  readonly items = computed(() => {
    const aggregation = this.data().aggregation;
    if (aggregation === null) return [];
    return aggregation.holdings
      .filter((holding) => COLLECTIBLE_TYPES.has(holding.assetType))
      .map((holding) => ({
        assetKey: holding.assetKey,
        name: holding.displayName ?? holding.assetKey.split(':').pop() ?? 'Collectible',
        protocol: holding.protocol,
        glyph: GLYPHS[holding.assetType] ?? '◈',
        value:
          holding.pricedValue === null
            ? $localize`:@@universe.portfolio.gallery.unpriced:Unpriced`
            : formatExact(holding.pricedValue, 'en'),
      }));
  });

  protected masked(): string {
    return maskedValue();
  }

  protected quantity(quantity: string | null, decimals?: number): string {
    const display = atomicToDisplay(quantity, decimals ?? 0);
    return display === null ? '-' : formatExact(display, 'en');
  }
}

const GLYPHS: Record<string, string> = {
  nft: '🖼',
  inscription: '⌘',
  rare_sat: '✦',
  name: 'Ⓝ',
  realm: 'Ⓡ',
  subrealm: 'ⓡ',
  bitmap: '▦',
};
