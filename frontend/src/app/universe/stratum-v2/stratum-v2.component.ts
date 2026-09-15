import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

import {
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
} from '@app/universe/universe.types';

interface StratumViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly roles?: StratumV2RoleStatus[];
  readonly templates?: StratumV2Template[];
  readonly declarations?: StratumV2JobDeclaration[];
  readonly message?: string;
}

@Component({
  selector: 'app-stratum-v2',
  templateUrl: './stratum-v2.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StratumV2Component implements OnInit, OnDestroy {
  private subscription?: Subscription;
  private readonly state = new BehaviorSubject<StratumViewModel>({ kind: 'loading' });
  readonly vm$: Observable<StratumViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private network: StateService,
  ) {
    this.seo.setTitle('Stratum V2 Job-Declaration Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: a role or template table the source could not
    // answer is an error with its reason, not an empty table.
    this.subscription = this.network.networkChanged$.pipe(
      startWith(this.network.network), distinctUntilChanged(),
      tap(() => this.state.next({ kind: 'loading' })),
      switchMap(() => combineLatest([
      this.api.getStratumV2Network$(),
      this.api.getStratumV2Templates$(),
      this.api.getStratumV2Declarations$(),
    ]).pipe(
      map(([networkData, tmplData, declData]): StratumViewModel => {
        if (!Array.isArray(networkData?.roles) || !Array.isArray(tmplData?.templates) || !Array.isArray(declData?.declarations)
          || declData.declarations.some(job => !job || !Array.isArray(job.minerDeclaredTxids) || !Array.isArray(job.poolModifiedTxids))) {
          return { kind: 'error', message: 'The source returned incomplete Stratum V2 telemetry.' };
        }
        return { kind: 'ready', roles: networkData.roles, templates: tmplData.templates, declarations: declData.declarations };
      }),
      catchError((error) => of<StratumViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    )),
    ).subscribe((vm) => this.state.next(vm));
  }

  ngOnDestroy(): void { this.subscription?.unsubscribe(); }
}
