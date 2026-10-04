import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, Optional } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { StateService } from '@app/services/state.service';
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
export class L2ObservatoryComponent implements OnInit, OnDestroy {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<L2ViewModel>({ kind: 'loading' });
  readonly vm$: Observable<L2ViewModel> = this.state.asObservable();
  private reads?: Subscription;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    @Optional() private networkState: StateService = null,
    @Optional() private route: ActivatedRoute = null,
  ) {
    this.seo.setTitle('BitVM & Bitcoin L2 Bridge Observatory');
  }

  ngOnInit(): void {
    const network = this.networkState?.networkChanged$.pipe(startWith(this.networkState.network), distinctUntilChanged()) ?? of(null);
    this.reads = combineLatest([this.route?.paramMap ?? of(null), network]).pipe(
      switchMap(([params]) => {
        this.state.next({ kind: 'loading' });
        const systemId = params?.get('systemId');
        const systems = systemId ? this.api.getL2System$(systemId).pipe(map(system => {
          if (!system || system.id !== systemId) { throw new Error('The bridge detail does not match the selected system.'); }
          return { systems: [system] };
        })) : this.api.getL2Systems$();
        // Failed reads remain an error; an unavailable source cannot become an empty directory.
        return combineLatest([systems, this.api.getL2Challenges$(systemId ?? undefined)]).pipe(
          map(([systemsData, challengesData]): L2ViewModel => {
            if (!Array.isArray(systemsData?.systems) || !Array.isArray(challengesData?.challenges)) { throw new Error('The bridge source returned incomplete observations.'); }
            if (systemId && challengesData.challenges.some(challenge => !challenge || challenge.systemId !== systemId)) { throw new Error('The challenges do not match the selected bridge system.'); }
            return { kind: 'ready', systems: systemsData.systems, challenges: challengesData.challenges };
          }),
          catchError(error => of<L2ViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
        );
      }),
    ).subscribe((vm) => this.state.next(vm));
  }

  ngOnDestroy(): void {
    this.reads?.unsubscribe();
    this.state.next({ kind: 'loading' });
    this.state.complete();
  }
}
