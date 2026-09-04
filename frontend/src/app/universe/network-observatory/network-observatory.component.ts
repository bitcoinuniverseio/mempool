import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
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
    combineLatest([
      this.api.getObserverNodes$().pipe(catchError(() => of({ nodes: [] }))),
      this.api.getPropagationObservation$().pipe(catchError(() => of(null))),
      this.api.getBlockTemplateComparison$().pipe(catchError(() => of(null))),
    ]).subscribe(([nodesData, propagation, templates]) => {
      if (!propagation || !templates) {
        this.state.next({ kind: 'error' });
        return;
      }
      this.state.next({
        kind: 'ready',
        nodes: nodesData.nodes,
        propagation,
        templates,
      });
    });
  }
}
