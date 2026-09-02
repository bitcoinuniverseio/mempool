import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AnimaEventDocument } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

type AnimaTransitionViewModel =
  | { readonly kind: 'loading' | 'error' }
  | { readonly kind: 'missing'; readonly eventId: string }
  | { readonly kind: 'ready'; readonly event: AnimaEventDocument };

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
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaTransitionComponent implements OnInit {
  readonly vm$: Observable<AnimaTransitionViewModel>;
  readonly shorten = shortenIdentifier;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    const document$ = this.route.paramMap.pipe(
      map((params) => params.get('eventId') ?? ''),
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
        );
      }),
    );

    this.vm$ = document$.pipe(
      map((result): AnimaTransitionViewModel => {
        if (result.state === 'error') {return { kind: 'error' };}
        if (result.state === 'missing' || !('doc' in result)) {
          return { kind: 'missing', eventId: result.eventId };
        }
        this.seo.setTitle(`ANIMA transition ${result.doc.event.eventId}`);
        return { kind: 'ready', event: result.doc };
      }),
    );
  }

  ngOnInit(): void {}
}
