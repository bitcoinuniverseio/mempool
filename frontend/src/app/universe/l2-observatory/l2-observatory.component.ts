import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

import {
  L2BridgeSystem,
  L2Challenge,
} from '@app/universe/universe.types';

interface L2ViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly systems?: L2BridgeSystem[];
  readonly challenges?: L2Challenge[];
  readonly message?: string;
}

@Component({
  selector: 'app-l2-observatory',
  templateUrl: './l2-observatory.component.html',
  styleUrls: ['../product-page.scss', './l2-observatory.component.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2ObservatoryComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<L2ViewModel>({ kind: 'loading' });
  readonly vm$: Observable<L2ViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('BitVM & Bitcoin L2 Bridge Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: a bridge table the source could not answer is an
    // error with its reason, not an empty table.
    combineLatest([
      this.api.getL2Systems$(),
      this.api.getL2Challenges$(),
    ]).pipe(
      map(([systemsData, challengesData]): L2ViewModel => ({
        kind: 'ready',
        systems: systemsData.systems,
        challenges: challengesData.challenges,
      })),
      catchError((error) => of<L2ViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
