import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AnimaOrganismDocument } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface AnimaItemViewModel {
  readonly kind: 'loading' | 'error' | 'missing' | 'ready';
  readonly organism?: AnimaOrganismDocument;
}

/**
 * One organism: identity, current vessel, full waymark timeline, and
 * achievements, exactly as the authority's record carries them.
 */
@Component({
  selector: 'app-anima-item',
  templateUrl: './anima-item.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaItemComponent implements OnInit {
  readonly vm$: Observable<AnimaItemViewModel>;
  readonly shorten = shortenIdentifier;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.vm$ = this.route.paramMap.pipe(
      map((params) => params.get('itemId') ?? ''),
      switchMap((itemId) => {
        if (!itemId) {
          return of({ state: 'missing' as const });
        }
        return api.getAnimaOrganism$(itemId).pipe(
          map((doc) => ({ state: 'served' as const, doc })),
          catchError((error) =>
            of({ state: error?.status === 404 ? ('missing' as const) : ('error' as const) }),
          ),
        );
      }),
      map((result): AnimaItemViewModel => {
        if (result.state === 'error') {return { kind: 'error' };}
        if (result.state === 'missing' || !('doc' in result)) {
          return { kind: 'missing' };
        }
        this.seo.setTitle(`ANIMA organism ${result.doc.organism.id}`);
        return { kind: 'ready', organism: result.doc };
      }),
    );
  }

  ngOnInit(): void {}
}
