import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  AnimaEventsDocument,
  AnimaStatusDocument,
} from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface AnimaTransitionsViewModel {
  readonly kind: 'loading' | 'ready' | 'degraded' | 'error';
  readonly status?: AnimaStatusDocument | null;
  readonly events?: AnimaEventsDocument;
  readonly total?: number;
  readonly loadingMore?: boolean;
  readonly canLoadMore?: boolean;
  readonly degradedReason?: string | null;
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
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaTransitionsComponent implements OnInit {
  private readonly state = new BehaviorSubject<AnimaTransitionsViewModel>({ kind: 'loading' });
  readonly vm$: Observable<AnimaTransitionsViewModel> = this.state.asObservable();
  readonly shorten = shortenIdentifier;

  private status: AnimaStatusDocument | null = null;
  private events: AnimaEventsDocument['events'] = [];
  private total = 0;
  private loadingMore = false;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle($localize`ANIMA transitions`);
  }

  ngOnInit(): void {
    this.api.getAnimaStatus$()
      .pipe(catchError(() => of<AnimaStatusDocument | null>(null)))
      .subscribe((status) => {
        this.status = status;
        if (status === null) {
          this.state.next({ kind: 'error' });
          return;
        }
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
      });
  }

  more(): void {
    if (this.loadingMore || this.events.length >= this.total) {return;}
    this.loadingMore = true;
    this.publish();
    this.api.getAnimaEvents$(this.events.length, 50)
      .pipe(catchError(() => of<AnimaEventsDocument | null>(null)))
      .subscribe((page) => {
        this.loadingMore = false;
        if (page === null) {
          this.publish();
          return;
        }
        this.events = this.events.concat(page.events);
        this.total = page.total;
        this.publish();
      });
  }

  private loadFirstPage(): void {
    this.api.getAnimaEvents$(0, 50)
      .pipe(catchError(() => of<AnimaEventsDocument | null>(null)))
      .subscribe((page) => {
        if (page === null) {
          this.state.next({ kind: 'error' });
          return;
        }
        this.events = page.events;
        this.total = page.total;
        this.publish();
      });
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
    });
  }
}
