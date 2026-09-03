import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinCreature } from '@app/universe/universe.types';

interface CreaturesViewModel {
  readonly kind: 'loading' | 'ready' | 'detail' | 'error';
  readonly creatures?: WildkinCreature[];
  readonly selected?: WildkinCreature;
}

@Component({
  selector: 'app-wildkin-creatures',
  templateUrl: './wildkin-creatures.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WildkinCreaturesComponent implements OnInit {
  private readonly state = new BehaviorSubject<CreaturesViewModel>({ kind: 'loading' });
  readonly vm$: Observable<CreaturesViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private route: ActivatedRoute,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Wildkin Creatures');
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap((params) => {
        const id = params.get('id');
        if (id) {
          return this.api.getWildkinCreature$(id).pipe(
            switchMap((creature) => of<CreaturesViewModel>({ kind: 'detail', selected: creature })),
            catchError(() => of<CreaturesViewModel>({ kind: 'error' }))
          );
        }
        return this.api.getWildkinCreatures$().pipe(
          switchMap((data) => of<CreaturesViewModel>({ kind: 'ready', creatures: data.creatures })),
          catchError(() => of<CreaturesViewModel>({ kind: 'error' }))
        );
      })
    ).subscribe((vm) => this.state.next(vm));
  }
}
