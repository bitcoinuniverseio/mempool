import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, distinctUntilChanged, map, of, startWith } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AnimaEventDocument } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface AnimaTransitionViewModel {
  readonly kind: 'loading' | 'error' | 'missing' | 'ready';
  readonly event?: AnimaEventDocument;
}

const EVENT_ID_PATTERN = /^a\d+:\d+$/;

/**
 * One logged transition: the authority's record, its Bitcoin anchor, and
 * every organism it touched. A 404 is a proven miss; any other failure is
 * an error the page states as one.
 */
@Component({
  selector: 'app-anima-transition',
  templateUrl: './anima-transition.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaTransitionComponent implements OnInit {
  readonly vm$: Observable<AnimaTransitionViewModel>;
  readonly shorten = shortenIdentifier;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private seo: SeoService,
    private network: StateService,
  ) {
    const document$ = combineLatest([this.route.paramMap, this.network.networkChanged$.pipe(startWith(this.network.network), distinctUntilChanged())]).pipe(
      map(([params]) => params.get('eventId') ?? ''),
      switchMap((eventId) => {
        if (!EVENT_ID_PATTERN.test(eventId)) {
          return of({ state: 'missing' as const, eventId });
        }
        return api.getAnimaEvent$(eventId).pipe(
          map((doc) => ({ state: 'served' as const, eventId, doc })),
          catchError((error) =>
            of({
              state: error?.status === 404 ? ('missing' as const) : ('error' as const),
              eventId,
            }),
          ),
          startWith({ state: 'loading' as const }),
        );
      }),
    );

    this.vm$ = document$.pipe(
      map((result): AnimaTransitionViewModel => {
        if (result.state === 'loading') {return { kind: 'loading' };}
        if (result.state === 'error') {return { kind: 'error' };}
        if (result.state === 'missing' || !('doc' in result)) {
          return { kind: 'missing' };
        }
        this.seo.setTitle(`ANIMA transition ${result.doc.event.eventId}`);
        return { kind: 'ready', event: result.doc };
      }),
    );
  }

  ngOnInit(): void {}
}
