import { ChangeDetectionStrategy, Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  AnimaEventsDocument,
  AnimaLoggedEvent,
  AnimaStatusDocument,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';
import { AnimaFailure, animaFailureFrom, animaFailureText, animaFailureTitle } from './anima-failure';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

export interface AnimaTransitionsViewModel {
  readonly kind: 'loading' | 'ready' | 'degraded' | 'error';
  readonly status?: AnimaStatusDocument | null;
  readonly events?: AnimaEventsDocument;
  readonly total?: number;
  readonly loadingMore?: boolean;
  readonly canLoadMore?: boolean;
  readonly degradedReason?: string | null;
  /** Why the page could not be read at all, or why the next page failed. */
  readonly failure?: AnimaFailure;
  /** A failed next page keeps every event already shown; this says so. */
  readonly pageFailure?: AnimaFailure | null;
}

/**
 * The logged transition list, straight from the authority's event log.
 *
 * The same component serves /anima/transitions and /anima/events, because
 * the protocol has exactly one kind of event and two names for the page
 * would invite the two pages to drift.
 */
@Component({
  selector: 'app-anima-transitions',
  templateUrl: './anima-transitions.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaTransitionsComponent implements OnInit {
  private readonly state = new BehaviorSubject<AnimaTransitionsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<AnimaTransitionsViewModel> = this.state.asObservable();
  readonly shorten = shortenIdentifier;
  readonly failureText = animaFailureText;
  readonly failureTitle = animaFailureTitle;

  private status: AnimaStatusDocument | null = null;
  private events: AnimaLoggedEvent[] = [];
  private total = 0;
  private loadingMore = false;
  private pageFailure: AnimaFailure | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private destroyRef: DestroyRef,
  ) {
    this.seo.setTitle($localize`ANIMA transitions`);
  }

  ngOnInit(): void {
    this.api.getAnimaStatus$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (status) => {
          this.status = status;
          if (status.state !== 'served') {
            this.state.next({
              kind: 'degraded',
              degradedReason:
                status.degradedReason
                ?? 'The ANIMA authority is not answering, so no transitions are shown.',
            });
            return;
          }
          this.loadFirstPage();
        },
        error: (error: unknown) => {
          const failure = animaFailureFrom(error);
          this.state.next({ kind: failure.kind === 'transport' || failure.kind === 'malformed' ? 'error' : 'degraded', failure, degradedReason: animaFailureText(failure) });
        },
      });
  }

  /**
   * Loads the next page, or retries the one that failed. The continuation is
   * the count of events already held, so a retry asks for the same page and
   * a page that arrives twice is appended once.
   */
  more(): void {
    if (this.loadingMore || this.events.length >= this.total) {return;}
    this.loadingMore = true;
    this.pageFailure = null;
    this.publish();
    this.api.getAnimaEvents$(this.events.length, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.loadingMore = false;
          this.append(page.events);
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
    this.api.getAnimaEvents$(0, 50)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.events = [];
          this.append(page.events);
          this.total = page.total;
          this.publish();
        },
        error: (error: unknown) => {
          const failure = animaFailureFrom(error);
          this.state.next({ kind: failure.kind === 'transport' || failure.kind === 'malformed' ? 'error' : 'degraded', failure, degradedReason: animaFailureText(failure) });
        },
      });
  }

  private append(events: readonly AnimaLoggedEvent[]): void {
    const seen = new Set(this.events.map((event) => event.eventId));
    for (const event of events) {
      if (seen.has(event.eventId)) {continue;}
      seen.add(event.eventId);
      this.events = this.events.concat(event);
    }
  }

  private publish(): void {
    this.state.next({
      kind: 'ready',
      status: this.status ?? undefined,
      events: {
        schemaVersion: 'universe-anima-v1',
        authorityId: 'index-anima',
        state: 'served',
        total: this.total,
        from: 0,
        events: this.events,
        degradedReason: null,
      },
      total: this.total,
      loadingMore: this.loadingMore,
      canLoadMore: this.events.length < this.total,
      pageFailure: this.pageFailure,
    });
  }
}
