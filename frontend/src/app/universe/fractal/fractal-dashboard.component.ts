import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { FractalBlockSummary, FractalMempoolOverview } from '@app/universe/universe.types';

interface FractalViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly tip?: { height: number; hash: string; time: number; network: string };
  readonly mempool?: FractalMempoolOverview;
  readonly latestBlock?: FractalBlockSummary;
}

@Component({
  selector: 'app-fractal-dashboard',
  templateUrl: './fractal-dashboard.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
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
    combineLatest([
      this.api.getFractalTip$().pipe(catchError(() => of(null))),
      this.api.getFractalMempool$().pipe(catchError(() => of(null))),
      this.api.getFractalBlock$('482910').pipe(catchError(() => of(null))),
    ]).subscribe(([tip, mempool, latestBlock]) => {
      if (!tip || !mempool || !latestBlock) {
        this.state.next({ kind: 'error' });
        return;
      }
      this.state.next({
        kind: 'ready',
        tip,
        mempool,
        latestBlock,
      });
    });
  }
}
