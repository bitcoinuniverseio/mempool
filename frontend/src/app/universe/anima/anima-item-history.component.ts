import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { AnimaOrganismHistoryDocument } from '@app/universe/universe.types';
import { shortenIdentifier } from '@app/universe/universe-evidence';

interface AnimaHistoryViewModel {
  readonly kind: 'loading' | 'error' | 'missing' | 'ready';
  readonly history?: AnimaOrganismHistoryDocument;
}

/**
 * One organism's transition history: its waymarks and achievements beside
 * the lineage document the authority derives from the state machine.
 */
@Component({
  selector: 'app-anima-item-history',
  templateUrl: './anima-item-history.component.html',
  styleUrls: ['./anima-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnimaItemHistoryComponent implements OnInit {
  readonly vm$: Observable<AnimaHistoryViewModel>;
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
        return api.getAnimaOrganismHistory$(itemId).pipe(
          map((doc) => ({ state: 'served' as const, doc })),
          catchError((error) =>
            of({ state: error?.status === 404 ? ('missing' as const) : ('error' as const) }),
          ),
        );
      }),
      map((result): AnimaHistoryViewModel => {
        if (result.state === 'error') {return { kind: 'error' };}
        if (result.state === 'missing' || !('doc' in result)) {
          return { kind: 'missing' };
        }
        this.seo.setTitle(`ANIMA organism ${result.doc.organism.id} history`);
        return { kind: 'ready', history: result.doc };
      }),
    );
  }

  ngOnInit(): void {}
}