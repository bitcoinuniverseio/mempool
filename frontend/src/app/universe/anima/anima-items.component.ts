import { ChangeDetectionStrategy, Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AnimaOrganism } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';
import { AnimaFailure, animaFailureFrom, animaFailureText, animaFailureTitle } from './anima-failure';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

export interface AnimaItemsViewModel {
  readonly kind: 'loading' | 'ready' | 'degraded' | 'error';
  readonly organisms?: AnimaOrganism[];
  readonly total?: number;
  readonly loadingMore?: boolean;
  readonly canLoadMore?: boolean;
  readonly degradedReason?: string | null;
  /** Why the page could not be read at all, or why the next page failed. */
  readonly failure?: AnimaFailure;
  /** A failed next page keeps every organism already shown; this says so. */
  readonly pageFailure?: AnimaFailure | null;
}

/**
 * The organism list. ANIMA calls its items organisms: state machines whose
 * state lives in Bitcoin outputs. The list is the authority's, paged, with
 * each entry linking to its full record.
 */
@Component({
  selector: 'app-anima-items',
  templateUrl: './anima-items.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaItemsComponent implements OnInit {
  private readonly state = new BehaviorSubject<AnimaItemsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<AnimaItemsViewModel> = this.state.asObservable();
  readonly shorten = shortenIdentifier;
  readonly failureText = animaFailureText;
  readonly failureTitle = animaFailureTitle;

  private organisms: AnimaOrganism[] = [];
  private total = 0;
  private loadingMore = false;
  private pageFailure: AnimaFailure | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private destroyRef: DestroyRef,
  ) {
    this.seo.setTitle($localize`ANIMA organisms`);
  }

  ngOnInit(): void {
    this.api.getAnimaStatus$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          if (status.state !== 'served') {
            this.state.next({
              kind: 'degraded',
              degradedReason:
                status.degradedReason
                ?? 'The ANIMA authority is not answering, so no organisms are shown.',
            });
            return;
          }
          this.loadFirstPage();
        },
        error: (error: unknown) => this.fail(animaFailureFrom(error)),
      });
  }

  /**
   * Loads the next page, or retries the one that failed. The continuation is
   * the count of organisms already held, so a retry asks for the same page
   * and a page that arrives twice is appended once.
   */
  more(): void {
    if (this.loadingMore || this.organisms.length >= this.total) {return;}
    this.loadingMore = true;
    this.pageFailure = null;
    this.publish();
    this.api.getAnimaOrganisms$(this.organisms.length, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.loadingMore = false;
          this.append(page.organisms);
          this.total = page.total;
          this.publish();
        },
        error: (error: unknown) => {
          this.loadingMore = false;
          this.pageFailure = animaFailureFrom(error);
          this.publish();
        },
      });
  }

  private loadFirstPage(): void {
    this.api.getAnimaOrganisms$(0, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.organisms = [];
          this.append(page.organisms);
          this.total = page.total;
          this.publish();
        },
        error: (error: unknown) => this.fail(animaFailureFrom(error)),
      });
  }

  private fail(failure: AnimaFailure): void {
    this.state.next({
      kind: failure.kind === 'transport' || failure.kind === 'malformed' ? 'error' : 'degraded',
      failure,
      degradedReason: animaFailureText(failure),
    });
  }

  private append(organisms: readonly AnimaOrganism[]): void {
    const seen = new Set(this.organisms.map((organism) => organism.id));
    for (const organism of organisms) {
      if (seen.has(organism.id)) {continue;}
      seen.add(organism.id);
      this.organisms = this.organisms.concat(organism);
    }
  }

  private publish(): void {
    this.state.next({
      kind: 'ready',
      organisms: this.organisms,
      total: this.total,
      loadingMore: this.loadingMore,
      canLoadMore: this.organisms.length < this.total,
      pageFailure: this.pageFailure,
    });
  }
}
