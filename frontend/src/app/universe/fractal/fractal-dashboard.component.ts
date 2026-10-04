import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, forkJoin, map, of, switchMap, Subject, startWith, takeUntil, merge } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { FractalBlockSummary, FractalMempoolOverview, FractalTip } from '@app/universe/universe.types';
import { fractalFailure } from './fractal-evidence';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface FractalViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly tip?: FractalTip;
  readonly mempoolFailure?: string;
  readonly blockFailure?: string;
  readonly mempool?: FractalMempoolOverview;
  readonly latestBlock?: FractalBlockSummary;
  readonly message?: string;
}

@Component({
  selector: 'app-fractal-dashboard',
  templateUrl: './fractal-dashboard.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FractalDashboardComponent implements OnInit, OnDestroy {
  private readonly destroyed = new Subject<void>();
  private readonly refresh = new Subject<void>();
  private readonly state = new BehaviorSubject<FractalViewModel>({ kind: 'loading' });
  readonly vm$: Observable<FractalViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Fractal Bitcoin Explorer');
  }

  ngOnInit(): void {
    merge(this.api.selectedNetwork$(), this.refresh).pipe(switchMap(() => this.api.getFractalTip$().pipe(
      switchMap(tip => forkJoin([
        this.api.getFractalMempool$().pipe(map(mempool => ({mempool})), catchError(error => of({mempoolFailure: fractalFailure(error)}))),
        this.api.getFractalBlock$(tip.hash).pipe(map(latestBlock => ({latestBlock})), catchError(error => of({blockFailure: fractalFailure(error)}))),
      ]).pipe(map(([mempool, block]): FractalViewModel => ({kind:'ready',tip,...mempool,...block})))),
      catchError(error => of<FractalViewModel>({kind:'error',message:fractalFailure(error)})),
      startWith<FractalViewModel>({kind:'loading'}),
    )), takeUntil(this.destroyed)).subscribe(vm => this.state.next(vm));
  }
  retry(): void {if (this.state.value.kind !== 'loading') this.refresh.next();}
  ngOnDestroy(): void {this.destroyed.next();this.destroyed.complete();}
}
