import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { LiquidNodeView } from './liquid-node-view';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

import {
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
} from '@app/universe/universe.types';

interface LiquidViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly summary?: LiquidObservatorySummary;
  readonly assets?: LiquidAssetRecord[];
  readonly pegs?: LiquidPegRecord[];
  readonly federation?: LiquidFederationEpoch;
  readonly message?: string;
}

@Component({
  selector: 'app-liquid-observatory',
  templateUrl: './liquid-observatory.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidObservatoryComponent implements OnInit, OnDestroy {
  network = 'liquidv1';
  private readonly nodeNetwork = new BehaviorSubject('liquidv1');
  readonly node$ = this.nodeNetwork.pipe(switchMap(network => this.api.getLiquidNode$(network).pipe(
    map(node => ({node, error: null as string | null, loading: false})),
    catchError(error => of({node: null as LiquidNodeView | null, error: error?.error?.error || 'Owned Elements checkpoint unavailable.', loading: false})),
    startWith({node: null as LiquidNodeView | null, error: null as string | null, loading: true}),
  )));
  private reads?: Subscription;
  refreshNode(): void { this.nodeNetwork.next(this.network); }
  ngOnDestroy(): void { this.reads?.unsubscribe(); this.nodeNetwork.complete(); this.state.complete(); }
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<LiquidViewModel>({ kind: 'loading' });
  readonly vm$: Observable<LiquidViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Liquid Confidential-Asset, Peg, and Federation Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: an asset or peg table the source could not answer
    // is an error with its reason, not an empty table.
    this.reads = combineLatest([
      this.api.getLiquidObservatorySummary$(),
      this.api.getLiquidAssets$(),
      this.api.getLiquidPegs$(),
      this.api.getLiquidFederation$(),
    ]).pipe(
      map(([summary, assetsData, pegsData, federation]): LiquidViewModel => ({
        kind: 'ready',
        summary,
        assets: assetsData.assets,
        pegs: pegsData.pegs,
        federation,
      })),
      catchError((error) => of<LiquidViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
