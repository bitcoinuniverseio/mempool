import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { FractalBlockSummary, FractalMempoolOverview } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface FractalViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly tip?: { height: number; hash: string; time: number; network: string };
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
export class FractalDashboardComponent implements OnInit {
  private readonly state = new BehaviorSubject<FractalViewModel>({ kind: 'loading' });
  readonly vm$: Observable<FractalViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Fractal Bitcoin Explorer');
  }

  ngOnInit(): void {
    // The latest block is the one at the reported tip, not a fixed height.
    // A read the source could not answer is an error with its reason, never
    // a blank panel.
    this.api.getFractalTip$().pipe(
      switchMap((tip) => combineLatest([
        of(tip),
        this.api.getFractalMempool$(),
        this.api.getFractalBlock$(String(tip.height)),
      ])),
      map(([tip, mempool, latestBlock]): FractalViewModel => ({ kind: 'ready', tip, mempool, latestBlock })),
      catchError((error) => of<FractalViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
