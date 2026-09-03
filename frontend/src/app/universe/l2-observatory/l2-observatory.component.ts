import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  L2BridgeSystem,
  L2Challenge,
} from '@app/universe/universe.types';

interface L2ViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly systems?: L2BridgeSystem[];
  readonly challenges?: L2Challenge[];
}

@Component({
  selector: 'app-l2-observatory',
  templateUrl: './l2-observatory.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2ObservatoryComponent implements OnInit {
  private readonly state = new BehaviorSubject<L2ViewModel>({ kind: 'loading' });
  readonly vm$: Observable<L2ViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('BitVM & Bitcoin L2 Bridge Observatory');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getL2Systems$().pipe(catchError(() => of({ systems: [] }))),
      this.api.getL2Challenges$().pipe(catchError(() => of({ challenges: [] }))),
    ]).subscribe(([systemsData, challengesData]) => {
      this.state.next({
        kind: 'ready',
        systems: systemsData.systems,
        challenges: challengesData.challenges,
      });
    });
  }
}
