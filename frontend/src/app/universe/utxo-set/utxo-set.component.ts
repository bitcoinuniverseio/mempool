import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ProtocolBearingUtxos,
  ScriptTypeDistribution,
  SupplyCohort,
  UtreexoRootsView,
  UtxoCheckpoint,
} from '@app/universe/universe.types';

interface UtxoViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly checkpoints?: UtxoCheckpoint[];
  readonly valueCohorts?: SupplyCohort[];
  readonly scriptTypes?: ScriptTypeDistribution[];
  readonly protocolUtxos?: ProtocolBearingUtxos;
  readonly utreexo?: UtreexoRootsView;
}

@Component({
  selector: 'app-utxo-set',
  templateUrl: './utxo-set.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtxoSetComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<UtxoViewModel>({ kind: 'loading' });
  readonly vm$: Observable<UtxoViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('UTXO-Set, Supply & Utreexo Observatory');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getUtxoCheckpoints$().pipe(catchError(() => of({ checkpoints: [] }))),
      this.api.getUtxoDistribution$().pipe(catchError(() => of({ valueCohorts: [], scriptTypes: [] }))),
      this.api.getProtocolBearingUtxos$().pipe(catchError(() => of(null))),
      this.api.getUtreexoRoots$().pipe(catchError(() => of(null))),
    ]).subscribe(([checkpointsData, distData, protocolUtxos, utreexo]) => {
      this.state.next({
        kind: 'ready',
        checkpoints: checkpointsData.checkpoints,
        valueCohorts: distData.valueCohorts,
        scriptTypes: distData.scriptTypes,
        protocolUtxos: protocolUtxos || undefined,
        utreexo: utreexo || undefined,
      });
    });
  }
}
