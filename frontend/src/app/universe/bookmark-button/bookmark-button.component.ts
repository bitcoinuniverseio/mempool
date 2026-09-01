import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { UniverseEntryKind, UniverseLocalService } from '@app/universe/universe-local.service';
import { ExplorerChain, ExplorerNetwork } from '@app/universe/universe.types';

/**
 * Saves a page to the visitor's own browser. No account, no server call, no
 * profile: the list lives in local storage and is readable only by this
 * browser. That is the whole point of it.
 */
@Component({
  selector: 'app-universe-bookmark-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bookmark-button.component.html',
  styleUrls: ['./bookmark-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookmarkButtonComponent implements OnInit, OnDestroy {
  @Input() kind: UniverseEntryKind;
  @Input() value: string;
  @Input() path: string;
  @Input() label: string;
  /** The chain and network the entry belongs to. Defaults match the service. */
  @Input() chain: ExplorerChain = 'bitcoin';
  @Input() network: ExplorerNetwork = 'mainnet';

  saved = false;
  private subscription?: Subscription;

  constructor(
    private local: UniverseLocalService,
    private changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.subscription = this.local.bookmarks$.subscribe(() => {
      const next = this.local.isBookmarked(this.kind, this.value, this.chain, this.network);
      if (next !== this.saved) {
        this.saved = next;
        this.changeDetector.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  toggle(): void {
    if (!this.kind || !this.value || !this.path || !this.label) {return;}
    this.saved = this.local.toggleBookmark({
      kind: this.kind,
      value: this.value,
      path: this.path,
      label: this.label,
      chain: this.chain,
      network: this.network,
    });
    this.changeDetector.markForCheck();
  }

  readonly saveLabel = $localize`:@@universe.bookmark.save-short:Save`;
  readonly savedLabel = $localize`:@@universe.bookmark.saved-short:Saved`;

  get actionLabel(): string {
    return this.saved
      ? $localize`:@@universe.bookmark.remove:Remove from saved`
      : $localize`:@@universe.bookmark.add:Save to this browser`;
  }
}
