import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  BlockTemplateComparison,
  ObserverNode,
  PropagationObservation,
} from '@app/universe/universe.types';

interface NetworkViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly nodes?: ObserverNode[];
  readonly propagation?: PropagationObservation;
  readonly templates?: BlockTemplateComparison;
  readonly message?: string;
}

@Component({
  selector: 'app-network-observatory',
  templateUrl: './network-observatory.component.html',
  styleUrls: ['../product-page.scss', './network-observatory.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NetworkObservatoryComponent implements OnInit {
  private readonly state = new BehaviorSubject<NetworkViewModel>({ kind: 'loading' });
  readonly vm$: Observable<NetworkViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Cross-Node Mempool & Template Observatory');
  }

  ngOnInit(): void {
    // No per-read fallback: a fleet table the source could not answer is an
    // error with its reason, not an empty table under a live-looking timeline.
    combineLatest([
      this.api.getObserverNodes$(),
      this.api.getPropagationObservation$(),
      this.api.getBlockTemplateComparison$(),
    ]).pipe(
      map(([nodesData, propagation, templates]): NetworkViewModel => ({
        kind: 'ready',
        nodes: nodesData.nodes,
        propagation,
        templates,
      })),
      catchError((error) => of<NetworkViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
